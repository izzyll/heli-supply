export type Lang = 'en' | 'es';
export type AxisAction = 'collective' | 'pitch' | 'roll' | 'yaw';
export type ButtonAction = 'drop' | 'hook' | 'camera' | 'chute' | 'recover' | 'base' | 'map' | 'pause' | 'flightmode' | 'flare';
export const AXIS_ACTIONS: AxisAction[] = ['collective', 'pitch', 'roll', 'yaw'];
export const BUTTON_ACTIONS: ButtonAction[] = ['drop', 'hook', 'camera', 'chute', 'recover', 'base', 'map', 'pause', 'flightmode', 'flare'];

export interface AxisBinding { pad: string; index: number; invert: boolean }
export interface ButtonBinding { pad: string; index: number }
export interface Bindings {
  axes: Partial<Record<AxisAction, AxisBinding>>;
  buttons: Partial<Record<ButtonAction, ButtonBinding>>;
  deadzone: number;
  expo: number;
}

export interface Settings {
  lang: Lang;
  mouseSens: number;
  invertMouse: boolean;
  mouseRecenter: number;
  volume: number;
  shadows: boolean;
  camera: 'chase' | 'cockpit';
  crateBreakHeight: number; // m
  flightModel: 'assist' | 'realistic';
  chuteArmed: boolean;
  bindings: Bindings;
}

export interface Stats {
  delivered: number; broken: number; bullseyes: number; hotDrops: number; chuteDrops: number;
  crashes: number; spins: number; jackpots: number; caches: number; bestStreak: number;
  flightTime: number; contracts: number;
  soldiers: number; missilesEvaded: number; missileHits: number;
}

export interface SaveData {
  v: number;
  cash: number;
  runEarned: number;
  totalEarned: number;
  xp: number;
  level: number;
  medals: number;
  medalFragments: number;
  prestiges: number;
  upgrades: Record<string, number>;
  helis: string[];
  heli: string;
  paint: string;
  paints: string[];
  baseCrates: number;
  stats: Stats;
  achievements: string[];
  daily: { last: string; streak: number };
  lastSeen: number;
  flares: number;
  tutorialSeen: boolean;
  freeSpins: number;
  spinCounter: number;
  jackpot: number;
  streak: number;
  settings: Settings;
}
