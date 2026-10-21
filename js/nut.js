// NUTS hero: procedural walnut-brain that cracks open on scroll / click.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const canvas = document.getElementById('gl');
const hero = document.getElementById('hero');
const isMobile = matchMedia('(max-width: 700px)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  canvas.remove();
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 1.75));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 0, 7);

// ---------- shaders ----------
const noiseGLSL = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
// ridged fbm -> brain-like folds
float folds(vec3 p){
  float f=0.,a=.55;
  for(int i=0;i<4;i++){ float n=1.-abs(snoise(p)); f+=n*n*a; p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; }
  return f;
}
`;

const vert = /* glsl */`
uniform float uTime, uAmp, uSpeed;
varying vec3 vWNormal, vWPos, vObj;
varying float vH;
${noiseGLSL}
float seam(vec3 n){ return smoothstep(.015,.11,abs(n.x)); }
vec3 shape(vec3 n, out float h){
  float s=seam(n);
  h=folds(n*1.9+vec3(0.,0.,uTime*uSpeed));
  float r=1.+(h*.16*uAmp)*s-(1.-s)*.10;
  r*=1.+.10*pow(max(n.y,0.),3.)-.04*pow(max(-n.y,0.),2.);   // pointed top like a walnut
  return n*r*vec3(.9,1.12,.95);
}
void main(){
  vec3 n=normalize(position);
  float h; vec3 p=shape(n,h);
  vec3 t1=normalize(cross(n,abs(n.y)<.99?vec3(0.,1.,0.):vec3(1.,0.,0.)));
  vec3 t2=cross(n,t1);
  float e=.006, hh;
  vec3 pa=shape(normalize(n+t1*e),hh), pb=shape(normalize(n+t2*e),hh);
  vec3 nn=normalize(cross(pa-p,pb-p));
  if(dot(nn,n)<0.) nn=-nn;
  vH=h; vObj=n;
  vec4 wp=modelMatrix*vec4(p,1.);
  vWPos=wp.xyz;
  vWNormal=normalize(mat3(modelMatrix)*nn);
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
  float cav=smoothstep(.15,.95,vH);                // 0 = deep fold, 1 = ridge
  vec3 deep=vec3(.09,.025,.005);
  vec3 mid=vec3(.85,.24,.03);
  vec3 top=vec3(1.,.62,.18);
  vec3 base=mix(deep,mid,cav); base=mix(base,top,smoothstep(.75,1.,cav));
  float diff=max(dot(N,L),0.);
  float wrap=max(dot(N,L)*.5+.5,0.);
  vec3 H=normalize(L+V);
  float spec=pow(max(dot(N,H),0.),48.)*cav;
  float fres=pow(1.-max(dot(N,V),0.),3.);
  vec3 rimCol=vec3(1.,.45,.1);
  vec3 col=base*(.12+diff*1.05+wrap*.25)+spec*vec3(1.,.85,.6)*.9+fres*rimCol*1.4;
  // fake ambient occlusion in folds
  col*=mix(.35,1.,cav);
  gl_FragColor=vec4(col,1.);
}`;

const detail = isMobile ? 48 : 90;
const geo = new THREE.IcosahedronGeometry(1, detail);
const uniforms = {
  uTime: { value: 0 }, uAmp: { value: 1 }, uSpeed: { value: .06 },
  uLight: { value: new THREE.Vector3(-2.5, 3, 4) },
  uSplit: { value: 0 },
};
const makeHalf = side => {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide,
    uniforms: { ...uniforms, uSide: { value: side } },
  });
  // share live uniforms
  Object.keys(uniforms).forEach(k => (m.uniforms[k] = uniforms[k]));
  return new THREE.Mesh(geo, m);
};
const nut = new THREE.Group();
const left = makeHalf(-1), right = makeHalf(1);
nut.add(left, right);

// glowing kernel revealed when cracked
const core = new THREE.Mesh(
  new THREE.SphereGeometry(.42, 48, 48),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSplit: uniforms.uSplit, uTime: uniforms.uTime },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uSplit,uTime; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(max(dot(vN,vV),0.),1.5); float p=.8+.2*sin(uTime*3.); gl_FragColor=vec4(vec3(1.,.55,.15)*f*p*2.2, f*uSplit); }`,
  })
);
nut.add(core);
scene.add(nut);

