import * as THREE from 'three';
import { Props, Bucket } from './props';
import type { Site } from './sitePlan';

export interface SiteVisual { site: Site; zone?: THREE.Group; pad: THREE.Mesh }

/** Builds the FOB, depots and outposts. FOB extra buildings appear as the base levels up. */
export class SiteBuilder {
  visuals = new Map<string, SiteVisual>();
  baseBuckets: { level: number; bucket: Bucket }[] = [];
  spinners: THREE.Object3D[] = [];

  constructor(private props: Props, sites: Site[]) {
    for (const s of sites) {
      if (s.type === 'fob') this.buildFob(s);
      else if (s.type === 'depot') this.buildDepot(s);
      else this.buildOutpost(s);
    }
    this.props.group.traverse((o) => { if (o.userData.spin) this.spinners.push(o); });
  }

  private buildFob(s: Site) {
    const P = this.props, y = s.y, f = s.facing;
    const R = (lx: number, lz: number) => Props.rel(s.x, s.z, f, lx, lz);
    const pad = P.helipad(s.x, y, s.z, s.padR, 'H', '#f2c94c');
    this.visuals.set(s.id, { site: s, pad });
    // supply yard marker
    P.helipad(s.yardX, y, s.yardZ, 9, '▣', '#7fd36b');
    P.hescoRing(s.x, s.z, y, 85, 28, [0, 7, 14, 21]);
    let [x, z] = R(-30, -25); P.tent(x, y, z, f, 6, 10);
    [x, z] = R(-30, -40); P.tent(x, y, z, f, 6, 10);
    [x, z] = R(-45, -30); P.tent(x, y, z, f + Math.PI / 2, 6, 12, 0x5f6640);
    [x, z] = R(40, 35); P.tower(x, y, z, 12);
    [x, z] = R(-55, 30); P.fuelTank(x, y, z);
    [x, z] = R(-55, 38); P.fuelTank(x, y, z);
    [x, z] = R(30, -45); P.container(x, y, z, f);
    [x, z] = R(34, -45); P.container(x, y, z, f, 0x4f6a4a);
    [x, z] = R(30, -45); P.container(x, y + 2.6, z, f + 0.1, 0x6a5a8a);
    [x, z] = R(15, 50); P.flag(x, y, z, 0x2d5aa8);
    [x, z] = R(-20, 55); P.radar(x, y, z);
    // Base growth buildings, unlocked by FOB level
    const growth: [number, (b: Bucket) => void][] = [
      [2, () => { const [a, b] = R(55, -10); P.hangar(a, y, b, f, 16, 22, 8); }],
      [3, () => { const [a, b] = R(-15, -60); P.tent(a, y, b, f, 7, 14, 0x766f4c); const [c, d] = R(0, -60); P.tent(c, y, d, f, 7, 14, 0x766f4c); }],
      [4, () => { const [a, b] = R(60, 20); P.tower(a, y, b, 16); }],
      [5, () => { const [a, b] = R(-62, -5); P.hangar(a, y, b, f + Math.PI / 2, 18, 26, 10); }],
      [6, () => { for (let i = 0; i < 4; i++) { const [a, b] = R(20 + i * 4, 65); P.container(a, y, b, f + Math.PI / 2, 0x6f5a3a + i * 0x050505); } }],
      [7, () => { const [a, b] = R(0, 72); P.radar(a, y, b); const [c, d] = R(10, 72); P.radar(c, y, d); }],
      [8, () => { const [a, b] = R(-60, 55); P.box(a, y, b, 14, 6, 10, 0x8a8370, f); }],
      [9, () => { const [a, b] = R(55, -50); P.hangar(a, y, b, f, 20, 28, 11); }],
      [10, () => { const [a, b] = R(-40, 65); P.tower(a, y, b, 20); }],
      [11, () => { const [a, b] = R(65, 55); P.box(a, y, b, 12, 9, 12, 0x6d6656, f); P.flag(a + 8, y, b, 0xc23b3b); }],
    ];
    for (const [level, fn] of growth) {
      const bucket: Bucket = { objects: [], colliders: [] };
      P.bucket = bucket;
      fn(bucket);
      P.bucket = null;
      this.baseBuckets.push({ level, bucket });
    }
  }

  setBaseLevel(level: number) {
    for (const { level: l, bucket } of this.baseBuckets) {
      const on = level >= l;
      for (const o of bucket.objects) o.visible = on;
      for (const c of bucket.colliders) c.setEnabled(on);
    }
  }

  private buildDepot(s: Site) {
    const P = this.props, y = s.y, f = s.facing;
    const R = (lx: number, lz: number) => Props.rel(s.x, s.z, f, lx, lz);
    const pad = P.helipad(s.x, y, s.z, s.padR, 'H', '#7fd36b');
    this.visuals.set(s.id, { site: s, pad });
    P.helipad(s.yardX, y, s.yardZ, 8, '▣', '#7fd36b');
    let [x, z] = R(-18, 20); P.container(x, y, z, f);
    [x, z] = R(-14, 20); P.container(x, y, z, f, 0x4f6a4a);
    [x, z] = R(-25, -15); P.tent(x, y, z, f, 6, 10);
    [x, z] = R(25, -20); P.fuelTank(x, y, z);
    [x, z] = R(-10, -30); P.tower(x, y, z, 10);
    P.hescoRing(s.x, s.z, y, 48, 18, [0, 9]);
  }

  private buildOutpost(s: Site) {
    const P = this.props, y = s.y, f = s.facing;
    const R = (lx: number, lz: number) => Props.rel(s.x, s.z, f, lx, lz);
    const pad = P.helipad(s.x, y, s.z, 5, 'H', '#ff8a1f');
    const zone = P.dropZone(s.x, y, s.z, s.padR);
    this.visuals.set(s.id, { site: s, pad, zone });
    let [x, z] = R(-22, 8); P.tent(x, y, z, f + 0.3, 5, 8);
    [x, z] = R(22, -6); P.tower(x, y, z, 9);
    [x, z] = R(-14, -22); P.container(x, y, z, f + 0.8);
    [x, z] = R(16, 22); P.flag(x, y, z, 0x2d5aa8);
    P.sandbags(s.x, s.z, y, 30, Math.PI * 0.8, f + 0.3);
    P.sandbags(s.x, s.z, y, 30, Math.PI * 0.6, f + Math.PI + 0.4);
  }

  update(dt: number) {
    for (const s of this.spinners) s.rotation.y += dt * 0.8;
  }
}
