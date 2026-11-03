import * as THREE from 'three';
import type { Heli } from '../heli/heli';

/** Third-person spring chase camera and first-person cockpit camera (toggle with V). */
export class CameraRig {
  mode: 'chase' | 'cockpit' = 'chase';
  dist = 16;
  lookYaw = 0;
  lookPitch = 0;
  shake = 0;
  private pos = new THREE.Vector3();
  private initialized = false;

  constructor(public camera: THREE.PerspectiveCamera) {}

  toggle() { this.mode = this.mode === 'chase' ? 'cockpit' : 'chase'; this.lookYaw = this.lookPitch = 0; }

  addShake(a: number) { this.shake = Math.min(2, this.shake + a); }

  update(dt: number, heli: Heli, look: [number, number, number], rightDown: boolean, groundAt: (x: number, z: number) => number) {
    const [lx, ly, zoom] = look;
    this.lookYaw -= lx * 0.004;
    this.lookPitch = Math.max(-1.2, Math.min(1.2, this.lookPitch - ly * 0.004));
    if (!rightDown) {
      const k = 1 - Math.exp(-3 * dt);
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }
    this.dist = Math.max(7, Math.min(60, this.dist * (1 + zoom * 0.1)));
    const cam = this.camera;
    const shake = new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    this.shake = Math.max(0, this.shake - dt * 2.5);

    if (this.mode === 'cockpit') {
      cam.fov = 78;
      const eye = new THREE.Vector3(...heli.def.eye);
      cam.position.copy(heli.worldPoint(eye)).addScaledVector(shake, 0.05);
      const q = heli.quat.clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.lookPitch - 0.12));
      cam.quaternion.copy(q);
      cam.near = 0.05;
    } else {
      cam.fov = 62;
      cam.near = 0.3;
      const scale = heli.def.rotorR / 4.2;
      const d = this.dist * scale;
      const yaw = heli.heading + this.lookYaw;
      const pitch = 0.22 + this.lookPitch;
      const offset = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d + 2 * scale, Math.cos(yaw) * Math.cos(pitch) * d);
      const desired = heli.pos.clone().add(offset);
      const g = groundAt(desired.x, desired.z) + 1.5;
      if (desired.y < g) desired.y = g;
      if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
      const k = 1 - Math.exp(-6 * dt);
      this.pos.lerp(desired, k);
      cam.position.copy(this.pos).add(shake);
      cam.lookAt(heli.pos.x, heli.pos.y + 1.2 * scale, heli.pos.z);
    }
    cam.updateProjectionMatrix();
  }

  snap() { this.initialized = false; }
}
