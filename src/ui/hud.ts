import { t, money } from '../i18n';
import { HALF_WORLD, WORLD_SIZE, REGION_LEVELS } from '../core/config';
import type { Site } from '../world/sitePlan';
import type { Component } from '../heli/heli';

export interface HudData {
  cash: number; level: number; xp: number; xpNeed: number; medals: number; income: number; streak: number;
  speed: number; agl: number; vs: number; heading: number; fuel: number; collective: number;
  stick: { x: number; y: number } | null;
  hp: Record<Component, number>;
  sling: boolean; bay: number; cap: number;
  troops: boolean; flares: number; flareCap: number;
  chute: 'armed' | 'off' | 'locked';
  flightModel: 'assist' | 'realistic';
  contractTitle: string; contractSub: string; contractTimer: string; timerOk: boolean;
  warnings: { text: string; amber?: boolean }[];
  hints: string[];
  predict: { text: string; color: string } | null;
  marker: { x: number; y: number; on: boolean; angle: number; label: string } | null;
  recover: number;
  locked: boolean;
  cockpit: boolean;
  wind: number;
}

export interface MinimapData {
  x: number; z: number; heading: number;
  sites: Site[]; targetId: string | null; level: number;
  caches: { x: number; z: number }[];
  crates: { x: number; z: number; mine: boolean }[];
  sams: { x: number; z: number; hot: boolean }[];
  missiles: { x: number; z: number }[];
}

const COMPS: Component[] = ['hull', 'engine', 'rotor', 'tail', 'skids'];

export class Hud {
  el: HTMLElement;
  private q = <T extends HTMLElement = HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private lastCash = -1;
  private mm: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D;

  constructor(private mapImage: HTMLCanvasElement) {
    this.el = document.getElementById('hud')!;
    this.build();
    this.mm = this.q<HTMLCanvasElement>('.minimap');
    this.mmCtx = this.mm.getContext('2d')!;
  }

  build() {
    this.el.querySelectorAll('.hud-root').forEach((e) => e.remove());
    const root = document.createElement('div');
    root.className = 'hud-root';
    root.innerHTML = `
      <div class="hud-panel hud-tl">
        <div class="hud-cash" id="h-cash">$0</div>
        <div class="hud-row"><span class="lvl-badge" id="h-lvl">LV 1</span><div class="bar xp"><i id="h-xp"></i></div><span id="h-xpt"></span></div>
        <div class="hud-row" style="margin-top:4px"><span id="h-income"></span><span id="h-streak"></span><span id="h-medals"></span></div>
      </div>
      <div class="hud-panel hud-tr">
        <h4 id="h-ct-title"></h4>
        <div class="hud-target" id="h-ct-target"></div>
        <div class="hud-sub" id="h-ct-sub"></div>
        <div class="hud-sub" id="h-ct-timer"></div>
      </div>
      <div class="hud-panel hud-bl">
        <div class="inst"><b>${t('hud_speed')}</b><span id="h-spd">0</span><small>${t('hud_kmh')}</small></div>
        <div class="inst"><b>${t('hud_alt')}</b><span id="h-alt">0</span><small>${t('hud_m')}</small></div>
        <div class="inst"><b>${t('hud_vs')}</b><span id="h-vs">0</span><small>${t('hud_ms')}</small></div>
        <div class="inst"><b>${t('hud_hdg')}</b><span id="h-hdg">000</span></div>
        <div class="inst"><b>${t('hud_fm')}</b><span id="h-fm" style="font-size:13px">-</span><small>G</small></div>
        <div class="inst wide"><b>${t('hud_fuel')}</b><div class="bar" style="width:160px;height:9px"><i id="h-fuel"></i></div></div>
        <div class="inst"><b>${t('hud_col')}</b><div class="vbar"><i id="h-col"></i></div></div>
        <div class="inst"><div class="stick" id="h-stick"><i></i></div></div>
      </div>
      <div class="hud-panel hud-br">
        <div class="dmg">${COMPS.map((c) => `<div><span>${t('dmg_' + c)}</span><div class="bar"><i id="h-dmg-${c}"></i></div></div>`).join('')}
          <div style="margin-top:4px;color:var(--muted)" id="h-wind"></div>
        </div>
        <canvas class="minimap" width="190" height="190"></canvas>
      </div>
      <div class="hud-panel hud-cargo" id="h-cargo"></div>
      <div class="hud-center"><div id="h-warn"></div><div id="h-hints"></div></div>
      <div class="predict" id="h-predict"></div>
      <div class="marker" id="h-marker"><div class="diamond"></div><div id="h-marker-l"></div></div>
      <div class="recover hud-panel" id="h-recover"><div class="hud-sub">${t('rec_title')}</div><div class="bar"><i id="h-rec"></i></div></div>
      <div class="crosshair" id="h-cross"></div>
      <div class="lock-hint" id="h-lock">${t('click_to_fly')} · Esc</div>
    `;
    this.el.prepend(root);
    this.lastCash = -1;
    if (this.mm) { this.mm = this.q<HTMLCanvasElement>('.minimap'); this.mmCtx = this.mm.getContext('2d')!; }
  }

