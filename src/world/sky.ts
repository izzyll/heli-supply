import * as THREE from 'three';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Sky {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  dome: THREE.Mesh;
  sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();

  constructor(scene: THREE.Scene) {
    const horizon = new THREE.Color(0xcfdde6);
    scene.fog = new THREE.Fog(horizon, 600, 4200);
    scene.background = horizon;

    const geo = new THREE.SphereGeometry(8000, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3d78c2) },
        mid: { value: horizon },
        bottom: { value: new THREE.Color(0x9fa89a) },
        sunDir: { value: this.sunDir },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.6)) : mix(mid, bottom, clamp(-h*4.0,0.0,1.0));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += vec3(1.0,0.9,0.7) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.15);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5b5040, 1.1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 900;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  follow(pos: THREE.Vector3, cameraPos: THREE.Vector3): void {
    // Snap the shadow camera to whole shadow-map texels so shadows don't shimmer/crawl as we fly.
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    const fwd = _f.copy(this.sunDir).negate();
    const right = _r.crossVectors(fwd, _up).normalize();
    const up = _u.crossVectors(right, fwd);
    const x = Math.round(pos.dot(right) / texel) * texel;
    const y = Math.round(pos.dot(up) / texel) * texel;
    const z = pos.dot(fwd);
    const snapped = _p.copy(right).multiplyScalar(x).addScaledVector(up, y).addScaledVector(fwd, z);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDir, 400);
    this.dome.position.copy(cameraPos);
  }
}
