import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CRATE_MASS, CRATE_SIZE, FIXED_DT, GRAVITY, ROPE_LENGTH, WATER_LEVEL } from '../core/config';
import type { UpStats } from '../core/upgrades';
import type { Physics, Tag } from '../physics/world';
import type { Heli } from '../heli/heli';

export type CrateState = 'staged' | 'slung' | 'free' | 'loose' | 'gone';

export interface Crate {
  id: number;
  contractId: number;
  weight: number;
  size: number;
  mass: number;
  body: RAPIER.RigidBody;
  mesh: THREE.Group;
  state: CrateState;
  integrity: number;
  joint: RAPIER.ImpulseJoint | null;
  rope: THREE.Line | null;
  chuteArmed: boolean;
  chuteOpen: number; // 0..1
  chuteMesh: THREE.Group | null;
  chuteDone: boolean;
  releaseT: number;
  releaseSpeed: number;
  releaseHoriz: number;
  releaseAgl: number;
  settleT: number;
  age: number;
  touched: boolean;
  broken: boolean;
  usedChute: boolean;
  looseT: number;
  impactWin: number;
  impactPeak: number;
  /** Pose before the last physics step (render interpolation). */
  pp?: THREE.Vector3;
  pq?: THREE.Quaternion;
}

const _rp = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion();

export const CRATE_DRAG = 0.004;
export const CHUTE_DRAG = 0.8;

export function chuteDelay(up: UpStats) { return Math.max(0.6, 1.5 - 0.15 * up.chute); }

function crateTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#6b6a3e'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#646338' : '#71703f'; g.fillRect(0, i * 22, 128, 20); }
  g.strokeStyle = '#3c3b22'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120);
  g.beginPath(); g.moveTo(4, 4); g.lineTo(124, 124); g.stroke();
  g.fillStyle = '#e8e2c4'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
  g.fillText('SUPPLY', 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CrateManager {
  crates: Crate[] = [];
  private nextId = 1;
  private tex = crateTexture();
  private mats: THREE.MeshStandardMaterial[];
  private debris: { body: RAPIER.RigidBody; mesh: THREE.Mesh; t: number }[] = [];
  onSettled: (c: Crate) => void = () => {};
  onBroken: (c: Crate) => void = () => {};
  onLost: (c: Crate) => void = () => {};
  onChute: (c: Crate) => void = () => {};
  onImpact: (c: Crate, dv: number) => void = () => {};

  constructor(private scene: THREE.Scene, private physics: Physics, private groundAt: (x: number, z: number) => number) {
    this.mats = [0xffffff, 0xd8c8a0, 0xa8b8a0].map((c) => new THREE.MeshStandardMaterial({ map: this.tex, color: c, roughness: 0.85, flatShading: true }));
  }

  spawn(x: number, y: number, z: number, weight: number, contractId: number, state: CrateState, vel?: THREE.Vector3, angvel?: THREE.Vector3, yaw = 0): Crate {
    const size = CRATE_SIZE[weight], mass = CRATE_MASS[weight];
    const half = size / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(0.05).setAngularDamping(1.6).setCcdEnabled(true),
    );
    const crate: Crate = {
      id: this.nextId++, contractId, weight, size, mass, body, state, integrity: 1, joint: null, rope: null,
      chuteArmed: false, chuteOpen: 0, chuteMesh: null, chuteDone: false, releaseT: 0, releaseSpeed: 0, releaseHoriz: 0,
      releaseAgl: 0, settleT: 0, age: 0, touched: false, broken: false, usedChute: false, looseT: 0, impactWin: 0, impactPeak: 0,
      mesh: new THREE.Group(),
    };
    this.physics.addCollider(
      RAPIER.ColliderDesc.cuboid(half, half, half).setDensity(mass / (size * size * size)).setFriction(0.55).setRestitution(0.02)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(mass * GRAVITY * 1.5),
      { kind: 'crate', ref: crate }, body,
    );
    if (vel) body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    if (angvel) body.setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z }, true);
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), this.mats[weight]);
    box.castShadow = box.receiveShadow = true;
    crate.mesh.add(box);
    // straps
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x2b2b22 });
    for (const r of [0, Math.PI / 2]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(size + 0.04, size + 0.04, 0.12), strapMat);
      s.rotation.y = r;
      crate.mesh.add(s);
    }
    this.scene.add(crate.mesh);
    this.crates.push(crate);
    return crate;
  }

  /** Stage crates for a contract in a neat row at a yard. */
  stage(x: number, y: number, z: number, n: number, weight: number, contractId: number) {
    const size = CRATE_SIZE[weight];
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const r = n === 1 ? 0 : 3.2;
      this.spawn(x + Math.cos(a) * r, y + size / 2 + 0.05, z + Math.sin(a) * r, weight, contractId, 'staged', undefined, undefined, a);
    }
  }

  slung(): Crate | undefined { return this.crates.find((c) => c.state === 'slung'); }

  findHookable(heli: Heli, up: UpStats): Crate | null {
    const hook = heli.worldPoint(heli.model.hookPoint);
    let best: Crate | null = null, bestD = Infinity;
    for (const c of this.crates) {
      if (c.state !== 'staged' && c.state !== 'loose') continue;
      const p = c.body.translation();
      const top = new THREE.Vector3(p.x, p.y + c.size / 2, p.z);
      const horiz = Math.hypot(top.x - hook.x, top.z - hook.z);
      const vert = hook.y - top.y;
      const maxLen = ROPE_LENGTH + up.ropeTol;
      if (horiz > up.hookR || vert < 0.3 || vert > maxLen) continue;
      const d = hook.distanceTo(top);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  hook(c: Crate, heli: Heli) {
    const hookLocal = heli.model.hookPoint;
    const p = c.body.translation();
    const hook = heli.worldPoint(hookLocal);
    const d = hook.distanceTo(new THREE.Vector3(p.x, p.y + c.size / 2, p.z));
    const len = Math.max(3, d + 0.2);
    const params = RAPIER.JointData.rope(len, { x: hookLocal.x, y: hookLocal.y, z: hookLocal.z }, { x: 0, y: c.size / 2, z: 0 });
    c.joint = this.physics.world.createImpulseJoint(params, heli.body, c.body, true);
    c.state = 'slung';
    c.body.wakeUp();
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    c.rope = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x222222 }));
    c.rope.frustumCulled = false;
    this.scene.add(c.rope);
  }

  private markReleased(c: Crate, armed: boolean, up: UpStats) {
    const v = c.body.linvel();
    const p = c.body.translation();
    c.state = 'free';
    c.releaseT = 0;
    c.releaseSpeed = Math.hypot(v.x, v.y, v.z);
    c.releaseHoriz = Math.hypot(v.x, v.z);
    c.releaseAgl = p.y - this.groundAt(p.x, p.z);
    c.chuteArmed = armed && up.chute > 0 && c.releaseAgl > 18;
    c.settleT = 0;
    c.touched = false;
  }

  /** Release the slung crate. It keeps its own physical velocity (swing + helicopter motion). */
  releaseSlung(armed: boolean, up: UpStats): Crate | null {
    const c = this.slung();
    if (!c) return null;
    if (c.joint) { this.physics.world.removeImpulseJoint(c.joint, true); c.joint = null; }
    if (c.rope) { this.scene.remove(c.rope); c.rope.geometry.dispose(); c.rope = null; }
    this.markReleased(c, armed, up);
    return c;
  }

  /** Drop a crate out of the internal bay: it inherits the helicopter's velocity (inertia). */
  dropInternal(heli: Heli, weight: number, contractId: number, armed: boolean, up: UpStats): Crate {
    const size = CRATE_SIZE[weight];
    const local = heli.model.hookPoint.clone().add(new THREE.Vector3(0, -size / 2 - 0.5, 0));
    const p = heli.worldPoint(local);
    const lv = heli.body.linvel(), av = heli.body.angvel();
    const w = new THREE.Vector3(av.x, av.y, av.z);
    const r = p.clone().sub(heli.pos);
    const v = new THREE.Vector3(lv.x, lv.y, lv.z).add(w.clone().cross(r)).add(new THREE.Vector3(0, -1, 0));
    const c = this.spawn(p.x, p.y, p.z, weight, contractId, 'free', v, w, heli.heading);
    this.markReleased(c, armed, up);
    return c;
  }

  remove(c: Crate) {
    if (c.joint) { this.physics.world.removeImpulseJoint(c.joint, true); c.joint = null; }
    if (c.rope) { this.scene.remove(c.rope); c.rope = null; }
    if (c.chuteMesh) { this.scene.remove(c.chuteMesh); c.chuteMesh = null; }
    this.scene.remove(c.mesh);
    this.physics.removeBody(c.body);
    c.state = 'gone';
    this.crates = this.crates.filter((x) => x !== c);
  }

  removeContract(contractId: number) {
    for (const c of this.crates) if (c.contractId === contractId && c.state !== 'gone' && c.state !== 'slung') this.remove(c);
  }

  onContact(self: Tag, other: Tag, force: number, up: UpStats) {
    const c = self.ref as Crate;
    if (c.state === 'gone' || c.broken) return;
    if (other.kind === 'water') { c.broken = true; return; }
    if (other.kind === 'debris') return;
    const dv = (force * FIXED_DT) / c.mass;
    if (other.kind !== 'heli') c.touched = true;
    const safe = up.crateSafe + (c.usedChute ? 2 : 0);
    if (dv > up.crateBreak) { c.integrity = 0; }
    else if (dv > safe) {
      // one landing spans several solver steps/bounces: count each impact window once, at its peak
      const from = c.impactWin > 0 ? Math.max(safe, c.impactPeak) : safe;
      if (dv > from) c.integrity = Math.max(0, c.integrity - (dv - from) * up.crateDmg);
      c.impactPeak = c.impactWin > 0 ? Math.max(c.impactPeak, dv) : dv;
      c.impactWin = 0.3;
    }
    if (dv > safe) this.onImpact(c, dv);
    if (c.integrity <= 0.001) c.broken = true;
  }

  preStep(dt: number, wind: THREE.Vector3, up: UpStats) {
    // remember poses before the step, for render interpolation
    for (const c of this.crates) {
      const p = c.body.translation(), r = c.body.rotation();
      (c.pp ??= new THREE.Vector3()).set(p.x, p.y, p.z);
      (c.pq ??= new THREE.Quaternion()).set(r.x, r.y, r.z, r.w);
    }
    for (const c of this.crates) {
      if (c.state !== 'free') continue;
      c.releaseT += dt;
      if (c.chuteArmed && !c.chuteDone && c.releaseT > chuteDelay(up)) {
        if (c.chuteOpen === 0) { c.usedChute = true; this.onChute(c); }
        c.chuteOpen = Math.min(1, c.chuteOpen + dt);
      }
      const v = c.body.linvel();
      const open = c.chuteDone ? 0 : c.chuteOpen;
      const cd = CRATE_DRAG + CHUTE_DRAG * open;
      const drift = open > 0 ? up.chuteDrift : 0.15;
      const wx = wind.x * drift, wz = wind.z * drift;
      const rx = v.x - wx, ry = v.y, rz = v.z - wz;
      const sp = Math.hypot(rx, ry, rz);
      const k = 1 / (1 + cd * sp * dt);
      c.body.setLinvel({ x: wx + rx * k, y: ry * k, z: wz + rz * k }, true);
      if (open > 0.3) {
        const av = c.body.angvel();
        c.body.setAngvel({ x: av.x * 0.9, y: av.y * 0.9, z: av.z * 0.9 }, true);
      }
    }
  }

  postStep(dt: number) {
    for (const c of this.crates) {
      if (c.state === 'gone') continue;
      c.age += dt;
      if (c.impactWin > 0) c.impactWin -= dt;
      const p = c.body.translation();
      if (c.broken) { this.breakCrate(c); continue; }
      if (p.y < WATER_LEVEL - 0.3 || p.y < -50) { this.onLost(c); this.remove(c); continue; }
      if (c.state === 'free') {
        const v = c.body.linvel(), w = c.body.angvel();
        const sp = Math.hypot(v.x, v.y, v.z), ang = Math.hypot(w.x, w.y, w.z);
        // gentle set-downs make no contact-force events, so also detect ground proximity
        if (!c.touched && p.y - c.size / 2 - this.groundAt(p.x, p.z) < 0.35) c.touched = true;
        if (c.chuteOpen > 0 && !c.chuteDone && c.touched) c.chuteDone = true;
        const resting = c.touched && sp < 0.35 && ang < 0.6;
        c.settleT = resting ? c.settleT + dt : 0;
        if (c.settleT > 0.8 || (c.touched && c.releaseT > 25)) this.onSettled(c);
      } else if (c.state === 'loose') {
        c.looseT += dt;
        if (c.looseT > 180) { this.onLost(c); this.remove(c); }
      }
    }
    this.crates = this.crates.filter((c) => c.state !== 'gone');
    for (const d of this.debris) d.t += dt;
    for (const d of this.debris.filter((x) => x.t > 6)) { this.scene.remove(d.mesh); this.physics.removeBody(d.body); }
    this.debris = this.debris.filter((x) => x.t <= 6);
  }

  private breakCrate(c: Crate) {
    const p = c.body.translation(), v = c.body.linvel();
    const mat = this.mats[c.weight];
    for (let i = 0; i < 8; i++) {
      const w = 0.12, l = c.size * (0.5 + Math.random() * 0.5);
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x + (Math.random() - 0.5) * c.size, p.y + 0.3 + Math.random() * 0.4, p.z + (Math.random() - 0.5) * c.size)
          .setLinvel(v.x * 0.4 + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, v.z * 0.4 + (Math.random() - 0.5) * 6)
          .setAngvel({ x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10 }),
      );
      this.physics.addCollider(RAPIER.ColliderDesc.cuboid(w / 2, w / 2, l / 2).setDensity(400), { kind: 'debris' }, body);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, w, l), mat);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.debris.push({ body, mesh, t: 0 });
    }
    this.onBroken(c);
    this.remove(c);
  }

  render(heli: Heli | null, alpha = 1) {
    for (const c of this.crates) {
      const t = c.body.translation(), q = c.body.rotation();
      const p = _rp.set(t.x, t.y, t.z);
      _rq.set(q.x, q.y, q.z, q.w);
      if (c.pp && c.pq && c.pp.distanceToSquared(p) < 100) {
        p.lerpVectors(c.pp, p, alpha);
        _rq.copy(_rq2.copy(c.pq).slerp(_rq, alpha));
      }
      c.mesh.position.copy(p);
      c.mesh.quaternion.copy(_rq);
      if (c.rope && heli) {
        const a = heli.renderPoint(heli.model.hookPoint);
        const b = new THREE.Vector3(0, c.size / 2, 0).applyQuaternion(c.mesh.quaternion).add(c.mesh.position);
        const pos = c.rope.geometry.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true;
      }
      const open = c.chuteDone ? 0 : c.chuteOpen;
      if (open > 0 && !c.chuteMesh) c.chuteMesh = this.makeChute();
      if (c.chuteMesh) {
        if (open <= 0) { this.scene.remove(c.chuteMesh); c.chuteMesh = null; continue; }
        c.chuteMesh.position.set(p.x, p.y + c.size / 2, p.z); // interpolated pose
        c.chuteMesh.scale.setScalar(Math.max(0.15, open));
      }
    }
    for (const d of this.debris) {
      const p = d.body.translation(), r = d.body.rotation();
      d.mesh.position.set(p.x, p.y, p.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private makeChute(): THREE.Group {
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4),
      new THREE.MeshStandardMaterial({ color: 0xe9e4d4, side: THREE.DoubleSide, flatShading: true, roughness: 0.9 }),
    );
    canopy.position.y = 5;
    canopy.castShadow = true;
    g.add(canopy);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 2.4, 6.4, Math.sin(a) * 2.4));
    }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x444444 })));
    this.scene.add(g);
    return g;
  }
}
