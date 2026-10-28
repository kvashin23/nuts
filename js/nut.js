// NUTS hero: procedural walnut-brain that cracks open on scroll / click.
// Performance notes: the folds are baked once on the CPU (no noise on the GPU per frame),
// there is no post-processing, pixel ratio is capped, and the scene drops to ~30 fps when idle.
import * as THREE from 'three';

const canvas = document.getElementById('gl');
const hero = document.getElementById('hero');
const isMobile = matchMedia('(max-width: 700px)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'default' });
} catch (e) {
  canvas.remove();
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.25 : 1.5));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 0, 7);

// ---------- simplex noise (CPU, used once to bake the folds) ----------
const snoise = (() => {
  const grad = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  const perm = new Uint8Array(512);
  let seed = 7;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { seed = (seed * 16807) % 2147483647; const j = seed % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F3 = 1 / 3, G3 = 1 / 6;
  return (x, y, z) => {
    const s = (x + y + z) * F3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3, x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
    else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
    const c = [[x0, y0, z0, 0, 0, 0], [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, i1, j1, k1], [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, i2, j2, k2], [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, 1, 1, 1]];
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    for (const [dx, dy, dz, oi, oj, ok] of c) {
      let tt = .6 - dx * dx - dy * dy - dz * dz;
      if (tt < 0) continue;
      const g = grad[perm[ii + oi + perm[jj + oj + perm[kk + ok]]] % 12];
      tt *= tt; n += tt * tt * (g[0] * dx + g[1] * dy + g[2] * dz);
    }
    return 32 * n;
  };
})();
// ridged fbm -> brain-like folds (three soft octaves)
const folds = (x, y, z) => {
  let f = 0, a = .6;
  for (let i = 0; i < 3; i++) { const n = 1 - Math.abs(snoise(x, y, z)); f += n * n * a; x = x * 2.05 + 1.7; y = y * 2.05 + 9.2; z = z * 2.05 + 3.1; a *= .45; }
  return f;
};
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// ---------- baked walnut geometry ----------
// per vertex we store the sphere direction, fold height and seam mask; the vertex shader only
// rebuilds the radius from them, so the "craziness" on mouse shake stays almost free
// indexed icosphere built directly (three's IcosahedronGeometry + mergeVertices took ~0.5 s)
function icosphere(n) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]];
  const F = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const pos = [], idx = [], seen = new Map();
  const vert = (x, y, z) => {
    const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let i = seen.get(key);
    if (i === undefined) { i = pos.length / 3; pos.push(x, y, z); seen.set(key, i); }
    return i;
  };
  for (const [a, b, c] of F) {
    const A = V[a], B = V[b], C = V[c], row = [];
    for (let i = 0; i <= n; i++) {
      row[i] = [];
      for (let j = 0; j <= n - i; j++) {
        const u = i / n, w = j / n, k = 1 - u - w;
        row[i][j] = vert(A[0] * k + B[0] * u + C[0] * w, A[1] * k + B[1] * u + C[1] * w, A[2] * k + B[2] * u + C[2] * w);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      idx.push(row[i][j], row[i + 1][j], row[i][j + 1]);
      if (j < n - i - 1) idx.push(row[i + 1][j], row[i + 1][j + 1], row[i][j + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function buildNut(detail) {
  const g = icosphere(detail);
  const pos = g.attributes.position, n = pos.count;
  const hArr = new Float32Array(n), sArr = new Float32Array(n), dir = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    dir.set([v.x, v.y, v.z], i * 3);
    const h = folds(v.x * 1.65, v.y * 1.65, v.z * 1.65);
    const s = smooth(.015, .11, Math.abs(v.x));
    hArr[i] = h; sArr[i] = s;
    let r = 1 + h * .13 * s - (1 - s) * .10;
    r *= 1 + .10 * Math.pow(Math.max(v.y, 0), 3) - .04 * Math.pow(Math.max(-v.y, 0), 2);
    pos.setXYZ(i, v.x * r * .9, v.y * r * 1.12, v.z * r * .95);
  }
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aH', new THREE.BufferAttribute(hArr, 1));
  g.setAttribute('aS', new THREE.BufferAttribute(sArr, 1));
  g.computeVertexNormals();
  return g;
}

const vert = /* glsl */`
uniform float uAmp;
attribute vec3 aDir; attribute float aH, aS;
varying vec3 vWNormal, vWPos, vObj;
varying float vH;
void main(){
  vec3 n=aDir;
  float r=1.+(aH*.13*uAmp)*aS-(1.-aS)*.10;
  r*=1.+.10*pow(max(n.y,0.),3.)-.04*pow(max(-n.y,0.),2.);
  vec3 p=n*r*vec3(.9,1.12,.95);
  vH=aH; vObj=n;
  vec4 wp=modelMatrix*vec4(p,1.);
  vWPos=wp.xyz;
  vWNormal=normalize(mat3(modelMatrix)*normal);
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;

const frag = /* glsl */`
uniform float uSide, uSplit, uTime;
uniform vec3 uLight;
varying vec3 vWNormal, vWPos, vObj;
varying float vH;
void main(){
  if(vObj.x*uSide < -0.001) discard;               // keep only this half
  vec3 N=normalize(vWNormal);
  vec3 V=normalize(cameraPosition-vWPos);
  if(!gl_FrontFacing){
    // inside of the shell: hot glowing core
    float g=.6+.4*sin(uTime*2.+vObj.y*6.);
    gl_FragColor=vec4(vec3(1.,.42,.08)*(1.2+g*uSplit*1.5),1.);
    return;
  }
  vec3 L=normalize(uLight);
  float cav=smoothstep(.2,1.,vH);                // 0 = deep fold, 1 = ridge
  vec3 deep=vec3(.08,.02,.006);
  vec3 mid=vec3(.58,.18,.03);
  vec3 top=vec3(.95,.46,.12);
  vec3 base=mix(deep,mid,cav); base=mix(base,top,smoothstep(.7,1.,cav));
  float diff=max(dot(N,L),0.);
  float wrap=dot(N,L)*.5+.5;
  vec3 H=normalize(L+V);
  float spec=pow(max(dot(N,H),0.),24.)*cav*.35;
  float fres=pow(1.-max(dot(N,V),0.),3.);
  vec3 col=base*(.1+diff*.9+wrap*.3)+spec*vec3(1.,.8,.55)+fres*vec3(1.,.36,.08)*1.1;
  col*=mix(.4,1.,cav);                            // fake ambient occlusion in folds
  gl_FragColor=vec4(col,1.);
}`;

const geo = buildNut(isMobile ? 40 : 64);
const uniforms = {
  uTime: { value: 0 }, uAmp: { value: 1 },
  uLight: { value: new THREE.Vector3(-2.5, 3, 4) },
  uSplit: { value: 0 },
};
const makeHalf = side => {
  const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide, uniforms: { ...uniforms, uSide: { value: side } } });
  Object.keys(uniforms).forEach(k => (m.uniforms[k] = uniforms[k])); // share live uniforms
  return new THREE.Mesh(geo, m);
};
const nut = new THREE.Group();
const left = makeHalf(-1), right = makeHalf(1);
nut.add(left, right);

// glowing kernel revealed when cracked
const core = new THREE.Mesh(
  new THREE.SphereGeometry(.42, 32, 24),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSplit: uniforms.uSplit, uTime: uniforms.uTime },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uSplit,uTime; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(max(dot(vN,vV),0.),1.5); float p=.8+.2*sin(uTime*3.); gl_FragColor=vec4(vec3(1.,.55,.15)*f*p*2.2, f*uSplit); }`,
  })
);
nut.add(core);
scene.add(nut);

// soft halo behind the nut — replaces the full-screen bloom pass at a fraction of the cost
const halo = new THREE.Mesh(
  new THREE.PlaneGeometry(4.4, 4.4),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSplit: uniforms.uSplit },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uSplit; varying vec2 vUv; void main(){ float d=length(vUv-.5)*2.; float a=pow(max(1.-d,0.),2.2)*(.22+uSplit*.35); gl_FragColor=vec4(1.,.38,.08,a); }`,
  })
);
halo.position.z = -1.2;
scene.add(halo);

// orbit rings (echo of the brand arcs)
const rings = new THREE.Group();
[[1.75, .3, 0], [2.1, -.5, .6], [2.5, .9, -.3]].forEach(([r, rx, rz], i) => {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .006 + i * .002, 6, 160), new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: .5 - i * .12 }));
  ring.rotation.set(Math.PI / 2 + rx, 0, rz);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(.035 + i * .01, 12, 12), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffffff : 0xffa040 }));
  bead.position.x = r;
  ring.add(bead);
  ring.userData.speed = .25 - i * .06;
  rings.add(ring);
});
scene.add(rings);

// dust particles
const P = isMobile ? 300 : 700;
const pPos = new Float32Array(P * 3), pSeed = new Float32Array(P);
for (let i = 0; i < P; i++) {
  const r = 2.2 + Math.random() * 5, a = Math.random() * Math.PI * 2, y = (Math.random() - .5) * 6;
  pPos.set([Math.cos(a) * r, y, Math.sin(a) * r - 1], i * 3);
  pSeed[i] = Math.random();
}
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('seed', new THREE.BufferAttribute(pSeed, 1));
const dust = new THREE.Points(pGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: uniforms.uTime, uPx: { value: renderer.getPixelRatio() } },
  vertexShader: `attribute float seed; uniform float uTime,uPx; varying float vA;
    void main(){ vec3 p=position; float a=uTime*(.03+seed*.05); p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz; p.y+=sin(uTime*.5+seed*20.)*.15;
    vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=(1.5+seed*3.)*uPx*(6./-mv.z); vA=.25+seed*.6; gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor=vec4(1.,.55,.2,vA*(1.-d*2.)); }`,
}));
scene.add(dust);

// ---------- layout ----------
const layout = { x: 0, y: 0, s: 1 };
function resize() {
  const w = hero.clientWidth, h = hero.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const wide = w / h > 1.1;
  layout.x = wide ? 1.35 : 0;
  layout.y = wide ? .1 : .55;
  layout.s = wide ? 1 : .78;
  wake();
}
addEventListener('resize', resize);

// ---------- interaction ----------
let lastInput = performance.now();
const wake = () => (lastInput = performance.now());
const mouse = { x: 0, y: 0, tx: 0, ty: 0, vel: 0 };
addEventListener('pointermove', e => {
  const nx = e.clientX / innerWidth * 2 - 1, ny = -(e.clientY / innerHeight * 2 - 1);
  mouse.vel = Math.min(mouse.vel + Math.hypot(nx - mouse.tx, ny - mouse.ty) * 2, 1.2);
  mouse.tx = nx; mouse.ty = ny;
  wake();
}, { passive: true });
addEventListener('scroll', wake, { passive: true });

// hit test against a bounding sphere — the old per-triangle raycast cost a lot of CPU on every mouse move
let clickSplit = 0, clickTarget = 0;
const raycaster = new THREE.Raycaster(), hitSphere = new THREE.Sphere();
const hitNut = e => {
  const r = hero.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1)), camera);
  hitSphere.set(nut.position, 1.05 * nut.scale.x);
  return raycaster.ray.intersectsSphere(hitSphere);
};
hero.addEventListener('click', e => {
  if (e.target.closest('a,button') || !hitNut(e)) return;
  clickTarget = clickTarget ? 0 : 1;
  wake();
  window.dispatchEvent(new CustomEvent('nut:crack', { detail: clickTarget }));
});
hero.addEventListener('pointermove', e => {
  hero.style.cursor = !e.target.closest('a,button') && hitNut(e) ? 'pointer' : '';
}, { passive: true });

let visible = true;
new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) wake(); }).observe(hero);

// ---------- loop ----------
// 60 fps while the user interacts or the intro plays, ~30 fps when idle, nothing off-screen
const clock = new THREE.Clock();
let intro = 0, last = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (!visible || document.hidden) { clock.getDelta(); return; }
  const active = now - lastInput < 2500 || intro < 1 || Math.abs(clickTarget - clickSplit) > .01;
  if (!active && now - last < 32) return;
  last = now;
  const dt = Math.min(clock.getDelta(), .05);
  const t = clock.elapsedTime;
  uniforms.uTime.value = t;
  intro = Math.min(intro + dt * .6, 1);
  const ei = 1 - Math.pow(1 - intro, 4);

  mouse.x += (mouse.tx - mouse.x) * .06;
  mouse.y += (mouse.ty - mouse.y) * .06;
  mouse.vel *= .94;

  // swells a little when you shake the mouse
  uniforms.uAmp.value = 1 + mouse.vel * .55 + Math.sin(t * 1.3) * .05;

  // scroll progress through hero
  const sp = Math.min(Math.max(scrollY / (hero.offsetHeight * .8), 0), 1);
  clickSplit += (clickTarget - clickSplit) * .07;
  const split = Math.max(sp, clickSplit);
  uniforms.uSplit.value = split;

  const gap = split * .75;
  left.position.x = -gap; right.position.x = gap;
  left.rotation.y = -split * .5; right.rotation.y = split * .5;
  left.rotation.z = split * .15; right.rotation.z = -split * .15;
  core.scale.setScalar(.6 + split * .8 + Math.sin(t * 3) * .03 * split);

  nut.position.set(layout.x + mouse.x * .15, layout.y + Math.sin(t * .8) * .06 - sp * .4, 0);
  nut.scale.setScalar(layout.s * (.4 + .6 * ei) * (1 + sp * .15));
  nut.rotation.y = t * .18 * (reduced ? 0 : 1) + mouse.x * .6 + (1 - ei) * 3;
  nut.rotation.x = -mouse.y * .35 + .15;
  halo.position.x = nut.position.x; halo.position.y = nut.position.y;
  halo.scale.setScalar(nut.scale.x);

  rings.position.copy(nut.position);
  rings.scale.setScalar(layout.s * ei * (1 + split * .25));
  rings.rotation.x = mouse.y * .2;
  rings.rotation.y = mouse.x * .3;
  rings.children.forEach(r => (r.rotation.z += r.userData.speed * dt * (1 + mouse.vel * 3)));

  dust.rotation.y = mouse.x * .2;
  renderer.render(scene, camera);
}
resize();
requestAnimationFrame(tick);
document.documentElement.classList.add('has-gl');
