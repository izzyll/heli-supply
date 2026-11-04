import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY } from '../core/config';
import { approach, clamp, smoothstep } from '../core/rng';
import type { UpStats } from '../core/upgrades';
import type { Physics, Tag } from '../physics/world';
import type { ControlState } from '../input/input';
import { buildHeliModel, disposeModel, HeliModel } from './model';
import type { HeliDef, Paint } from './defs';

export type Component = 'hull' | 'engine' | 'rotor' | 'tail' | 'skids';
export const COMPONENTS: Component[] = ['hull', 'engine', 'rotor', 'tail', 'skids'];

export interface HitEvent { kind: 'impact' | 'rotor' | 'tail' | 'water'; amount: number; pos: THREE.Vector3 }

export interface FlightEnv {
  wind: THREE.Vector3;
  groundAt: (x: number, z: number) => number;
  extraMass: number; // internal cargo (applied as weight)
  loadMass: number;  // total cargo mass (bay + sling) used for hover compensation
  up: UpStats;
  realistic: boolean; // realistic flight model (rate cyclic, ETL, flare) vs assisted (attitude hold)
}

const _q = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/**
 * Limits a commanded angular rate near an attitude limit. Pushing further out fades from full authority at
 * `soft` to none at `hard`, and beyond `hard` the airframe is driven back.
 */
function envelope(angle: number, rate: number, soft: number, hard: number): number {
  const a = Math.abs(angle);
  if (rate * angle > 0) rate *= 1 - smoothstep(soft, hard, a);
  if (a > hard) rate -= Math.sign(angle) * (a - hard) * 7;
  return rate;
}

export class Heli {
  body: RAPIER.RigidBody;
  model: HeliModel;
  colliders: Record<'hull' | 'boom' | 'skidL' | 'skidR' | 'rotor' | 'tail', RAPIER.Collider>;
  hp: Record<Component, number> = { hull: 1, engine: 1, rotor: 1, tail: 1, skids: 1 };
  maxHp: Record<Component, number> = { hull: 100, engine: 80, rotor: 80, tail: 60, skids: 60 };
  fuel = 0;
  fuelMax = 0;
  rpm = 0;
  crashed = false;
  crashTimer = 0;
  agl = 0;
  thrustFrac = 0;
  landed = false;
  landedTime = 0;
  heading = 0;
  speed = 0;
  vs = 0;
  rotorAngle = 0;
  hits: HitEvent[] = [];
  rotorContacts = new Set<number>();
  tailContacts = new Set<number>();
  pos = new THREE.Vector3();
  quat = new THREE.Quaternion();
  vel = new THREE.Vector3();
  /** Pose at the previous physics step, and the interpolated pose used for drawing. */
  prevPos = new THREE.Vector3();
  prevQuat = new THREE.Quaternion();
  rpos = new THREE.Vector3();
  rquat = new THREE.Quaternion();
  lastImpactSfx = 0;
  /** What last damaged the airframe from outside (for the crash screen). */
  lastHitBy: 'missile' | null = null;
  ownHandles = new Set<number>();

