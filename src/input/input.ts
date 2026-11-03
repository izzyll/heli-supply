import type { ButtonAction, Settings } from '../core/state';
import { clamp } from '../core/rng';
import { GamepadInput } from './gamepad';

export interface ControlState {
  collective: number; // -1..1, 0 = hover
  pitch: number;      // +1 = nose down (forward)
  roll: number;       // +1 = roll right
  yaw: number;        // +1 = yaw right
  cyclicActive: boolean;
  collectiveActive: boolean;
  lever: number;      // 0..1 absolute collective lever (realistic mode); stays where it is left
}

const KEY_ACTIONS: Record<string, ButtonAction> = {
  KeyE: 'drop', KeyF: 'hook', KeyV: 'camera', KeyP: 'chute', KeyR: 'recover', KeyB: 'base', KeyM: 'map', KeyG: 'flightmode', Escape: 'pause',
};

/** Merges keyboard, pointer-locked mouse (virtual stick) and gamepads/HOTAS into one ControlState. */
export class Input {
  keys = new Set<string>();
  ctl: ControlState = { collective: 0, pitch: 0, roll: 0, yaw: 0, cyclicActive: false, collectiveActive: false, lever: 0 };
  pressed = new Set<ButtonAction>();
  held = new Set<ButtonAction>();
  private keyPressed = new Set<ButtonAction>();
  stick = { x: 0, y: 0 };
  /** Realistic-mode collective lever, 0 = bottom (flat pitch), ~0.5 = hover, 1 = full. */
  lever = 0;
  mouseActive = false;
  lookX = 0; lookY = 0; zoom = 0;
  rightDown = false;
  locked = false;
  gamepad: GamepadInput;
  onOtherKey: ((code: string) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private settings: () => Settings) {
    this.gamepad = new GamepadInput(() => this.settings().bindings);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!e.repeat) {
        const a = KEY_ACTIONS[e.code];
        if (a) this.keyPressed.add(a);
        this.onOtherKey?.(e.code);
      }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.canvas; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => { if (e.button === 2) this.rightDown = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.rightDown = false; });
    window.addEventListener('mousemove', (e) => {
      const s = this.settings();
      if (this.rightDown) { this.lookX += e.movementX; this.lookY += e.movementY; return; }
      if (!this.locked) return;
      const k = 0.0022 * s.mouseSens;
      this.stick.x = clamp(this.stick.x + e.movementX * k, -1, 1);
      this.stick.y = clamp(this.stick.y + e.movementY * k * (s.invertMouse ? -1 : 1), -1, 1);
      this.mouseActive = true;
    });
    canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); }, { passive: true });
  }

  lock() {
    if (this.locked) return;
    try { const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* needs a user gesture */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  update(dt: number) {
    const s = this.settings();
    const k = (c: string) => this.keys.has(c);
    this.gamepad.poll();
    const gp = this.gamepad;

    // keyboard
    let col = (k('KeyW') || k('Space') || k('ShiftLeft') ? 1 : 0) - (k('KeyS') || k('KeyX') ? 1 : 0);
    let yaw = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    const kbPitch = (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0);
    const kbRoll = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
    if (k('KeyC')) { this.stick.x = 0; this.stick.y = 0; }

    // mouse virtual stick slowly recentres
    const rc = s.mouseRecenter * dt;
    this.stick.x -= Math.sign(this.stick.x) * Math.min(Math.abs(this.stick.x), rc);
    this.stick.y -= Math.sign(this.stick.y) * Math.min(Math.abs(this.stick.y), rc);
    const mousePitch = -this.stick.y; // mouse forward (up) = nose down
    const mouseRoll = this.stick.x;

    let pitch = kbPitch + (this.locked ? mousePitch : 0) + gp.axes.pitch;
    let roll = kbRoll + (this.locked ? mouseRoll : 0) + gp.axes.roll;
    col += gp.axes.collective;
    yaw += gp.axes.yaw;

    this.ctl.collective = clamp(col, -1, 1);
    this.ctl.pitch = clamp(pitch, -1, 1);
    this.ctl.roll = clamp(roll, -1, 1);
    this.ctl.yaw = clamp(yaw, -1, 1);
    this.ctl.cyclicActive = kbPitch !== 0 || kbRoll !== 0 || gp.axisActive.pitch || gp.axisActive.roll ||
      (this.locked && (Math.abs(this.stick.x) > 0.04 || Math.abs(this.stick.y) > 0.04));
    this.ctl.collectiveActive = col !== 0 || gp.axisActive.collective;
    // realistic lever: a bound HOTAS throttle is absolute; keys / spring-centred sticks move the lever and it stays
    if (s.bindings.axes.collective && gp.axisActive.collective) this.lever = clamp((gp.axes.collective + 1) / 2, 0, 1);
    else this.lever = clamp(this.lever + clamp(col, -1, 1) * 0.45 * dt, 0, 1);
    this.ctl.lever = this.lever;

    // actions
    this.pressed = new Set([...this.keyPressed, ...gp.pressed]);
    this.keyPressed.clear();
    this.held.clear();
    for (const [code, a] of Object.entries(KEY_ACTIONS)) if (this.keys.has(code)) this.held.add(a);
    for (const a of Object.keys(gp.buttons) as ButtonAction[]) if (gp.buttons[a]) this.held.add(a);
  }

  consumeLook(): [number, number, number] {
    const r: [number, number, number] = [this.lookX, this.lookY, this.zoom];
    this.lookX = this.lookY = this.zoom = 0;
    return r;
  }
}
