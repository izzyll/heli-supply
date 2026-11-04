import * as THREE from 'three';
import { SEED, WATER_LEVEL } from '../core/config';
import { mulberry32, clamp } from '../core/rng';
import { aaStats, AAStats, threatSites } from '../core/economy';
import type { Terrain } from '../world/terrain';
import type { Site } from '../world/sitePlan';
import type { Heli } from '../heli/heli';
import type { Particles } from '../fx/particles';
import type { Sfx } from '../audio/sfx';
import { Props, mat, Bucket } from '../world/props';

/** A surface-to-air missile site. Its radar has to track the helicopter for `lockTime` seconds before it can fire. */
export interface SamSite {
  id: number;
  x: number; y: number; z: number;
  region: number;
  active: boolean;
  stats: AAStats;
  state: 'idle' | 'tracking' | 'reload';
  lock: number;        // 0..1 lock progress
  reload: number;      // seconds until it can track again
  salvoLeft: number;   // missiles still to launch in the current salvo
  salvoT: number;
  turret: THREE.Group;
  rails: THREE.Group;
  dish: THREE.Object3D;
  lamp: THREE.Mesh;
  bucket: Bucket;
}

interface Flare { pos: THREE.Vector3; vel: THREE.Vector3; life: number; sprite: THREE.Sprite }

interface Missile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: 'heli' | Flare | null;
  life: number;
  mesh: THREE.Group;
  site: SamSite;
  decoyed: boolean;
}

export interface AAWarning { tracking: number; locked: boolean; inbound: number; bearing: number | null }

const _d = new THREE.Vector3(), _t = new THREE.Vector3(), _a = new THREE.Vector3();

const MISSILE_SPEED = 175;   // m/s top speed
const MISSILE_ACCEL = 140;   // m/s² boost
const MISSILE_TURN = 1.9;    // rad/s max turn rate
const MISSILE_LIFE = 12;     // s
const FUSE_R = 7;            // m proximity fuse
const FLARE_LIFE = 4;

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,220,120,0.9)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Enemy air defence: SAM sites, their missiles, and the player's decoy flares. */
export class AASystem {
  sites: SamSite[] = [];
  missiles: Missile[] = [];
  flares: Flare[] = [];
  warning: AAWarning = { tracking: 0, locked: false, inbound: 0, bearing: null };
  /** Called when a missile detonates near the helicopter. */
  onHit: (() => void) | null = null;
  /** Called when a missile aimed at the helicopter ends without hitting it. */
  onEvade: (() => void) | null = null;
  private beepT = 0;
  private wasLocked = false;
  private flareCd = 0;
  private glowMat: THREE.SpriteMaterial;
  private missileGeo = new THREE.CylinderGeometry(0.13, 0.13, 2.4, 6).rotateX(Math.PI / 2);
  private plumeGeo = new THREE.SphereGeometry(0.35, 6, 4);

  constructor(private scene: THREE.Scene, private terrain: Terrain, sites: Site[], private particles: Particles, private sfx: Sfx, props: Props) {
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.placeSites(sites, props);
  }

  // ------------------------------------------------------------------ placement
  private placeSites(sites: Site[], props: Props) {
    const rand = mulberry32(SEED ^ 0xaa51);
    const bases = sites.filter((s) => s.type !== 'outpost');
    const cands: { x: number; z: number; region: number; key: number }[] = [];
    const ok = (x: number, z: number) => {
      if (Math.hypot(x, z) < 500) return false;
      const h = this.terrain.heightAt(x, z);
      if (h < WATER_LEVEL + 2 || this.terrain.slopeAt(x, z) > 0.3) return false;
      for (const s of sites) if (Math.hypot(s.x - x, s.z - z) < s.radius + 45) return false;
      for (const b of bases) if (Math.hypot(b.x - x, b.z - z) < 350) return false;
      for (const c of cands) if (Math.hypot(c.x - x, c.z - z) < 160) return false;
      return true;
    };
    const tryPlace = (cx: number, cz: number, r0: number, r1: number, region: number) => {
      for (let tries = 0; tries < 40; tries++) {
        const a = rand() * Math.PI * 2, r = r0 + rand() * (r1 - r0);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (ok(x, z)) { cands.push({ x, z, region, key: rand() + region * 0.15 }); return; }
      }
    };
    for (const s of sites) {
      if (s.type !== 'outpost') continue;
      const n = 2 + (rand() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) tryPlace(s.x, s.z, 180, 400, s.region);
      // one more along the supply route from the nearest base
      const b = [...bases].sort((p, q) => Math.hypot(p.x - s.x, p.z - s.z) - Math.hypot(q.x - s.x, q.z - s.z))[0];
      const f = 0.35 + rand() * 0.4;
      tryPlace(b.x + (s.x - b.x) * f, b.z + (s.z - b.z) * f, 0, 120, s.region);
    }
    // a gentle mix: earlier regions first, shuffled within
    cands.sort((p, q) => p.key - q.key);
    let id = 0;
    for (const c of cands) this.sites.push(this.buildSite(id++, c.x, c.z, c.region, props));
  }