  constructor(public def: HeliDef, paint: Paint, private physics: Physics, scene: THREE.Scene, spawn: THREE.Vector3, yaw: number, up: UpStats) {
    this.model = buildHeliModel(def, paint);
    scene.add(this.model.root);
    const [hx, hy, hz] = def.body;
    const [ix, iy, iz] = def.inertia;
    const q = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setAdditionalMassProperties(def.mass, { x: 0, y: 0, z: 0 }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(0.02)
        .setAngularDamping(0.9)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const thr = def.mass * GRAVITY * 1.3;
    const solid = (desc: RAPIER.ColliderDesc, part: Tag['part']) =>
      physics.addCollider(
        desc.setDensity(0).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(thr),
        { kind: 'heli', part, ref: this },
        this.body,
      );
    const tailZ = hz * 0.85 + def.boomLen;
    this.colliders = {
      hull: solid(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, def.bodyY, 0).setFriction(0.6).setRestitution(0.05), 'hull'),
      boom: solid(RAPIER.ColliderDesc.cuboid(0.25 * (hx / 0.85), 0.3 + def.tailR * 0.4, def.boomLen / 2).setTranslation(0, def.bodyY + hy * 0.3 + def.tailR * 0.2, hz * 0.85 + def.boomLen / 2), 'boom'),
      skidL: solid(RAPIER.ColliderDesc.cuboid(0.08, 0.08, def.skidLen / 2).setTranslation(-def.skidX, def.skidY, 0).setFriction(0.9), 'skids'),
      skidR: solid(RAPIER.ColliderDesc.cuboid(0.08, 0.08, def.skidLen / 2).setTranslation(def.skidX, def.skidY, 0).setFriction(0.9), 'skids'),
      rotor: physics.addCollider(
        RAPIER.ColliderDesc.cylinder(0.12, def.rotorR).setTranslation(0, def.rotorY, 0).setSensor(true).setDensity(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        { kind: 'rotor', ref: this }, this.body),
      tail: physics.addCollider(
        RAPIER.ColliderDesc.ball(def.tailR).setTranslation(0.22, def.bodyY + hy * 0.3 + def.tailR * 0.5, tailZ).setSensor(true).setDensity(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        { kind: 'tailrotor', ref: this }, this.body),
    };
    for (const c of Object.values(this.colliders)) this.ownHandles.add(c.handle);
    this.applyUpgrades(up, true);
    this.syncState();
    this.snapPrev();
  }

  /** Remember the current pose before a physics step, for render interpolation. */
  savePrev() { this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat); }

  /** Drop interpolation history (teleports) so the model doesn't streak across the map. */
  snapPrev() { this.savePrev(); this.rpos.copy(this.pos); this.rquat.copy(this.quat); }

  applyUpgrades(up: UpStats, refill = false) {
    const k = up.hpMul;
    const base = this.def.hp;
    const prev = { ...this.maxHp };
    this.maxHp = { hull: base * k, engine: base * 0.8 * k, rotor: base * 0.8 * k, tail: base * 0.6 * k, skids: base * 0.6 * k };
    this.fuelMax = this.def.fuel * up.fuelMul;
    if (refill) { this.fuel = this.fuelMax; this.hp = { hull: 1, engine: 1, rotor: 1, tail: 1, skids: 1 }; }
    else {
      // keep absolute damage the same when max changes
      for (const c of Object.keys(this.hp) as Component[]) {
        const missing = (1 - this.hp[c]) * prev[c];
        this.hp[c] = clamp(1 - missing / this.maxHp[c], 0, 1);
      }
      this.fuel = Math.min(this.fuel, this.fuelMax);
    }
  }

  get destroyed() { return this.hp.hull <= 0 || this.hp.rotor <= 0; }

  damage(c: Component, points: number) {
    if (points <= 0) return;
    this.hp[c] = Math.max(0, this.hp[c] - points / this.maxHp[c]);
  }

  repairCostPoints(): number {
    let s = 0;
    for (const c of Object.keys(this.hp) as Component[]) s += (1 - this.hp[c]) * this.maxHp[c];
    return s;
  }

  repairAll() { this.hp = { hull: 1, engine: 1, rotor: 1, tail: 1, skids: 1 }; this.lastHitBy = null; }

  // ---------------------------------------------------------------- physics
  onContact(self: Tag, other: Tag, force: number, up: UpStats) {
    if (this.crashed) return;
    if (other.kind === 'heli' || other.kind === 'debris') return;
    const p = this.body.translation();
    if (other.kind === 'water') {
      if (!this.hits.some((h) => h.kind === 'water')) this.hits.push({ kind: 'water', amount: 1, pos: new THREE.Vector3(p.x, p.y, p.z) });
      this.hp.hull = 0;
      return;
    }
    const dv = (force * (1 / 60)) / this.def.mass;
    const ib = up.impactBonus;
    let pts = 0;
    if (self.part === 'skids') {
      const thr = 3.5 + ib;
      if (dv > thr) {
        pts = (dv - thr) * 14;
        this.damage('skids', pts);
        this.damage('hull', pts * (this.hp.skids <= 0.3 ? 0.9 : 0.25));
      }
    } else if (self.part === 'hull') {
      const thr = 2.0 + ib;
      if (dv > thr) { pts = (dv - thr) * 18; this.damage('hull', pts); this.damage('engine', pts * 0.4); }
    } else if (self.part === 'boom') {
      const thr = 1.6 + ib;
      if (dv > thr) { pts = (dv - thr) * 14; this.damage('hull', pts * 0.5); this.damage('tail', pts * 0.9); }
    }
    if (pts > 0.5) this.hits.push({ kind: 'impact', amount: pts, pos: new THREE.Vector3(p.x, p.y + this.def.skidY, p.z) });
  }

  onSensor(own: number, other: number, started: boolean, otherTag: Tag | undefined) {
    if (!otherTag) return;
    if (otherTag.kind === 'heli' || otherTag.kind === 'rotor' || otherTag.kind === 'tailrotor' || otherTag.kind === 'debris') return;
    const set = own === this.colliders.rotor.handle ? this.rotorContacts : this.tailContacts;
    if (started) {
      set.add(other);
      if (this.rpm < 0.2 || this.crashed) return;
      const isRotor = set === this.rotorContacts;
      this.damage(isRotor ? 'rotor' : 'tail', (isRotor ? 22 : 26) * this.rpm);
      // violent jolt
      const m = this.def.mass;
      const [ix, , iz] = this.def.inertia;
      this.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * ix * 2.5, y: (Math.random() - 0.5) * m * 2, z: (Math.random() - 0.5) * iz * 2.5 }, true);
      const lv = this.body.linvel();
      this.body.applyImpulse({ x: -lv.x * m * 0.35, y: -Math.abs(lv.y) * m * 0.2, z: -lv.z * m * 0.35 }, true);
      const tip = this.rotorTipWorld();
      this.hits.push({ kind: isRotor ? 'rotor' : 'tail', amount: 1, pos: tip });
    } else {
      set.delete(other);
    }
  }

  rotorTipWorld(): THREE.Vector3 {
    // approximate contact point: rotor tip in direction of travel
    const v = this.vel.clone(); v.y = 0;
    if (v.lengthSq() < 0.01) v.set(0, 0, -1).applyQuaternion(this.quat);
    v.normalize().multiplyScalar(this.def.rotorR);
    return new THREE.Vector3(0, this.def.rotorY, 0).applyQuaternion(this.quat).add(this.pos).add(v);
  }

  preStep(dt: number, ctl: ControlState, env: FlightEnv) {
    const b = this.body, def = this.def;
    b.resetForces(true);
    b.resetTorques(true);
    const r = b.rotation(), lv = b.linvel(), av = b.angvel(), t = b.translation();
    _q.set(r.x, r.y, r.z, r.w);
    const up = _v.set(0, 1, 0).applyQuaternion(_q).clone();
    const fwd = _v.set(0, 0, -1).applyQuaternion(_q).clone();
    const heading = Math.atan2(-fwd.x, -fwd.z);
    this.heading = heading;
    const ground = env.groundAt(t.x, t.z);
    this.agl = t.y + def.skidY - 0.08 - ground;

    const alive = !this.crashed && this.fuel > 0 && this.hp.engine > 0;
    this.rpm = approach(this.rpm, alive ? 1 : 0, dt * (alive ? 0.45 : 0.18));

    let c = ctl.collective, pi = ctl.pitch, ro = ctl.roll;
    const ya = ctl.yaw;
    const real = env.realistic;
    const hv = real ? 0 : env.up.hover;
    if (hv > 0 && !this.landed) {
      const ff = Math.cos(heading), fs = Math.sin(heading);
      const vf = lv.x * -fs + lv.z * -ff;
      const vr = lv.x * ff + lv.z * -fs;
      if (!ctl.cyclicActive) {
        pi += clamp(-vf * 0.035 * hv, -0.7, 0.7);
        ro += clamp(-vr * 0.035 * hv, -0.7, 0.7);
      }
      if (!ctl.collectiveActive) c += clamp(-lv.y * 0.09 * hv, -0.6, 0.6);
    }
    if (real) {
      // absolute lever: below the hover point the blades flatten out, at 0 there is almost no lift
      const Lh = this.hoverLever(env.up);
      const L = clamp(ctl.lever, 0, 1);
      c = L >= Lh ? (L - Lh) / (1 - Lh) : (L - Lh) / Lh;
    }
    c = clamp(c, -1, 1); pi = clamp(pi, -1, 1); ro = clamp(ro, -1, 1);
    if (this.crashed) { c = -1; pi = ro = 0; }

    // ---- main rotor thrust
    const W = def.mass * GRAVITY;
    const head = def.headroom * env.up.engineMul;
    const hoverW = W + env.loadMass * GRAVITY * 0.6;
    const ax = lv.x - env.wind.x, ay = lv.y - env.wind.y, az = lv.z - env.wind.z;
    let thrust = hoverW + W * (c >= 0 ? c * head : c * 0.85);
    if (real) {
      // Realistic: no tilt compensation. Rotor thrust depends on the airflow through the disc.
      const along = ax * up.x + ay * up.y + az * up.z;          // air velocity along the rotor axis
      const vin = -along;                                        // >0: air flowing up through the disc (flare / descent)
      const px = ax - up.x * along, py = ay - up.y * along, pz = az - up.z * along;
      const inPlane = Math.hypot(px, py, pz);
      const etl = 0.18 * smoothstep(4, 18, inPlane);             // effective translational lift
      // vertical inflow: climbing lowers blade angle of attack (less thrust), descending raises it
      const vinV = -ay * Math.max(0, up.y);
      thrust *= 1 + etl + 0.04 * clamp(vinV, -15, 0);
      // air rushing up through the disc (autorotation-like). Quadratic, so the first seconds of a drop feel like real
      // gravity and the sink rate only levels off near ~14 m/s
      if (vinV > 0) thrust += W * 0.0045 * Math.min(vinV, 20) ** 2 * this.rpm;
      // Disc lift: pulling the disc up into the relative wind at speed makes it act like a wing. The force is
      // perpendicular to the airflow, so it curves the flight path upward (zoom climb / J-hook) instead of only braking.
      const air2 = ax * ax + ay * ay + az * az;
      if (air2 > 16 && vin > 0 && this.rpm > 0.5) {
        const air = Math.sqrt(air2);
        const sinA = vin / air;                                  // disc angle of attack
        // blade pitch matters: with the collective down the disc produces far less lift
        const colF = 0.25 + 0.75 * clamp((c + 1), 0, 1);
        const L = Math.min(2.2 * W, W * 0.0022 * air2 * sinA) * colF * this.rpm * (0.55 + 0.45 * this.hp.rotor);
        // lift direction: the component of the rotor axis perpendicular to the airflow
        const ux = ax / air, uy = ay / air, uz = az / air;
        const d = up.x * ux + up.y * uy + up.z * uz;
        let nx = up.x - ux * d, ny = up.y - uy * d, nz = up.z - uz * d;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const Di = L * 0.22;                                     // induced drag bleeds energy
        b.addForce({ x: nx * L - ux * Di, y: ny * L - uy * Di, z: nz * L - uz * Di }, true);
      }
    } else {
      thrust /= Math.max(up.y, 0.72);                            // assisted: holds altitude when tilted
    }
    // low-g: nosing over hard unloads the rotor, so at extreme tilt the helicopter sinks fast
    if (real) thrust *= 0.45 + 0.55 * smoothstep(0.15, 0.65, up.y);
    thrust *= this.rpm * (0.45 + 0.55 * this.hp.engine) * (0.55 + 0.45 * this.hp.rotor);
    const ge = def.rotorR * 2;
    if (this.agl < ge) thrust *= 1 + 0.1 * (1 - Math.max(0, this.agl) / ge);
    thrust = Math.max(0, thrust);
    this.thrustFrac = thrust / W;
    b.addForce({ x: up.x * thrust, y: up.y * thrust, z: up.z * thrust }, true);
    if (env.extraMass > 0) b.addForce({ x: 0, y: -env.extraMass * GRAVITY, z: 0 }, true);

    // ---- aerodynamic drag (relative to the air mass)
    const hs = Math.hypot(ax, az);
    // assisted mode adds artificial vertical damping for a stable, easy hover; realistic relies on rotor inflow
    // (weaker with the collective down, so lowering it really lets the helicopter drop)
    const vdamp = real ? 0 : def.mass * 0.55 * ay * (ay < 0 ? 1 - 0.6 * Math.max(0, -c) : 1);
    b.addForce({ x: -def.drag * ax * hs, y: -def.vdrag * ay * Math.abs(ay) - vdamp, z: -def.drag * az * hs }, true);

    // ---- attitude control (target tilt from cyclic, PD toward it)
    const authority = this.rpm * (0.35 + 0.65 * this.hp.rotor);
    const Itilt = (def.inertia[0] + def.inertia[2]) / 2;
    const Iy = def.inertia[1];
    if (!this.crashed && authority > 0.02 && real) {
      // Realistic: cyclic commands pitch/roll RATE in the body frame (no tilt limit, no auto-level)
      const right = _w.set(1, 0, 0).applyQuaternion(_q).clone();
      const back = _w.set(0, 0, 1).applyQuaternion(_q).clone();
      const pitchRate = def.maxTilt * 2.6, rollRate = def.maxTilt * 3.1;
      const wP = av.x * right.x + av.y * right.y + av.z * right.z;
      const wR = av.x * back.x + av.y * back.y + av.z * back.z;
      const kr = 6 * authority;
      // Attitude envelope: the fuselage hangs under the rotor, so cyclic authority fades at extreme angles and the
      // airframe is pushed back. No loops or flips: past the limit the helicopter just falls (see low-g thrust loss).
      const fwdY = -back.y;
      // full-range angles (atan2 with the up vector) so the envelope still pushes the right way past 90°
      const pitchA = Math.atan2(fwdY, up.y);                     // + nose up
      const rollA = Math.atan2(-right.y, up.y);                  // + rolled right
      const D = Math.PI / 180;
      const pitchCmd = envelope(pitchA, -pi * pitchRate, pitchA > 0 ? 60 * D : 50 * D, pitchA > 0 ? 80 * D : 70 * D);
      const rollCmd = envelope(rollA, ro * rollRate, 55 * D, 75 * D);
      const tP = Itilt * kr * (pitchCmd - wP);
      const tR = Itilt * kr * (-rollCmd - wR);
      b.addTorque({
        x: right.x * tP + back.x * tR,
        y: right.y * tP + back.y * tR,
        z: right.z * tP + back.z * tR,
      }, true);
      // weathervane: the tail boom swings the nose into the relative wind at speed
      const side = ax * right.x + ay * right.y + az * right.z;
      const wv = -Iy * 0.05 * clamp(side, -25, 25) * Math.max(0, up.y);
      b.addTorque({ x: up.x * wv, y: up.y * wv, z: up.z * wv }, true);
    }
    if (!this.crashed && authority > 0.02) {
      _qt.setFromAxisAngle(Y, heading);
      _qa.setFromAxisAngle(X, -pi * def.maxTilt);
      _qb.setFromAxisAngle(Z, -ro * def.maxTilt);
      _qt.multiply(_qa).multiply(_qb);
      const qe = _qt.multiply(_q.clone().invert());
      if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
      const ex = qe.x * 2, ey = qe.y * 2, ez = qe.z * 2;
      const wUp = av.x * up.x + av.y * up.y + av.z * up.z;
      const tx = av.x - up.x * wUp, ty = av.y - up.y * wUp, tz = av.z - up.z * wUp;
      const kp = 14 * authority, kd = 5.5;
      // remove the yaw component of the error (yaw handled separately)
      const eUp = ex * up.x + ey * up.y + ez * up.z;
      if (!real) b.addTorque({
        x: Itilt * (kp * (ex - up.x * eUp) - kd * tx),
        y: Itilt * (kp * (ey - up.y * eUp) - kd * ty),
        z: Itilt * (kp * (ez - up.z * eUp) - kd * tz),
      }, true);

      // yaw: rate control from pedals, weakened by tail damage; missing anti-torque spins the airframe
      const tailAuth = this.hp.tail > 0 ? 0.25 + 0.75 * this.hp.tail : 0;
      const desired = -ya * def.yawRate * (0.4 + 0.6 * this.hp.tail);
      let yawT = Iy * 4 * (desired - wUp) * tailAuth * this.rpm;
      yawT += Iy * (1 - this.hp.tail) * this.thrustFrac * 2.0;
      b.addTorque({ x: up.x * yawT, y: up.y * yawT, z: up.z * yawT }, true);

      // damaged main rotor wobble
      if (this.hp.rotor < 0.75) {
        const k = (0.75 - this.hp.rotor) * Itilt * 6 * this.rpm;
        b.addTorque({ x: (Math.random() - 0.5) * k, y: 0, z: (Math.random() - 0.5) * k }, true);
      }
    }
  }

  /** Realistic-mode lever position that gives hover thrust (about 0.5). */
  hoverLever(up: UpStats): number {
    const head = this.def.headroom * up.engineMul;
    return 0.85 / (0.85 + head);
  }

  postStep(dt: number) {
    this.syncState();
    // continuous rotor strike damage while intersecting something
    if (this.rpm > 0.2 && !this.crashed) {
      if (this.rotorContacts.size > 0) this.damage('rotor', 45 * dt * this.rpm);
      if (this.tailContacts.size > 0) this.damage('tail', 60 * dt * this.rpm);
    }
    // fuel
    if (!this.crashed && this.rpm > 0.05) {
      this.fuel = Math.max(0, this.fuel - this.def.burn * (0.25 + 0.75 * Math.min(2, this.thrustFrac)) * dt);
    }
    // landed detection
    const isLanded = this.agl < 0.35 && this.speed < 1.2 && this.upY() > 0.9;
    this.landedTime = isLanded ? this.landedTime + dt : 0;
    this.landed = this.landedTime > 0.4;
    if (!this.crashed && this.destroyed) {
      this.crashed = true;
      this.crashTimer = 0;
      this.body.setAngularDamping(0.3);
    }
    if (this.crashed) this.crashTimer += dt;
  }

  upY(): number { return _w.set(0, 1, 0).applyQuaternion(this.quat).y; }

  syncState() {
    const t = this.body.translation(), r = this.body.rotation(), v = this.body.linvel();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    this.vel.set(v.x, v.y, v.z);
    this.speed = this.vel.length();
    this.vs = v.y;
  }

  /** Visual update each render frame. */
  render(dt: number, cockpitView: boolean, alpha = 1) {
    if (this.prevPos.distanceToSquared(this.pos) > 400) this.savePrev();
    this.rpos.lerpVectors(this.prevPos, this.pos, alpha);
    this.rquat.slerpQuaternions(this.prevQuat, this.quat, alpha);
    this.model.root.position.copy(this.rpos);
    this.model.root.quaternion.copy(this.rquat);
    this.rotorAngle += dt * this.rpm * 28;
    this.model.mainRotor.rotation.y = -this.rotorAngle;
    this.model.tailRotor.rotation.x = this.rotorAngle * 3.2;
    const fast = this.rpm > 0.6;
    // steady motion-blur disc at speed instead of randomly blinking the blades (that read as flicker)
    (this.model.disc.material as THREE.MeshBasicMaterial).opacity = 0.05 + this.rpm * (fast ? 0.2 : 0.12);
    this.model.blades.visible = !fast;
    this.model.cockpit.visible = cockpitView;
    // In cockpit view, hide parts that would clip the camera
    this.model.exterior.children.forEach((c) => { if (c !== this.model.mainRotor) c.visible = !cockpitView || !(c as THREE.Mesh).isMesh || c.position.z > 0.5 || c.position.y < this.def.skidY + 0.4; });
  }

  worldPoint(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyQuaternion(this.quat).add(this.pos);
  }

  /** Like worldPoint, but on the interpolated (drawn) pose. */
  renderPoint(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyQuaternion(this.rquat).add(this.rpos);
  }

  /** Heading of the drawn pose. */
  renderHeading(): number {
    const f = _w.set(0, 0, -1).applyQuaternion(this.rquat);
    return Math.atan2(-f.x, -f.z);
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }

  respawn(pos: THREE.Vector3, yaw: number, up: UpStats) {
    const q = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngularDamping(0.9);
    this.crashed = false;
    this.crashTimer = 0;
    this.rpm = 0;
    this.lastHitBy = null;
    this.rotorContacts.clear();
    this.tailContacts.clear();
    this.applyUpgrades(up, true);
    this.syncState();
    this.snapPrev();
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.model.root);
    disposeModel(this.model);
    this.physics.removeBody(this.body);
  }
}


