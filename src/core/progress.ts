import type { SaveData } from './state';
import { writeSave, defaultSave } from './save';
import { baseLevelFor, incomePerMin, medalMul, PRESTIGE_LEVEL, prestigeGain, upgradeCost, xpForLevel } from './economy';
import { computeUpStats, UPGRADES, UpgradeKey, UpStats } from './upgrades';
import { HELIS, HeliId, PAINTS } from '../heli/defs';
import { REGION_LEVELS } from './config';

export interface Achievement { id: string; reward: number; check: (s: SaveData) => boolean }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_delivery', reward: 200, check: (s) => s.stats.delivered >= 1 },
  { id: 'deliveries_10', reward: 600, check: (s) => s.stats.delivered >= 10 },
  { id: 'deliveries_50', reward: 2500, check: (s) => s.stats.delivered >= 50 },
  { id: 'deliveries_250', reward: 12000, check: (s) => s.stats.delivered >= 250 },
  { id: 'deliveries_1000', reward: 60000, check: (s) => s.stats.delivered >= 1000 },
  { id: 'bullseye_1', reward: 300, check: (s) => s.stats.bullseyes >= 1 },
  { id: 'bullseye_25', reward: 5000, check: (s) => s.stats.bullseyes >= 25 },
  { id: 'hotdrop_1', reward: 400, check: (s) => s.stats.hotDrops >= 1 },
  { id: 'hotdrop_25', reward: 6000, check: (s) => s.stats.hotDrops >= 25 },
  { id: 'chute_1', reward: 800, check: (s) => s.stats.chuteDrops >= 1 },
  { id: 'streak_10', reward: 3000, check: (s) => s.stats.bestStreak >= 10 },
  { id: 'level_5', reward: 1000, check: (s) => s.level >= 5 },
  { id: 'level_10', reward: 5000, check: (s) => s.level >= 10 },
  { id: 'level_20', reward: 25000, check: (s) => s.level >= 20 },
  { id: 'crash_1', reward: 150, check: (s) => s.stats.crashes >= 1 },
  { id: 'jackpot_1', reward: 2000, check: (s) => s.stats.jackpots >= 1 },
  { id: 'spins_100', reward: 1500, check: (s) => s.stats.spins >= 100 },
  { id: 'caches_10', reward: 1200, check: (s) => s.stats.caches >= 10 },
  { id: 'heli_utility', reward: 2000, check: (s) => s.helis.includes('utility') },
  { id: 'heli_heavy', reward: 10000, check: (s) => s.helis.includes('heavy') },
  { id: 'prestige_1', reward: 5000, check: (s) => s.prestiges >= 1 },
];

export interface ProgressUI {
  toast: (msg: string, kind?: 'good' | 'info' | 'bad' | 'gold') => void;
  banner: (title: string, sub?: string) => void;
  sfx: (name: 'coin' | 'levelup' | 'achievement' | 'buy' | 'error') => void;
  t: (key: string, p?: Record<string, string | number>) => string;
  money: (n: number) => string;
  onBaseLevel: (level: number) => void;
}

/** Owns the save data and all progression rules (cash, XP, upgrades, rewards, prestige). */
export class Progress {
  up: UpStats;
  private incomeAcc = 0;
  private listeners: (() => void)[] = [];

  refreshUp() { this.up = computeUpStats(this.s.upgrades, this.s.settings.crateBreakHeight); }

  constructor(public s: SaveData, private ui: ProgressUI) {
    this.up = computeUpStats(s.upgrades, s.settings.crateBreakHeight);
  }

  onChange(f: () => void) { this.listeners.push(f); }
  changed() { this.listeners.forEach((f) => f()); }
  save() { writeSave(this.s); }

  get baseLevel() { return baseLevelFor(this.s.baseCrates); }
  get income() { return incomePerMin(this.baseLevel, this.up.incomeUp, this.s.medals); }
  get regionsUnlocked() { return REGION_LEVELS.filter((l) => this.s.level >= l).length; }
  get xpNeed() { return xpForLevel(this.s.level); }
  get capacity() { return HELIS[this.s.heli as HeliId].capacity + this.up.cargoBonus; }
  get minBet() { return 25 * (1 + Math.floor(this.s.level / 2)); }

  addCash(n: number, earned = true) {
    n = Math.round(n);
    this.s.cash += n;
    if (earned && n > 0) { this.s.runEarned += n; this.s.totalEarned += n; }
    this.changed();
  }

  spend(n: number): boolean {
    if (this.s.cash < n) { this.ui.sfx('error'); return false; }
    this.s.cash -= Math.round(n);
    this.changed();
    return true;
  }

  addXp(xp: number) {
    this.s.xp += Math.round(xp);
    const before = this.regionsUnlocked;
    while (this.s.xp >= this.xpNeed) {
      this.s.xp -= this.xpNeed;
      this.s.level++;
      const reward = 150 * this.s.level;
      this.addCash(reward);
      this.ui.banner(this.ui.t('toast_levelup', { n: this.s.level }), '+' + this.ui.money(reward));
      this.ui.sfx('levelup');
    }
    if (this.regionsUnlocked > before) this.ui.toast(this.ui.t('toast_unlocked_region'), 'gold');
    this.checkAchievements();
    this.changed();
  }

