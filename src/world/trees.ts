import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mulberry32 } from '../core/rng';
import { BOUNDARY, WATER_LEVEL } from '../core/config';
import type { Terrain } from './terrain';
import type { Site } from './sitePlan';
import type { Physics } from '../physics/world';

/** Instanced low-poly trees, each with a trunk + canopy collider so rotors can strike them. */
export function buildTrees(scene: THREE.Scene, physics: Physics, terrain: Terrain, sites: Site[], count = 2200): void {
  const rand = mulberry32(4242);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = new THREE.ConeGeometry(1, 1, 6);
  canopyGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4430, flatShading: true }), count);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), count);
  trunks.castShadow = canopies.castShadow = true;
  trunks.receiveShadow = canopies.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const color = new THREE.Color();
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 20) {
    tries++;
    // clustered: pick a forest centre then scatter around it
    const cx = (rand() * 2 - 1) * BOUNDARY, cz = (rand() * 2 - 1) * BOUNDARY;
    const clusterN = 3 + Math.floor(rand() * 10);
    for (let k = 0; k < clusterN && placed < count; k++) {
      const x = cx + (rand() - 0.5) * 120, z = cz + (rand() - 0.5) * 120;
      if (Math.abs(x) > BOUNDARY || Math.abs(z) > BOUNDARY) continue;
      const h = terrain.heightAt(x, z);
      if (h < WATER_LEVEL + 2 || h > 230) continue;
      if (terrain.slopeAt(x, z) > 0.6) continue;
      let ok = true;
      for (const st of sites) if (Math.hypot(x - st.x, z - st.z) < st.radius * 0.8) { ok = false; break; }
      if (!ok) continue;
      const trunkH = 2 + rand() * 2.5;
      const canopyH = 5 + rand() * 7;
      const canopyR = 1.6 + rand() * 1.8;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      m.compose(p.set(x, h - 0.3, z), q, s.set(1, trunkH + 0.3, 1));
      trunks.setMatrixAt(placed, m);
      m.compose(p.set(x, h + trunkH - 0.4, z), q, s.set(canopyR, canopyH, canopyR));
      canopies.setMatrixAt(placed, m);
      color.setHSL(0.25 + rand() * 0.08, 0.35 + rand() * 0.2, 0.22 + rand() * 0.1);
      canopies.setColorAt(placed, color);
      physics.addCollider(RAPIER.ColliderDesc.cylinder(trunkH / 2, 0.3).setTranslation(x, h + trunkH / 2, z), { kind: 'tree' });
      physics.addCollider(
        RAPIER.ColliderDesc.cone(canopyH / 2, canopyR * 0.85).setTranslation(x, h + trunkH - 0.4 + canopyH / 2, z),
        { kind: 'tree' },
      );
      placed++;
    }
  }
  trunks.count = canopies.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  scene.add(trunks, canopies);
}