  private buildSite(id: number, x: number, z: number, region: number, props: Props): SamSite {
    let y = Infinity;
    for (const [dx, dz] of [[0, 0], [3, 3], [-3, 3], [3, -3], [-3, -3]]) y = Math.min(y, this.terrain.heightAt(x + dx, z + dz));
    const bucket: Bucket = { objects: [], colliders: [] };
    props.bucket = bucket;
    const f = Math.atan2(-x, -z);
    props.box(x, y - 0.5, z, 5.2, 1.4, 6.4, 0x4a5236, f);
    props.sandbags(x, z, y, 9, Math.PI * 1.4, f + Math.PI * 0.3);
    props.box(x + 7, y - 0.3, z + 4, 2.2, 2.4, 3.6, 0x3f4630, f + 0.4);
    props.bucket = null;

    const turret = new THREE.Group();
    turret.position.set(x, y + 0.9, z);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.6, 10), mat(0x384029));
    ring.castShadow = true;
    turret.add(ring);
    const rails = new THREE.Group();
    rails.position.y = 0.6;
    for (const sx of [-0.55, 0.55]) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4), mat(0x5b6444));
      tube.position.set(sx, 0.4, 0.6);
      tube.castShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.05), mat(0x8f2a20));
      cap.position.set(sx, 0.4, -1.43);
      rails.add(tube, cap);
    }
    turret.add(rails);
    const dish = new THREE.Group();
    dish.position.set(0, 2.2, 1.6);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 0.15), mat(0x2f3324));
    mast.position.y = -0.7;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.12), mat(0x9aa08a));
    dish.add(mast, plate);
    turret.add(dish);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0x331010 }));
    lamp.position.set(0, 2.85, 1.6);
    turret.add(lamp);
    turret.visible = false;
    this.scene.add(turret);
    bucket.objects.forEach((o) => (o.visible = false));
    bucket.colliders.forEach((c) => c.setEnabled(false));
    return {
      id, x, y, z, region, active: false, stats: aaStats(0, region), state: 'idle', lock: 0, reload: 0, salvoLeft: 0, salvoT: 0,
      turret, rails, dish, lamp, bucket,
    };
  }

  /** Switch on SAM sites according to how many deliveries the pilot has made. */
  setThreat(delivered: number, regionsUnlocked: number) {
    const n = threatSites(delivered);
    let on = 0;
    for (const s of this.sites) {
      const active = s.region < regionsUnlocked && on < n;
      if (active) on++;
      s.stats = aaStats(delivered, s.region);
      if (active === s.active) continue;
      s.active = active;
      s.state = 'idle'; s.lock = 0; s.reload = active ? 6 : 0; s.salvoLeft = 0;
      s.turret.visible = active;
      s.bucket.objects.forEach((o) => (o.visible = active));
      s.bucket.colliders.forEach((c) => c.setEnabled(active));
    }
  }

  get activeSites() { return this.sites.filter((s) => s.active); }

  // ------------------------------------------------------------------ flares
  /** Pops a pair of decoy flares. Returns false while on cooldown. */
  releaseFlares(h: Heli, eff: number): boolean {
    if (this.flareCd > 0) return false;
    this.flareCd = 0.6;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(h.quat);
    const made: Flare[] = [];
    for (const side of [-1, 1]) {
      const pos = h.pos.clone().add(new THREE.Vector3(0, -0.6, 0)).addScaledVector(right, side * 1.2);
      const vel = h.vel.clone().multiplyScalar(0.6).addScaledVector(right, side * 9).add(new THREE.Vector3(0, -3, 0));
      const sprite = new THREE.Sprite(this.glowMat);
      sprite.scale.setScalar(3.2);
      sprite.position.copy(pos);
      this.scene.add(sprite);
      const f = { pos, vel, life: FLARE_LIFE, sprite };
      this.flares.push(f);
      made.push(f);
    }
    // radars lose their lock in the clutter
    for (const s of this.sites) if (s.state === 'tracking') s.lock = 0;
    // missiles already in the air may take the bait
    for (const m of this.missiles) {
      if (m.target !== 'heli') continue;
      if (Math.random() < eff) { m.target = made[Math.floor(Math.random() * made.length)]; m.decoyed = true; }
    }
    this.sfx.play('flare');
    return true;
  }

  // ------------------------------------------------------------------ simulation
  private lineOfSight(s: SamSite, p: THREE.Vector3): boolean {
    const sy = s.y + 3;
    for (let i = 1; i < 12; i++) {
      const k = i / 12;
      const x = s.x + (p.x - s.x) * k, z = s.z + (p.z - s.z) * k, y = sy + (p.y - sy) * k;
      if (this.terrain.groundAt(x, z) > y - 1.5) return false;
    }
    return true;
  }

  update(dt: number, h: Heli) {
    this.flareCd = Math.max(0, this.flareCd - dt);
    const airborne = !h.crashed && !h.landed && h.agl > 3;
    let maxLock = 0, locked = false;

    for (const s of this.sites) {
      if (!s.active) continue;
      if (s.reload > 0) { s.reload -= dt; s.state = 'reload'; }
      const dist = Math.hypot(h.pos.x - s.x, h.pos.y - s.y, h.pos.z - s.z);
      const canSee = airborne && dist < s.stats.range && this.lineOfSight(s, h.pos);
      if (s.salvoLeft > 0) {
        s.salvoT -= dt;
        if (s.salvoT <= 0) { this.launch(s, h); s.salvoLeft--; s.salvoT = 0.7; }
      } else if (s.reload <= 0 && canSee) {
        s.state = 'tracking';
        s.lock = Math.min(1, s.lock + dt / s.stats.lockTime);
        if (s.lock >= 1) {
          s.salvoLeft = s.stats.salvo; s.salvoT = 0.35;
          s.lock = 0; s.reload = s.stats.reload; s.state = 'reload';
          locked = true;
        }
      } else {
        if (s.reload <= 0) s.state = 'idle';
        s.lock = Math.max(0, s.lock - (2 * dt) / s.stats.lockTime);
      }
      if (s.state === 'tracking') maxLock = Math.max(maxLock, s.lock);
      if (s.salvoLeft > 0) locked = true;
    }

    // missiles
    let inbound = 0, nearest = Infinity, bearing: number | null = null;
    for (const m of this.missiles) {
      m.life -= dt;
      let tgt: THREE.Vector3 | null = null, tvel: THREE.Vector3 | null = null;
      if (m.target === 'heli') { tgt = h.pos; tvel = h.vel; }
      else if (m.target) { tgt = m.target.pos; tvel = m.target.vel; if (m.target.life <= 0) m.target = null; }
      const speed = Math.min(MISSILE_SPEED, m.vel.length() + MISSILE_ACCEL * dt);
      if (tgt && tvel) {
        // lead pursuit with a turn-rate limit
        const tgo = clamp(_d.copy(tgt).sub(m.pos).length() / Math.max(60, speed), 0, 3);
        _t.copy(tgt).addScaledVector(tvel, tgo).sub(m.pos).normalize();
        _a.copy(m.vel).normalize();
        const ang = Math.acos(clamp(_a.dot(_t), -1, 1));
        const maxA = MISSILE_TURN * dt;
        if (ang > 1e-4) _a.lerp(_t, Math.min(1, maxA / ang)).normalize();
        m.vel.copy(_a).multiplyScalar(speed);
      } else m.vel.setLength(speed);
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(_d.copy(m.pos).add(m.vel));

      const dHeli = m.pos.distanceTo(h.pos);
      if (m.target === 'heli' && !h.crashed) {
        inbound++;
        if (dHeli < nearest) { nearest = dHeli; bearing = Math.atan2(m.pos.x - h.pos.x, m.pos.z - h.pos.z); }
      }
      if (!h.crashed && dHeli < FUSE_R) { this.detonate(m, h, dHeli); continue; }
      if (m.pos.y < this.terrain.groundAt(m.pos.x, m.pos.z) + 0.3 || m.life <= 0) { this.detonate(m, null, Infinity); continue; }
    }
    this.missiles = this.missiles.filter((m) => m.life > -100);

    // flares
    for (const f of this.flares) {
      f.life -= dt;
      f.vel.multiplyScalar(Math.exp(-1.2 * dt));
      f.vel.y -= 4 * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.sprite.position.copy(f.pos);
      f.sprite.scale.setScalar(3.2 * Math.max(0.2, f.life / FLARE_LIFE) + Math.random() * 0.6);
      if (f.life <= 0) this.scene.remove(f.sprite);
    }
    this.flares = this.flares.filter((f) => f.life > 0);

    // radar warning receiver
    this.warning = { tracking: maxLock, locked: locked || inbound > 0, inbound, bearing };
    if (locked && !this.wasLocked) this.sfx.play('locked');
    this.wasLocked = locked;
    if (maxLock > 0 && !locked && inbound === 0) {
      this.beepT -= dt;
      if (this.beepT <= 0) { this.sfx.play('lock'); this.beepT = 0.7 - 0.55 * maxLock; }
    } else this.beepT = 0;
  }

  private launch(s: SamSite, h: Heli) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(this.missileGeo, mat(0xd8d8d0));
    const plume = new THREE.Mesh(this.plumeGeo, new THREE.MeshBasicMaterial({ color: 0xffb040 }));
    plume.position.z = -1.4;
    mesh.add(body, plume);
    const pos = new THREE.Vector3(s.x, s.y + 2.2, s.z);
    const dir = new THREE.Vector3(h.pos.x - s.x, 0, h.pos.z - s.z).normalize();
    dir.y = 0.9; dir.normalize();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.missiles.push({ pos, vel: dir.multiplyScalar(40), target: 'heli', life: MISSILE_LIFE, mesh, site: s, decoyed: false });
    this.particles.emit('smoke', pos, 25, new THREE.Vector3(0, 1, 0), 2);
    this.particles.emit('fire', pos, 15);
    this.sfx.play('launch');
  }

  private detonate(m: Missile, h: Heli | null, dist: number) {
    m.life = -1000;
    this.scene.remove(m.mesh);
    this.particles.explosion(m.pos);
    this.sfx.play('boom');
    if (h && dist < FUSE_R) {
      const k = (1 - dist / (FUSE_R * 2)) * m.site.stats.damage * (0.85 + Math.random() * 0.3);
      h.damage('hull', k * 0.9);
      h.damage('engine', k * 0.6);
      h.damage('rotor', k * 0.4);
      h.damage('tail', k * 0.6);
      h.lastHitBy = 'missile';
      const mass = h.def.mass;
      const push = _d.copy(h.pos).sub(m.pos).normalize().multiplyScalar(mass * 4);
      h.body.applyImpulse({ x: push.x, y: push.y, z: push.z }, true);
      const [ix, , iz] = h.def.inertia;
      h.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * ix * 1.5, y: (Math.random() - 0.5) * mass, z: (Math.random() - 0.5) * iz * 1.5 }, true);
      h.hits.push({ kind: 'impact', amount: 25, pos: m.pos.clone() });
      this.onHit?.();
    } else if (m.target === 'heli' || m.decoyed) this.onEvade?.();
  }

  /** Visual-only animation, every render frame. */
  render(dt: number, h: Heli, time: number) {
    for (const s of this.sites) {
      if (!s.active) continue;
      const tracking = s.state === 'tracking' || s.salvoLeft > 0;
      if (tracking) {
        const yaw = Math.atan2(h.pos.x - s.x, h.pos.z - s.z) + Math.PI;
        s.turret.rotation.y += Math.atan2(Math.sin(yaw - s.turret.rotation.y), Math.cos(yaw - s.turret.rotation.y)) * Math.min(1, dt * 3);
        const elev = Math.atan2(h.pos.y - s.y, Math.hypot(h.pos.x - s.x, h.pos.z - s.z));
        s.rails.rotation.x += (clamp(elev, 0.15, 1.2) - s.rails.rotation.x) * Math.min(1, dt * 3);
      } else s.rails.rotation.x += (0.35 - s.rails.rotation.x) * Math.min(1, dt);
      s.dish.rotation.y += dt * (tracking ? 0 : 1.4);
      const lm = s.lamp.material as THREE.MeshBasicMaterial;
      const on = tracking ? Math.sin(time * (8 + 20 * s.lock)) > 0 : s.state === 'reload' ? false : Math.sin(time * 1.5) > 0.9;
      lm.color.setHex(on ? 0xff2a1a : 0x331010);
    }
    for (const m of this.missiles) this.particles.emit('smoke', m.pos, 1, m.vel.clone().multiplyScalar(-0.05), 0.4);
    for (const f of this.flares) if (Math.random() < 0.7) this.particles.emit('fire', f.pos, 1, f.vel.clone().multiplyScalar(0.3), 0.3);
  }

  /** Removes everything in flight (respawn / prestige). */
  clearFlight() {
    for (const m of this.missiles) this.scene.remove(m.mesh);
    for (const f of this.flares) this.scene.remove(f.sprite);
    this.missiles = [];
    this.flares = [];
    for (const s of this.sites) { s.lock = 0; s.salvoLeft = 0; if (s.active) s.reload = Math.max(s.reload, 8); }
    this.warning = { tracking: 0, locked: false, inbound: 0, bearing: null };
  }
}