  recordDelivery(ok: boolean, flags: { bullseye?: boolean; hot?: boolean; chute?: boolean } = {}) {
    const st = this.s.stats;
    if (ok) {
      const prevBase = this.baseLevel;
      st.delivered++;
      this.s.baseCrates++;
      this.s.streak++;
      st.bestStreak = Math.max(st.bestStreak, this.s.streak);
      if (flags.bullseye) st.bullseyes++;
      if (flags.hot) st.hotDrops++;
      if (flags.chute) st.chuteDrops++;
      this.s.spinCounter++;
      if (this.s.spinCounter >= 5) {
        this.s.spinCounter = 0;
        this.s.freeSpins++;
        this.ui.toast(this.ui.t('toast_freespin'), 'gold');
      }
      if (this.baseLevel > prevBase) {
        this.ui.banner(this.ui.t('toast_base_up', { n: this.baseLevel }), this.ui.t('b_income', { cash: this.ui.money(this.income) }));
        this.ui.onBaseLevel(this.baseLevel);
      }
      if (this.s.streak > 1 && this.s.streak % 5 === 0) this.ui.toast(this.ui.t('toast_streak', { n: this.s.streak }), 'gold');
    } else {
      st.broken++;
      this.s.streak = 0;
    }
    this.checkAchievements();
    this.changed();
  }

  breakStreak() { this.s.streak = 0; this.changed(); }

  checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      if (this.s.achievements.includes(a.id) || !a.check(this.s)) continue;
      this.s.achievements.push(a.id);
      this.s.cash += a.reward;
      this.ui.toast(this.ui.t('toast_achievement', { name: this.ui.t('ach_' + a.id) }) + '  +' + this.ui.money(a.reward), 'gold');
      this.ui.sfx('achievement');
    }
  }

  upgradeTier(k: UpgradeKey) { return this.s.upgrades[k] ?? 0; }

  upgradePrice(k: UpgradeKey): number | null {
    const d = UPGRADES.find((u) => u.key === k)!;
    const t = this.upgradeTier(k);
    if (t >= d.max) return null;
    return upgradeCost(d.base, d.growth, t);
  }

  buyUpgrade(k: UpgradeKey): boolean {
    const price = this.upgradePrice(k);
    if (price === null || !this.spend(price)) return false;
    this.s.upgrades[k] = this.upgradeTier(k) + 1;
    this.up = computeUpStats(this.s.upgrades, this.s.settings.crateBreakHeight);
    this.ui.sfx('buy');
    this.changed();
    this.save();
    return true;
  }

  buyHeli(id: HeliId): boolean {
    const d = HELIS[id];
    if (this.s.helis.includes(id) || this.s.level < d.level || !this.spend(d.price)) return false;
    this.s.helis.push(id);
    this.s.heli = id;
    this.ui.sfx('buy');
    this.checkAchievements();
    this.changed();
    this.save();
    return true;
  }

  buyPaint(id: string): boolean {
    const p = PAINTS.find((x) => x.id === id)!;
    if (this.s.paints.includes(id)) { this.s.paint = id; this.changed(); return true; }
    if (this.s.medals < p.cost) { this.ui.sfx('error'); return false; }
    this.s.medals -= p.cost;
    this.s.paints.push(id);
    this.s.paint = id;
    this.ui.sfx('buy');
    this.changed();
    this.save();
    return true;
  }

  canPrestige() { return this.s.level >= PRESTIGE_LEVEL && prestigeGain(this.s.runEarned) > 0; }

  prestige() {
    if (!this.canPrestige()) return;
    const gain = prestigeGain(this.s.runEarned);
    const keep = this.s;
    const fresh = defaultSave(keep.settings.lang);
    fresh.medals = keep.medals + gain;
    fresh.medalFragments = keep.medalFragments;
    fresh.prestiges = keep.prestiges + 1;
    fresh.totalEarned = keep.totalEarned;
    fresh.stats = keep.stats;
    fresh.achievements = keep.achievements;
    fresh.paints = keep.paints;
    fresh.paint = keep.paint;
    fresh.settings = keep.settings;
    fresh.daily = keep.daily;
    fresh.jackpot = keep.jackpot;
    fresh.cash = 1000 * fresh.medals;
    this.s = fresh;
    this.up = computeUpStats(this.s.upgrades, this.s.settings.crateBreakHeight);
    this.checkAchievements();
    this.ui.banner(this.ui.t('b_prestige'), '+' + gain + ' 🎖️');
    this.ui.onBaseLevel(this.baseLevel);
    this.changed();
    this.save();
  }

  addMedalFragment() {
    this.s.medalFragments++;
    if (this.s.medalFragments >= 10) { this.s.medalFragments -= 10; this.s.medals++; }
    this.changed();
  }

  /** Passive base income while playing. */
  tick(dt: number) {
    this.s.stats.flightTime += dt;
    this.incomeAcc += (this.income / 60) * dt;
    if (this.incomeAcc >= 10) {
      const n = Math.floor(this.incomeAcc);
      this.incomeAcc -= n;
      this.addCash(n);
    }
  }

  /** Called once at boot: offline income + daily login bonus. */
  welcome() {
    const now = Date.now();
    const away = Math.min(8 * 3600, Math.max(0, (now - this.s.lastSeen) / 1000));
    if (away > 120 && this.income > 0) {
      const amt = Math.round((this.income / 60) * away);
      if (amt > 0) { this.addCash(amt); this.ui.toast(this.ui.t('toast_welcome', { cash: this.ui.money(amt) }), 'gold'); }
    }
    const today = new Date().toISOString().slice(0, 10);
    if (this.s.daily.last !== today) {
      const y = new Date(now - 86400000).toISOString().slice(0, 10);
      this.s.daily.streak = this.s.daily.last === y ? (this.s.daily.streak % 7) + 1 : 1;
      this.s.daily.last = today;
      const d = this.s.daily.streak;
      const amt = Math.round(200 * d * (1 + this.s.level * 0.2) * medalMul(this.s.medals));
      this.addCash(amt);
      if (d === 7) this.s.freeSpins += 3;
      this.ui.toast(this.ui.t('toast_daily', { d, cash: this.ui.money(amt) }), 'gold');
    }
    this.save();
  }
}