  update(d: HudData) {
    const set = (id: string, v: string) => { const e = this.q('#' + id); if (e && e.textContent !== v) e.textContent = v; };
    if (Math.round(d.cash) !== this.lastCash) {
      const c = this.q('#h-cash');
      c.textContent = money(d.cash);
      if (this.lastCash >= 0 && d.cash > this.lastCash) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
      this.lastCash = Math.round(d.cash);
    }
    set('h-lvl', `${t('hud_level')} ${d.level}`);
    this.q('#h-xp').style.width = Math.min(100, (d.xp / d.xpNeed) * 100) + '%';
    set('h-xpt', `${d.xp}/${d.xpNeed}`);
    set('h-income', d.income > 0 ? '🏗️ ' + t('income_rate', { cash: money(d.income) }) : '');
    set('h-streak', d.streak > 1 ? `🔥 ×${(1 + Math.min(d.streak, 20) * 0.05).toFixed(2)}` : '');
    set('h-medals', d.medals > 0 ? `🎖️ ${d.medals}` : '');
    set('h-ct-title', d.contractTitle);
    set('h-ct-target', d.contractSub ? d.contractSub.split('\n')[0] : '');
    set('h-ct-sub', d.contractSub ? d.contractSub.split('\n').slice(1).join(' · ') : '');
    set('h-ct-timer', d.contractTimer);
    this.q('#h-ct-timer').style.color = d.timerOk ? 'var(--good)' : 'var(--muted)';
    set('h-fm', t(d.flightModel === 'realistic' ? 'fm_real_short' : 'fm_assist_short'));
    this.q('#h-fm').style.color = d.flightModel === 'realistic' ? 'var(--warn, #f2c94c)' : '';
    set('h-spd', String(Math.round(d.speed * 3.6)));
    set('h-alt', String(Math.max(0, Math.round(d.agl))));
    set('h-vs', (d.vs >= 0 ? '+' : '') + d.vs.toFixed(1));
    this.q('#h-vs').style.color = d.vs < -4 && d.agl < 15 ? 'var(--bad)' : '';
    set('h-hdg', String(Math.round(((d.heading % 360) + 360) % 360)).padStart(3, '0'));
    const fuel = this.q('#h-fuel');
    fuel.style.width = d.fuel * 100 + '%';
    fuel.style.background = d.fuel < 0.2 ? 'var(--bad)' : '';
    this.q('#h-col').style.height = Math.min(100, (d.collective / 2) * 100) + '%';
    const stick = this.q('#h-stick');
    stick.style.visibility = d.stick ? 'visible' : 'hidden';
    if (d.stick) (stick.firstElementChild as HTMLElement).style.transform = `translate(calc(-50% + ${d.stick.x * 22}px), calc(-50% + ${d.stick.y * 22}px))`;
    for (const c of COMPS) {
      const b = this.q('#h-dmg-' + c);
      const v = d.hp[c];
      b.style.width = v * 100 + '%';
      b.style.background = v > 0.6 ? 'var(--good)' : v > 0.3 ? 'var(--warn)' : 'var(--bad)';
    }
    set('h-wind', d.wind > 0.5 ? '🌬 ' + t('wind', { v: d.wind.toFixed(1) }) : '');
    const cargo = `<span class="${d.sling ? 'on' : ''}">🪝 ${t('cargo_sling')}: ${d.sling ? '1' : '0'}</span>
      <span class="${d.bay ? 'on' : ''}">${d.troops ? '👥 ' + t('cargo_seats') : '📦 ' + t('cargo_bay')}: ${d.bay}/${d.cap}</span>
      <span class="${d.chute === 'armed' ? 'on' : ''}">🪂 ${t(d.chute === 'armed' ? 'chute_armed' : d.chute === 'off' ? 'chute_off' : 'chute_locked')}</span>
      <span class="${d.flares ? 'on' : ''}" style="${d.flares ? '' : 'color:var(--bad)'}">🎆 ${t('cargo_flares')}: ${d.flares}/${d.flareCap}</span>`;
    const ce = this.q('#h-cargo');
    if (ce.dataset.v !== cargo) { ce.innerHTML = cargo; ce.dataset.v = cargo; }
    const warn = d.warnings.map((w) => `<div class="warn ${w.amber ? 'amber' : ''}">${w.text}</div>`).join('');
    const we = this.q('#h-warn');
    if (we.dataset.v !== warn) { we.innerHTML = warn; we.dataset.v = warn; }
    const hints = d.hints.map((h) => `<div><span class="hint">${h}</span></div>`).join('');
    const he = this.q('#h-hints');
    if (he.dataset.v !== hints) { he.innerHTML = hints; he.dataset.v = hints; }
    const pe = this.q('#h-predict');
    pe.style.display = d.predict ? 'block' : 'none';
    if (d.predict) { pe.textContent = d.predict.text; pe.style.color = d.predict.color; }
    const me = this.q('#h-marker');
    if (d.marker) {
      me.style.display = 'block';
      me.style.left = d.marker.x + 'px';
      me.style.top = d.marker.y + 'px';
      const shape = me.firstElementChild as HTMLElement;
      shape.className = d.marker.on ? 'diamond' : 'arrow';
      shape.style.transform = d.marker.on ? 'rotate(45deg)' : `rotate(${d.marker.angle}rad)`;
      set('h-marker-l', d.marker.label);
    } else me.style.display = 'none';
    const re = this.q('#h-recover');
    re.style.display = d.recover > 0 ? 'block' : 'none';
    this.q('#h-rec').style.width = d.recover * 100 + '%';
    this.q('#h-cross').style.display = d.cockpit ? 'block' : 'none';
    this.q('#h-lock').style.display = d.locked ? 'none' : 'block';
  }

