import { mulberry32 } from '../core/rng';
import { CELL, HALF_WORLD, REGION_RADII, WATER_LEVEL } from '../core/config';
import type { HeightFn } from './heightSource';

export type SiteType = 'fob' | 'depot' | 'outpost';
export interface Site {
  id: string;
  type: SiteType;
  name: string;
  x: number; z: number; y: number;
  radius: number;      // flatten radius
  region: number;
  padR: number;        // landing / drop zone radius
  yardX: number; yardZ: number; // where staged crates spawn
  facing: number;      // yaw for layout
}

const OUTPOST_NAMES = ['Viper', 'Falcon', 'Kestrel', 'Hammer', 'Granite', 'Lynx', 'Talon', 'Ridge', 'Saber', 'Badger',
  'Cobalt', 'Raven', 'Harbor', 'Summit', 'Ember', 'Frost', 'Onyx', 'Lancer', 'Mesa', 'Atlas'];
const DEPOT_NAMES = ['Depot Bravo', 'Depot Charlie', 'Depot Delta'];

const snap = (v: number) => Math.round((v + HALF_WORLD) / CELL) * CELL - HALF_WORLD;

export function planSites(raw: HeightFn, seed: number): Site[] {
  const rand = mulberry32(seed ^ 0x5eed);
  const sites: Site[] = [];

  const make = (id: string, type: SiteType, name: string, x: number, z: number, region: number): Site => {
    const radius = type === 'fob' ? 150 : type === 'depot' ? 100 : 75;
    const padR = type === 'fob' ? 12 : type === 'depot' ? 10 : 12;
    const facing = rand() * Math.PI * 2;
    const yardD = type === 'fob' ? 30 : 22;
    return {
      id, type, name, x, z, region, radius, padR, facing,
      y: Math.max(raw(x, z), WATER_LEVEL + 2.5),
      yardX: x + Math.cos(facing) * yardD, yardZ: z + Math.sin(facing) * yardD,
    };
  };

  sites.push(make('fob', 'fob', 'FOB Anvil', snap(0), snap(0), 0));

  const place = (type: SiteType, region: number, name: string, id: string) => {
    const [r0, r1] = REGION_RADII[region];
    const minSep = region === 0 ? 230 : 330;
    let best: { x: number; z: number; score: number } | null = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + rand() * (r1 - r0);
      const x = snap(Math.cos(a) * r), z = snap(Math.sin(a) * r);
      const h = raw(x, z);
      if (h < WATER_LEVEL + 2) continue;
      let slope = 0;
      for (const [dx, dz] of [[30, 0], [-30, 0], [0, 30], [0, -30]]) slope = Math.max(slope, Math.abs(raw(x + dx, z + dz) - h));
      let sepOk = true;
      for (const s of sites) if (Math.hypot(s.x - x, s.z - z) < minSep) { sepOk = false; break; }
      if (!sepOk) continue;
      const score = slope;
      if (!best || score < best.score) best = { x, z, score };
      if (slope < 12) break;
    }
    if (!best) {
      const a = rand() * Math.PI * 2;
      const r = (r0 + r1) / 2;
      best = { x: snap(Math.cos(a) * r), z: snap(Math.sin(a) * r), score: 0 };
    }
    sites.push(make(id, type, name, best.x, best.z, region));
  };

  let nameIdx = 0;
  const counts = [5, 5, 5, 4];
  for (let region = 0; region < 4; region++) {
    if (region > 0) place('depot', region, DEPOT_NAMES[region - 1], 'depot' + region);
    for (let i = 0; i < counts[region]; i++) {
      const n = OUTPOST_NAMES[nameIdx % OUTPOST_NAMES.length];
      place('outpost', region, 'OP ' + n, 'op' + nameIdx);
      nameIdx++;
    }
  }
  return sites;
}
