import * as THREE from 'three';
import { GRAVITY } from '../core/config';
import type { UpStats } from '../core/upgrades';
import { CHUTE_DRAG, CRATE_DRAG, chuteDelay } from './crates';

export interface Prediction {
  impact: THREE.Vector3;
  impactSpeed: number;   // speed at first ground contact
  vertSpeed: number;
  time: number;
  chute: boolean;
  valid: boolean;
}

const MAX_POINTS = 160;

/** Forward-simulates a released crate with the same gravity/drag/parachute model the physics uses. */
export function predict(pos: THREE.Vector3, vel: THREE.Vector3, armed: boolean, wind: THREE.Vector3, up: UpStats,
  groundAt: (x: number, z: number) => number, out: THREE.Vector3[]): Prediction {
  const dt = 1 / 30;
  const p = pos.clone(), v = vel.clone();
  const agl0 = p.y - groundAt(p.x, p.z);
  const chute = armed && up.chute > 0 && agl0 > 18;
  const useWind = up.computer >= 1;
  let open = 0, t = 0;
  out.length = 0;
  out.push(p.clone());
  for (let i = 0; i < MAX_POINTS * 3; i++) {
    t += dt;
    if (chute && t > chuteDelay(up)) open = Math.min(1, open + dt);
    const cd = CRATE_DRAG + CHUTE_DRAG * open;
    const drift = open > 0 ? up.chuteDrift : 0.15;
    const wx = useWind ? wind.x * drift : 0, wz = useWind ? wind.z * drift : 0;
    const rx = v.x - wx, ry = v.y, rz = v.z - wz;
    const sp = Math.hypot(rx, ry, rz);
    const k = 1 / (1 + cd * sp * dt);
    v.set(wx + rx * k, ry * k, wz + rz * k);
    v.y -= GRAVITY * dt;
    p.addScaledVector(v, dt);
    if (i % 2 === 0 && out.length < MAX_POINTS) out.push(p.clone());
    const g = groundAt(p.x, p.z);
    if (p.y <= g) {
      p.y = g;
      out.push(p.clone());
      return { impact: p, impactSpeed: v.length(), vertSpeed: -v.y, time: t, chute, valid: true };
    }
  }
  return { impact: p, impactSpeed: v.length(), vertSpeed: -v.y, time: t, chute, valid: false };
}

/** Dotted arc + ground marker showing where a released crate will land. */
export class DropPredictor {
  line: THREE.Line;
  marker: THREE.Group;
  ring: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private geo: THREE.BufferGeometry;
  private mat: THREE.LineDashedMaterial;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3 + 6), 3));
    this.mat = new THREE.LineDashedMaterial({ color: 0x7dff9a, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.9, depthTest: false });
    this.line = new THREE.Line(this.geo, this.mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 10;
    this.marker = new THREE.Group();
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.2, 32),
      new THREE.MeshBasicMaterial({ color: 0x7dff9a, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 11;
    const cross = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false }),
    );
    cross.rotation.x = -Math.PI / 2;
    const cross2 = cross.clone(); cross2.rotation.z = Math.PI / 2;
    this.marker.add(this.ring, cross, cross2);
    scene.add(this.line, this.marker);
    this.hide();
  }

  hide() { this.line.visible = false; this.marker.visible = false; }

  show(pred: Prediction, pts: THREE.Vector3[], color: number) {
    const attr = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(pts.length, MAX_POINTS + 2);
    for (let i = 0; i < n; i++) attr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    attr.needsUpdate = true;
    this.geo.setDrawRange(0, n);
    this.line.computeLineDistances();
    this.mat.color.setHex(color);
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.marker.position.copy(pred.impact).add(new THREE.Vector3(0, 0.3, 0));
    const s = 1 + Math.min(3, pred.time * 0.15);
    this.marker.scale.setScalar(s);
    this.line.visible = true;
    this.marker.visible = true;
  }

  get points() { return this.pts; }
}
