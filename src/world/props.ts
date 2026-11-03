import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Physics, yawQuat } from '../physics/world';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
const prismGeo = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 3, 1); g.rotateX(-Math.PI / 2); return g; })();
const matCache = new Map<string, THREE.Material>();

export function mat(color: number, emissive = 0, extra = ''): THREE.MeshStandardMaterial {
  const key = color + ':' + emissive + ':' + extra;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, emissive, emissiveIntensity: emissive ? 1 : 0 });
    matCache.set(key, m);
  }
  return m;
}

export interface Bucket { objects: THREE.Object3D[]; colliders: RAPIER.Collider[] }

/** Builds static low-poly props, each with a matching static collider. */
export class Props {
  group = new THREE.Group();
  bucket: Bucket | null = null;

  constructor(scene: THREE.Scene, private physics: Physics) {
    scene.add(this.group);
  }

  private track(o: THREE.Object3D, c?: RAPIER.Collider) {
    this.group.add(o);
    if (this.bucket) { this.bucket.objects.push(o); if (c) this.bucket.colliders.push(c); }
  }

  /** y is the bottom of the box. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, rotY = 0, collide = true): THREE.Mesh {
    const m = new THREE.Mesh(boxGeo, mat(color));
    m.scale.set(w, h, d); m.position.set(x, y + h / 2, z); m.rotation.y = rotY;
    m.castShadow = true; m.receiveShadow = true;
    let c: RAPIER.Collider | undefined;
    if (collide) {
      c = this.physics.addCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y + h / 2, z).setRotation(yawQuat(rotY)).setFriction(0.8),
        { kind: 'static' },
      );
    }
    this.track(m, c);
    return m;
  }

  cyl(x: number, y: number, z: number, r: number, h: number, color: number, collide = true): THREE.Mesh {
    const m = new THREE.Mesh(cylGeo, mat(color));
    m.scale.set(r, h, r); m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    let c: RAPIER.Collider | undefined;
    if (collide) c = this.physics.addCollider(RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y + h / 2, z), { kind: 'static' });
    this.track(m, c);
    return m;
  }

  /** Local offset helper: place relative to a site centre rotated by `facing`. */
  static rel(cx: number, cz: number, facing: number, lx: number, lz: number): [number, number] {
    const c = Math.cos(facing), s = Math.sin(facing);
    return [cx + lx * c - lz * s, cz + lx * s + lz * c];
  }

