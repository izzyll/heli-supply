import { t } from '../i18n';

/**
 * Illustrated "How to play" walkthrough shown before the first flight (and from the start screen).
 * The pictures are inline SVG, so no image assets are needed.
 */

const C = {
  ground: '#3b4a2c', grass: '#4f6a36', sky1: '#1b2b36', sky2: '#2f4a58', body: '#6b7a46', dark: '#2f3324', glass: '#9fd3e6',
  line: '#b9f5a8', text: '#e8efe4', muted: '#93a690', gold: '#ffd25a', good: '#6be07f', warn: '#ffb03a', bad: '#ff5f4f', accent: '#ff8a1f', blue: '#4fa3ff',
};

function key(x: number, y: number, label: string, w = 28): string {
  return `<g><rect x="${x}" y="${y}" width="${w}" height="26" rx="5" fill="#1d2a1f" stroke="${C.line}" stroke-width="1.5"/>
    <rect x="${x + 2}" y="${y + 21}" width="${w - 4}" height="3" rx="1.5" fill="${C.line}" opacity="0.25"/>
    <text x="${x + w / 2}" y="${y + 18}" text-anchor="middle" font-size="13" font-weight="700" fill="${C.text}" font-family="ui-monospace,Consolas,monospace">${label}</text></g>`;
}

function arrow(x1: number, y1: number, x2: number, y2: number, color: string = C.gold, w = 3): string {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 9;
  const p1 = [x2 - Math.cos(a - 0.45) * h, y2 - Math.sin(a - 0.45) * h], p2 = [x2 - Math.cos(a + 0.45) * h, y2 - Math.sin(a + 0.45) * h];
  return `<line x1="${x1}" y1="${y1}" x2="${x2 - Math.cos(a) * 4}" y2="${y2 - Math.sin(a) * 4}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>
    <polygon points="${x2},${y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}" fill="${color}"/>`;
}

/** Side view helicopter, nose to the left. (x, y) = fuselage centre. */
function heli(x: number, y: number, s = 1, tilt = 0): string {
  return `<g transform="translate(${x} ${y}) rotate(${tilt}) scale(${s})">
    <rect x="14" y="-5" width="40" height="5" rx="2" fill="${C.body}"/>
    <polygon points="50,-5 60,-17 62,-17 58,0" fill="${C.body}"/>
    <circle cx="58" cy="-6" r="5" fill="none" stroke="${C.dark}" stroke-width="1.5"/>
    <ellipse cx="0" cy="0" rx="24" ry="13" fill="${C.body}"/>
    <path d="M-23,-1 Q-20,-12 -6,-11 L-6,0 Z" fill="${C.glass}" opacity="0.9"/>
    <rect x="-2" y="-19" width="4" height="7" fill="${C.dark}"/>
    <rect x="-40" y="-22" width="80" height="3" rx="1.5" fill="${C.dark}"/>
    <line x1="-12" y1="11" x2="-14" y2="18" stroke="${C.dark}" stroke-width="2"/>
    <line x1="12" y1="11" x2="14" y2="18" stroke="${C.dark}" stroke-width="2"/>
    <line x1="-22" y1="18" x2="22" y2="18" stroke="${C.dark}" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

function crate(x: number, y: number, s = 22): string {
  return `<g><rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" fill="#9a7a4a" stroke="#5a4426" stroke-width="2"/>
    <line x1="${x - s / 2}" y1="${y - s / 2}" x2="${x + s / 2}" y2="${y + s / 2}" stroke="#5a4426" stroke-width="2"/>
    <line x1="${x + s / 2}" y1="${y - s / 2}" x2="${x - s / 2}" y2="${y + s / 2}" stroke="#5a4426" stroke-width="2"/></g>`;
}

function pad(x: number, y: number, rx = 46, color: string = C.gold, label = 'H'): string {
  return `<g><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${rx * 0.18}" fill="#55584a" stroke="${color}" stroke-width="2.5"/>
    <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="900" fill="${color}" font-family="system-ui">${label}</text></g>`;
}

function soldier(x: number, y: number): string {
  return `<g><circle cx="${x}" cy="${y - 22}" r="4" fill="#3b4128"/><rect x="${x - 4}" y="${y - 18}" width="8" height="12" rx="3" fill="#55603a"/>
    <line x1="${x - 2}" y1="${y - 6}" x2="${x - 4}" y2="${y}" stroke="#3b4128" stroke-width="3"/><line x1="${x + 2}" y1="${y - 6}" x2="${x + 4}" y2="${y}" stroke="#3b4128" stroke-width="3"/></g>`;
}

function emoji(x: number, y: number, e: string, size = 26): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}">${e}</text>`;
}

