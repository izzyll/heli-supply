import { t, money, setLang, getLang } from '../i18n';
import { UPGRADES, UpgradeKey } from '../core/upgrades';
import { HELIS, HeliId, PAINTS } from '../heli/defs';
import { ACHIEVEMENTS, Progress } from '../core/progress';
import { BASE_THRESHOLDS, PRESTIGE_LEVEL, SEATS_PER_BAY, medalMul, prestigeGain } from '../core/economy';
import { AXIS_ACTIONS, BUTTON_ACTIONS, AxisAction, ButtonAction } from '../core/state';
import type { Contracts } from '../gameplay/contracts';
import type { GamepadInput } from '../input/gamepad';
import type { Slots } from './slots';
import type { Sfx } from '../audio/sfx';

export type Tab = 'contracts' | 'hangar' | 'casino' | 'base' | 'settings';

export interface MenuActions {
  accept: (i: number) => void;
  abandon: () => void;
  reroll: () => void;
  selectHeli: (id: HeliId) => void;
  paintChanged: () => void;
  close: () => void;
  settingsChanged: () => void;
  prestige: () => void;
  reset: () => void;
}

export class Menu {
  open = false;
  tab: Tab = 'contracts';
  atBase = false;
  private root: HTMLElement;
  private confirm: string | null = null;
  private liveTimer = 0;

  constructor(private p: Progress, private contracts: Contracts, private slots: Slots, private pad: GamepadInput,
    private sfx: Sfx, private act: MenuActions) {
    this.root = document.getElementById('overlay')!;
    p.onChange(() => this.refreshHead());
    pad.onCaptured = (target, padId, index) => {
      const b = this.p.s.settings.bindings;
      if (target.type === 'axis') b.axes[target.action] = { pad: padId, index, invert: target.action === 'pitch' || target.action === 'collective' };
      else b.buttons[target.action] = { pad: padId, index };
      this.p.save();
      this.render();
    };
  }

  show(tab: Tab, atBase: boolean) {
    this.open = true;
    this.atBase = atBase;
    this.tab = tab;
    this.render();
  }

  hide() {
    this.open = false;
    this.pad.cancelCapture();
    this.root.querySelector('.menu-modal')?.remove();
    cancelAnimationFrame(this.liveTimer);
  }

  private refreshHead() {
    const c = this.root.querySelector('.menu-modal .cash');
    if (c) c.textContent = money(this.p.s.cash);
  }

