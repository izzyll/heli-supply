import * as THREE from 'three';
import type { HeliDef, Paint } from './defs';

export interface HeliModel {
  root: THREE.Group;
  exterior: THREE.Group;
  cockpit: THREE.Group;
  mainRotor: THREE.Group;
  tailRotor: THREE.Group;
  blades: THREE.Group;
  disc: THREE.Mesh;
  enginePoint: THREE.Vector3;
  tailPoint: THREE.Vector3;
  hookPoint: THREE.Vector3;
  rotorTip: number;
}

const M = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, metalness: 0.15, ...extra });

export function buildHeliModel(def: HeliDef, paint: Paint): HeliModel {
  const root = new THREE.Group();
  const ext = new THREE.Group();
  root.add(ext);
  const body = M(paint.body), accent = M(paint.accent), dark = M(0x222222), metal = M(0x777b80, { metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2c3a, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.75 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = ext) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const [hx, hy, hz] = def.body;

  if (def.shape === 'egg') {
    const egg = add(new THREE.SphereGeometry(1, 12, 9), body, 0, def.bodyY, 0.1);
    egg.scale.set(hx * 1.08, hy * 1.12, hz * 1.05);
    const g = add(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), glass, 0, def.bodyY + 0.05, -hz * 0.45);
    g.scale.set(hx * 0.98, hy * 1.0, hz * 0.65);
    g.rotation.x = -Math.PI / 2.3;
  } else {
    add(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 1.6), body, 0, def.bodyY, hz * 0.2);
    const nose = add(new THREE.SphereGeometry(1, 10, 8), body, 0, def.bodyY - hy * 0.1, -hz * 0.65);
    nose.scale.set(hx, hy * 0.9, hz * 0.45);
    const g = add(new THREE.BoxGeometry(hx * 1.7, hy * 0.7, hz * 0.3), glass, 0, def.bodyY + hy * 0.35, -hz * 0.78);
    g.rotation.x = -0.45;
    // side doors / stripes
    add(new THREE.BoxGeometry(hx * 2.02, hy * 0.25, hz * 1.0), accent, 0, def.bodyY - hy * 0.4, hz * 0.2);
  }
  // engine hump + mast
  add(new THREE.BoxGeometry(hx * 1.0, hy * 0.5, hz * 0.7), accent, 0, def.bodyY + hy * 1.05, hz * 0.25);
  add(new THREE.CylinderGeometry(0.1, 0.14, def.rotorY - def.bodyY - hy, 8), metal, 0, (def.rotorY + def.bodyY + hy) / 2, 0);
  // exhaust
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), dark, 0.25, def.bodyY + hy * 1.05, hz * 0.7).rotation.x = Math.PI / 2;

  // tail boom
  const boomZ0 = hz * 0.85;
  const boom = add(new THREE.CylinderGeometry(0.12 * (hx / 0.85), 0.28 * (hx / 0.85), def.boomLen, 8), body, 0, def.bodyY + hy * 0.3, boomZ0 + def.boomLen / 2);
  boom.rotation.x = Math.PI / 2;
  const tailZ = boomZ0 + def.boomLen;
  const fin = add(new THREE.BoxGeometry(0.08, def.tailR * 1.7, def.tailR * 0.9), accent, 0, def.bodyY + hy * 0.3 + def.tailR * 0.6, tailZ - 0.1);
  fin.rotation.x = 0.25;
  add(new THREE.BoxGeometry(def.tailR * 2.2, 0.06, def.tailR * 0.5), accent, 0, def.bodyY + hy * 0.3, tailZ - def.tailR);

  // skids
  for (const sx of [-1, 1]) {
    const skid = add(new THREE.CylinderGeometry(0.06, 0.06, def.skidLen, 6), metal, sx * def.skidX, def.skidY, 0);
    skid.rotation.x = Math.PI / 2;
    const tip = add(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), metal, sx * def.skidX, def.skidY + 0.15, -def.skidLen / 2 - 0.2);
    tip.rotation.x = Math.PI / 2 - 0.6;
    for (const sz of [-0.35, 0.35]) {
      const strutH = def.bodyY - hy * 0.6 - def.skidY;
      const st = add(new THREE.BoxGeometry(0.08, strutH, 0.12), metal, sx * def.skidX * 0.85, def.skidY + strutH / 2, sz * def.skidLen * 0.6);
      st.rotation.z = sx * 0.18;
    }
  }

  // main rotor
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, def.rotorY, 0);
  ext.add(mainRotor);
  const blades = new THREE.Group();
  mainRotor.add(blades);
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 8), metal, 0, 0, 0, mainRotor);
  for (let i = 0; i < def.blades; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, def.rotorR), dark);
    b.position.set(0, 0, def.rotorR / 2);
    const holder = new THREE.Group();
    holder.rotation.y = (i / def.blades) * Math.PI * 2;
    b.castShadow = true;
    holder.add(b);
    blades.add(holder);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(def.rotorR, 32),
    new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  mainRotor.add(disc);

  // tail rotor
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.22 * (hx / 0.85), def.bodyY + hy * 0.3 + def.tailR * 0.5, tailZ);
  ext.add(tailRotor);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, def.tailR * 2, 0.14), dark);
    b.rotation.x = i * Math.PI / 2;
    tailRotor.add(b);
  }

  // cockpit interior (visible in first person)
  const cockpit = new THREE.Group();
  root.add(cockpit);
  const [ex, ey, ez] = def.eye;
  const panelMat = M(0x2a2d30);
  // low instrument panel ahead of the pilot (glare shield sits below the horizon line)
  const panelZ = ez - 0.95, panelY = ey - 0.62;
  add(new THREE.BoxGeometry(hx * 1.7, 0.22, 0.3), panelMat, 0, panelY, panelZ, cockpit).rotation.x = -0.5;
  // instrument dials
  for (let i = 0; i < 5; i++) {
    const d = add(new THREE.CircleGeometry(0.035, 14), new THREE.MeshBasicMaterial({ color: i === 2 ? 0x3fd06b : 0xd8d8d8 }), ex - 0.24 + i * 0.12, panelY + 0.06, panelZ + 0.12, cockpit);
    d.rotation.x = -0.5;
  }
  const frame = M(0x1b1d1f);
  // thin windshield frame, kept well away from the eye point
  add(new THREE.BoxGeometry(0.035, 1.0, 0.035), frame, 0, ey - 0.05, ez - 1.05, cockpit).rotation.x = -0.45;
  add(new THREE.BoxGeometry(hx * 2, 0.035, 0.035), frame, 0, ey + 0.62, ez - 0.55, cockpit);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.035, 1.1, 0.035), frame, sx * hx * 1.0, ey - 0.05, ez - 0.75, cockpit).rotation.z = sx * 0.2;
  // cyclic stick
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), frame, ex, ey - 0.75, ez - 0.2, cockpit);
  cockpit.visible = false;

  return {
    root, exterior: ext, cockpit, mainRotor, tailRotor, blades, disc,
    enginePoint: new THREE.Vector3(0, def.bodyY + hy * 1.2, hz * 0.6),
    tailPoint: new THREE.Vector3(0, def.bodyY + hy * 0.3, tailZ),
    hookPoint: new THREE.Vector3(0, def.skidY - 0.2, 0),
    rotorTip: def.rotorR,
  };
}

export function disposeModel(model: HeliModel) {
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
}
