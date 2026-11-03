import type { SaveData } from './state';

const KEY = 'supply-run-save-v1';
export const SAVE_VERSION = 1;

export function defaultSave(lang: 'en' | 'es'): SaveData {
  return {
    v: SAVE_VERSION,
    cash: 500,
    runEarned: 0,
    totalEarned: 0,
    xp: 0,
    level: 1,
    medals: 0,
    medalFragments: 0,
    prestiges: 0,
    upgrades: {},
    helis: ['scout'],
    heli: 'scout',
    paint: 'olive',
    paints: ['olive'],
    baseCrates: 0,
    stats: { delivered: 0, broken: 0, bullseyes: 0, hotDrops: 0, chuteDrops: 0, crashes: 0, spins: 0, jackpots: 0, caches: 0, bestStreak: 0, flightTime: 0, contracts: 0 },
    achievements: [],
    daily: { last: '', streak: 0 },
    lastSeen: Date.now(),
    freeSpins: 1,
    spinCounter: 0,
    jackpot: 5000,
    streak: 0,
    settings: {
      lang,
      mouseSens: 1,
      invertMouse: false,
      mouseRecenter: 1.2,
      volume: 0.7,
      shadows: true,
      camera: 'chase',
      flightModel: 'assist',
      crateBreakHeight: 40,
      chuteArmed: true,
      bindings: { axes: {}, buttons: {}, deadzone: 0.06, expo: 0.25 },
    },
  };
}

function merge<T>(def: T, src: unknown): T {
  if (src === null || typeof src !== 'object' || Array.isArray(def)) return (src ?? def) as T;
  const out: Record<string, unknown> = { ...(def as Record<string, unknown>) };
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    const d = (def as Record<string, unknown>)[k];
    out[k] = d !== null && typeof d === 'object' && !Array.isArray(d) && k !== 'upgrades' && k !== 'axes' && k !== 'buttons' ? merge(d, v) : v;
  }
  return out as T;
}

export function loadSave(lang: 'en' | 'es'): SaveData {
  const def = defaultSave(lang);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    return merge(def, JSON.parse(raw));
  } catch {
    return def;
  }
}

export function writeSave(s: SaveData): void {
  try {
    s.lastSeen = Date.now();
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage unavailable */ }
}

export function wipeSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
