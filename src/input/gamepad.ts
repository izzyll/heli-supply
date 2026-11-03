import type { AxisAction, Bindings, ButtonAction } from '../core/state';
import { clamp } from '../core/rng';

export interface PadSnapshot { id: string; index: number; mapping: string; axes: number[]; buttons: number[] }

export type CaptureTarget = { type: 'axis'; action: AxisAction } | { type: 'button'; action: ButtonAction };

/** Polls every connected controller (a HOTAS often shows up as 2–3 separate devices). */
export class GamepadInput {
  pads: PadSnapshot[] = [];
  axes: Record<AxisAction, number> = { collective: 0, pitch: 0, roll: 0, yaw: 0 };
  axisActive: Record<AxisAction, boolean> = { collective: false, pitch: false, roll: false, yaw: false };
  buttons: Partial<Record<ButtonAction, boolean>> = {};
  pressed = new Set<ButtonAction>();
  capture: CaptureTarget | null = null;
  private baseline = new Map<string, number[]>();
  private baselineBtn = new Map<string, number[]>();
  onCaptured: ((t: CaptureTarget, pad: string, index: number) => void) | null = null;

  constructor(private bindings: () => Bindings) {}

  startCapture(t: CaptureTarget) {
    this.capture = t;
    this.baseline.clear();
    this.baselineBtn.clear();
    for (const p of this.pads) { this.baseline.set(p.id, [...p.axes]); this.baselineBtn.set(p.id, [...p.buttons]); }
  }

  cancelCapture() { this.capture = null; }

  poll() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pads = [];
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      this.pads.push({ id: gp.id, index: gp.index, mapping: gp.mapping, axes: [...gp.axes], buttons: gp.buttons.map((b) => b.value) });
    }
    const B = this.bindings();
    const prev = this.buttons;
    this.buttons = {};
    this.pressed.clear();
    for (const k of Object.keys(this.axes) as AxisAction[]) { this.axes[k] = 0; this.axisActive[k] = false; }

    if (this.capture) { this.doCapture(); return; }

    const apply = (raw: number, deadzone: number) => {
      const a = Math.abs(raw);
      if (a < deadzone) return 0;
      const v = Math.sign(raw) * ((a - deadzone) / (1 - deadzone));
      return (1 - B.expo) * v + B.expo * v * v * v;
    };

    for (const action of Object.keys(this.axes) as AxisAction[]) {
      const bind = B.axes[action];
      if (bind) {
        const pad = this.pads.find((p) => p.id === bind.pad);
        if (!pad || pad.axes[bind.index] === undefined) continue;
        let v = pad.axes[bind.index];
        if (bind.invert) v = -v;
        // throttle levers sit at an end stop; don't apply the deadzone there
        const val = action === 'collective' ? clamp(v, -1, 1) : apply(v, B.deadzone);
        this.axes[action] = val;
        this.axisActive[action] = action === 'collective' ? true : Math.abs(val) > 0.02;
      }
    }
    // Standard-mapping gamepads get sensible defaults for anything not bound
    const std = this.pads.find((p) => p.mapping === 'standard');
    if (std) {
      const def: [AxisAction, number, boolean][] = [['yaw', 0, false], ['collective', 1, true], ['roll', 2, false], ['pitch', 3, true]];
      for (const [action, idx, inv] of def) {
        if (B.axes[action]) continue;
        const v = apply((inv ? -1 : 1) * (std.axes[idx] ?? 0), B.deadzone);
        if (Math.abs(v) > 0.02) { this.axes[action] = v; this.axisActive[action] = true; }
      }
      const defBtn: [ButtonAction, number][] = [['drop', 0], ['chute', 1], ['hook', 2], ['camera', 3], ['recover', 4], ['base', 5], ['map', 8], ['pause', 9]];
      for (const [action, idx] of defBtn) if (!B.buttons[action] && (std.buttons[idx] ?? 0) > 0.5) this.buttons[action] = true;
    }
    for (const action of Object.keys(B.buttons) as ButtonAction[]) {
      const bind = B.buttons[action]!;
      const pad = this.pads.find((p) => p.id === bind.pad);
      if (pad && (pad.buttons[bind.index] ?? 0) > 0.5) this.buttons[action] = true;
    }
    for (const k of Object.keys(this.buttons) as ButtonAction[]) if (this.buttons[k] && !prev[k]) this.pressed.add(k);
  }

  private doCapture() {
    const t = this.capture!;
    for (const p of this.pads) {
      if (!this.baseline.has(p.id)) { this.baseline.set(p.id, [...p.axes]); this.baselineBtn.set(p.id, [...p.buttons]); continue; }
      if (t.type === 'axis') {
        const base = this.baseline.get(p.id)!;
        let best = -1, bestD = 0.5;
        p.axes.forEach((v, i) => { const d = Math.abs(v - (base[i] ?? 0)); if (d > bestD) { bestD = d; best = i; } });
        if (best >= 0) { this.capture = null; this.onCaptured?.(t, p.id, best); return; }
      } else {
        const base = this.baselineBtn.get(p.id)!;
        const i = p.buttons.findIndex((v, k) => v > 0.5 && (base[k] ?? 0) < 0.5);
        if (i >= 0) { this.capture = null; this.onCaptured?.(t, p.id, i); return; }
      }
    }
  }
}
