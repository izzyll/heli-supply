import './styles.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BOUNDARY, CRATE_MASS, FIXED_DT, REGION_LEVELS, REGION_RADII, REGION_WIND, SEED, WATER_LEVEL, regionAt } from './core/config';
import { clamp } from './core/rng';
import { loadSave, wipeSave } from './core/save';
import { Progress } from './core/progress';
import { medalMul, scoreDelivery, SEATS_PER_BAY } from './core/economy';
import { AASystem } from './gameplay/aa';
import { Troops } from './gameplay/troops';
import { detectLang, money, onLangChange, setLang, t } from './i18n';
import { Physics } from './physics/world';
import { createRawHeight } from './world/heightSource';
import { planSites, Site } from './world/sitePlan';
import { Terrain } from './world/terrain';
import { Sky } from './world/sky';
import { Props } from './world/props';
import { SiteBuilder } from './world/sites';
import { buildTrees } from './world/trees';
import { Heli } from './heli/heli';
import { HELIS, HeliId, PAINTS } from './heli/defs';
import { Input } from './input/input';
import { CameraRig } from './camera/cameraRig';
import { Crate, CrateManager } from './gameplay/crates';
import { DropPredictor, predict } from './gameplay/airdrop';
import { Contracts } from './gameplay/contracts';
import { Particles } from './fx/particles';
import { Sfx } from './audio/sfx';
import { Hud, HudData } from './ui/hud';
import { Menu, Tab } from './ui/menus';
import { Slots } from './ui/slots';
import { showTutorial } from './ui/tutorial';
import { banner, confetti, floatCash, payCard, toast } from './ui/toast';

type Mode = 'start' | 'fly' | 'menu' | 'crash' | 'map';

interface Cache { x: number; y: number; z: number; group: THREE.Group }

