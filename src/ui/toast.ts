import { t, money } from '../i18n';
import type { PayLine } from '../core/economy';

const root = () => document.getElementById('toasts')!;

export function toast(msg: string, kind: 'good' | 'info' | 'bad' | 'gold' = 'info', life = 3) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  el.style.setProperty('--life', life + 's');
  root().appendChild(el);
  setTimeout(() => el.remove(), (life + 0.5) * 1000);
  // keep the stack short
  const all = root().querySelectorAll('.toast');
  if (all.length > 5) all[0].remove();
}

export function banner(title: string, sub = '') {
  document.querySelectorAll('.banner').forEach((b) => b.remove());
  const el = document.createElement('div');
  el.className = 'banner';
  el.innerHTML = `<h1></h1><p></p>`;
  el.querySelector('h1')!.textContent = title;
  el.querySelector('p')!.textContent = sub;
  document.getElementById('hud')!.appendChild(el);
  setTimeout(() => el.remove(), 3300);
  confetti(60);
}

export function payCard(title: string, lines: PayLine[], total: number) {
  document.querySelectorAll('.paycard').forEach((b) => b.remove());
  const el = document.createElement('div');
  el.className = 'paycard';
  const h = document.createElement('h3'); h.textContent = title; el.appendChild(h);
  for (const l of lines) {
    const row = document.createElement('div'); row.className = 'l';
    const a = document.createElement('span'); a.textContent = t(l.key);
    const b = document.createElement('b'); b.textContent = l.value;
    row.append(a, b); el.appendChild(row);
  }
  const tot = document.createElement('div'); tot.className = 'tot';
  tot.innerHTML = `<span></span><span></span>`;
  (tot.children[0] as HTMLElement).textContent = t('pay_total');
  (tot.children[1] as HTMLElement).textContent = '+' + money(total);
  el.appendChild(tot);
  document.getElementById('hud')!.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

export function floatCash(amount: number) {
  const el = document.createElement('div');
  el.className = 'floatcash';
  el.textContent = '+' + money(amount);
  document.getElementById('hud')!.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

export function confetti(n = 40) {
  const hud = document.getElementById('hud')!;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = `hsl(${Math.random() * 360},90%,60%)`;
    c.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    hud.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}
