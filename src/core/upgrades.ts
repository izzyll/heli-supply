export type UpgradeKey =
  | 'engine' | 'armor' | 'fuel' | 'hover' | 'hook' | 'cargo'
  | 'padding' | 'chute' | 'computer' | 'radar' | 'payout' | 'income';

export interface UpgradeDef { key: UpgradeKey; max: number; base: number; growth: number; icon: string }

export const UPGRADES: UpgradeDef[] = [
  { key: 'engine', max: 20, base: 300, growth: 1.17, icon: '⚙️' },
  { key: 'armor', max: 20, base: 350, growth: 1.17, icon: '🛡️' },
  { key: 'fuel', max: 15, base: 200, growth: 1.16, icon: '⛽' },
  { key: 'hover', max: 5, base: 600, growth: 1.7, icon: '🎯' },
  { key: 'hook', max: 5, base: 400, growth: 1.6, icon: '⚓' },
  { key: 'cargo', max: 4, base: 2500, growth: 2.2, icon: '📦' },
  { key: 'padding', max: 15, base: 250, growth: 1.18, icon: '🧱' },
  { key: 'chute', max: 6, base: 3000, growth: 1.5, icon: '🪂' },
  { key: 'computer', max: 2, base: 2000, growth: 2.5, icon: '🖥️' },
  { key: 'radar', max: 3, base: 800, growth: 2.2, icon: '📡' },
  { key: 'payout', max: 30, base: 500, growth: 1.2, icon: '💰' },
  { key: 'income', max: 30, base: 400, growth: 1.18, icon: '🏗️' },
];

export interface UpStats {
  engineMul: number;
  hpMul: number;
  impactBonus: number;
  fuelMul: number;
  cargoBonus: number;
  crateSafe: number;
  crateBreak: number;
  crateDmg: number;    // integrity lost per m/s of impact above crateSafe
  chute: number;
  chuteDrift: number;
  computer: number;
  hover: number;
  hookR: number;
  ropeTol: number;
  payoutMul: number;
  incomeUp: number;
  radar: number;
}

/** Impact speed after falling from height h (m), with the crate's air drag (terminal ~50 m/s). */
export function fallSpeed(h: number): number {
  const vt = 49.5;
  return vt * Math.sqrt(1 - Math.exp((-2 * 9.81 * Math.max(0, h)) / (vt * vt)));
}

/** breakHeight: free-fall height (m) at which an unpadded crate breaks (game default 4 m, adjustable in Settings). */
export function computeUpStats(u: Record<string, number>, breakHeight = 4): UpStats {
  const g = (k: UpgradeKey) => u[k] ?? 0;
  const baseBreak = Math.max(4, fallSpeed(breakHeight) + 0.1);
  return {
    engineMul: 1 + 0.06 * g('engine'),
    hpMul: 1 + 0.08 * g('armor'),
    impactBonus: 0.15 * g('armor'),
    fuelMul: 1 + 0.12 * g('fuel'),
    cargoBonus: g('cargo'),
    crateSafe: 2.5 + 0.4 * g('padding'),
    crateBreak: baseBreak + 0.8 * g('padding'),
    // scale damage so integrity falls off proportionally between the safe and break speeds
    crateDmg: 0.07 * (9 - 2.5) / (baseBreak - 2.5),
    chute: g('chute'),
    chuteDrift: Math.max(0.2, 1 - 0.15 * Math.max(0, g('chute') - 1)),
    computer: g('computer'),
    hover: g('hover'),
    hookR: 3 + g('hook'),
    ropeTol: 1 + 1.5 * g('hook'),
    payoutMul: 1 + 0.05 * g('payout'),
    incomeUp: g('income'),
    radar: g('radar'),
  };
}