function frame(inner: string): string {
  return `<svg viewBox="0 0 360 210" xmlns="http://www.w3.org/2000/svg" role="img">
    <defs><linearGradient id="tutsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.sky1}"/><stop offset="1" stop-color="${C.sky2}"/></linearGradient></defs>
    <rect width="360" height="210" rx="10" fill="url(#tutsky)"/>${inner}</svg>`;
}

const ground = (y = 182) => `<rect x="0" y="${y}" width="360" height="${210 - y}" fill="${C.ground}"/><rect x="0" y="${y}" width="360" height="3" fill="${C.grass}"/>`;

// ---------------------------------------------------------------- pages
const PICS: (() => string)[] = [
  // 1 - flight controls
  () => frame(`${ground()}
    ${heli(180, 108, 1.7, -8)}
    ${arrow(52, 128, 52, 52)}${arrow(52, 100, 52, 168)}
    ${key(66, 46, 'W')}${key(66, 140, 'S')}
    <path d="M250,52 A70,70 0 0 1 292,104" fill="none" stroke="${C.gold}" stroke-width="3"/>${arrow(286, 92, 293, 106)}
    <rect x="292" y="122" width="30" height="44" rx="15" fill="#1d2a1f" stroke="${C.line}" stroke-width="1.5"/><line x1="307" y1="122" x2="307" y2="138" stroke="${C.line}" stroke-width="1.5"/>
    ${key(254, 176, '↑', 22)}${key(230, 176, '←', 22)}${key(278, 176, '→', 22)}
    <path d="M140,62 Q180,44 220,62" fill="none" stroke="${C.accent}" stroke-width="3"/>${arrow(212, 57, 222, 63, C.accent)}
    ${key(118, 30, 'A')}${key(222, 30, 'D')}`),
  // 2 - contracts & cargo
  () => frame(`${ground()}
    <rect x="66" y="10" width="28" height="172" fill="${C.good}" opacity="0.18"/>
    ${pad(80, 182, 46, C.good, '▣')}${crate(64, 171)}${crate(90, 171)}
    ${heli(240, 66, 1.5)}
    <line x1="240" y1="93" x2="240" y2="140" stroke="${C.text}" stroke-width="2" stroke-dasharray="4 3"/>
    ${crate(240, 152, 24)}
    ${key(258, 118, 'F')}
    ${emoji(150, 120, '➜', 30)}
    ${key(124, 140, 'B')}
    <rect x="300" y="10" width="26" height="172" fill="${C.accent}" opacity="0.18"/>`),
  // 3 - delivery methods
  () => frame(`${ground()}
    ${heli(70, 56, 1.2)}
    <line x1="20" y1="46" x2="40" y2="46" stroke="${C.text}" stroke-width="2" opacity="0.5"/><line x1="14" y1="58" x2="38" y2="58" stroke="${C.text}" stroke-width="2" opacity="0.5"/>
    ${key(96, 76, 'E')}
    <path d="M74,80 Q200,80 262,176" fill="none" stroke="${C.good}" stroke-width="3" stroke-dasharray="6 5"/>
    <ellipse cx="262" cy="183" rx="46" ry="8" fill="none" stroke="${C.accent}" stroke-width="3"/>
    <circle cx="262" cy="183" r="5" fill="${C.good}"/>
    <g font-family="system-ui" font-size="13" font-weight="700">
      <circle cx="262" cy="30" r="8" fill="${C.good}"/><text x="276" y="35" fill="${C.text}">✓</text>
      <circle cx="262" cy="54" r="8" fill="${C.warn}"/><text x="276" y="59" fill="${C.text}">~</text>
      <circle cx="262" cy="78" r="8" fill="${C.bad}"/><text x="276" y="83" fill="${C.text}">✗</text>
    </g>
    ${emoji(326, 110, '🪂', 26)}${key(314, 120, 'P')}`),
  // 4 - troops
  () => frame(`${ground()}
    ${pad(100, 184, 54)}
    ${heli(100, 155, 1.5)}
    ${soldier(176, 184)}${soldier(204, 184)}${soldier(232, 184)}
    ${arrow(160, 150, 250, 150, C.good)}
    <polygon points="270,184 298,150 326,184" fill="#6b7046"/><rect x="292" y="166" width="12" height="18" fill="#2f3324"/>
    <g transform="translate(250 22)"><text x="28" y="40" text-anchor="middle" font-size="34">🪂</text>
      <circle cx="28" cy="28" r="26" fill="none" stroke="${C.bad}" stroke-width="4"/><line x1="10" y1="46" x2="46" y2="10" stroke="${C.bad}" stroke-width="4"/></g>
    <g transform="translate(40 26)"><circle cx="20" cy="20" r="20" fill="${C.good}" opacity="0.25"/><text x="20" y="27" text-anchor="middle" font-size="20" fill="${C.good}" font-weight="900">↓</text></g>`),
  // 5 - SAM & flares
  () => frame(`${ground()}
    <polygon points="120,182 175,110 240,182" fill="#33402a"/>
    <rect x="34" y="170" width="44" height="12" fill="#4a5236"/><rect x="48" y="150" width="34" height="9" rx="2" fill="#5b6444" transform="rotate(-35 50 160)"/>
    <circle cx="44" cy="150" r="4" fill="${C.bad}"/>
    <path d="M70,140 A40,40 0 0 1 98,122" fill="none" stroke="${C.bad}" stroke-width="2"/><path d="M80,150 A60,60 0 0 1 120,118" fill="none" stroke="${C.bad}" stroke-width="2" opacity="0.7"/>
    <path d="M70,150 Q140,30 236,90" fill="none" stroke="#d8d8d0" stroke-width="2.5" stroke-dasharray="5 4"/>
    <circle cx="236" cy="90" r="11" fill="${C.gold}" opacity="0.5"/><circle cx="236" cy="90" r="5" fill="#fff6d8"/>
    <circle cx="222" cy="104" r="8" fill="${C.gold}" opacity="0.45"/><circle cx="222" cy="104" r="3.5" fill="#fff6d8"/>
    ${heli(286, 60, 1.3, -6)}
    ${key(300, 92, 'Q')}
    ${heli(270, 168, 0.8)}
    <line x1="74" y1="150" x2="262" y2="166" stroke="${C.bad}" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.8"/>
    <text x="178" y="140" text-anchor="middle" font-size="20" fill="${C.bad}" font-weight="900">✗</text>`),
  // 6 - base & progress
  () => frame(`${ground()}
    ${pad(110, 184, 60)}
    ${heli(110, 155, 1.5)}
    ${emoji(214, 74, '⛽', 30)}${emoji(258, 74, '🔧', 30)}${emoji(302, 74, '🛒', 30)}
    ${key(244, 104, 'B')}
    ${emoji(214, 156, '🗺️', 28)}${key(232, 136, 'M')}
    ${emoji(296, 156, '🏠', 28)}${key(312, 136, 'R', 28)}
    <rect x="26" y="20" width="110" height="10" rx="5" fill="#1d2a1f" stroke="${C.line}"/><rect x="28" y="22" width="70" height="6" rx="3" fill="${C.good}"/>
    <rect x="26" y="38" width="110" height="10" rx="5" fill="#1d2a1f" stroke="${C.line}"/><rect x="28" y="40" width="30" height="6" rx="3" fill="${C.warn}"/>`),
];

