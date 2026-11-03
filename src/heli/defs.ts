export type HeliId = 'scout' | 'utility' | 'heavy';

export interface HeliDef {
  id: HeliId;
  mass: number;
  inertia: [number, number, number];
  maxTilt: number;      // radians
  yawRate: number;      // rad/s
  headroom: number;     // extra thrust fraction above hover at full collective
  drag: number;         // horizontal quadratic drag coefficient
  vdrag: number;        // vertical quadratic drag coefficient
  hp: number;
  capacity: number;     // internal crates
  fuel: number;         // litres
  burn: number;         // litres / s at hover
  price: number;
  level: number;
  shape: 'egg' | 'box';
  body: [number, number, number]; // fuselage half extents
  bodyY: number;
  rotorR: number;
  rotorY: number;
  blades: number;
  boomLen: number;
  tailR: number;
  skidY: number;
  skidX: number;
  skidLen: number;
  eye: [number, number, number];
}

export const HELIS: Record<HeliId, HeliDef> = {
  scout: {
    id: 'scout', mass: 1100, inertia: [1700, 2400, 1300], maxTilt: 0.56, yawRate: 1.8, headroom: 0.75,
    drag: 1.1, vdrag: 5, hp: 100, capacity: 1, fuel: 100, burn: 0.3, price: 0, level: 1,
    shape: 'egg', body: [0.85, 0.8, 1.6], bodyY: 0.2, rotorR: 4.2, rotorY: 1.45, blades: 5,
    boomLen: 3.4, tailR: 0.65, skidY: -0.95, skidX: 0.8, skidLen: 2.8, eye: [0.32, 0.45, -1.0],
  },
  utility: {
    id: 'utility', mass: 2300, inertia: [4200, 6500, 3200], maxTilt: 0.5, yawRate: 1.4, headroom: 0.85,
    drag: 2.4, vdrag: 10, hp: 170, capacity: 2, fuel: 190, burn: 0.55, price: 15000, level: 6,
    shape: 'box', body: [1.05, 0.9, 2.5], bodyY: 0.25, rotorR: 6.2, rotorY: 1.65, blades: 4,
    boomLen: 4.6, tailR: 0.95, skidY: -1.1, skidX: 1.05, skidLen: 3.8, eye: [0.42, 0.55, -1.9],
  },
  heavy: {
    id: 'heavy', mass: 4500, inertia: [11000, 17000, 8000], maxTilt: 0.4, yawRate: 1.0, headroom: 0.95,
    drag: 4.8, vdrag: 20, hp: 280, capacity: 4, fuel: 340, burn: 0.95, price: 90000, level: 14,
    shape: 'box', body: [1.4, 1.25, 3.7], bodyY: 0.35, rotorR: 8.2, rotorY: 2.2, blades: 6,
    boomLen: 5.6, tailR: 1.25, skidY: -1.5, skidX: 1.35, skidLen: 5.2, eye: [0.55, 0.75, -3.0],
  },
};

export interface Paint { id: string; body: number; accent: number; cost: number }
export const PAINTS: Paint[] = [
  { id: 'olive', body: 0x55603a, accent: 0x2f3324, cost: 0 },
  { id: 'desert', body: 0xb59a6a, accent: 0x6b5a3a, cost: 2 },
  { id: 'arctic', body: 0xdfe5ea, accent: 0x7c8a96, cost: 3 },
  { id: 'night', body: 0x24272c, accent: 0x111214, cost: 4 },
  { id: 'rescue', body: 0xd8442e, accent: 0xf2f2f2, cost: 5 },
  { id: 'gold', body: 0xd4af37, accent: 0x6b5410, cost: 10 },
];
