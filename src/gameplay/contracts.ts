import { REGION_LEVELS } from '../core/config';
import { basePay, SOLDIER_PAY } from '../core/economy';
import type { Site } from '../world/sitePlan';

/** 'cargo' = crates (sling, bay, airdrop). 'troops' = soldiers, who only board and leave with the helicopter landed. */
export type ContractKind = 'cargo' | 'troops';

export interface Contract {
  id: number;
  kind: ContractKind;
  pickup: string;
  dest: string;
  crates: number;     // crates, or soldiers for a troops contract
  weight: number;
  dist: number;
  region: number;
  timeLimit: number;
  estPay: number;
}

export interface ActiveContract extends Contract {
  elapsed: number;
  delivered: number;
  resolved: number;
  internal: number;   // crates (or soldiers) currently in the helicopter
  staged: number;     // crates still waiting at the pickup yard
  earned: number;
}

let nextId = 1;

export class Contracts {
  offers: Contract[] = [];
  active: ActiveContract | null = null;

  constructor(private sites: Site[]) {}

  site(id: string) { return this.sites.find((s) => s.id === id)!; }

  /** capacity = bay crates, seats = soldier seats. */
  generate(level: number, capacity: number, payoutMul: number, seats = capacity * 4) {
    const regions = REGION_LEVELS.filter((l) => level >= l).length;
    const pickups = this.sites.filter((s) => (s.type === 'fob' || s.type === 'depot') && s.region < regions);
    const dests = this.sites.filter((s) => s.type === 'outpost' && s.region < regions);
    this.offers = [];
    for (let i = 0; i < 3; i++) {
      // bias towards the newest region so progression feels fresh
      const destPool = Math.random() < 0.5 ? dests.filter((d) => d.region === regions - 1) : dests;
      const dest = (destPool.length ? destPool : dests)[Math.floor(Math.random() * (destPool.length || dests.length))];
      // pick the closest pickup to the destination most of the time
      const sorted = [...pickups].sort((a, b) => Math.hypot(a.x - dest.x, a.z - dest.z) - Math.hypot(b.x - dest.x, b.z - dest.z));
      const pickup = Math.random() < 0.7 ? sorted[0] : sorted[Math.floor(Math.random() * sorted.length)];
      const dist = Math.hypot(pickup.x - dest.x, pickup.z - dest.z);
      const region = dest.region;
      const troops = level >= 2 && Math.random() < 0.3;
      if (troops) {
        const soldiers = 2 + Math.floor(Math.random() * (Math.min(8, Math.max(2, seats * 2)) - 1));
        const trips = Math.ceil(soldiers / seats);
        this.offers.push({
          id: nextId++, kind: 'troops', pickup: pickup.id, dest: dest.id, crates: soldiers, weight: 0, dist, region,
          timeLimit: Math.round(90 + (dist / 28) * 1.6 * trips),
          estPay: Math.round(basePay(dist, 0, region) * soldiers * SOLDIER_PAY * payoutMul * 1.15),
        });
        continue;
      }
      const maxW = level >= 7 ? 2 : level >= 3 ? 1 : 0;
      const weight = Math.floor(Math.random() * (maxW + 1));
      const crates = 1 + Math.floor(Math.random() * Math.min(4, capacity + 1));
      this.offers.push({
        id: nextId++, kind: 'cargo', pickup: pickup.id, dest: dest.id, crates, weight, dist, region,
        timeLimit: Math.round(90 + (dist / 28) * 1.6 * crates),
        estPay: Math.round(basePay(dist, weight, region) * crates * payoutMul * 1.15),
      });
    }
  }

  accept(i: number): ActiveContract {
    const c = this.offers[i];
    this.active = { ...c, elapsed: 0, delivered: 0, resolved: 0, internal: 0, staged: c.crates, earned: 0 };
    this.offers.splice(i, 1);
    return this.active;
  }

  get inTime() { return !!this.active && this.active.elapsed <= this.active.timeLimit; }

  get done() { return !!this.active && this.active.resolved >= this.active.crates; }
}
