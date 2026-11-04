import * as THREE from 'three';
import { mat } from '../world/props';

interface Walker { g: THREE.Group; tx: number; tz: number; speed: number; removeAtEnd: boolean; t: number }

const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.9, 3, 8);
const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
const packGeo = new THREE.BoxGeometry(0.42, 0.5, 0.22);

function soldier(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, mat(0x55603a));
  body.position.y = 0.73;
  const head = new THREE.Mesh(headGeo, mat(0x3b4128));
  head.position.y = 1.55;
  const pack = new THREE.Mesh(packGeo, mat(0x4a4a32));
  pack.position.set(0, 0.95, 0.27);
  for (const m of [body, head, pack]) m.castShadow = true;
  g.add(body, head, pack);
  return g;
}

/** Cosmetic soldiers: a squad waiting at the pickup pad, walking to board, and walking off at the outpost. */
export class Troops {
  private waiting: THREE.Group[] = [];
  private walkers: Walker[] = [];
  private spot = { x: 0, z: 0, y: 0, facing: 0 };

  constructor(private scene: THREE.Scene, private groundAt: (x: number, z: number) => number) {}

  /** Line up `n` soldiers at the edge of a pad. */
  setWaiting(n: number, x = this.spot.x, z = this.spot.z, facing = this.spot.facing) {
    this.spot = { x, z, y: this.groundAt(x, z), facing };
    while (this.waiting.length > n) this.scene.remove(this.waiting.pop()!);
    while (this.waiting.length < n) {
      const g = soldier();
      this.scene.add(g);
      this.waiting.push(g);
    }
    const ax = Math.cos(facing), az = Math.sin(facing);
    this.waiting.forEach((g, i) => {
      const off = (i - (n - 1) / 2) * 1.1;
      const px = x - az * off, pz = z + ax * off;
      g.position.set(px, this.groundAt(px, pz), pz);
      g.rotation.y = -facing + Math.PI / 2;
    });
  }

  /** One waiting soldier walks to the helicopter and climbs in. */
  board(hx: number, hz: number) {
    const g = this.waiting.pop() ?? (() => { const s = soldier(); s.position.set(this.spot.x, this.spot.y, this.spot.z); this.scene.add(s); return s; })();
    this.walkers.push({ g, tx: hx, tz: hz, speed: 4.5, removeAtEnd: true, t: 0 });
  }

  /** One soldier jumps out of the helicopter and walks towards (tx, tz). */
  disembark(hx: number, hz: number, tx: number, tz: number) {
    const g = soldier();
    g.position.set(hx, this.groundAt(hx, hz), hz);
    this.scene.add(g);
    const a = Math.atan2(tz - hz, tx - hx) + (Math.random() - 0.5) * 0.8;
    const d = 18 + Math.random() * 10;
    this.walkers.push({ g, tx: hx + Math.cos(a) * d, tz: hz + Math.sin(a) * d, speed: 3.2, removeAtEnd: true, t: 0 });
  }

  clear() {
    for (const g of this.waiting) this.scene.remove(g);
    for (const w of this.walkers) this.scene.remove(w.g);
    this.waiting = [];
    this.walkers = [];
  }

  update(dt: number) {
    for (const w of this.walkers) {
      w.t += dt;
      const p = w.g.position;
      const dx = w.tx - p.x, dz = w.tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.6 || w.t > 15) { this.scene.remove(w.g); w.t = -1; continue; }
      const step = Math.min(d, w.speed * dt);
      p.x += (dx / d) * step; p.z += (dz / d) * step;
      p.y = this.groundAt(p.x, p.z) + Math.abs(Math.sin(w.t * 9)) * 0.08;
      w.g.rotation.y = Math.atan2(dx, dz) + Math.PI;
    }
    this.walkers = this.walkers.filter((w) => w.t >= 0);
  }
}