const PAGES = PICS.length;

/** Shows the tutorial. `onDone` runs when the player finishes or skips it. */
export function showTutorial(onDone: () => void) {
  const o = document.getElementById('overlay')!;
  const m = document.createElement('div');
  m.className = 'modal tut-modal';
  o.appendChild(m);
  let page = 0;

  const close = () => { window.removeEventListener('keydown', onKey, true); m.remove(); onDone(); };
  const go = (p: number) => { page = Math.max(0, Math.min(PAGES - 1, p)); render(); };
  const onKey = (e: KeyboardEvent) => {
    const eat = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'Space') { eat(); if (page === PAGES - 1) close(); else go(page + 1); }
    else if (e.code === 'ArrowLeft') { eat(); go(page - 1); }
    else if (e.code === 'Escape') { eat(); close(); }
  };
  window.addEventListener('keydown', onKey, true);

  function render() {
    const n = page + 1;
    const bullets = t(`tut_p${n}_b`).split('\n').map((b) => `<li>${b}</li>`).join('');
    const last = page === PAGES - 1;
    m.innerHTML = `<div class="tut">
      <div class="tut-head"><span class="tut-step">${t('tut_step', { n, m: PAGES })}</span><button class="btn small" data-act="skip">${t('tut_skip')}</button></div>
      <h2>${t(`tut_p${n}_t`)}</h2>
      <div class="tut-pic">${PICS[page]()}</div>
      <ul class="tut-list">${bullets}</ul>
      <div class="tut-dots">${Array.from({ length: PAGES }, (_, i) => `<button class="${i === page ? 'on' : ''}" data-dot="${i}" aria-label="${i + 1}"></button>`).join('')}</div>
      <div class="tut-nav">
        <button class="btn" data-act="back" ${page === 0 ? 'disabled' : ''}>← ${t('tut_back')}</button>
        <button class="btn primary" data-act="next">${last ? t('tut_go') : t('tut_next') + ' →'}</button>
      </div>
    </div>`;
    m.querySelector('[data-act="skip"]')!.addEventListener('click', close);
    m.querySelector('[data-act="back"]')!.addEventListener('click', () => go(page - 1));
    m.querySelector('[data-act="next"]')!.addEventListener('click', () => (last ? close() : go(page + 1)));
    m.querySelectorAll<HTMLButtonElement>('[data-dot]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.dot))));
  }
  render();
}
