import { en } from './en';
import { es } from './es';
import type { Lang } from '../core/state';

export type TKey = keyof typeof en;
const dicts: Record<Lang, Record<TKey, string>> = { en, es };
let lang: Lang = 'en';
const listeners: (() => void)[] = [];

export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export const getLang = () => lang;
export function onLangChange(f: () => void) { listeners.push(f); }

export function t(key: string, params?: Record<string, string | number>): string {
  let s: string = dicts[lang][key as TKey] ?? en[key as TKey] ?? key;
  if (params) for (const k in params) s = s.split('{' + k + '}').join(String(params[k]));
  return s;
}

export function detectLang(): Lang {
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function money(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', { useGrouping: true });
}