// orbit rings (echo of the brand arcs)
const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: .55 });
const rings = new THREE.Group();
[[1.75, .3, 0], [2.1, -.5, .6], [2.5, .9, -.3]].forEach(([r, rx, rz], i) => {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, .006 + i * .002, 8, 220), ringMat.clone());
  ring.rotation.set(Math.PI / 2 + rx, 0, rz);
  ring.material.opacity = .5 - i * .12;
  // a little "planet" bead on each ring
  const bead = new THREE.Mesh(new THREE.SphereGeometry(.035 + i * .01, 16, 16), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffffff : 0xffa040 }));
  bead.position.x = r;
  ring.add(bead);
  ring.userData.speed = .25 - i * .06;
  rings.add(ring);
});
scene.add(rings);

// dust particles
const P = isMobile ? 500 : 1400;
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

// ---------- post ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .35, .5, .86);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- layout ----------
const layout = { x: 0, y: 0, s: 1 };
function resize() {
  const w = hero.clientWidth, h = hero.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const wide = w / h > 1.1;
  layout.x = wide ? 1.35 : 0;
  layout.y = wide ? .1 : .55;
  layout.s = wide ? 1 : .78;
}
addEventListener('resize', resize);
resize();

// ---------- interaction ----------
const mouse = { x: 0, y: 0, tx: 0, ty: 0, vel: 0 };
addEventListener('pointermove', e => {
  const nx = e.clientX / innerWidth * 2 - 1, ny = -(e.clientY / innerHeight * 2 - 1);
  mouse.vel = Math.min(mouse.vel + Math.hypot(nx - mouse.tx, ny - mouse.ty) * 2, 1.2);
  mouse.tx = nx; mouse.ty = ny;
});

let clickSplit = 0, clickTarget = 0;
const raycaster = new THREE.Raycaster();
hero.addEventListener('click', e => {
  if (e.target.closest('a,button')) return;
  const r = hero.getBoundingClientRect();
  const v = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
  raycaster.setFromCamera(v, camera);
  if (raycaster.intersectObject(nut, true).length) {
    clickTarget = clickTarget ? 0 : 1;
    window.dispatchEvent(new CustomEvent('nut:crack', { detail: clickTarget }));
  }
});
// tell the custom cursor what's under it
hero.addEventListener('pointermove', e => {
  const r = hero.getBoundingClientRect();
  const v = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
  raycaster.setFromCamera(v, camera);
  const hit = raycaster.intersectObject(left, false).length || raycaster.intersectObject(right, false).length;
  window.dispatchEvent(new CustomEvent('nut:hover', { detail: { hit: !!hit, open: clickTarget } }));
});

let visible = true;
new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(hero);

// ---------- loop ----------
const clock = new THREE.Clock();
let intro = 0;
function tick() {
  requestAnimationFrame(tick);
  if (!visible) return;
  const dt = Math.min(clock.getDelta(), .05);
  const t = clock.elapsedTime;
  uniforms.uTime.value = t;
  intro = Math.min(intro + dt * .6, 1);
  const ei = 1 - Math.pow(1 - intro, 4);

  mouse.x += (mouse.tx - mouse.x) * .06;
  mouse.y += (mouse.ty - mouse.y) * .06;
  mouse.vel *= .94;

  // crazier when you shake the mouse
  uniforms.uAmp.value = 1 + mouse.vel * .55 + Math.sin(t * 1.3) * .05;
  uniforms.uSpeed.value = .06 + mouse.vel * .25;

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

  rings.position.copy(nut.position);
  rings.scale.setScalar(layout.s * ei * (1 + split * .25));
  rings.rotation.x = mouse.y * .2;
  rings.rotation.y = mouse.x * .3;
  rings.children.forEach(r => (r.rotation.z += r.userData.speed * dt * (1 + mouse.vel * 3)));

  dust.rotation.y = mouse.x * .2;
  bloom.strength = .3 + split * .55;

  composer.render();
}
tick();
document.documentElement.classList.add('has-gl');