  tent(x: number, y: number, z: number, rotY: number, w = 5, d = 8, color = 0x6b7046): void {
    const wallH = 1.2, roofH = 2;
    this.box(x, y, z, w, wallH, d, color, rotY, false);
    const roof = new THREE.Mesh(prismGeo, mat(color - 0x080808 > 0 ? color - 0x080808 : color));
    roof.scale.set(w / 1.732, roofH / 1.5, d);
    roof.position.set(x, y + wallH + (roofH / 1.5) * 0.5, z);
    roof.rotation.y = rotY;
    roof.castShadow = true; roof.receiveShadow = true;
    const c = this.physics.addCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, (wallH + roofH) / 2, d / 2).setTranslation(x, y + (wallH + roofH) / 2, z).setRotation(yawQuat(rotY)),
      { kind: 'static' },
    );
    this.track(roof, c);
  }

  container(x: number, y: number, z: number, rotY: number, color = 0x7a5a3a): void {
    this.box(x, y, z, 2.5, 2.6, 6, color, rotY);
  }

  tower(x: number, y: number, z: number, h = 12): void {
    const leg = 0x5a4a38;
    for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) this.box(x + dx, y, z + dz, 0.3, h, 0.3, leg, 0, false);
    this.track(new THREE.Object3D(), this.physics.addCollider(RAPIER.ColliderDesc.cuboid(1.7, h / 2, 1.7).setTranslation(x, y + h / 2, z), { kind: 'static' }));
    this.box(x, y + h, z, 4, 0.3, 4, leg, 0, false);
    this.box(x, y + h + 0.3, z, 4, 1.1, 4, 0x6b6546, 0, false);
    this.box(x, y + h + 2.6, z, 4.6, 0.3, 4.6, 0x4a4a3a, 0, false);
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) this.box(x + dx, y + h + 1.4, z + dz, 0.2, 1.2, 0.2, leg, 0, false);
  }

  hescoLine(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = Math.atan2(x1 - x0, z1 - z0);
    this.box((x0 + x1) / 2, y, (z0 + z1) / 2, 1.4, 1.6, len, 0xa58f68, rot);
  }

  hescoRing(cx: number, cz: number, y: number, r: number, segments: number, gaps: number[]): void {
    for (let i = 0; i < segments; i++) {
      if (gaps.includes(i)) continue;
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      this.hescoLine(cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, y);
    }
  }

  flag(x: number, y: number, z: number, color: number): void {
    this.cyl(x, y, z, 0.08, 9, 0xcccccc);
    const f = new THREE.Mesh(boxGeo, mat(color));
    f.scale.set(0.05, 1.2, 2); f.position.set(x, y + 8.2, z + 1);
    f.castShadow = true;
    this.track(f);
  }

  fuelTank(x: number, y: number, z: number): void {
    const m = new THREE.Mesh(cylGeo, mat(0x5d6b4a));
    m.scale.set(1.6, 7, 1.6); m.rotation.z = Math.PI / 2; m.position.set(x, y + 1.7, z);
    m.castShadow = true; m.receiveShadow = true;
    const c = this.physics.addCollider(RAPIER.ColliderDesc.cuboid(3.5, 1.6, 1.6).setTranslation(x, y + 1.7, z), { kind: 'static' });
    this.track(m, c);
  }

  sandbags(cx: number, cz: number, y: number, r: number, arc = Math.PI, start = 0): void {
    const n = Math.max(3, Math.round((r * arc) / 2.2));
    for (let i = 0; i < n; i++) {
      const a = start + (i / (n - 1)) * arc;
      this.box(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 2.2, 1.1, 0.9, 0x9a8b66, -a + Math.PI / 2, i % 2 === 0);
    }
  }

  hangar(x: number, y: number, z: number, rotY: number, w = 16, d = 20, h = 8): void {
    this.box(x, y, z, w, h * 0.6, d, 0x6d6a5b, rotY);
    const roof = new THREE.Mesh(cylGeo, mat(0x5b594d));
    roof.scale.set(w / 2, d, h * 0.5);
    roof.rotation.set(Math.PI / 2, 0, 0, 'YXZ');
    roof.rotation.y = rotY;
    roof.position.set(x, y + h * 0.6, z);
    roof.castShadow = true; roof.receiveShadow = true;
    this.track(roof);
  }

  radar(x: number, y: number, z: number): void {
    this.cyl(x, y, z, 0.4, 6, 0x777777);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 3), mat(0xd8d8d0));
    dish.rotation.order = 'YXZ';
    dish.rotation.x = Math.PI / 2.4;
    dish.position.set(x, y + 6.5, z);
    dish.castShadow = true;
    dish.userData.spin = true;
    this.track(dish);
  }

  static helipadTexture(label: string, ring: string): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#3b3d3a'; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
    g.strokeStyle = ring; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f2f2f2'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 128, 136);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  helipad(x: number, y: number, z: number, r: number, label = 'H', ring = '#f2c94c'): THREE.Mesh {
    const top = new THREE.MeshStandardMaterial({ map: Props.helipadTexture(label, ring), roughness: 0.9 });
    const side = mat(0x2e302d);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 32), [side, top, side]);
    m.position.set(x, y + 0.04, z);
    m.receiveShadow = true;
    this.track(m);
    return m;
  }

  dropZone(x: number, y: number, z: number, r: number): THREE.Group {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.RingGeometry(r - 0.8, r, 48), new THREE.MeshBasicMaterial({ color: 0xff8a1f, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    const mid = new THREE.Mesh(new THREE.RingGeometry(r * 0.5 - 0.4, r * 0.5, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
    const bull = new THREE.Mesh(new THREE.CircleGeometry(3, 32), new THREE.MeshBasicMaterial({ color: 0xff3b1f, side: THREE.DoubleSide, transparent: true, opacity: 0.75 }));
    for (const m of [outer, mid, bull]) { m.rotation.x = -Math.PI / 2; g.add(m); }
    outer.position.y = 0.12; mid.position.y = 0.13; bull.position.y = 0.14;
    g.position.set(x, y, z);
    this.track(g);
    // traffic cones around the zone
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), mat(0xff7a00));
      cone.position.set(x + Math.cos(a) * (r + 1), y + 0.4, z + Math.sin(a) * (r + 1));
      cone.castShadow = true;
      this.track(cone);
    }
    return g;
  }
}
