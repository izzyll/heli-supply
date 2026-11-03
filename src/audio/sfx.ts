/** All sounds are synthesised with WebAudio — no asset files needed. */
export type SfxName = 'coin' | 'levelup' | 'achievement' | 'buy' | 'error' | 'crash' | 'crunch' | 'thud' | 'hook' | 'release'
  | 'jackpot' | 'spin' | 'reelstop' | 'win' | 'alarm' | 'chute' | 'click';

export class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private rotorGain: GainNode | null = null;
  private rotorLfo: OscillatorNode | null = null;
  private rotorFilter: BiquadFilterNode | null = null;
  private whine: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // rotor: filtered noise amplitude-modulated at blade-pass frequency
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    this.rotorFilter = ctx.createBiquadFilter();
    this.rotorFilter.type = 'lowpass'; this.rotorFilter.frequency.value = 380; this.rotorFilter.Q.value = 0.8;
    const am = ctx.createGain(); am.gain.value = 0.5;
    this.rotorLfo = ctx.createOscillator(); this.rotorLfo.type = 'sawtooth'; this.rotorLfo.frequency.value = 0;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.5;
    this.rotorLfo.connect(lfoDepth).connect(am.gain);
    this.rotorGain = ctx.createGain(); this.rotorGain.gain.value = 0;
    src.connect(this.rotorFilter).connect(am).connect(this.rotorGain).connect(this.master);
    src.start(); this.rotorLfo.start();
    // turbine whine
    this.whine = ctx.createOscillator(); this.whine.type = 'triangle'; this.whine.frequency.value = 300;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start();
  }

  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }

  engine(rpm: number, thrust: number, muted: boolean) {
    if (!this.ctx || !this.rotorGain || !this.rotorLfo || !this.whine || !this.whineGain || !this.rotorFilter) return;
    const t = this.ctx.currentTime;
    const g = muted ? 0 : rpm;
    this.rotorGain.gain.setTargetAtTime(g * (0.35 + 0.25 * Math.min(1.5, thrust)), t, 0.1);
    this.rotorLfo.frequency.setTargetAtTime(rpm * 17, t, 0.1);
    this.rotorFilter.frequency.setTargetAtTime(250 + 300 * Math.min(1.5, thrust), t, 0.1);
    this.whine.frequency.setTargetAtTime(200 + rpm * 900 + thrust * 80, t, 0.1);
    this.whineGain.gain.setTargetAtTime(g * 0.025, t, 0.1);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, when = 0, slide = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, vol = 0.5, when = 0) {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t); s.stop(t + dur + 0.05);
  }

  play(name: SfxName) {
    switch (name) {
      case 'coin': this.tone(988, 0.08, 'square', 0.12); this.tone(1319, 0.25, 'square', 0.12, 0.08); break;
      case 'buy': this.tone(660, 0.08, 'triangle', 0.2); this.tone(990, 0.15, 'triangle', 0.2, 0.07); break;
      case 'error': this.tone(180, 0.18, 'square', 0.15); break;
      case 'click': this.tone(1200, 0.03, 'square', 0.06); break;
      case 'levelup': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.22, i * 0.1)); break;
      case 'achievement': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.2, 'sine', 0.2, i * 0.08)); break;
      case 'jackpot': for (let i = 0; i < 12; i++) this.tone([523, 659, 784, 1047][i % 4] * (1 + Math.floor(i / 4) * 0.5), 0.18, 'square', 0.12, i * 0.08); break;
      case 'win': [659, 880, 1109].forEach((f, i) => this.tone(f, 0.18, 'square', 0.12, i * 0.07)); break;
      case 'spin': this.burst(0.15, 2500, 0.08); break;
      case 'reelstop': this.tone(300, 0.06, 'square', 0.1); break;
      case 'crash': this.burst(1.6, 600, 0.9); this.tone(80, 1.2, 'sawtooth', 0.4, 0, 0.3); break;
      case 'crunch': this.burst(0.35, 1800, 0.6); this.tone(140, 0.25, 'square', 0.2, 0, 0.5); break;
      case 'thud': this.burst(0.18, 300, 0.5); break;
      case 'hook': this.tone(420, 0.06, 'square', 0.15); this.tone(620, 0.08, 'square', 0.15, 0.05); break;
      case 'release': this.tone(500, 0.08, 'square', 0.15); this.tone(330, 0.1, 'square', 0.15, 0.05); break;
      case 'chute': this.burst(0.5, 900, 0.35); break;
      case 'alarm': this.tone(880, 0.12, 'square', 0.1); this.tone(660, 0.12, 'square', 0.1, 0.14); break;
    }
  }
}
