import { REGION_PAY, WEIGHT_PAY } from './config';

export const xpForLevel = (level: number) => Math.floor(100 * Math.pow(1.25, level - 1));
export const upgradeCost = (base: number, growth: number, tier: number) => Math.round(base * Math.pow(growth, tier));
export const medalMul = (medals: number) => 1 + 0.1 * medals;

export const BASE_THRESHOLDS = [0, 5, 15, 30, 50, 80, 120, 170, 230, 300, 400, 520];
export function baseLevelFor(crates: number): number {
  let l = 0;
  for (let i = 0; i < BASE_THRESHOLDS.length; i++) if (crates >= BASE_THRESHOLDS[i]) l = i;
  return l + 1;
}
export function incomePerMin(baseLevel: number, incomeUp: number, medals: number): number {
  return ((baseLevel - 1) * 12 + incomeUp * 15) * medalMul(medals);
}
export function prestigeGain(runEarned: number): number {
  return Math.floor(Math.sqrt(runEarned / 25000));
}
export const PRESTIGE_LEVEL = 15;

export function basePay(dist: number, weight: number, region: number): number {
  return (100 + dist * 0.35) * WEIGHT_PAY[weight] * REGION_PAY[region];
}
export function deliveryXp(dist: number, weight: number, region: number): number {
  return Math.round((20 + dist * 0.03) * (1 + weight * 0.5) * (1 + region * 0.3));
}

export interface DeliveryInput {
  dist: number; weight: number; region: number;
  integrity: number;          // 0..1
  zoneDist: number;           // metres from zone centre
  zoneR: number;
  landed: boolean;
  hot: boolean;
  chute: boolean;
  inTime: boolean;
  streak: number;
  payoutMul: number;
  medals: number;
  lucky: boolean;
}
export interface PayLine { key: string; value: string }
export interface DeliveryResult { total: number; xp: number; lines: PayLine[]; bullseye: boolean; near: boolean }

export function scoreDelivery(d: DeliveryInput): DeliveryResult {
  const lines: PayLine[] = [];
  const base = basePay(d.dist, d.weight, d.region);
  lines.push({ key: 'pay_base', value: '$' + Math.round(base) });
  let mul = 1;
  const add = (key: string, m: number) => {
    if (Math.abs(m - 1) > 0.005) { mul *= m; lines.push({ key, value: '×' + m.toFixed(2) }); }
  };
  add('pay_integrity', d.integrity);
  const near = d.zoneDist > d.zoneR;
  const bullseye = !near && d.zoneDist < (d.landed ? 4 : 3);
  if (near) add('pay_near', 0.5);
  else add('pay_accuracy', 1 + 0.3 * (1 - d.zoneDist / d.zoneR));
  if (bullseye) add('pay_bullseye', 1.5);
  if (d.hot) add('pay_hot', 1.5);
  if (d.chute) add('pay_chute', 1.15);
  if (d.inTime) add('pay_time', 1.2);
  add('pay_streak', 1 + Math.min(d.streak, 20) * 0.05);
  add('pay_bonus', d.payoutMul * medalMul(d.medals));
  if (d.lucky) add('pay_lucky', 3);
  const total = Math.max(1, Math.round(base * mul));
  const xp = Math.round(deliveryXp(d.dist, d.weight, d.region) * (0.5 + 0.5 * d.integrity) * (bullseye ? 1.5 : 1));
  return { total, xp, lines, bullseye, near };
}

// ---------- Slots (in-game cash only) ----------
export const SLOT_SYMBOLS = ['📦', '⛽', '🚁', '⭐', '🎖️', '7️⃣'];
export const SLOT_WEIGHTS = [30, 24, 18, 12, 8, 5];
export const SLOT_TRIPLE = [5, 8, 15, 30, 60, -1]; // -1 = jackpot
export function spinReel(rand: () => number = Math.random): number {
  const total = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < SLOT_WEIGHTS.length; i++) { r -= SLOT_WEIGHTS[i]; if (r < 0) return i; }
  return 0;
}
/** Bet multiplier for a result, or -1 for the jackpot. */
export function slotPayout(r: number[]): number {
  const [a, b, c] = r;
  if (a === b && b === c) return SLOT_TRIPLE[a];
  const pair = a === b ? a : b === c ? b : a === c ? a : -1;
  if (pair === 5) return 2;
  if (pair >= 0) return 1;
  return 0;
}
