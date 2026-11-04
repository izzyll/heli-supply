import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CELL, GRID, HALF_WORLD, WATER_LEVEL, WORLD_SIZE } from '../core/config';
import { createNoise2D, mulberry32, smoothstep } from '../core/rng';
import type { HeightFn } from './heightSource';
import type { Site } from './sitePlan';
import type { Physics } from '../physics/world';

export class Terrain {
  readonly n = GRID + 1;
  heights: Float32Array;
  mesh!: THREE.Mesh;
  water!: THREE.Mesh;
  mapCanvas!: HTMLCanvasElement;

  constructor(raw: HeightFn, private sites: Site[]) {
    const n = this.n;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -HALF_WORLD + i * CELL, z = -HALF_WORLD + j * CELL;
        let h = raw(x, z);
        for (const s of sites) {
          const d = Math.hypot(x - s.x, z - s.z);
          if (d < s.radius) h += (s.y - h) * smoothstep(s.radius, s.radius * 0.6, d);
        }
        this.heights[i + j * n] = h;
      }
    }
  }

  private h(i: number, j: number): number {
    const n = this.n;
    i = Math.max(0, Math.min(n - 1, i)); j = Math.max(0, Math.min(n - 1, j));
    return this.heights[i + j * n];
  }

  /** Exact height of the rendered/collision triangle surface. */
  heightAt(x: number, z: number): number {
    const fx = (x + HALF_WORLD) / CELL, fz = (z + HALF_WORLD) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const ha = this.h(i, j), hb = this.h(i + 1, j), hc = this.h(i, j + 1), hd = this.h(i + 1, j + 1);
    if (tx + tz <= 1) return ha + (hb - ha) * tx + (hc - ha) * tz;
    return hd + (hc - hd) * (1 - tx) + (hb - hd) * (1 - tz);
  }

  groundAt(x: number, z: number): number {
    return Math.max(this.heightAt(x, z), WATER_LEVEL);
  }

  slopeAt(x: number, z: number): number {
    const d = 4;
    const dx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const dz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return Math.hypot(dx, dz) / (2 * d);
  }

  private faceColor(avgH: number, ny: number, cx: number, cz: number, noise: (x: number, y: number) => number, out: THREE.Color) {
    const v = noise(cx / 120, cz / 120) * 0.5 + 0.5;
    let inBase = false;
    for (const s of this.sites) {
      if (Math.hypot(cx - s.x, cz - s.z) < s.radius * 0.45) { inBase = true; break; }
    }
    if (avgH < WATER_LEVEL + 1.6) out.setRGB(0.78, 0.71, 0.5);
    else if (inBase) out.setRGB(0.55 + v * 0.05, 0.48 + v * 0.04, 0.34);
    else if (ny < 0.7) out.setRGB(0.42 + v * 0.08, 0.4 + v * 0.06, 0.37 + v * 0.05);
    else if (avgH > 210 && ny > 0.78) out.setRGB(0.92, 0.93, 0.96);
    else {
      const dry = smoothstep(60, 180, avgH);
      out.setRGB(0.3 + v * 0.12 + dry * 0.1, 0.46 + v * 0.08 - dry * 0.06, 0.2 + v * 0.05 + dry * 0.04);
    }
  }

  buildMesh(): THREE.Mesh {
    const n = this.n;
    const tris = GRID * GRID * 2;
    const pos = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 9);
    const noise = createNoise2D(mulberry32(99));
    const rand = mulberry32(7);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
    const color = new THREE.Color();
    let p = 0;
    // Visual only: sink underwater vertices an extra metre so the seabed never sits almost exactly at the
    // water surface (that near-coplanar overlap z-fights and makes the water flicker at a distance).
    const vh = (i: number, j: number) => { const h = this.heights[i + j * n]; return h < WATER_LEVEL ? h - 1.2 : h; };
    const pushTri = (ia: number, ja: number, ib: number, jb: number, ic: number, jc: number) => {
      a.set(-HALF_WORLD + ia * CELL, vh(ia, ja), -HALF_WORLD + ja * CELL);
      b.set(-HALF_WORLD + ib * CELL, vh(ib, jb), -HALF_WORLD + jb * CELL);
      c.set(-HALF_WORLD + ic * CELL, vh(ic, jc), -HALF_WORLD + jc * CELL);
      e1.subVectors(b, a); e2.subVectors(c, a); nrm.crossVectors(e1, e2).normalize();
      const ny = Math.abs(nrm.y);
      const avgH = (a.y + b.y + c.y) / 3;
      this.faceColor(avgH, ny, (a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, noise, color);
      const jit = 0.97 + rand() * 0.06;
      for (const v of [a, b, c]) {
        pos[p] = v.x; pos[p + 1] = v.y; pos[p + 2] = v.z;
        col[p] = color.r * jit; col[p + 1] = color.g * jit; col[p + 2] = color.b * jit;
        p += 3;
      }
    };
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        // a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1); triangles (a,c,b) and (b,c,d)
        pushTri(i, j, i, j + 1, i + 1, j);
        pushTri(i + 1, j, i, j + 1, i + 1, j + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;

    const wgeo = new THREE.PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({
      color: 0x2f6f8f, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85,
      // pull the surface slightly towards the camera in depth so it wins against shallow seabed far away
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.water.position.y = WATER_LEVEL;
    this.water.receiveShadow = true;
    return this.mesh;
  }

  addColliders(physics: Physics): void {
    const n = this.n;
    const verts = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (i + j * n) * 3;
      verts[k] = -HALF_WORLD + i * CELL; verts[k + 1] = this.heights[i + j * n]; verts[k + 2] = -HALF_WORLD + j * CELL;
    }
    const idx = new Uint32Array(GRID * GRID * 6);
    let p = 0;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const A = i + j * n, B = i + 1 + j * n, C = i + (j + 1) * n, D = i + 1 + (j + 1) * n;
      idx[p++] = A; idx[p++] = C; idx[p++] = B;
      idx[p++] = B; idx[p++] = C; idx[p++] = D;
    }
    physics.addCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.9), { kind: 'terrain' });
    // Water surface: a big thin slab so things that fall in are stopped (and flagged as lost/ditched).
    physics.addCollider(
      RAPIER.ColliderDesc.cuboid(HALF_WORLD, 0.5, HALF_WORLD).setTranslation(0, WATER_LEVEL - 0.5, 0).setFriction(0.3),
      { kind: 'water' },
    );
  }

  /** Top-down coloured relief map used by the minimap and the full map. */
  buildMapCanvas(size = 512): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const color = new THREE.Color();
    const noise = createNoise2D(mulberry32(99));
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = -HALF_WORLD + (px + 0.5) / size * WORLD_SIZE;
        const z = -HALF_WORLD + (py + 0.5) / size * WORLD_SIZE;
        const h = this.heightAt(x, z);
        const k = (px + py * size) * 4;
        if (h < WATER_LEVEL) {
          img.data[k] = 50; img.data[k + 1] = 110; img.data[k + 2] = 145; img.data[k + 3] = 255;
          continue;
        }
        const hx = this.heightAt(x + 10, z) - h, hz = this.heightAt(x, z + 10) - h;
        const ny = 1 / Math.sqrt(1 + (hx / 10) ** 2 + (hz / 10) ** 2);
        this.faceColor(h, ny, x, z, noise, color);
        const shade = Math.max(0.55, Math.min(1.25, 1 - (hx + hz) * 0.03));
        img.data[k] = Math.min(255, color.r * 255 * shade);
        img.data[k + 1] = Math.min(255, color.g * 255 * shade);
        img.data[k + 2] = Math.min(255, color.b * 255 * shade);
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.mapCanvas = cv;
    return cv;
  }
}