  drawMinimap(m: MinimapData) {
    const g = this.mmCtx, S = 190, R = S / 2;
    const range = 900; // metres from centre to edge
    const img = this.mapImage;
    const pxPerM = img.width / WORLD_SIZE;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#0b0f0c'; g.fillRect(0, 0, S, S);
    // north-up map centred on the helicopter
    const sx = (m.x + HALF_WORLD) * pxPerM - range * pxPerM, sz = (m.z + HALF_WORLD) * pxPerM - range * pxPerM;
    g.globalAlpha = 0.9;
    g.drawImage(img, sx, sz, range * 2 * pxPerM, range * 2 * pxPerM, 0, 0, S, S);
    g.globalAlpha = 1;
    const toS = (x: number, z: number): [number, number] => [R + ((x - m.x) / range) * R, R + ((z - m.z) / range) * R];
    for (const s of m.sites) {
      let [px, py] = toS(s.x, s.z);
      const locked = m.level < REGION_LEVELS[s.region];
      const target = s.id === m.targetId;
      const dx = px - R, dy = py - R, dd = Math.hypot(dx, dy);
      if (dd > R - 6) { if (!target) continue; px = R + (dx / dd) * (R - 6); py = R + (dy / dd) * (R - 6); }
      g.fillStyle = locked ? '#666' : s.type === 'fob' ? '#4fa3ff' : s.type === 'depot' ? '#6be07f' : '#ff8a1f';
      g.beginPath(); g.arc(px, py, target ? 6 : 4, 0, Math.PI * 2); g.fill();
      if (target) { g.strokeStyle = '#ffd25a'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.stroke(); }
    }
    for (const c of m.caches) {
      const [px, py] = toS(c.x, c.z);
      g.fillStyle = '#ffd25a'; g.fillRect(px - 3, py - 3, 6, 6);
    }
    for (const c of m.crates) {
      const [px, py] = toS(c.x, c.z);
      g.fillStyle = c.mine ? '#ffffff' : '#bbbbbb'; g.fillRect(px - 2, py - 2, 4, 4);
    }
    for (const s of m.sams) {
      let [px, py] = toS(s.x, s.z);
      const dx = px - R, dy = py - R, dd = Math.hypot(dx, dy);
      if (dd > R - 6) { if (!s.hot) continue; px = R + (dx / dd) * (R - 6); py = R + (dy / dd) * (R - 6); }
      g.fillStyle = s.hot ? '#ff3c28' : '#b04030';
      g.beginPath(); g.moveTo(px, py - 6); g.lineTo(px + 5, py + 4); g.lineTo(px - 5, py + 4); g.closePath(); g.fill();
    }
    for (const ms of m.missiles) {
      const [px, py] = toS(ms.x, ms.z);
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(px, py, 2.5, 0, Math.PI * 2); g.fill();
    }
    // helicopter arrow
    g.translate(R, R);
    g.rotate(-m.heading);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(160,220,150,0.4)'; g.lineWidth = 1;
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#b9f5a8'; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.fillText('N', R, 12);
  }
}
