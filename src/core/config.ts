export const WORLD_SIZE = 5000;
export const HALF_WORLD = WORLD_SIZE / 2;
export const GRID = 256;
export const CELL = WORLD_SIZE / GRID;
export const WATER_LEVEL = 8;
export const GRAVITY = 9.81;
export const FIXED_DT = 1 / 60;
export const BOUNDARY = 2250;
export const SEED = 1337;
export const ROPE_LENGTH = 10;

/** Pilot level needed to unlock each region (ring around the FOB). */
export const REGION_LEVELS = [1, 4, 9, 15];
export const REGION_RADII: [number, number][] = [[260, 750], [850, 1250], [1350, 1800], [1880, 2150]];
export const REGION_PAY = [1, 1.35, 1.8, 2.4];
export const REGION_WIND = [0, 3, 6.5, 10];

export const CRATE_MASS = [300, 600, 1000];
export const CRATE_SIZE = [1.2, 1.4, 1.6];
export const WEIGHT_PAY = [1, 1.7, 2.6];

export function regionAt(x: number, z: number): number {
  const d = Math.hypot(x, z);
  if (d < 800) return 0;
  if (d < 1300) return 1;
  if (d < 1840) return 2;
  return 3;
}