class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
  physics = new Physics();
  sites: Site[];
  terrain: Terrain;
  sky: Sky;
  siteBuilder: SiteBuilder;
  progress: Progress;
  input: Input;
  heli!: Heli;
  crates: CrateManager;
  predictor: DropPredictor;
  contracts: Contracts;
  aa: AASystem;
  troops: Troops;
  particles: Particles;
  sfx = new Sfx();
  hud!: Hud;
  menu: Menu;
  slots: Slots;
  rig: CameraRig;
  mode: Mode = 'start';
  wind = new THREE.Vector3();
  time = 0;
  acc = 0;
  last = performance.now();
  caches: Cache[] = [];
  cacheTimer = 10;
  loadTimer = 0;
  serviced = false;
  recoverHold = 0;
  saveTimer = 0;
  hudTimer = 0;
  crashShown = false;
  crashHandled = false;
  crashCause = '';
  lastFuelAlarm = 0;
  beacon: THREE.Mesh;
  predPts: THREE.Vector3[] = [];
  zonePulse = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // --- save / language
    const save = loadSave(detectLang());
    setLang(save.settings.lang);
    this.progress = new Progress(save, {
      toast, banner, t, money,
      sfx: (n) => this.sfx.play(n),
      onBaseLevel: (l) => this.siteBuilder?.setBaseLevel(l),
    });

    // --- world
    const raw = createRawHeight(SEED);
    this.sites = planSites(raw, SEED);
    this.terrain = new Terrain(raw, this.sites);
    this.scene.add(this.terrain.buildMesh(), this.terrain.water);
    this.terrain.addColliders(this.physics);
    this.terrain.buildMapCanvas(512);
    this.sky = new Sky(this.scene);
    const props = new Props(this.scene, this.physics);
    this.siteBuilder = new SiteBuilder(props, this.sites);
    this.siteBuilder.setBaseLevel(this.progress.baseLevel);
    buildTrees(this.scene, this.physics, this.terrain, this.sites);

    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 400, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.scene.add(this.beacon);

    // --- systems
    this.particles = new Particles(this.scene);
    this.crates = new CrateManager(this.scene, this.physics, (x, z) => this.terrain.groundAt(x, z));
    this.predictor = new DropPredictor(this.scene);
    this.contracts = new Contracts(this.sites);
    this.aa = new AASystem(this.scene, this.terrain, this.sites, this.particles, this.sfx, props);
    this.aa.setThreat(this.s.stats.delivered, this.progress.regionsUnlocked);
    this.aa.onHit = () => { this.s.stats.missileHits++; this.rig.addShake(2); toast(t('toast_missile_hit'), 'bad', 2); };
    this.aa.onEvade = () => { this.s.stats.missilesEvaded++; this.progress.checkAchievements(); };
    this.troops = new Troops(this.scene, (x, z) => this.terrain.groundAt(x, z));
    this.input = new Input(canvas, () => this.progress.s.settings);
    this.rig = new CameraRig(this.camera);
    this.rig.mode = this.progress.s.settings.camera;
    this.slots = new Slots(this.progress, this.sfx);
    this.menu = new Menu(this.progress, this.contracts, this.slots, this.input.gamepad, this.sfx, {
      accept: (i) => this.acceptContract(i),
      abandon: () => this.abandonContract(),
      reroll: () => this.rerollOffers(),
      selectHeli: (id) => this.selectHeli(id),
      paintChanged: () => this.rebuildHeli(),
      close: () => this.closeMenu(),
      settingsChanged: () => this.applySettings(),
      prestige: () => this.doPrestige(),
      reset: () => { wipeSave(); location.reload(); },
    });

    this.spawnHeli();
    this.hud = new Hud(this.terrain.mapCanvas);
    onLangChange(() => { this.hud.build(); });
    this.wirePhysicsEvents();
    this.wireCrateEvents();
    this.rerollOffers();
    this.applySettings();

    canvas.addEventListener('click', () => {
      this.sfx.unlock();
      if (this.mode === 'fly') this.input.lock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.mode === 'fly' && this.input.mouseActive) {
        // Esc released the mouse: pause like a normal game
        this.openMenu('contracts', this.atFobPad());
      }
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => this.progress.save());
    this.resize();
    this.showStart();
    requestAnimationFrame((t) => this.frame(t));
  }

  get s() { return this.progress.s; }
  lastFm: string = '';
  get up() { return this.progress.up; }
  fob(): Site { return this.sites.find((s) => s.type === 'fob')!; }
  site(id: string) { return this.sites.find((s) => s.id === id)!; }

  // ------------------------------------------------------------------ setup
  spawnHeli() {
    const def = HELIS[this.s.heli as HeliId] ?? HELIS.scout;
    const paint = PAINTS.find((p) => p.id === this.s.paint) ?? PAINTS[0];
    const f = this.fob();
    const pos = new THREE.Vector3(f.x, f.y - def.skidY + 0.12, f.z);
    this.heli = new Heli(def, paint, this.physics, this.scene, pos, -f.facing + Math.PI / 2, this.up);
    this.rig.snap();
  }

  rebuildHeli() {
    const hadContract = this.contracts.active;
    const slung = this.crates.slung();
    if (slung) this.crates.releaseSlung(false, this.up);
    this.heli.dispose(this.scene);
    this.spawnHeli();
    if (hadContract) hadContract.internal = 0;
  }

  selectHeli(id: HeliId) {
    if (!this.s.helis.includes(id)) return;
    this.s.heli = id;
    this.rebuildHeli();
    this.progress.save();
  }

  /** When entering realistic mode, start the lever at hover (airborne) or at the bottom (landed). */
  syncLever() {
    this.lastFm = this.s.settings.flightModel;
    this.input.lever = this.heli.agl < 1.5 ? 0 : this.heli.hoverLever(this.up);
  }

  applySettings() {
    const st = this.s.settings;
    this.sfx.setVolume(st.volume);
    this.renderer.shadowMap.enabled = st.shadows;
    this.sky.sun.castShadow = st.shadows;
    if (this.s.settings.flightModel !== this.lastFm) this.syncLever();
    this.progress.refreshUp();
    this.heli.applyUpgrades(this.up);
  }

  wirePhysicsEvents() {
    this.physics.forceListeners.push((self, other, force) => {
      if (self.kind === 'heli' && self.ref === this.heli) this.heli.onContact(self, other, force, this.up);
      else if (self.kind === 'crate') this.crates.onContact(self, other, force, this.up);
    });
    this.physics.collisionListeners.push((h1, h2, started) => {
      const t1 = this.physics.tags.get(h1), t2 = this.physics.tags.get(h2);
      const own = (t: typeof t1) => !!t && (t.kind === 'rotor' || t.kind === 'tailrotor') && t.ref === this.heli;
      if (own(t1)) this.heli.onSensor(h1, h2, started, t2);
      else if (own(t2)) this.heli.onSensor(h2, h1, started, t1);
    });
  }

  wireCrateEvents() {
    this.crates.onSettled = (c) => this.crateSettled(c);
    this.crates.onBroken = (c) => {
      const p = c.body.translation();
      this.particles.emit('splinter', new THREE.Vector3(p.x, p.y, p.z), 40, undefined, 2);
      this.particles.emit('dust', new THREE.Vector3(p.x, p.y, p.z), 25);
      this.sfx.play('crunch');
      toast(t('toast_broken'), 'bad');
      this.crateResolved(c, false);
    };
    this.crates.onLost = (c) => { toast(t('toast_lost'), 'bad'); this.crateResolved(c, false); };
    this.crates.onChute = () => { this.sfx.play('chute'); toast(t('toast_chute'), 'info', 1.5); };
    this.crates.onImpact = (c, dv) => {
      if (dv > 4) {
        const p = c.body.translation();
        this.particles.emit('dust', new THREE.Vector3(p.x, p.y - c.size / 2, p.z), 8);
        this.sfx.play('thud');
      }
    };
  }

  // ------------------------------------------------------------------ contracts
  get seats() { return this.progress.capacity * SEATS_PER_BAY; }
  get troopsActive() { return this.contracts.active?.kind === 'troops'; }

  rerollOffers() { this.contracts.generate(this.s.level, this.progress.capacity, this.up.payoutMul * medalMul(this.s.medals), this.seats); }

  /** Soldiers wait beside the pickup pad until the helicopter lands there. */
  troopSpot(pick: Site) {
    const d = pick.padR + 5;
    return { x: pick.x + Math.cos(pick.facing + Math.PI) * d, z: pick.z + Math.sin(pick.facing + Math.PI) * d };
  }

  acceptContract(i: number) {
    if (this.contracts.active) return;
    const a = this.contracts.accept(i);
    const pick = this.site(a.pickup);
    if (a.kind === 'troops') {
      const sp = this.troopSpot(pick);
      this.troops.setWaiting(Math.min(a.staged, 8), sp.x, sp.z, pick.facing);
    } else this.crates.stage(pick.yardX, pick.y, pick.yardZ, a.crates, a.weight, a.id);
    toast(t('toast_contract_new', { name: this.site(a.dest).name }), 'good');
    this.sfx.play('buy');
    if (this.contracts.offers.length === 0) this.rerollOffers();
  }

  abandonContract() {
    const a = this.contracts.active;
    if (!a) return;
    const sl = this.crates.slung();
    if (sl && sl.contractId === a.id) this.crates.releaseSlung(false, this.up);
    this.crates.removeContract(a.id);
    this.troops.clear();
    this.contracts.active = null;
    this.rerollOffers();
  }

  crateResolved(c: Crate, delivered: boolean) {
    const a = this.contracts.active;
    if (!delivered) this.progress.recordDelivery(false);
    if (!a || c.contractId !== a.id) return;
    a.resolved++;
    this.checkContractDone();
  }

  /** Count crates that are lost with the helicopter (bay contents). */
  loseBayCargo() {
    const a = this.contracts.active;
    if (!a || a.internal <= 0) return;
    const n = a.internal;
    a.internal = 0;
    a.resolved += n;
    for (let i = 0; i < n; i++) this.progress.recordDelivery(false);
    this.checkContractDone();
  }

  checkContractDone() {
    const a = this.contracts.active;
    if (!a || a.resolved < a.crates) return;
    if (a.delivered > 0) {
      const bonus = Math.round(a.earned * 0.1);
      this.progress.addCash(bonus);
      this.s.stats.contracts++;
      banner(t('toast_contract_done', { cash: money(a.earned + bonus) }), `${a.delivered}/${a.crates} 📦`);
      this.sfx.play('levelup');
    } else toast(t('toast_contract_failed'), 'bad');
    if (a.kind === 'troops') this.troops.setWaiting(0);
    this.contracts.active = null;
    this.rerollOffers();
    this.progress.save();
  }

  deliver(c: { weight: number; integrity: number; usedChute: boolean; releaseHoriz: number; contractId: number }, zoneDist: number, landed: boolean, at: THREE.Vector3) {
    const a = this.contracts.active;
    if (!a || c.contractId !== a.id) return;
    const dest = this.site(a.dest);
    const hot = !landed && !c.usedChute && c.releaseHoriz > 20;
    const lucky = Math.random() < 0.05;
    const r = scoreDelivery({
      dist: a.dist, weight: a.weight, region: a.region, integrity: c.integrity, zoneDist, zoneR: dest.padR, landed,
      hot, chute: c.usedChute && !landed, inTime: this.contracts.inTime, streak: this.s.streak,
      payoutMul: this.up.payoutMul, medals: this.s.medals, lucky, troops: a.kind === 'troops',
    });
    if (a.kind === 'troops') this.s.stats.soldiers++;
    a.delivered++;
    a.resolved++;
    a.earned += r.total;
    this.progress.recordDelivery(true, { bullseye: r.bullseye, hot, chute: c.usedChute && !landed });
    this.progress.addCash(r.total);
    this.progress.addXp(r.xp);
    payCard(r.bullseye ? t('toast_bullseye') : r.near ? t('toast_near') : t('toast_delivered', { cash: money(r.total) }), r.lines, r.total);
    floatCash(r.total);
    toast(t('toast_xp', { xp: r.xp }), 'good', 2);
    if (hot) toast(t('toast_hotdrop'), 'gold');
    if (lucky) { toast(t('toast_lucky'), 'gold'); confetti(80); }
    this.particles.emit('confetti', at.clone().add(new THREE.Vector3(0, 1, 0)), r.bullseye ? 120 : 50);
    this.sfx.play('coin');
    if (r.bullseye) this.sfx.play('achievement');
    this.updateThreat();
    this.checkContractDone();
    this.progress.save();
  }

  /** More deliveries = more (and sharper) enemy air defence. */
  updateThreat() {
    const before = this.aa.activeSites.length;
    this.aa.setThreat(this.s.stats.delivered, this.progress.regionsUnlocked);
    if (this.aa.activeSites.length > before) toast(t('toast_aa_new'), 'bad', 3);
  }

  crateSettled(c: Crate) {
    const a = this.contracts.active;
    const p = c.body.translation();
    if (!a || c.contractId !== a.id) { this.crates.remove(c); return; }
    const dest = this.site(a.dest);
    const d = Math.hypot(p.x - dest.x, p.z - dest.z);
    if (d <= dest.padR * 2) {
      this.crates.remove(c);
      this.deliver(c, d, false, new THREE.Vector3(p.x, p.y, p.z));
    } else {
      c.state = 'loose';
      c.looseT = 0;
      toast(t('toast_missed'), 'info');
    }
  }

  // ------------------------------------------------------------------ menus / modes
  atFobPad(): boolean {
    const f = this.fob();
    return this.heli.landed && Math.hypot(this.heli.pos.x - f.x, this.heli.pos.z - f.z) < f.padR + 4;
  }

  openMenu(tab: Tab, atBase: boolean) {
    this.mode = 'menu';
    this.input.unlock();
    this.menu.show(tab, atBase);
  }

  closeMenu() {
    this.menu.hide();
    this.mode = 'fly';
    this.progress.save();
    this.input.lock();
  }

  showStart() {
    const o = document.getElementById('overlay')!;
    const m = document.createElement('div');
    m.className = 'modal start-modal';
    const first = this.s.stats.delivered === 0;
    m.innerHTML = `<div class="start">
      <h1>${t('title')}</h1>
      <p>${t('subtitle')}</p>
      <p style="font-size:13px">${t('start_hint')}</p>
      <div class="keys" style="text-align:left;margin:14px 0">${['k_collective', 'k_yaw', 'k_cyclic', 'k_hook', 'k_drop', 'k_chute', 'k_flare', 'k_cam', 'k_base', 'k_map', 'k_rec'].map((k) => `<div>${t(k)}</div>`).join('')}</div>
      <div><button class="btn small" data-l="en">English</button> <button class="btn small" data-l="es">Español</button></div>
      <button class="btn" id="tut-btn">📖 ${t('tut_howto')}</button>
      <button class="btn primary" id="start-btn">${first ? t('start') : t('continue')}</button>
    </div>`;
    o.appendChild(m);
    m.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) => b.addEventListener('click', () => {
      this.s.settings.lang = b.dataset.l as 'en' | 'es'; setLang(this.s.settings.lang); this.progress.save(); m.remove(); this.showStart();
    }));
    m.querySelector('#tut-btn')!.addEventListener('click', () => {
      this.sfx.unlock();
      m.style.display = 'none';
      showTutorial(() => { this.s.tutorialSeen = true; this.progress.save(); m.style.display = ''; });
    });
    const begin = () => {
      this.progress.welcome();
      if (!this.contracts.active) this.openMenu('contracts', true);
      else { this.mode = 'fly'; this.input.lock(); }
    };
    m.querySelector('#start-btn')!.addEventListener('click', () => {
      m.remove();
      this.sfx.unlock();
      // first flight: walk through the controls and mechanics before taking off
      if (!this.s.tutorialSeen) showTutorial(() => { this.s.tutorialSeen = true; this.progress.save(); begin(); });
      else begin();
    });
  }

  showCrash() {
    this.crashShown = true;
    this.mode = 'crash';
    this.input.unlock();
    const fee = Math.min(this.s.cash, Math.round((80 + this.s.level * 30) * 0.5));
    const o = document.getElementById('overlay')!;
    const m = document.createElement('div');
    m.className = 'modal crash-modal';
    m.innerHTML = `<div class="start crash">
      <h1>${t('cr_title')}</h1>
      <p style="font-size:18px;color:var(--text)">${this.crashCause}</p>
      <div class="kv" style="max-width:360px;margin:10px auto"><span>${t('cr_repair')}</span><span style="color:var(--bad)">-${money(fee)}</span></div>
      <p>${t('cr_tip_' + Math.floor(Math.random() * 4))}</p>
      <button class="btn primary" id="cr-btn">${t('cr_respawn')}</button>
    </div>`;
    o.appendChild(m);
    m.querySelector('#cr-btn')!.addEventListener('click', () => {
      m.remove();
      this.progress.spend(fee);
      this.respawnAtFob();
      this.mode = 'fly';
      this.input.lock();
    });
  }

  respawnAtFob() {
    const f = this.fob();
    const sl = this.crates.slung();
    if (sl) this.crates.releaseSlung(false, this.up);
    this.loseBayCargo();
    this.heli.respawn(new THREE.Vector3(f.x, f.y - this.heli.def.skidY + 0.12, f.z), -f.facing + Math.PI / 2, this.up);
    this.input.lever = 0;
    this.aa.clearFlight();
    this.crashShown = false;
    this.crashHandled = false;
    this.serviced = true;
    this.rig.snap();
  }

  toggleMap() {
    const o = document.getElementById('overlay')!;
    const ex = o.querySelector('.map-modal');
    if (ex) { ex.remove(); this.mode = 'fly'; this.input.lock(); return; }
    this.mode = 'map';
    this.input.unlock();
    const m = document.createElement('div');
    m.className = 'modal map-modal';
    m.innerHTML = `<div class="mapwrap"><canvas width="900" height="900"></canvas><span class="close">${t('map_close')}</span></div>`;
    o.appendChild(m);
    m.addEventListener('click', () => this.toggleMap());
    this.drawMap(m.querySelector('canvas')!);
  }

  drawMap(cv: HTMLCanvasElement) {
    const g = cv.getContext('2d')!, S = cv.width;
    g.drawImage(this.terrain.mapCanvas, 0, 0, S, S);
    const W = 5000, toS = (x: number, z: number): [number, number] => [(x + W / 2) / W * S, (z + W / 2) / W * S];
    // locked regions shading
    for (let r = 3; r >= 0; r--) {
      if (this.s.level >= REGION_LEVELS[r]) continue;
      const [cx, cy] = toS(0, 0);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.arc(cx, cy, (REGION_RADII[r][1] + 60) / W * S, 0, Math.PI * 2);
      g.arc(cx, cy, (REGION_RADII[r][0] - 60) / W * S, 0, Math.PI * 2, true); g.fill();
    }
    const a = this.contracts.active;
    g.font = 'bold 13px system-ui'; g.textAlign = 'center';
    for (const s of this.sites) {
      const [x, y] = toS(s.x, s.z);
      const locked = this.s.level < REGION_LEVELS[s.region];
      g.fillStyle = locked ? '#777' : s.type === 'fob' ? '#4fa3ff' : s.type === 'depot' ? '#6be07f' : '#ff8a1f';
      g.beginPath(); g.arc(x, y, s.type === 'fob' ? 9 : 6, 0, Math.PI * 2); g.fill();
      if (a && (a.dest === s.id || a.pickup === s.id)) { g.strokeStyle = '#ffd25a'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
      const label = s.name + (locked ? ` (${t('map_locked', { n: REGION_LEVELS[s.region] })})` : '');
      g.strokeText(label, x, y - 12); g.fillText(label, x, y - 12);
    }
    if (a) {
      const [x1, y1] = toS(this.site(a.pickup).x, this.site(a.pickup).z), [x2, y2] = toS(this.site(a.dest).x, this.site(a.dest).z);
      g.setLineDash([8, 6]); g.strokeStyle = '#ffd25a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
    }
    // known enemy SAM sites with their engagement range
    for (const sam of this.aa.activeSites) {
      const [x, y] = toS(sam.x, sam.z);
      g.strokeStyle = 'rgba(255,60,40,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, (sam.stats.range / W) * S, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ff3c28';
      g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 6, y + 5); g.lineTo(x - 6, y + 5); g.closePath(); g.fill();
    }
    const [hx, hy] = toS(this.heli.pos.x, this.heli.pos.z);
    g.save(); g.translate(hx, hy); g.rotate(-this.heli.heading);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#b9f5a8'; g.font = 'bold 20px monospace'; g.textAlign = 'left'; g.fillText(t('map_title'), 14, 28);
  }

  doPrestige() {
    this.abandonContract();
    this.progress.prestige();
    this.siteBuilder.setBaseLevel(this.progress.baseLevel);
    this.rebuildHeli();
    this.aa.clearFlight();
    this.aa.setThreat(this.s.stats.delivered, this.progress.regionsUnlocked);
    this.rerollOffers();
    this.applySettings();
  }

  // ------------------------------------------------------------------ loop
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setScale(h);
  }

  frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    try { this.tick(now); } catch (e) { console.error(e); }
  }

  tick(now: number) {
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.input.update(dt);
    this.handleActions(dt);

    if (this.mode === 'fly' || this.mode === 'crash') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 5) { this.fixedStep(); this.acc -= FIXED_DT; steps++; }
      if (steps === 5) this.acc = 0;
      this.progress.tick(dt);
      this.updateGameplay(dt);
    }
    this.renderFrame(dt);
  }

  updateWind() {
    const reg = regionAt(this.heli.pos.x, this.heli.pos.z);
    const mag = REGION_WIND[reg] * (0.75 + 0.25 * Math.sin(this.time * 0.37) + 0.1 * Math.sin(this.time * 1.7));
    const ang = this.time * 0.01 + 1.2;
    this.wind.set(Math.cos(ang) * mag, 0, Math.sin(ang) * mag);
  }

  fixedStep() {
    const a = this.contracts.active;
    const internalMass = a ? a.internal * CRATE_MASS[a.weight] : 0;
    const sl = this.crates.slung();
    let slungAir = 0;
    if (sl) {
      const p = sl.body.translation();
      // only count the sling load while it's actually hanging (not resting on the ground)
      if (p.y - this.terrain.groundAt(p.x, p.z) - sl.size / 2 > 0.25) slungAir = sl.mass;
    }
    const loadMass = internalMass + slungAir;
    this.updateWind();
    this.heli.preStep(FIXED_DT, this.mode === 'fly' ? this.input.ctl : { collective: -1, pitch: 0, roll: 0, yaw: 0, cyclicActive: false, collectiveActive: false, lever: 0 }, {
      wind: this.wind, groundAt: (x, z) => this.terrain.groundAt(x, z), extraMass: internalMass, loadMass, up: this.up, realistic: this.s.settings.flightModel === 'realistic',
    });
    // soft boundary
    const p = this.heli.pos;
    if (Math.abs(p.x) > BOUNDARY || Math.abs(p.z) > BOUNDARY) {
      const m = this.heli.def.mass * 4;
      this.heli.body.addForce({ x: -Math.sign(p.x) * (Math.abs(p.x) > BOUNDARY ? m : 0), y: 0, z: -Math.sign(p.z) * (Math.abs(p.z) > BOUNDARY ? m : 0) }, true);
    }
    this.crates.preStep(FIXED_DT, this.wind, this.up);
    this.heli.savePrev();
    this.physics.step();
    this.heli.postStep(FIXED_DT);
    this.crates.postStep(FIXED_DT);
  }

  handleActions(dt: number) {
    const pr = this.input.pressed;
    if (this.mode === 'map') { if (pr.has('map') || pr.has('pause')) this.toggleMap(); return; }
    if (this.mode === 'menu') { if (pr.has('pause') && this.menu.open && !this.input.gamepad.capture) this.closeMenu(); return; }
    if (this.mode !== 'fly') return;
    if (pr.has('pause')) { this.openMenu('contracts', this.atFobPad()); return; }
    if (pr.has('base') && this.atFobPad()) { this.openMenu(this.contracts.active ? 'hangar' : 'contracts', true); return; }
    if (pr.has('map')) { this.toggleMap(); return; }
    if (pr.has('camera')) { this.rig.toggle(); this.s.settings.camera = this.rig.mode; }
    if (pr.has('flightmode')) {
      const st = this.s.settings;
      st.flightModel = st.flightModel === 'realistic' ? 'assist' : 'realistic';
      this.syncLever();
      this.sfx.play('click');
      toast(t(st.flightModel === 'realistic' ? 'fm_real_on' : 'fm_assist_on'), 'info', 2.5);
      this.progress.save();
    }
    if (pr.has('chute')) {
      if (this.up.chute <= 0) toast(t('toast_no_chute'), 'info', 2);
      else { this.s.settings.chuteArmed = !this.s.settings.chuteArmed; this.sfx.play('click'); }
    }
    if (this.heli.crashed) return;
    if (pr.has('flare')) {
      if (this.s.flares <= 0) { toast(t('toast_no_flares'), 'bad', 2); this.sfx.play('error'); }
      else if (this.aa.releaseFlares(this.heli, this.up.flareEff)) { this.s.flares--; this.progress.changed(); }
    }
    const troops = this.troopsActive;
    if (pr.has('hook')) {
      if (troops) toast(t('toast_troops_no_sling'), 'info', 2);
      else if (this.crates.slung()) { /* already carrying */ }
      else {
        const c = this.crates.findHookable(this.heli, this.up);
        if (c) { this.crates.hook(c, this.heli); this.sfx.play('hook'); toast(t('toast_hooked'), 'good', 1.5); }
        else toast(t('toast_cant_hook'), 'info', 1.5);
      }
    }
    if (pr.has('drop')) {
      const armed = this.s.settings.chuteArmed;
      const a = this.contracts.active;
      if (this.crates.slung()) { this.crates.releaseSlung(armed, this.up); this.sfx.play('release'); }
      else if (troops) { if (a && a.internal > 0) toast(t('toast_land_troops'), 'info', 2.5); }
      else if (a && a.internal > 0) {
        a.internal--;
        this.crates.dropInternal(this.heli, a.weight, a.id, armed, this.up);
        this.sfx.play('release');
      }
    }
    // hold-to-recover
    if (this.input.held.has('recover')) {
      this.recoverHold += dt;
      if (this.recoverHold > 1.5) {
        this.recoverHold = 0;
        const fee = Math.min(this.s.cash, 50 + this.s.level * 15);
        this.progress.spend(fee);
        toast(t('rec_desc', { cash: money(fee) }), 'info');
        this.respawnAtFob();
      }
    } else this.recoverHold = 0;
  }

  updateGameplay(dt: number) {
    const h = this.heli;
    const a = this.contracts.active;
    if (a) a.elapsed += dt;
    this.aa.update(dt, h);

    // crash handling
    if (h.crashed && !this.crashHandled) {
      this.crashHandled = true;
      this.particles.explosion(h.pos);
      this.sfx.play('crash');
      this.rig.addShake(2);
      this.s.stats.crashes++;
      this.progress.breakStreak();
      this.progress.checkAchievements();
      this.crashCause = h.hits.some((x) => x.kind === 'water') ? t('cr_cause_water') : h.lastHitBy === 'missile' ? t('cr_cause_missile')
        : h.hp.rotor <= 0 ? t('cr_cause_rotor') : t('cr_cause_hull');
      const sl = this.crates.slung();
      if (sl) this.crates.releaseSlung(false, this.up);
      this.loseBayCargo();
    }
    if (h.crashed && h.crashTimer > 2.8 && !this.crashShown) this.showCrash();

    // hits -> fx
    for (const hit of h.hits) {
      if (hit.kind === 'impact') {
        this.particles.emit('spark', hit.pos, Math.min(40, 5 + hit.amount * 2));
        this.particles.emit('dust', hit.pos, 10);
        this.rig.addShake(Math.min(1.2, hit.amount * 0.05));
        if (this.time - h.lastImpactSfx > 0.15) { this.sfx.play('thud'); h.lastImpactSfx = this.time; }
      } else if (hit.kind === 'rotor' || hit.kind === 'tail') {
        this.particles.emit('spark', hit.pos, 60, undefined, 2);
        this.particles.emit('splinter', hit.pos, 20);
        this.rig.addShake(1.2);
        this.sfx.play('crunch');
      } else if (hit.kind === 'water') {
        this.particles.emit('smoke', hit.pos, 60, new THREE.Vector3(0, 4, 0), 3);
      }
    }
    h.hits.length = 0;

    if (h.crashed) return;

    // landing services
    const f = this.fob();
    if (h.landed) {
      const atFob = Math.hypot(h.pos.x - f.x, h.pos.z - f.z) < f.padR + 4;
      const depot = this.sites.find((s) => s.type === 'depot' && Math.hypot(h.pos.x - s.x, h.pos.z - s.z) < s.padR + 4);
      if ((atFob || depot) && !this.serviced) {
        this.serviced = true;
        if (h.fuel < h.fuelMax - 0.5) { h.fuel = h.fuelMax; toast(t('toast_refuel'), 'good', 1.5); }
        if (atFob) {
          const pts = h.repairCostPoints();
          if (pts > 0.5) {
            const cost = Math.min(this.s.cash, Math.round(pts * 1.5));
            this.progress.spend(cost);
            h.repairAll();
            toast(t('toast_repair', { cash: money(cost) }), 'info');
          }
        }
      }
    } else if (h.agl > 3) this.serviced = false;

    // load / unload through the bay
    this.loadTimer = Math.max(0, this.loadTimer - dt);
    if (a && a.kind === 'troops') {
      // soldiers only board and leave with the helicopter parked on the pad
      if (h.landed && this.loadTimer <= 0) {
        const pick = this.site(a.pickup), dest = this.site(a.dest);
        const atPick = Math.hypot(h.pos.x - pick.x, h.pos.z - pick.z) < pick.padR + 4;
        const destD = Math.hypot(h.pos.x - dest.x, h.pos.z - dest.z);
        if (atPick && a.staged > 0 && a.internal < this.seats) {
          a.staged--;
          a.internal++;
          this.troops.board(h.pos.x, h.pos.z);
          this.loadTimer = 0.5;
          this.sfx.play('hook');
          toast(t('toast_boarded', { n: a.internal, max: this.seats }), 'good', 1.2);
        } else if (destD < dest.padR && a.internal > 0) {
          a.internal--;
          this.loadTimer = 0.5;
          this.troops.disembark(h.pos.x, h.pos.z, dest.x + Math.cos(dest.facing) * 30, dest.z + Math.sin(dest.facing) * 30);
          this.deliver({ weight: 0, integrity: 1, usedChute: false, releaseHoriz: 0, contractId: a.id }, destD, true, h.pos.clone());
        }
      }
    } else if (a && h.landed && this.loadTimer <= 0) {
      const pick = this.site(a.pickup), dest = this.site(a.dest);
      const nearPick = Math.hypot(h.pos.x - pick.yardX, h.pos.z - pick.yardZ) < 16 || Math.hypot(h.pos.x - pick.x, h.pos.z - pick.z) < pick.padR + 4;
      const destD = Math.hypot(h.pos.x - dest.x, h.pos.z - dest.z);
      if (nearPick && a.internal < this.progress.capacity) {
        const staged = this.crates.crates.filter((c) => c.contractId === a.id && c.state === 'staged');
        if (staged.length) {
          staged.sort((x, y) => x.body.translation().x - y.body.translation().x);
          this.crates.remove(staged[0]);
          a.internal++;
          this.loadTimer = 0.8;
          this.sfx.play('hook');
          toast(t('toast_loaded', { n: a.internal, max: this.progress.capacity }), 'good', 1.5);
        }
      } else if (destD < dest.padR && a.internal > 0) {
        a.internal--;
        this.loadTimer = 0.8;
        this.deliver({ weight: a.weight, integrity: 1, usedChute: false, releaseHoriz: 0, contractId: a.id }, destD, true, h.pos.clone());
      }
    }

    // bonus caches
    this.updateCaches(dt);

    // periodic save
    this.saveTimer += dt;
    if (this.saveTimer > 15) { this.saveTimer = 0; this.progress.save(); }
  }

  updateCaches(dt: number) {
    this.cacheTimer -= dt;
    const regions = this.progress.regionsUnlocked;
    if (this.cacheTimer <= 0 && this.caches.length < 3) {
      this.cacheTimer = 40 + Math.random() * 40;
      const maxR = REGION_RADII[Math.max(0, regions - 1)][1];
      for (let tries = 0; tries < 30; tries++) {
        const ang = Math.random() * Math.PI * 2, r = 200 + Math.random() * (maxR - 200);
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const y = this.terrain.heightAt(x, z);
        if (y < WATER_LEVEL + 2 || this.terrain.slopeAt(x, z) > 0.5) continue;
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xffd25a, emissive: 0x8a6a12, emissiveIntensity: 0.8, flatShading: true }));
        box.position.y = 1.2;
        box.castShadow = true;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 120, 8, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.y = 60;
        g.add(box, beam);
        g.position.set(x, y, z);
        this.scene.add(g);
        this.caches.push({ x, y, z, group: g });
        break;
      }
    }
    for (const c of this.caches) {
      c.group.children[0].rotation.y += dt * 1.5;
      c.group.children[0].position.y = 1.2 + Math.sin(this.time * 2) * 0.3;
      const d = Math.hypot(this.heli.pos.x - c.x, this.heli.pos.y - c.y, this.heli.pos.z - c.z);
      if (d < 16) {
        const amt = Math.round(60 * (1 + this.s.level * 0.4) * medalMul(this.s.medals));
        this.progress.addCash(amt);
        this.progress.addXp(10 + this.s.level * 2);
        this.s.stats.caches++;
        this.progress.checkAchievements();
        toast(t('toast_cache', { cash: money(amt) }), 'gold');
        floatCash(amt);
        this.sfx.play('coin');
        this.particles.emit('confetti', new THREE.Vector3(c.x, c.y + 2, c.z), 60);
        this.scene.remove(c.group);
        c.x = NaN;
      }
    }
    this.caches = this.caches.filter((c) => !Number.isNaN(c.x));
  }

  target(): { pos: THREE.Vector3; label: string; id: string; kind: 'pickup' | 'drop' | 'fob' } {
    const a = this.contracts.active;
    if (a) {
      const sl = this.crates.slung();
      const carrying = a.internal > 0 || (sl && sl.contractId === a.id);
      const staged = a.kind === 'troops' ? a.staged > 0 : this.crates.crates.some((c) => c.contractId === a.id && c.state === 'staged');
      if (!carrying && staged) {
        const p = this.site(a.pickup);
        if (a.kind === 'troops') return { pos: new THREE.Vector3(p.x, p.y, p.z), label: p.name, id: p.id, kind: 'pickup' };
        return { pos: new THREE.Vector3(p.yardX, p.y, p.yardZ), label: p.name, id: p.id, kind: 'pickup' };
      }
      const d = this.site(a.dest);
      return { pos: new THREE.Vector3(d.x, d.y, d.z), label: d.name, id: d.id, kind: 'drop' };
    }
    const f = this.fob();
    return { pos: new THREE.Vector3(f.x, f.y, f.z), label: f.name, id: f.id, kind: 'fob' };
  }

  renderFrame(dt: number) {
    const h = this.heli;
    const cockpit = this.rig.mode === 'cockpit';
    // physics runs at a fixed 60 Hz; draw between the last two steps so motion is smooth at any frame rate
    const alpha = Math.min(1, this.acc / FIXED_DT);
    h.render(dt, cockpit, alpha);
    this.crates.render(h, alpha);
    const look = this.input.consumeLook();
    this.rig.update(dt, h, look, this.input.rightDown, (x, z) => this.terrain.groundAt(x, z));
    this.sky.follow(h.pos, this.camera.position);
    this.siteBuilder.update(dt);
    this.aa.render(dt, h, this.time);
    this.troops.update(dt);

    // FX: damage smoke, fire, rotor wash
    const eng = h.worldPoint(h.model.enginePoint);
    if (h.hp.engine < 0.6 && Math.random() < (0.6 - h.hp.engine) * 3) this.particles.emit(h.hp.engine < 0.3 ? 'darksmoke' : 'smoke', eng, 1, h.vel.clone().multiplyScalar(0.3));
    if (h.hp.engine < 0.15 || h.crashed) { this.particles.emit('fire', eng, 1, h.vel.clone().multiplyScalar(0.3)); if (Math.random() < 0.5) this.particles.emit('darksmoke', eng, 1); }
    if (h.hp.tail < 0.4 && Math.random() < 0.3) this.particles.emit('smoke', h.worldPoint(h.model.tailPoint), 1);
    if (h.rpm > 0.4 && h.agl < h.def.rotorR * 2.2 && !h.crashed) {
      const g = this.terrain.groundAt(h.pos.x, h.pos.z);
      const k = (1 - h.agl / (h.def.rotorR * 2.2)) * h.rpm * h.thrustFrac;
      if (Math.random() < k * 2) this.particles.emit('dust', new THREE.Vector3(h.pos.x, g + 0.3, h.pos.z), 2, undefined, h.def.rotorR);
    }
    this.particles.update(dt);

    // target beacon + zone pulse
    const tg = this.target();
    this.beacon.position.set(tg.pos.x, tg.pos.y + 200, tg.pos.z);
    (this.beacon.material as THREE.MeshBasicMaterial).color.setHex(tg.kind === 'pickup' ? 0x6be07f : tg.kind === 'drop' ? 0xff8a1f : 0x4fa3ff);
    this.zonePulse += dt;
    for (const v of this.siteBuilder.visuals.values()) {
      if (!v.zone) continue;
      const on = v.site.id === tg.id;
      v.zone.scale.setScalar(on ? 1 + Math.sin(this.zonePulse * 4) * 0.03 : 1);
    }

    // drop prediction
    let predHud: HudData['predict'] = null;
    const a = this.contracts.active;
    const sl = this.crates.slung();
    const carrying = !!sl || (!!a && a.internal > 0 && a.kind !== 'troops');
    if (carrying && !h.landed && !h.crashed && h.agl > 1.5 && this.mode === 'fly') {
      let pos: THREE.Vector3, vel: THREE.Vector3;
      if (sl) { const p = sl.body.translation(), v = sl.body.linvel(); pos = new THREE.Vector3(p.x, p.y, p.z); vel = new THREE.Vector3(v.x, v.y, v.z); }
      else { pos = h.worldPoint(h.model.hookPoint).add(new THREE.Vector3(0, -1.2, 0)); vel = h.vel.clone().add(new THREE.Vector3(0, -1, 0)); }
      const pr = predict(pos, vel, this.s.settings.chuteArmed, this.wind, this.up, (x, z) => this.terrain.groundAt(x, z), this.predPts);
      const safe = this.up.crateSafe + (pr.chute ? 2 : 0);
      const v = pr.vertSpeed;
      const col = v > this.up.crateBreak ? 0xff4f3f : v > safe ? 0xffb03a : 0x7dff9a;
      this.predictor.show(pr, this.predPts, col);
      if (this.up.computer >= 2) {
        const key = v > this.up.crateBreak ? 'predict_break' : v > safe ? 'predict_damage' : 'predict_ok';
        predHud = { text: t(key, { v: v.toFixed(1) }), color: '#' + col.toString(16).padStart(6, '0') };
      } else if (v > this.up.crateBreak) predHud = { text: '⚠ ' + t('predict_break', { v: '—' }), color: '#ff4f3f' };
    } else this.predictor.hide();

    this.sfx.engine(h.rpm, h.thrustFrac, this.mode === 'menu' || this.mode === 'start');

    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && this.mode !== 'start') {
      this.hudTimer = 0.066;
      this.updateHud(tg, predHud);
    }
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(tg: ReturnType<Game['target']>, predict: HudData['predict']) {
    const h = this.heli, s = this.s, a = this.contracts.active;
    const warnings: HudData['warnings'] = [];
    const hints: string[] = [];
    if (!h.crashed) {
      if (h.fuel <= 0) warnings.push({ text: t('warn_nofuel') });
      else if (h.fuel / h.fuelMax < 0.2) {
        warnings.push({ text: t('warn_fuel'), amber: true });
        if (this.time - this.lastFuelAlarm > 4) { this.lastFuelAlarm = this.time; this.sfx.play('alarm'); }
      }
      if (h.hp.tail < 0.35) warnings.push({ text: t('warn_tail') });
      if (h.hp.engine < 0.35) warnings.push({ text: t('warn_engine') });
      if (h.hp.rotor < 0.35) warnings.push({ text: t('warn_rotor') });
      if (Math.abs(h.pos.x) > BOUNDARY - 100 || Math.abs(h.pos.z) > BOUNDARY - 100) warnings.push({ text: t('warn_boundary'), amber: true });
      if (h.vs < -8 && h.agl < 25 && h.agl > 2) warnings.push({ text: t('warn_pull_up') });
      // radar warning receiver
      const w = this.aa.warning;
      if (w.inbound > 0 && w.bearing !== null) {
        const d = new THREE.Vector3(Math.sin(w.bearing), 0, Math.cos(w.bearing));
        const f = d.dot(h.forward()), r = d.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(h.quat));
        const dir = Math.abs(f) > Math.abs(r) ? (f > 0 ? 'dir_ahead' : 'dir_behind') : (r > 0 ? 'dir_right' : 'dir_left');
        warnings.push({ text: t('warn_missile', { dir: t(dir) }) });
      } else if (w.locked) warnings.push({ text: t('warn_locked') });
      else if (w.tracking > 0) warnings.push({ text: t('warn_radar', { p: Math.round(w.tracking * 100) }), amber: true });
      if ((w.tracking > 0.3 || w.inbound > 0) && this.s.flares > 0) hints.push(t('hint_flares', { n: this.s.flares }));
      // hints
      if (this.atFobPad()) hints.push(t('hint_base'));
      if (!this.crates.slung()) {
        const hk = this.crates.findHookable(h, this.up);
        if (hk) hints.push(t('hint_hook'));
        else if (a) {
          const near = this.crates.crates.find((c) => c.contractId === a.id && (c.state === 'staged' || c.state === 'loose') &&
            Math.hypot(c.body.translation().x - h.pos.x, c.body.translation().z - h.pos.z) < 40);
          if (near && !h.landed) hints.push(t('hint_crate_here', { r: this.up.hookR.toFixed(0) }));
          if (near && tg.kind === 'pickup' && a.internal < this.progress.capacity) hints.push(t('hint_land_load'));
        }
      }
      if (a && a.kind === 'troops') {
        if (tg.kind === 'pickup' && a.internal < this.seats) hints.push(t('hint_land_board'));
        else if (a.internal > 0 && !h.landed) hints.push(t('hint_land_troops'));
      } else if (this.crates.slung() || (a && a.internal > 0)) hints.push(t('hint_drop'));
      if (h.fuel <= 0 && h.landed) hints.push(t('hint_recover'));
    }

    // waypoint marker
    let marker: HudData['marker'] = null;
    const tp = tg.pos.clone().add(new THREE.Vector3(0, 8, 0));
    const dist = Math.hypot(tp.x - h.pos.x, tp.z - h.pos.z);
    const label = `${tg.label} · ${dist > 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'}`;
    const W = window.innerWidth, H = window.innerHeight;
    const ndc = tp.clone().project(this.camera);
    const local = tp.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (local.z < 0 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.9) {
      marker = { x: (ndc.x + 1) / 2 * W, y: (1 - ndc.y) / 2 * H, on: true, angle: 0, label };
    } else {
      let dx = local.x, dy = -local.y;
      if (Math.hypot(dx, dy) < 1e-3) dy = 1;
      const n = Math.hypot(dx, dy);
      dx /= n; dy /= n;
      const r = Math.min(W, H) / 2 - 70;
      marker = { x: W / 2 + dx * r, y: H / 2 + dy * r, on: false, angle: Math.atan2(dx, -dy), label };
    }

    let title = '', sub = '', timer = '', timerOk = false;
    if (a) {
      title = a.kind === 'troops' ? `👥 ${t('c_soldiers', { n: a.crates })} · ${t('c_must_land')}` : `${t('c_crates', { n: a.crates })} · ${t('c_weight_' + a.weight)}`;
      sub = (tg.kind === 'pickup' ? t('target_pickup', { name: tg.label }) : t('target_drop', { name: tg.label })) + '\n' +
        t('c_progress', { d: a.delivered, r: a.resolved, t: a.crates }) + `\n+${money(a.earned)}`;
      const left = Math.max(0, a.timeLimit - a.elapsed);
      timerOk = left > 0;
      timer = timerOk ? `⏱ ${t('timer_bonus')} ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : t('timer_over');
    } else {
      title = t('target_fob');
      sub = t('no_contract');
    }
    const stick = this.input.locked ? { x: this.input.stick.x, y: this.input.stick.y } : null;
    const data: HudData = {
      cash: s.cash, level: s.level, xp: s.xp, xpNeed: this.progress.xpNeed, medals: s.medals, income: this.progress.income, streak: s.streak,
      speed: h.speed, agl: h.agl, vs: h.vs, heading: (-h.heading * 180) / Math.PI, fuel: clamp(h.fuel / h.fuelMax, 0, 1), collective: s.settings.flightModel === 'realistic' ? this.input.lever * 2 : h.thrustFrac,
      stick, hp: h.hp, sling: !!this.crates.slung(), bay: a?.internal ?? 0, cap: this.troopsActive ? this.seats : this.progress.capacity,
      troops: this.troopsActive, flares: s.flares, flareCap: this.up.flareCap,
      flightModel: s.settings.flightModel,
      chute: this.up.chute <= 0 ? 'locked' : s.settings.chuteArmed ? 'armed' : 'off',
      contractTitle: title, contractSub: sub, contractTimer: timer, timerOk,
      warnings, hints, predict, marker: this.mode === 'fly' ? marker : null,
      recover: this.recoverHold / 1.5, locked: this.input.locked || this.mode !== 'fly', cockpit: this.rig.mode === 'cockpit', wind: this.wind.length(),
    };
    this.hud.update(data);
    const cratesMini = this.crates.crates.filter((c) => c.state !== 'gone').map((c) => { const p = c.body.translation(); return { x: p.x, z: p.z, mine: !!a && c.contractId === a.id }; });
    this.hud.drawMinimap({
      x: h.pos.x, z: h.pos.z, heading: h.heading, sites: this.sites, targetId: tg.id, level: s.level,
      caches: this.up.radar > 0 ? this.caches.filter((c) => Math.hypot(c.x - h.pos.x, c.z - h.pos.z) < 600 + this.up.radar * 600) : [],
      crates: cratesMini,
      sams: this.aa.activeSites
        .filter((x) => x.state === 'tracking' || x.salvoLeft > 0 || Math.hypot(x.x - h.pos.x, x.z - h.pos.z) < 300 + this.up.radar * 400)
        .map((x) => ({ x: x.x, z: x.z, hot: x.state === 'tracking' || x.salvoLeft > 0 })),
      missiles: this.aa.missiles.map((m) => ({ x: m.pos.x, z: m.pos.z })),
    });
  }
}

async function boot() {
  const loading = document.getElementById('loading')!;
  try {
    await RAPIER.init();
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    // let the loading text paint before the heavy world build
    await new Promise((r) => setTimeout(r, 30));
    const game = new Game(canvas);
    (window as unknown as { game: Game }).game = game;
    loading.remove();
  } catch (e) {
    console.error(e);
    loading.textContent = 'Failed to start: ' + (e as Error).message;
  }
}
boot();
