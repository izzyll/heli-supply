import { t, money } from '../i18n';
import { SLOT_SYMBOLS, SLOT_TRIPLE, slotPayout, spinReel } from '../core/economy';
import type { Progress } from '../core/progress';
import type { Sfx } from '../audio/sfx';
import { confetti } from './toast';

const BET_MULTS = [1, 2, 5, 10, 25];

/** 3-reel slot machine. In-game cash only. */
export class Slots {
  el: HTMLElement | null = null;
  betIdx = 0;
  spinning = false;

  constructor(private progress: Progress, private sfx: Sfx) {}

  get bet() { return this.progress.minBet * BET_MULTS[this.betIdx]; }

  render(container: HTMLElement) {
    const p = this.progress;
    container.innerHTML = `
      <div class="slots">
        <div class="machine">
          <h2>${t('cas_title')}</h2>
          <div class="jackpot">${t('cas_jackpot')}: <span id="s-jp">${money(p.s.jackpot)}</span></div>
          <div class="reels">${[0, 1, 2].map((i) => `<div class="reel"><div class="strip" id="s-r${i}"><div>${SLOT_SYMBOLS[i]}</div></div></div>`).join('')}</div>
          <div class="slot-msg" id="s-msg"></div>
          <div class="hud-sub">${t('cas_bet')}</div>
          <div class="bets">${BET_MULTS.map((m, i) => `<button class="btn small ${i === this.betIdx ? 'on' : ''}" data-bet="${i}">${money(p.minBet * m)}</button>`).join('')}</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:8px">
            <button class="btn gold" id="s-spin" style="font-size:20px;padding:10px 34px">${t('cas_spin')}</button>
            <button class="btn primary" id="s-free" ${p.s.freeSpins > 0 ? '' : 'disabled'}>${t('cas_free', { n: p.s.freeSpins })}</button>
          </div>
          <p class="hud-sub" style="margin-top:10px">${t('cas_note')}</p>
        </div>
        <div class="card paytable">
          <h3>${t('cas_paytable')}</h3>
          ${SLOT_SYMBOLS.map((s, i) => `<div><span>${s}${s}${s}</span><b>${SLOT_TRIPLE[i] < 0 ? t('cas_jackpot') : '×' + SLOT_TRIPLE[i]}</b></div>`).reverse().join('')}
          <div><span>${t('cas_pair7')} 7️⃣7️⃣</span><b>×2</b></div>
          <div><span>${t('cas_pair')}</span><b>×1</b></div>
        </div>
      </div>`;
    this.el = container;
    container.querySelectorAll<HTMLButtonElement>('[data-bet]').forEach((b) => b.addEventListener('click', () => {
      if (this.spinning) return;
      this.betIdx = Number(b.dataset.bet);
      container.querySelectorAll('[data-bet]').forEach((x) => x.classList.toggle('on', x === b));
      this.sfx.play('click');
    }));
    container.querySelector('#s-spin')!.addEventListener('click', () => this.spin(false));
    container.querySelector('#s-free')!.addEventListener('click', () => this.spin(true));
  }

  private spin(free: boolean) {
    if (this.spinning || !this.el) return;
    const p = this.progress;
    const bet = free ? Math.min(this.bet, p.minBet * 5) : this.bet;
    if (free) { if (p.s.freeSpins <= 0) return; p.s.freeSpins--; }
    else if (!p.spend(bet)) { this.msg(t('cas_nocash'), true); return; }
    this.spinning = true;
    p.s.stats.spins++;
    p.s.jackpot += Math.round(bet * 0.03);
    const result = [spinReel(), spinReel(), spinReel()];
    this.msg('');
    this.sfx.play('spin');
    const machine = this.el.querySelector('.machine')!;
    machine.classList.remove('win');
    result.forEach((sym, i) => {
      const strip = this.el!.querySelector<HTMLElement>('#s-r' + i)!;
      const n = 18 + i * 6;
      const syms: string[] = [];
      for (let k = 0; k < n; k++) syms.push(SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
      syms.push(SLOT_SYMBOLS[sym]);
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      strip.innerHTML = syms.map((s) => `<div>${s}</div>`).join('');
      void strip.offsetHeight;
      const dur = 0.9 + i * 0.45;
      strip.style.transition = `transform ${dur}s cubic-bezier(.15,.8,.25,1)`;
      strip.style.transform = `translateY(-${n * 92}px)`;
      setTimeout(() => this.sfx.play('reelstop'), dur * 1000);
    });
    setTimeout(() => this.resolve(result, bet), (0.9 + 2 * 0.45) * 1000 + 120);
    p.changed();
  }

  private resolve(r: number[], bet: number) {
    const p = this.progress;
    this.spinning = false;
    const mult = slotPayout(r);
    const machine = this.el?.querySelector('.machine');
    if (mult === -1) {
      const win = p.s.jackpot;
      p.addCash(win, false);
      p.s.jackpot = 100 * p.minBet;
      p.s.stats.jackpots++;
      p.addMedalFragment();
      this.msg(t('cas_jackpot_win', { cash: money(win) }));
      this.sfx.play('jackpot');
      confetti(120);
      machine?.classList.add('win');
    } else if (mult > 1) {
      p.addCash(bet * mult, false);
      this.msg(t('cas_win', { cash: money(bet * mult) }));
      this.sfx.play(mult >= 15 ? 'jackpot' : 'win');
      if (mult >= 15) confetti(60);
      machine?.classList.add('win');
    } else if (mult === 1) {
      p.addCash(bet, false);
      this.msg(t('cas_push'));
      this.sfx.play('coin');
    } else {
      this.msg(t('cas_lose'), true);
    }
    p.checkAchievements();
    p.changed();
    p.save();
    const jp = this.el?.querySelector('#s-jp');
    if (jp) jp.textContent = money(p.s.jackpot);
    const free = this.el?.querySelector<HTMLButtonElement>('#s-free');
    if (free) { free.disabled = p.s.freeSpins <= 0; free.textContent = t('cas_free', { n: p.s.freeSpins }); }
  }

  private msg(text: string, lose = false) {
    const m = this.el?.querySelector('#s-msg');
    if (!m) return;
    m.textContent = text;
    m.className = 'slot-msg' + (lose ? ' lose' : '');
  }
}
