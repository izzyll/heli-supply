import * as THREE from 'three';

const MAX = 4000;

export type FxKind = 'smoke' | 'darksmoke' | 'fire' | 'spark' | 'dust' | 'splinter' | 'confetti';

interface P { vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number; grav: number; drag: number; r: number; g: number; b: number; fade: number }

/** Simple pooled point-sprite particle system. */
export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private ps: P[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX; i++) this.ps.push({ vx: 0, vy: 0, vz: 0, life: 0, max: 0, size: 0, grow: 0, grav: 0, drag: 0, r: 0, g: 0, b: 0, fade: 1 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vC, vA * (1.0 - r*4.0)); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setScale(h: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.9; }

  emit(kind: FxKind, pos: THREE.Vector3, count: number, baseVel?: THREE.Vector3, spread = 1) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const p = this.ps[i];
      const rnd = () => (Math.random() - 0.5) * 2;
      const bv = baseVel ?? new THREE.Vector3();
      this.pos[i * 3] = pos.x + rnd() * 0.3 * spread; this.pos[i * 3 + 1] = pos.y + rnd() * 0.3 * spread; this.pos[i * 3 + 2] = pos.z + rnd() * 0.3 * spread;
      p.vx = bv.x; p.vy = bv.y; p.vz = bv.z; p.fade = 1;
      switch (kind) {
        case 'smoke': case 'darksmoke': {
          const c = kind === 'smoke' ? 0.55 + Math.random() * 0.15 : 0.12 + Math.random() * 0.1;
          p.r = p.g = p.b = c; p.vx += rnd() * 0.8 * spread; p.vy += 1.5 + Math.random() * 1.5; p.vz += rnd() * 0.8 * spread;
          p.max = 2.5 + Math.random() * 2; p.size = 1.2; p.grow = 2.2; p.grav = -0.3; p.drag = 0.6; p.fade = 0.55; break;
        }
        case 'fire':
          p.r = 1; p.g = 0.45 + Math.random() * 0.35; p.b = 0.1; p.vx += rnd() * 2 * spread; p.vy += 2 + Math.random() * 3; p.vz += rnd() * 2 * spread;
          p.max = 0.5 + Math.random() * 0.6; p.size = 1.6; p.grow = 1; p.grav = -1; p.drag = 1.5; break;
        case 'spark':
          p.r = 1; p.g = 0.85; p.b = 0.4; p.vx += rnd() * 9 * spread; p.vy += Math.random() * 7; p.vz += rnd() * 9 * spread;
          p.max = 0.4 + Math.random() * 0.5; p.size = 0.18; p.grow = 0; p.grav = 9.8; p.drag = 0.5; break;
        case 'dust':
          p.r = 0.62; p.g = 0.55; p.b = 0.42; p.vx += rnd() * 6 * spread; p.vy += Math.random() * 1.2; p.vz += rnd() * 6 * spread;
          p.max = 1.2 + Math.random(); p.size = 1.5; p.grow = 3; p.grav = -0.2; p.drag = 1.4; p.fade = 0.45; break;
        case 'splinter':
          p.r = 0.5; p.g = 0.42; p.b = 0.25; p.vx += rnd() * 5 * spread; p.vy += 2 + Math.random() * 5; p.vz += rnd() * 5 * spread;
          p.max = 0.9; p.size = 0.25; p.grow = 0; p.grav = 9.8; p.drag = 0.3; break;
        case 'confetti': {
          const h = Math.random();
          const c = new THREE.Color().setHSL(h, 0.9, 0.6);
          p.r = c.r; p.g = c.g; p.b = c.b; p.vx += rnd() * 6; p.vy += 4 + Math.random() * 6; p.vz += rnd() * 6;
          p.max = 2.2; p.size = 0.35; p.grow = 0; p.grav = 4; p.drag = 0.8; break;
        }
      }
      p.life = p.max;
      this.size[i] = p.size;
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
      this.alpha[i] = p.fade;
    }
  }

  explosion(pos: THREE.Vector3) {
    this.emit('fire', pos, 120, undefined, 4);
    this.emit('spark', pos, 80, undefined, 2);
    this.emit('darksmoke', pos, 90, new THREE.Vector3(0, 2, 0), 3);
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      const p = this.ps[i];
      if (p.life <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      p.life -= dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      this.pos[i * 3] += p.vx * dt; this.pos[i * 3 + 1] += p.vy * dt; this.pos[i * 3 + 2] += p.vz * dt;
      this.size[i] += p.grow * dt;
      const t = Math.max(0, p.life / p.max);
      this.alpha[i] = p.fade * Math.min(1, t * 2);
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
