import { createNoise2D, mulberry32, smoothstep } from '../core/rng';
import { HALF_WORLD } from '../core/config';

export type HeightFn = (x: number, z: number) => number;

/** Raw procedural height (before site flattening). Valleys near the centre, mountains outward. */
export function createRawHeight(seed: number): HeightFn {
  const rand = mulberry32(seed);
  const n1 = createNoise2D(rand), n2 = createNoise2D(rand), n3 = createNoise2D(rand), n4 = createNoise2D(rand);
  const fbm = (x: number, z: number) => {
    let a = 0, amp = 1, f = 1, sum = 0;
    for (let o = 0; o < 5; o++) { a += amp * n1(x * f, z * f); sum += amp; amp *= 0.5; f *= 2.03; }
    return a / sum;
  };
  const ridged = (x: number, z: number) => {
    let a = 0, amp = 1, f = 1, sum = 0;
    for (let o = 0; o < 4; o++) { const v = 1 - Math.abs(n2(x * f, z * f)); a += amp * v * v; sum += amp; amp *= 0.5; f *= 2.1; }
    return a / sum;
  };
  return (x: number, z: number) => {
    const d = Math.hypot(x, z);
    const base = fbm(x / 1100, z / 1100) * 40 + 22;
    const hills = n3(x / 300, z / 300) * 6 * smoothstep(150, 500, d);
    const mMask = smoothstep(650, 2000, d);
    const mountains = ridged(x / 650, z / 650) * 260 * mMask * (0.6 + 0.4 * n4(x / 450, z / 450));
    const edge = smoothstep(HALF_WORLD - 330, HALF_WORLD - 40, Math.max(Math.abs(x), Math.abs(z)));
    return base + hills + mountains + edge * 420;
  };
}