  render() {
    this.root.querySelector('.menu-modal')?.remove();
    if (!this.open) return;
    const tabs: Tab[] = ['contracts', 'hangar', 'casino', 'base', 'settings'];
    const m = document.createElement('div');
    m.className = 'modal menu-modal';
    m.innerHTML = `<div class="window">
      <div class="win-head">
        ${!this.atBase ? `<b style="margin-right:8px;color:var(--muted);letter-spacing:2px">${t('menu_paused')}</b>` : ''}
        ${tabs.map((x) => `<button class="tab ${x === this.tab ? 'on' : ''}" data-tab="${x}">${t('menu_' + x)}</button>`).join('')}
        <span class="cash">${money(this.p.s.cash)}</span>
      </div>
      <div class="win-body" id="m-body"></div>
      <div class="win-foot"><button class="btn primary" id="m-close">${this.atBase ? t('menu_takeoff') : t('menu_resume')}</button></div>
    </div>`;
    this.root.appendChild(m);
    m.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.tab as Tab; this.confirm = null; this.sfx.play('click'); this.render();
    }));
    m.querySelector('#m-close')!.addEventListener('click', () => this.act.close());
    const body = m.querySelector<HTMLElement>('#m-body')!;
    const needsBase = (this.tab === 'hangar' || this.tab === 'casino') && !this.atBase;
    if (needsBase) { body.innerHTML = `<p style="color:var(--muted);text-align:center;margin-top:60px">🛬 ${t('menu_fob_only')}</p>`; return; }
    switch (this.tab) {
      case 'contracts': this.renderContracts(body); break;
      case 'hangar': this.renderHangar(body); break;
      case 'casino': this.slots.render(body); break;
      case 'base': this.renderBase(body); break;
      case 'settings': this.renderSettings(body); break;
    }
  }

  private renderContracts(body: HTMLElement) {
    const c = this.contracts;
    const site = (id: string) => c.site(id).name;
    let html = '';
    if (c.active) {
      const a = c.active;
      html += `<div class="section-title">${t('c_active')}</div>
        <div class="card active">
          <h3>${a.kind === 'troops' ? '👥' : '📦'} ${site(a.pickup)} → ${site(a.dest)}</h3>
          <div class="row">${a.kind === 'troops' ? `<span class="tag">${t('c_must_land')}</span><span>${t('c_soldiers', { n: a.crates })}</span>`
            : `<span class="tag w${a.weight}">${t('c_weight_' + a.weight)}</span><span>${t('c_crates', { n: a.crates })}</span>`}<span>${(a.dist / 1000).toFixed(2)} km</span></div>
          <div class="row"><span>${t('c_progress', { d: a.delivered, r: a.resolved, t: a.crates })}</span><b style="color:var(--gold)">+${money(a.earned)}</b></div>
          <div class="row"><span></span><button class="btn danger small" id="c-abandon">${t('c_cancel')}</button></div>
        </div>`;
    }
    html += `<div class="section-title">${t('menu_contracts')} <button class="btn small" id="c-reroll" style="margin-left:8px">🔄 ${t('c_reroll')}</button></div>
      <p class="hud-sub">${t('c_capacity', { n: this.p.capacity })}</p><div class="grid">`;
    c.offers.forEach((o, i) => {
      html += `<div class="card">
        <h3>${o.kind === 'troops' ? '👥 ' : ''}${site(o.pickup)} → ${site(o.dest)}</h3>
        <div class="row">${o.kind === 'troops' ? `<span class="tag">${t('c_must_land')}</span><span>${t('c_soldiers', { n: o.crates })}</span>`
          : `<span class="tag w${o.weight}">${t('c_weight_' + o.weight)}</span><span>${t('c_crates', { n: o.crates })}</span>`}<span class="tag">${t('c_region', { n: o.region + 1 })}</span></div>
        ${o.kind === 'troops' ? `<p>${t('c_troops_desc', { n: this.p.capacity * SEATS_PER_BAY })}</p>` : ''}
        <div class="row"><span>${t('c_dist')}</span><b>${(o.dist / 1000).toFixed(2)} km</b></div>
        <div class="row"><span>${t('c_time')}</span><b>${Math.floor(o.timeLimit / 60)}:${String(o.timeLimit % 60).padStart(2, '0')}</b></div>
        <div class="row"><span>${t('c_pay')}</span><b style="color:var(--gold)">~${money(o.estPay)}</b></div>
        ${o.weight === 2 ? `<p>⚠️ ${t('c_heavy_warn')}</p>` : ''}
        <button class="btn primary" data-accept="${i}" ${c.active ? 'disabled' : ''}>${t('c_accept')}</button>
      </div>`;
    });
    html += '</div>';
    if (!c.active && !c.offers.length) html += `<p>${t('c_none')}</p>`;
    body.innerHTML = html;
    body.querySelector('#c-abandon')?.addEventListener('click', () => { this.act.abandon(); this.render(); });
    body.querySelector('#c-reroll')?.addEventListener('click', () => { this.act.reroll(); this.sfx.play('click'); this.render(); });
    body.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach((b) => b.addEventListener('click', () => { this.act.accept(Number(b.dataset.accept)); this.render(); }));
  }

  private renderHangar(body: HTMLElement) {
    const p = this.p;
    const fp = p.flarePrice, room = Math.max(0, p.up.flareCap - p.s.flares);
    const pack = Math.min(4, room), fill = room;
    const canPack = pack > 0 && p.s.cash >= pack * fp, canFill = fill > 0 && p.s.cash >= fill * fp;
    let html = `<div class="section-title">${t('h_counter')}</div><div class="grid">
      <div class="card"><h3>🎆 ${t('h_flares')}</h3>
        <p>${t('h_flares_d')}</p>
        <div class="row"><span>${t('h_flares_have', { n: p.s.flares, m: p.up.flareCap })}</span><span>${t('h_flares_each', { cash: money(fp) })}</span></div>
        <div class="row">
          <button class="btn ${canPack ? 'primary' : ''}" data-flares="4" ${canPack ? '' : 'disabled'}>${t('h_flares_buy', { n: pack || 4 })} ${money((pack || 4) * fp)}</button>
          <button class="btn ${canFill ? 'primary' : ''}" data-flares="${fill}" ${canFill ? '' : 'disabled'}>${t('h_flares_fill')} ${fill ? money(fill * fp) : ''}</button>
        </div></div></div>
      <div class="section-title">${t('h_upgrades')}</div><div class="grid">`;
    for (const u of UPGRADES) {
      const tier = p.upgradeTier(u.key);
      const price = p.upgradePrice(u.key);
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < tier ? 'on' : ''}"></i>`).join('');
      html += `<div class="card">
        <h3>${u.icon} ${t('up_' + u.key)}</h3>
        <p>${t('up_' + u.key + '_d')}</p>
        <div class="pips">${pips}</div>
        <div class="row"><span>${t('h_tier', { n: tier, m: u.max })}</span>
          ${price === null ? `<b style="color:var(--gold)">${t('h_max')}</b>` : `<button class="btn ${p.s.cash >= price ? 'primary' : ''}" data-up="${u.key}" ${p.s.cash >= price ? '' : 'disabled'}>${t('h_buy')} ${money(price)}</button>`}
        </div></div>`;
    }
    html += `</div><div class="section-title">${t('h_helis')}</div><div class="grid">`;
    for (const id of Object.keys(HELIS) as HeliId[]) {
      const d = HELIS[id];
      const owned = p.s.helis.includes(id);
      const inUse = p.s.heli === id;
      const lockedLv = p.s.level < d.level;
      let btn: string;
      if (inUse) btn = `<b style="color:var(--gold)">${t('h_selected')}</b>`;
      else if (owned) btn = `<button class="btn primary" data-heli="${id}">${t('h_select')}</button>`;
      else if (lockedLv) btn = `<span class="tag">🔒 ${t('h_req_level', { n: d.level })}</span>`;
      else btn = `<button class="btn ${p.s.cash >= d.price ? 'primary' : ''}" data-buyheli="${id}" ${p.s.cash >= d.price ? '' : 'disabled'}>${t('h_buy')} ${money(d.price)}</button>`;
      html += `<div class="card ${inUse ? 'active' : ''}"><h3>🚁 ${t('heli_' + id)}</h3><p>${t('heli_' + id + '_d')}</p>
        <p>${t('h_stats', { m: d.mass, c: d.capacity, f: d.fuel, h: d.hp })}</p><div class="row"><span></span>${btn}</div></div>`;
    }
    html += `</div><div class="section-title">${t('h_paints')}</div><div class="grid">`;
    for (const pt of PAINTS) {
      const owned = p.s.paints.includes(pt.id);
      const inUse = p.s.paint === pt.id;
      const hex = '#' + pt.body.toString(16).padStart(6, '0');
      html += `<div class="card ${inUse ? 'active' : ''}"><h3><i style="display:inline-block;width:16px;height:16px;border-radius:4px;background:${hex}"></i> ${t('paint_' + pt.id)}</h3>
        <div class="row"><span>${owned ? t('h_owned') : t('h_medals', { n: pt.cost })}</span>
        ${inUse ? `<b style="color:var(--gold)">${t('h_selected')}</b>` : `<button class="btn" data-paint="${pt.id}" ${owned || p.s.medals >= pt.cost ? '' : 'disabled'}>${owned ? t('h_select') : t('h_buy')}</button>`}</div></div>`;
    }
    html += '</div>';
    body.innerHTML = html;
    const keep = body.scrollTop;
    body.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.addEventListener('click', () => {
      const top = body.scrollTop;
      if (p.buyUpgrade(b.dataset.up as UpgradeKey)) { this.act.settingsChanged(); this.renderHangar(body); body.scrollTop = top; }
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-flares]').forEach((b) => b.addEventListener('click', () => {
      const top = body.scrollTop;
      if (p.buyFlares(Number(b.dataset.flares))) { this.renderHangar(body); body.scrollTop = top; }
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-heli]').forEach((b) => b.addEventListener('click', () => { this.act.selectHeli(b.dataset.heli as HeliId); this.renderHangar(body); }));
    body.querySelectorAll<HTMLButtonElement>('[data-buyheli]').forEach((b) => b.addEventListener('click', () => {
      if (p.buyHeli(b.dataset.buyheli as HeliId)) { this.act.selectHeli(b.dataset.buyheli as HeliId); this.renderHangar(body); }
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-paint]').forEach((b) => b.addEventListener('click', () => {
      if (p.buyPaint(b.dataset.paint!)) { this.act.paintChanged(); this.renderHangar(body); }
    }));
    body.scrollTop = keep;
  }

  private renderBase(body: HTMLElement) {
    const p = this.p, s = p.s;
    const bl = p.baseLevel;
    const next = BASE_THRESHOLDS[bl];
    const gain = prestigeGain(s.runEarned);
    const fmtTime = (sec: number) => `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    const stats: [string, string][] = [
      ['st_delivered', String(s.stats.delivered)], ['st_broken', String(s.stats.broken)], ['st_bullseyes', String(s.stats.bullseyes)],
      ['st_hotDrops', String(s.stats.hotDrops)], ['st_chuteDrops', String(s.stats.chuteDrops)], ['st_bestStreak', String(s.stats.bestStreak)],
      ['st_contracts', String(s.stats.contracts)], ['st_caches', String(s.stats.caches)], ['st_crashes', String(s.stats.crashes)],
      ['st_spins', String(s.stats.spins)], ['st_jackpots', String(s.stats.jackpots)], ['st_flightTime', fmtTime(s.stats.flightTime)],
      ['st_soldiers', String(s.stats.soldiers)], ['st_missilesEvaded', String(s.stats.missilesEvaded)], ['st_missileHits', String(s.stats.missileHits)],
      ['st_totalEarned', money(s.totalEarned)],
    ];
    body.innerHTML = `
      <div class="grid">
        <div class="card active"><h3>🏗️ ${t('b_level', { n: bl })}</h3>
          <p>${t('b_income', { cash: money(p.income) })}</p>
          <p>${next !== undefined ? t('b_next', { n: next }) : t('b_max')}</p>
          ${next !== undefined ? `<div class="bar"><i style="width:${Math.min(100, (s.baseCrates / next) * 100)}%"></i></div>` : ''}
        </div>
        <div class="card"><h3>🎖️ ${t('b_prestige')}</h3>
          <p>${t('b_medals', { n: s.medals, p: Math.round((medalMul(s.medals) - 1) * 100), f: s.medalFragments })}</p>
          <p>${t('b_prestige_desc')}</p>
          ${p.canPrestige()
            ? `<button class="btn gold" id="b-prestige">${this.confirm === 'prestige' ? t('b_prestige_confirm') : t('b_prestige_gain', { n: gain })}</button>`
            : `<span class="tag">🔒 ${t('b_prestige_req', { n: PRESTIGE_LEVEL })}</span>`}
        </div>
      </div>
      <div class="section-title">${t('b_stats')}</div>
      <div class="kv">${stats.map(([k, v]) => `<span>${t(k)}</span><span>${v}</span>`).join('')}</div>
      <div class="section-title">${t('b_achievements')} (${s.achievements.length}/${ACHIEVEMENTS.length})</div>
      <div class="ach">${ACHIEVEMENTS.map((a) => `<div class="${s.achievements.includes(a.id) ? 'on' : ''}">${s.achievements.includes(a.id) ? '🏆' : '🔒'} ${t('ach_' + a.id)}<br><small>+${money(a.reward)}</small></div>`).join('')}</div>`;
    body.querySelector('#b-prestige')?.addEventListener('click', () => {
      if (this.confirm !== 'prestige') { this.confirm = 'prestige'; this.renderBase(body); return; }
      this.confirm = null;
      this.act.prestige();
      this.render();
    });
  }

  private renderSettings(body: HTMLElement) {
    const s = this.p.s.settings;
    const b = s.bindings;
    const padName = (id: string) => id.length > 28 ? id.slice(0, 28) + '…' : id;
    const cap = this.pad.capture;
    body.innerHTML = `<div class="settings">
      <div class="section-title">${t('menu_settings')}</div>
      <label>${t('s_language')} <span><button class="btn small ${getLang() === 'en' ? 'primary' : ''}" data-lang="en">English</button> <button class="btn small ${getLang() === 'es' ? 'primary' : ''}" data-lang="es">Español</button></span></label>
      <label>${t('s_flight')} <span><button class="btn small ${s.flightModel !== 'realistic' ? 'primary' : ''}" data-fm="assist">${t('fm_assist')}</button> <button class="btn small ${s.flightModel === 'realistic' ? 'primary' : ''}" data-fm="realistic">${t('fm_real')}</button></span></label>
      <p class="hud-sub">${t(s.flightModel === 'realistic' ? 'fm_real_desc' : 'fm_assist_desc')}</p>
      <label>${t('s_break_h')} <span><input type="range" min="4" max="80" step="1" value="${s.crateBreakHeight}" data-set="crateBreakHeight"> <b id="s-bh">${s.crateBreakHeight} m</b></span></label>
      <p class="hud-sub">${t('s_break_h_desc')}</p>
      <label>${t('s_mouse_sens')} <input type="range" min="0.2" max="3" step="0.1" value="${s.mouseSens}" data-set="mouseSens"></label>
      <label>${t('s_recenter')} <input type="range" min="0" max="4" step="0.1" value="${s.mouseRecenter}" data-set="mouseRecenter"></label>
      <label>${t('s_invert')} <input type="checkbox" ${s.invertMouse ? 'checked' : ''} data-check="invertMouse"></label>
      <label>${t('s_volume')} <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-set="volume"></label>
      <label>${t('s_shadows')} <input type="checkbox" ${s.shadows ? 'checked' : ''} data-check="shadows"></label>

      <div class="section-title">${t('s_controls')} — HOTAS / Gamepad</div>
      <p class="hud-sub">${t('s_std_hint')}</p>
      <div class="hud-sub">${t('s_devices')}</div>
      <div id="pads">${this.pad.pads.length ? '' : `<p class="hud-sub">${t('s_nodevices')}</p>`}</div>
      <div class="hud-sub" style="margin-top:8px">${t('s_axes')}</div>
      ${AXIS_ACTIONS.map((a) => {
        const bd = b.axes[a];
        const capturing = cap?.type === 'axis' && cap.action === a;
        return `<div class="bindrow"><span>${t('ax_' + a)}</span><code>${bd ? `${padName(bd.pad)} · axis ${bd.index}` : t('s_unbound')}</code>
          <button class="btn small ${capturing ? 'gold' : ''}" data-bind-axis="${a}">${capturing ? t('s_binding') : t('s_bind')}</button>
          <label style="border:0;padding:0;font-size:12px"><input type="checkbox" ${bd?.invert ? 'checked' : ''} data-inv="${a}" ${bd ? '' : 'disabled'}> ${t('s_invert_axis')}</label>
          <button class="btn small" data-clear-axis="${a}" ${bd ? '' : 'disabled'}>${t('s_clear')}</button></div>`;
      }).join('')}
      <div class="hud-sub" style="margin-top:8px">${t('s_buttons')}</div>
      ${BUTTON_ACTIONS.map((a) => {
        const bd = b.buttons[a];
        const capturing = cap?.type === 'button' && cap.action === a;
        return `<div class="bindrow"><span>${t('bt_' + a)}</span><code>${bd ? `${padName(bd.pad)} · btn ${bd.index}` : t('s_unbound')}</code>
          <button class="btn small ${capturing ? 'gold' : ''}" data-bind-btn="${a}">${capturing ? t('s_binding_btn') : t('s_bind')}</button><span></span>
          <button class="btn small" data-clear-btn="${a}" ${bd ? '' : 'disabled'}>${t('s_clear')}</button></div>`;
      }).join('')}
      <label>${t('s_deadzone')} <input type="range" min="0" max="0.3" step="0.01" value="${b.deadzone}" data-bset="deadzone"></label>
      <label>${t('s_expo')} <input type="range" min="0" max="1" step="0.05" value="${b.expo}" data-bset="expo"></label>

      <div class="section-title">${t('s_keyboard')}</div>
      <div class="keys">${['k_collective', 'k_yaw', 'k_cyclic', 'k_center', 'k_hook', 'k_drop', 'k_chute', 'k_cam', 'k_fm', 'k_base', 'k_map', 'k_rec', 'k_look'].map((k) => `<div>${t(k)}</div>`).join('')}</div>

      <div class="section-title"></div>
      <button class="btn danger" id="s-reset">${this.confirm === 'reset' ? t('s_reset_confirm') : t('s_reset')}</button>
    </div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((x) => x.addEventListener('click', () => {
      s.lang = x.dataset.lang as 'en' | 'es'; setLang(s.lang); this.p.save(); this.act.settingsChanged(); this.render();
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-fm]').forEach((x) => x.addEventListener('click', () => {
      s.flightModel = x.dataset.fm as 'assist' | 'realistic'; this.p.save(); this.act.settingsChanged(); this.render();
    }));
    body.querySelectorAll<HTMLInputElement>('[data-set]').forEach((x) => x.addEventListener('input', () => {
      (s as unknown as Record<string, number>)[x.dataset.set!] = Number(x.value); this.act.settingsChanged(); this.p.save();
      if (x.dataset.set === 'crateBreakHeight') { const e = body.querySelector('#s-bh'); if (e) e.textContent = x.value + ' m'; }
    }));
    body.querySelectorAll<HTMLInputElement>('[data-check]').forEach((x) => x.addEventListener('change', () => {
      (s as unknown as Record<string, boolean>)[x.dataset.check!] = x.checked; this.act.settingsChanged(); this.p.save();
    }));
    body.querySelectorAll<HTMLInputElement>('[data-bset]').forEach((x) => x.addEventListener('input', () => {
      (b as unknown as Record<string, number>)[x.dataset.bset!] = Number(x.value); this.p.save();
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-bind-axis]').forEach((x) => x.addEventListener('click', () => {
      this.pad.startCapture({ type: 'axis', action: x.dataset.bindAxis as AxisAction }); this.renderSettings(body);
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-bind-btn]').forEach((x) => x.addEventListener('click', () => {
      this.pad.startCapture({ type: 'button', action: x.dataset.bindBtn as ButtonAction }); this.renderSettings(body);
    }));
    body.querySelectorAll<HTMLInputElement>('[data-inv]').forEach((x) => x.addEventListener('change', () => {
      const bd = b.axes[x.dataset.inv as AxisAction]; if (bd) bd.invert = x.checked; this.p.save();
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-clear-axis]').forEach((x) => x.addEventListener('click', () => {
      delete b.axes[x.dataset.clearAxis as AxisAction]; this.p.save(); this.renderSettings(body);
    }));
    body.querySelectorAll<HTMLButtonElement>('[data-clear-btn]').forEach((x) => x.addEventListener('click', () => {
      delete b.buttons[x.dataset.clearBtn as ButtonAction]; this.p.save(); this.renderSettings(body);
    }));
    body.querySelector('#s-reset')!.addEventListener('click', () => {
      if (this.confirm !== 'reset') { this.confirm = 'reset'; this.renderSettings(body); return; }
      this.act.reset();
    });
    // live controller axes view
    const padsEl = body.querySelector<HTMLElement>('#pads')!;
    let lastCount = -1;
    const live = () => {
      if (!this.open || this.tab !== 'settings' || !document.body.contains(padsEl)) return;
      const pads = this.pad.pads;
      if (pads.length !== lastCount) {
        lastCount = pads.length;
        padsEl.innerHTML = pads.length ? pads.map((pd, k) => `<div class="hud-sub">🎮 ${padName(pd.id)} (${pd.mapping || 'raw'})</div>
          <div class="axislive">${pd.axes.map((_, i) => `<div>axis ${i}<div class="bar"><i id="ax-${k}-${i}"></i></div></div>`).join('')}</div>`).join('')
          : `<p class="hud-sub">${t('s_nodevices')}</p>`;
      }
      pads.forEach((pd, k) => pd.axes.forEach((v, i) => {
        const e = padsEl.querySelector<HTMLElement>(`#ax-${k}-${i}`);
        if (e) { e.style.left = (v < 0 ? 50 + v * 50 : 50) + '%'; e.style.width = Math.abs(v) * 50 + '%'; }
      }));
      if (this.pad.capture === null && body.querySelector('.btn.gold[data-bind-axis], .btn.gold[data-bind-btn]')) this.renderSettings(body);
      this.liveTimer = requestAnimationFrame(live);
    };
    cancelAnimationFrame(this.liveTimer);
    this.liveTimer = requestAnimationFrame(live);
  }
}
