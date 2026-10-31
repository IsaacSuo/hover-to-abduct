// HOVER TO ABDUCT. Tilt is the only input: all of it arrives through input.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { initInput, updateInput, getTilt, calibrate, inputHint } from './input.js';
import { audio } from './audio.js';
import { createPipeline } from './render.js';
import { makeRoad, buildLayout, buildEnvironment, heightAt, WORLD_HALF, ROAD_HALF } from './world.js';

// =============================================================== TUNING
const TARGET_SCORE = 12000;
const ROUND_SECONDS = 60;

// Flight. Top speed is roughly (25 deg * TILT_SENSITIVITY) / DRAG.
const TILT_SENSITIVITY = 1.15; // m/s^2 of thrust per degree of tilt
const TILT_DEADZONE_DEG = 2.5; // below this the controller counts as level
const DRAG = 1.4; // 1/s, how quickly speed bleeds off
const GLIDE_FRICTION = 1.0; // m/s^2 extra braking when level, so the glide truly ends
const UFO_ALTITUDE = 11.5;

// Beam. It turns on below HOVER_SPEED_ON and off above HOVER_SPEED_OFF; the gap is the hysteresis.
const HOVER_SPEED_ON = 1.4; // m/s (the hover threshold)
const HOVER_SPEED_OFF = 2.6; // m/s
const BEAM_WARMUP = 0.3; // s
const BEAM_RADIUS = 5; // m
const GHOST_SENSE_RADIUS = 10; // m, ghosts stir when a beam comes on within this range

// Lift speed by weight class (m/s, each object varies +-10%).
const LIFT_SPEEDS = { light: 7.5, medium: 4.2, heavy: 2.4, huge: 1.35 };
// Seconds of being towed (beam off) a class survives before it drops. Light objects never drop.
const DROP_TOLERANCE = { light: Infinity, medium: 0.9, heavy: 0.3, huge: 0.12 };

// Combo.
const COMBO_WINDOW = 3.5; // s between grabs before the chain breaks
const COMBO_MAX = 5;
const COMBO_GRABS_PER_STEP = 2; // grabs needed for each +1 on the multiplier
const BULK_TIERS = [[3, 150, 'BULK ORDER!'], [5, 350, 'WHOLESALE!'], [8, 700, 'CLEARANCE SALE!']]; // arrivals in one hover

// Feel.
const BIG_LOOT = 800; // value from which a grab shakes the camera
const GRAVITY = 24;
const CAR_SPEED = 9; // m/s
const CAR_GAP = 3; // m of clear road kept between cars
const RING_DELAY = 3; // s on the win/lose screen before the PLAY AGAIN ring appears
const RING_HOVER_TIME = 1.1; // s of hovering over the ring to restart
const RING_RADIUS = 6;
const CAMERA_DISTANCE = 18;
const CAMERA_HEIGHT = 7.5;
const CAMERA_MAX_HEIGHT = 15; // cranes up to here when a building would hide the beam's footprint
const CAMERA_FOV = 56;
const CAMERA_YAW_RATE = 0.0105; // rad of view turn per metre of sideways travel; 0 locks the heading

// What everything is worth. mul scales the class lift speed.
const KINDS = {
  wheat: { cls: 'light', value: 2, scenery: true, mul: 0.8, label: 'wheat' },
  pumpkin: { cls: 'light', value: 50, label: 'pumpkin', quips: ['GOURD-GEOUS!', 'PUMPKIN SPICE DELIVERY!', 'OH MY GOURD!'] },
  lantern: { cls: 'light', value: 90, label: 'jack-o-lantern', quips: ['LIGHTS, GOURD, ACTION!', 'TRICK OR TREAT!'] },
  chicken: { cls: 'light', value: 60, label: 'chicken', quips: ['WHY DID THE CHICKEN CROSS THE BEAM?', 'WINNER WINNER!', 'BAWK TO THE FUTURE!'] },
  crow: { cls: 'light', value: 70, label: 'crow', quips: ['CAW-GHT!', 'MURDER, SHE ABDUCTED!'] },
  urn: { cls: 'light', value: 80, label: 'urn', quips: ['GRANDPA, NO!'] },
  skull: { cls: 'light', value: 80, label: 'skull', quips: ['NICE TEETH!'] },
  fence: { cls: 'medium', value: 30, mul: 1.5, label: 'fence', quips: ['DE-FENCE!', 'GOOD NEIGHBOURS, GONE!'] },
  hay: { cls: 'medium', value: 40, mul: 1.3, label: 'hay bale', quips: ['HAY, PUT ME DOWN!'] },
  stone: { cls: 'medium', value: 40, mul: 1.2, label: 'rock', quips: ['GEOLOGY!'] },
  tombstone: { cls: 'medium', value: 120, label: 'tombstone', quips: ['REST IN SPACE!', 'GRAVE ROBBERY, BUT MAKE IT ALIEN!'] },
  lamp: { cls: 'medium', value: 120, label: 'lamp', quips: ['LIGHTS OUT!', 'THE CITY WILL HEAR ABOUT THIS!'] },
  scarecrow: { cls: 'medium', value: 160, label: 'scarecrow', quips: ['NOT SCARED!', 'HE HAD NO BRAIN ANYWAY!'] },
  tree: { cls: 'medium', value: 150, mul: 0.8, label: 'tree', quips: ['TREE-MENDOUS!', 'LEAF IT TO US!'] },
  cauldron: { cls: 'medium', value: 150, label: 'cauldron', quips: ['SOUP OF THE DAY!'] },
  pillar: { cls: 'medium', value: 150, label: 'pillar', quips: ['PILLAR OF THE COMMUNITY!'] },
  coffin: { cls: 'medium', value: 220, label: 'coffin', quips: ['SORRY, OCCUPIED!'] },
  sheep: { cls: 'medium', value: 180, label: 'sheep', quips: ['EWE ARE COMING WITH US!', 'BAA-BYE!'] },
  pig: { cls: 'medium', value: 180, label: 'pig', quips: ['WHEN PIGS FLY!', 'HOG-DUCTED!'] },
  cow: { cls: 'medium', value: 350, mul: 0.8, label: 'cow', quips: ['MOO-VING DAY!', 'GRADE A ABDUCTION!', 'CLASSIC!'] },
  well: { cls: 'heavy', value: 500, label: 'well', quips: ['OH, WELL!'] },
  coop: { cls: 'heavy', value: 600, label: 'coop', quips: ['FLEW THE COOP!'] },
  car: { cls: 'heavy', value: 850, label: 'car', quips: ['YOUR WARRANTY HAS EXPIRED!', 'PARKING: SOLVED!', 'NO MORE TRAFFIC!'] },
  silo: { cls: 'huge', value: 2200, mul: 1.15, label: 'silo', quips: ['SILO-NARA!', 'GRAIN OF TRUTH!'] },
  tower: { cls: 'huge', value: 2000, mul: 1.2, label: 'tower', quips: ['GONE WITH THE WIND!', 'TALL ORDER!'] },
  farmhouse: { cls: 'huge', value: 2800, label: 'farmhouse', quips: ['EXTREME HOME MAKEOVER!', 'LISTING REMOVED!'], pool: 'house' },
  barn: { cls: 'huge', value: 3200, label: 'barn', quips: ['BARN TO BE WILD!', 'BARN AGAIN!'], pool: 'house' },
  ghost: { cls: 'light', value: 750, mul: 0.65, ghost: true, label: 'ghost', quips: ['GHOSTBUSTED!', 'BOO-GIE ON UP!', 'SPIRIT LEVEL: FULL!'] },
};
const DROP_QUIPS = ['BUTTERFINGERS!', 'OOPS!', 'ALIEN FUMBLE!', 'NO REFUNDS!', 'GRAVITY STILL WORKS!'];
const LANDING_QUIPS = [
  (a, b) => `${a} VS ${b}: ${a} WINS!`, (a, b) => `THAT ${b} HAD A FAMILY!`, (a, b) => `${b} INSURANCE WON'T COVER THIS!`,
  (a, b) => `A ${a} FELL ON A ${b}. CLASSIC.`, (a, b) => `SPECIAL DELIVERY FOR ${b}!`, (a, b) => `GRAVITY 1, ${b} 0!`,
];
const POOLS = { lamp: [17, '#ff9a3c', 0.62], small: [6.5, '#ff8a2a', 0.5], house: [22, '#ff9440', 0.26], head: [9, '#ffe2a8', 0.24] };
const BELLY = 1.15; // how far under the saucer centre objects are swallowed
const SPRING = { light: [16, 3], medium: [20, 6], heavy: [30, 10], huge: [40, 14] };
const q = new URLSearchParams(location.search);
const MANUAL = q.has('manual'); // test mode: no rAF loop, the test drives time

// =============================================================== setup
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + (b - a) * Math.random();
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA_FOV, innerWidth / innerHeight, 0.5, 2600);
const pipeline = createPipeline(renderer, scene, camera);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  pipeline.resize();
});

const MATERIALS = {
  Pal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true, side: THREE.DoubleSide }),
  Glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.85, 1.85, 1.85) }),
  Glass: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, transparent: true, opacity: 0.1, flatShading: true }),
  Ghost: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true, transparent: true, opacity: 0.86, emissive: '#a6ffe0', emissiveIntensity: 0.5 }),
};

const m4 = new THREE.Matrix4();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const e1 = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

// Runtime state
const props = [];
const solids = []; // everything except scenery
const occluders = []; // big enough to hide the UFO's footprint from the camera
const active = []; // lifting / falling / settling right now
const movers = { animals: [], crows: [], cars: [], ghosts: [] };
const batches = {};
const dims = {};
const nodes = {};
const ufo = { pos: new THREE.Vector3(0, UFO_ALTITUDE, 52), vel: new THREE.Vector3(), speed: 0 };
const beam = { engaged: false, level: 0, state: 'off', transitions: 0 };
const cam = { yaw: 0, pos: new THREE.Vector3(), trauma: 0, focus: 18, height: CAMERA_HEIGHT };
const stats = { grabs: 0, drops: 0, ghosts: 0, best: null, bestPts: 0, hovers: 0 };
let round = 'loading';
let clock = 0;
let score = 0;
let timeLeft = ROUND_SECONDS;
let chain = 0;
let chainT = 0;
let hoverArrivals = 0;
let hoverWheat = 0;
let saidCropCircle = false;
let saidEdge = false;
let saidGhost = false;
let saidJam = false;
let countT = 0;
let countShown = 0;
let endT = 0;
let fadeT = 0;
let hintT = 0;
let won = false;
let road;
let layout;
let lastQuipT = -9;
let lastQuipRank = 0;
let tilt = { pitch: 0, roll: 0 };
const smoothTilt = { pitch: 0, roll: 0 };
const ufoParts = {};
let beamFx;
let ring;
let pools;
let moonRig;

// =============================================================== loading
function splitNode(node) {
  const parts = [];
  node.traverse((o) => {
    if (o.isMesh) parts.push({ geometry: o.geometry, material: MATERIALS[o.material.name.split('.')[0]] ?? MATERIALS.Pal });
  });
  return parts;
}

async function load() {
  const gltf = await new GLTFLoader().loadAsync('/assets/world.glb');
  for (const node of gltf.scene.children) {
    nodes[node.name] = splitNode(node);
    const box = new THREE.Box3();
    for (const p of nodes[node.name]) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox);
    }
    const size = box.getSize(new THREE.Vector3());
    dims[node.name] = { r: Math.max(size.x, size.z) / 2, h: size.y };
  }
  await document.fonts.load('80px Creepster');

  road = makeRoad();
  layout = buildLayout(road, dims);
  moonRig = buildEnvironment(scene, road, layout, nodes);
  buildProps();
  buildUfo();
  buildBeamFx();
  buildRing();

  $('scoreGoal').textContent = `/ ${TARGET_SCORE}`;
  initInput();
  $('loading').remove();
  startRound();
  if (!MANUAL) requestAnimationFrame(frame);
}

function buildProps() {
  const counts = {};
  for (const it of layout.items) counts[it.model] = (counts[it.model] || 0) + 1;
  for (const [model, count] of Object.entries(counts)) {
    const meshes = nodes[model].map((part) => {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, count);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false;
      const glassy = part.material === MATERIALS.Ghost;
      inst.castShadow = model !== 'wheat' && !glassy;
      inst.receiveShadow = !glassy;
      scene.add(inst);
      return inst;
    });
    batches[model] = { meshes, used: 0, dirty: true };
  }

  // Additive fake-light pools for lamps and windows: 40 real lights would be far too slow.
  const tex = radialTexture();
  const poolItems = layout.items.filter((it) => it.pool || KINDS[it.kind].pool);
  pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, color: 0xffffff }),
    Math.max(1, poolItems.length));
  pools.frustumCulled = false;
  pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pools.renderOrder = 1;
  scene.add(pools);

  let poolIdx = 0;
  for (const it of layout.items) {
    const def = KINDS[it.kind];
    const batch = batches[it.model];
    const d = dims[it.model];
    const base = it.scale ?? 1;
    const p = {
      kind: it.kind, def, model: it.model, batch, idx: batch.used++,
      home: { x: it.x, z: it.z, rot: it.rot, s: it.s ?? 0 }, base,
      r: d.r * base, h: d.h * base,
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: base, vel: new THREE.Vector3(),
      state: 'idle', y0: 0, off: new THREE.Vector2(), strain: 0, liftSpeed: 0, axis: new THREE.Vector3(), angle: 0,
      spin: 0, phase: Math.random() * 6.28, baseQuat: new THREE.Quaternion(), angVel: new THREE.Vector3(), bounces: 0, hit: false,
      sq: 0, dropped: false, poolId: -1, poolType: it.pool ?? def.pool ?? null, settleT: 0, settleTo: new THREE.Quaternion(),
      pen: it.pen ?? null, penHome: it.pen ?? null, wait: 0, tx: 0, tz: 0, walk: rand(0.55, 1.15),
      fly: it.fly ?? null, flyHome: it.fly ?? null, flyA: Math.random() * 6.28,
      lane: it.lane ?? null, s: 0, carSpeed: 0, stopT: 0, onRoad: false, hidden: !!it.hidden,
    };
    if (p.poolType) {
      p.poolId = poolIdx++;
      pools.setColorAt(p.poolId, new THREE.Color(POOLS[p.poolType][1]).multiplyScalar(POOLS[p.poolType][2]));
    }
    props.push(p);
    if (!def.scenery) solids.push(p);
    if (d.h > 4 && d.r > 1.7 && !it.model.startsWith('tree_dead') && it.kind !== 'lamp') occluders.push(p);
    if (p.penHome) movers.animals.push(p);
    if (p.flyHome) movers.crows.push(p);
    if (p.lane !== null) movers.cars.push(p);
    if (p.hidden) movers.ghosts.push(p);
  }
  pools.instanceColor.needsUpdate = true;
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.35, '#8a8a8a');
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function nodeMesh(name) {
  const group = new THREE.Group();
  for (const part of nodes[name]) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = part.material !== MATERIALS.Glass;
    group.add(mesh);
  }
  return group;
}

function buildUfo() {
  const root = new THREE.Group();
  const tiltGroup = new THREE.Group();
  const lights = nodeMesh('ufo_lights');
  const cockpit = nodeMesh('ufo_cockpit');
  const duck = nodeMesh('ufo_duck');
  const stick = nodeMesh('ufo_stick');
  stick.position.set(0, 0.84, 0.82);
  cockpit.add(duck, stick);
  const dome = nodeMesh('ufo_dome');
  dome.children.forEach((m) => { m.renderOrder = 3; });
  tiltGroup.add(nodeMesh('ufo_body'), lights, cockpit, dome);
  root.add(tiltGroup);
  scene.add(root);
  const glowLight = new THREE.PointLight('#fff0c0', 26, 9, 1.4);
  glowLight.position.set(0, 2.1, 0);
  tiltGroup.add(glowLight);
  Object.assign(ufoParts, { root, tiltGroup, lights, cockpit, duck, stick, hop: 0, hopV: 0 });
}

function buildBeamFx() {
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { level: { value: 0 }, time: { value: 0 }, tint: { value: new THREE.Color('#7dffcf') } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalMatrix*normal; vV=-mv.xyz; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float level, time; uniform vec3 tint; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float rim = pow(max(1.-abs(dot(normalize(vN), normalize(vV))), 0.), 1.7);
        float bands = .8 + .2*sin(vUv.y*30. - time*6.);
        float a = (.07 + .5*rim) * (.3 + .7*vUv.y) * bands;
        gl_FragColor = vec4(tint * a * level * 1.5, 1.);
      }`,
  });
  const coneGeo = new THREE.CylinderGeometry(1.05, BEAM_RADIUS, 1, 28, 1, true).translate(0, -0.5, 0);
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.renderOrder = 2;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.6, BEAM_RADIUS * 0.55, 1, 20, 1, true).translate(0, -0.5, 0), coneMat);
  inner.renderOrder = 2;
  scene.add(cone, inner);

  const tex = radialTexture();
  const spot = new THREE.Mesh(new THREE.PlaneGeometry(BEAM_RADIUS * 2.9, BEAM_RADIUS * 2.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, color: '#7dffcf', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
  spot.renderOrder = 1;
  // Footprint ring: always visible, so you can see what a hover would catch before you stop.
  const reticle = new THREE.Mesh(new THREE.RingGeometry(BEAM_RADIUS - 0.14, BEAM_RADIUS, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 1.2), transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
  reticle.renderOrder = 1;
  const light = new THREE.PointLight('#7dffcf', 0, 30, 1.5);
  scene.add(spot, reticle, light);

  const count = 80;
  const seeds = Array.from({ length: count }, () => ({ a: Math.random() * 6.28, r: Math.sqrt(Math.random()), p: Math.random(), s: rand(0.22, 0.5) }));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(1.1, 3, 2.3), size: 0.17, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  scene.add(sparks);

  // Tow lines for objects still attached while the beam is off.
  const tow = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(240), 3)),
    new THREE.LineBasicMaterial({ color: new THREE.Color(0.6, 2.2, 1.7), transparent: true, opacity: 0.65, depthWrite: false }));
  tow.frustumCulled = false;
  scene.add(tow);
  beamFx = { cone, inner, coneMat, spot, reticle, light, sparks, seeds, tow };
}

function buildRing() {
  const group = new THREE.Group();
  const band = new THREE.Mesh(new THREE.RingGeometry(RING_RADIUS - 0.6, RING_RADIUS, 56).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.5, 0.35), fog: false, transparent: true, depthWrite: false }));
  band.position.y = 0.3;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(RING_RADIUS - 0.6, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 3, 2.2), fog: false, transparent: true, depthWrite: false, opacity: 0.7 }));
  fill.position.y = 0.26;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(RING_RADIUS, RING_RADIUS, 26, 40, 1, true).translate(0, 13, 0), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: 'varying float h; void main(){ h=uv.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying float h; void main(){ gl_FragColor=vec4(vec3(1.,.5,.12)*pow(max(1.-h,0.),2.4)*.2,1.); }',
  }));
  group.add(band, fill, column);
  group.visible = false;
  scene.add(group);
  ring = { group, band, fill, charge: 0, x: 0, z: 0 };
}

// =============================================================== prop matrices
function setMatrix(p) {
  const s = p.scale;
  const squash = p.sq > 0 ? 1 - 0.42 * Math.sin((p.sq / 0.7) * Math.PI) : 1;
  const stretch = p.sq > 0 ? 1 + 0.2 * Math.sin((p.sq / 0.7) * Math.PI) : 1;
  v2.set(s * stretch, s * squash, s * stretch);
  // Rotate about the object's middle rather than its feet.
  const hc = (p.h / p.base) * 0.5;
  v1.set(0, hc * v2.y, 0).applyQuaternion(p.quat);
  m4.compose(p.pos, p.quat, v2);
  m4.elements[12] = p.pos.x - v1.x;
  m4.elements[13] = p.pos.y + hc * v2.y - v1.y;
  m4.elements[14] = p.pos.z - v1.z;
  for (const mesh of p.batch.meshes) mesh.setMatrixAt(p.idx, s > 0 ? m4 : ZERO_MATRIX);
  p.batch.dirty = true;
}

function setPool(p, on) {
  if (p.poolId < 0) return;
  if (!on) {
    pools.setMatrixAt(p.poolId, ZERO_MATRIX);
  } else {
    const r = POOLS[p.poolType][0];
    m4.makeScale(r, 1, r);
    m4.setPosition(p.pos.x, heightAt(p.pos.x, p.pos.z) + 0.16, p.pos.z);
    pools.setMatrixAt(p.poolId, m4);
  }
  pools.instanceMatrix.needsUpdate = true;
}

function flushBatches() {
  for (const b of Object.values(batches)) {
    if (!b.dirty) continue;
    for (const mesh of b.meshes) mesh.instanceMatrix.needsUpdate = true;
    b.dirty = false;
  }
}

// =============================================================== round flow
function resetWorld() {
  for (const p of props) {
    p.state = p.hidden ? 'hidden' : 'idle';
    p.pos.set(p.home.x, heightAt(p.home.x, p.home.z) + 0.02, p.home.z);
    p.quat.setFromAxisAngle(UP, p.home.rot);
    p.scale = p.hidden ? 0 : p.base;
    p.dropped = false;
    p.sq = 0;
    p.strain = 0;
    p.pen = p.penHome;
    p.fly = p.flyHome;
    p.wait = rand(0, 3);
    p.tx = p.home.x;
    p.tz = p.home.z;
    p.stopT = 0;
    if (p.lane !== null) {
      p.s = p.home.s;
      p.carSpeed = CAR_SPEED;
      p.onRoad = true;
      placeCar(p);
    } else {
      if (p.fly) p.pos.y = p.fly.h;
      setMatrix(p);
      setPool(p, !p.hidden);
    }
  }
  active.length = 0;
  ufo.pos.set(0, UFO_ALTITUDE, 52);
  ufo.vel.set(0, 0, 0);
  ufo.speed = 0;
  beam.engaged = false;
  beam.level = 0;
  beam.state = 'off';
  cam.yaw = 0;
  cam.pos.set(0, CAMERA_HEIGHT, 52 + CAMERA_DISTANCE);
  cam.height = CAMERA_HEIGHT;
  ring.group.visible = false;
  ring.charge = 0;
}

function startRound() {
  resetWorld();
  score = 0;
  timeLeft = ROUND_SECONDS;
  chain = 0;
  chainT = 0;
  hoverArrivals = 0;
  saidCropCircle = saidEdge = saidGhost = saidJam = false;
  Object.assign(stats, { grabs: 0, drops: 0, ghosts: 0, best: null, bestPts: 0, hovers: 0 });
  round = 'countdown';
  countT = 3;
  countShown = 0;
  calibrate(2.8);
  $('big').className = 'glow';
  $('center').className = '';
  $('timer').style.visibility = '';
  $('sub').textContent = 'Hold steady...';
  $('hint').textContent = '';
  $('hint').style.opacity = 1;
  $('timer').textContent = ROUND_SECONDS;
  $('timer').classList.remove('low');
  $('quip').className = '';
  updateHud();
  $('fade').style.opacity = 0;
}

function endRound(didWin) {
  round = 'end';
  won = didWin;
  endT = 0;
  $('big').textContent = didWin ? 'ABDUCTION COMPLETE!' : 'THE MOTHERSHIP IS DISAPPOINTED';
  $('big').className = `glow title${didWin ? ' win' : ''}`;
  $('center').className = 'end';
  $('quip').className = '';
  $('timer').style.visibility = 'hidden';
  const best = stats.best ? `  -  prize catch: ${stats.best}` : '';
  $('sub').textContent = `${score} of ${TARGET_SCORE}${best}`;
  didWin ? audio.win() : audio.lose();
  addTrauma(didWin ? 0.5 : 0.2);
}

function showRing() {
  // Ahead of the UFO (so it's on screen) and on the clearest ground nearby, but never underneath:
  // the player has to fly over on purpose.
  let best = null;
  let bestScore = -Infinity;
  for (const a of [0, 0.5, -0.5, 0.95, -0.95, 1.4, -1.4]) {
    const yaw = cam.yaw + a;
    const x = clamp(ufo.pos.x - Math.sin(yaw) * 20, -WORLD_HALF + 8, WORLD_HALF - 8);
    const z = clamp(ufo.pos.z - Math.cos(yaw) * 20, -WORLD_HALF + 8, WORLD_HALF - 8);
    let s = -Math.abs(a) * 2;
    if (Math.hypot(x - ufo.pos.x, z - ufo.pos.z) < RING_RADIUS + 4) s -= 100;
    for (const p of solids) {
      if (p.state === 'idle' && p.h > 3 && Math.hypot(p.pos.x - x, p.pos.z - z) < RING_RADIUS + p.r) s -= p.h;
    }
    if (s > bestScore) {
      bestScore = s;
      best = [x, z];
    }
  }
  ring.x = best[0];
  ring.z = best[1];
  ring.group.position.set(ring.x, heightAt(ring.x, ring.z), ring.z);
  ring.group.visible = true;
  ring.charge = 0;
  $('hint').textContent = 'Fly to the ring and hover to play again';
  $('hint').style.opacity = 1;
}

function updateRound(dt) {
  if (round === 'countdown') {
    countT -= dt;
    const n = Math.ceil(countT);
    if (n !== countShown && n > 0) {
      countShown = n;
      $('big').textContent = n;
      audio.count(n);
    }
    if (countT <= 0) {
      round = 'play';
      $('big').textContent = '';
      $('sub').textContent = '';
      $('hint').textContent = `${inputHint()}  -  Stop to beam things up`;
      hintT = 6;
      say('GO!', 'big', 3);
      audio.count(0);
    }
  } else if (round === 'play') {
    timeLeft -= dt;
    const shown = Math.max(0, Math.ceil(timeLeft));
    if ($('timer').textContent !== String(shown)) {
      $('timer').textContent = shown;
      $('timer').classList.toggle('low', shown <= 10);
    }
    if (hintT > 0 && (hintT -= dt) <= 0) $('hint').style.opacity = 0;
    if (score >= TARGET_SCORE) endRound(true);
    else if (timeLeft <= 0) endRound(false);
  } else if (round === 'end') {
    endT += dt;
    if (endT >= RING_DELAY && !ring.group.visible) showRing();
    if (ring.group.visible) {
      const pulse = 0.82 + 0.18 * Math.sin(clock * 4);
      ring.band.material.color.setRGB(3.2 * pulse, 1.5 * pulse, 0.35);
      ring.fill.scale.setScalar(Math.max(0.001, ring.charge));
      if (beam.state === 'on' && overRing()) ring.charge = Math.min(1, ring.charge + dt / RING_HOVER_TIME);
      else ring.charge = Math.max(0, ring.charge - dt);
      if (ring.charge >= 1) {
        round = 'fading';
        fadeT = 0.5;
        $('fade').style.opacity = 1;
        audio.count(0);
      }
    }
  } else if (round === 'fading') {
    fadeT -= dt;
    if (fadeT <= 0) startRound();
  }
}

const overRing = () => ring.group.visible && Math.hypot(ufo.pos.x - ring.x, ufo.pos.z - ring.z) < RING_RADIUS;

// =============================================================== flight & beam
function updateFlight(dt) {
  tilt = getTilt();
  smoothTilt.pitch += (tilt.pitch - smoothTilt.pitch) * Math.min(1, dt * 7);
  smoothTilt.roll += (tilt.roll - smoothTilt.roll) * Math.min(1, dt * 7);
  if (round === 'countdown' || round === 'fading' || round === 'loading') return;

  const mag = Math.hypot(tilt.pitch, tilt.roll);
  const k = mag > TILT_DEADZONE_DEG ? (mag - TILT_DEADZONE_DEG) / mag : 0;
  const thrust = TILT_SENSITIVITY * k;
  const sin = Math.sin(cam.yaw);
  const cos = Math.cos(cam.yaw);
  // forward = (-sin, -cos), right = (cos, -sin) in x/z
  ufo.vel.x += (tilt.roll * cos - tilt.pitch * sin) * thrust * dt;
  ufo.vel.z += (-tilt.roll * sin - tilt.pitch * cos) * thrust * dt;
  ufo.vel.multiplyScalar(Math.exp(-DRAG * dt));
  if (k === 0) {
    const sp = ufo.vel.length();
    if (sp > 0) ufo.vel.multiplyScalar(Math.max(0, sp - GLIDE_FRICTION * dt) / sp);
  }
  // Soft wall at the edge of the map.
  for (const axis of ['x', 'z']) {
    const over = Math.abs(ufo.pos[axis]) - WORLD_HALF;
    if (over > 0) {
      ufo.vel[axis] -= Math.sign(ufo.pos[axis]) * over * 9 * dt;
      if (!saidEdge && round === 'play') {
        saidEdge = true;
        say('THE MOTHERSHIP SAYS: STAY ON THE FARM!', 'small', 1);
      }
    }
  }
  ufo.pos.addScaledVector(ufo.vel, dt);
  ufo.speed = ufo.vel.length();
}

function updateBeam(dt) {
  const allowed = round === 'play' || (round === 'end' && overRing());
  beam.engaged = allowed && ufo.speed < (beam.engaged ? HOVER_SPEED_OFF : HOVER_SPEED_ON);
  beam.level = clamp(beam.level + (beam.engaged ? dt / BEAM_WARMUP : -dt / 0.12), 0, 1);
  const next = beam.engaged ? (beam.level >= 1 ? 'on' : 'warming') : 'off';
  if (next !== beam.state) {
    if ((next === 'off') !== (beam.state === 'off')) beam.transitions++;
    if (next === 'on') {
      hoverArrivals = 0;
      hoverWheat = 0;
      stats.hovers++;
    }
    beam.state = next;
  }
  audio.setHum(beam.level);
}

function updateCapture() {
  if (beam.state !== 'on' || round !== 'play') return;
  const r2 = BEAM_RADIUS * BEAM_RADIUS;
  for (const p of props) {
    if (p.state !== 'idle') continue;
    const dx = p.pos.x - ufo.pos.x;
    const dz = p.pos.z - ufo.pos.z;
    if (dx * dx + dz * dz < r2) startLift(p);
  }
}

function startLift(p) {
  p.state = 'lift';
  p.y0 = p.pos.y;
  p.off.set(p.pos.x - ufo.pos.x, p.pos.z - ufo.pos.z);
  p.vel.set(0, 0, 0);
  p.strain = 0;
  p.liftSpeed = LIFT_SPEEDS[p.def.cls] * (p.def.mul ?? 1) * rand(0.9, 1.1);
  p.axis.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
  p.angle = 0;
  p.spin = p.def.cls === 'light' ? rand(2, 4.5) : p.def.cls === 'medium' ? rand(0.8, 1.8) : 0;
  p.baseQuat.copy(p.quat);
  p.onRoad = false;
  p.pen = null;
  p.fly = null;
  setPool(p, false);
  active.push(p);
}

// =============================================================== lift / drop physics
function updateActive(dt) {
  let w = 0;
  for (let i = 0; i < active.length; i++) {
    const p = active[i];
    if (p.state === 'lift') updateLift(p, dt);
    else if (p.state === 'fall') updateFall(p, dt);
    else if (p.state === 'settle') updateSettle(p, dt);
    if (p.state === 'lift' || p.state === 'fall' || p.state === 'settle') active[w++] = p;
  }
  active.length = w;
}

function updateLift(p, dt) {
  const cls = p.def.cls;
  const beamOn = beam.state === 'on';
  if (p.def.ghost && !beamOn) {
    startDive(p);
    return;
  }
  if (beamOn) p.strain = Math.max(0, p.strain - dt * 2);
  else if (cls !== 'light') {
    p.strain += dt;
    if (p.strain >= DROP_TOLERANCE[cls]) {
      dropProp(p);
      return;
    }
  }
  const topY = ufo.pos.y - BELLY;
  if (beamOn || cls === 'light') p.pos.y += p.liftSpeed * dt;
  const u = clamp((p.pos.y - p.y0) / Math.max(0.01, topY - p.y0), 0, 1);

  // Spring towards a spiral into the beam's axis: the lag is what makes things sway when towed.
  const inward = (1 - u) ** 0.7;
  const swirl = u * 2.4;
  const c = Math.cos(swirl);
  const s = Math.sin(swirl);
  const tx = ufo.pos.x + (p.off.x * c - p.off.y * s) * inward;
  const tz = ufo.pos.z + (p.off.x * s + p.off.y * c) * inward;
  const [K, D] = SPRING[cls];
  p.vel.x += (K * (tx - p.pos.x) - D * p.vel.x) * dt;
  p.vel.z += (K * (tz - p.pos.z) - D * p.vel.z) * dt;
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;

  // Things shrink as they near the hatch, so even a barn fits inside.
  const fit = clamp((topY + 0.2 - p.pos.y) / (p.h / p.base), 0.1, 1);
  let scale = p.base * Math.min(fit, 1);
  if (u > 0.92) scale *= 1 - ((u - 0.92) / 0.08) * 0.75;
  p.scale = scale;

  const wob = cls === 'huge' ? 0.035 : cls === 'heavy' ? 0.06 : 0.1;
  const leanX = clamp((tz - p.pos.z) * 0.07, -0.6, 0.6);
  const leanZ = clamp(-(tx - p.pos.x) * 0.07, -0.6, 0.6);
  e1.set(leanX + Math.sin(clock * 2.3 + p.phase) * wob, 0, leanZ + Math.sin(clock * 1.9 + p.phase * 2) * wob);
  p.quat.setFromEuler(e1);
  if (p.spin) {
    p.angle += p.spin * dt;
    p.quat.multiply(q1.setFromAxisAngle(p.axis, p.angle));
  }
  p.quat.multiply(p.baseQuat);
  setMatrix(p);
  if (u >= 1) grab(p);
}

function dropProp(p) {
  p.state = 'fall';
  p.vel.x = ufo.vel.x * 0.7 + p.vel.x * 0.3;
  p.vel.z = ufo.vel.z * 0.7 + p.vel.z * 0.3;
  p.vel.y = 1.2;
  p.bounces = 2;
  p.hit = false;
  const spin = { medium: 3, heavy: 1.5, huge: 0.7 }[p.def.cls];
  p.angVel.set(rand(-spin, spin), rand(-spin, spin), rand(-spin, spin));
  chain = 0;
  chainT = 0;
  stats.drops++;
  say(pick(DROP_QUIPS), 'sad', 2);
  audio.drop();
}

function updateFall(p, dt) {
  p.vel.y -= GRAVITY * dt;
  p.pos.addScaledVector(p.vel, dt);
  p.scale += (p.base - p.scale) * Math.min(1, dt * 7);
  v1.copy(p.angVel).multiplyScalar(dt);
  q1.setFromEuler(e1.set(v1.x, v1.y, v1.z));
  p.quat.premultiply(q1);

  if (!p.hit && p.vel.y < 0) {
    for (const v of solids) {
      if (v === p || v.state !== 'idle') continue;
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
      if (d > (v.r + p.r) * 0.72 || p.pos.y > v.pos.y + v.h || p.pos.y < v.pos.y - 0.5) continue;
      landOn(p, v, d);
      break;
    }
  }
  const ground = heightAt(p.pos.x, p.pos.z);
  if (p.pos.y <= ground) {
    p.pos.y = ground;
    const speed = -p.vel.y;
    impact(p, speed);
    if (p.bounces > 0 && speed > 5) {
      p.bounces--;
      p.vel.y = speed * 0.3;
      p.vel.x *= 0.6;
      p.vel.z *= 0.6;
      p.angVel.multiplyScalar(0.5);
    } else {
      p.state = 'settle';
      p.settleT = 0;
      p.scale = p.base;
      e1.setFromQuaternion(p.quat, 'YXZ');
      // Ends up upright-ish, but never quite straight again.
      p.settleTo.setFromEuler(e1.set(rand(-0.07, 0.07), e1.y, rand(-0.07, 0.07), 'YXZ'));
    }
  }
  setMatrix(p);
}

function updateSettle(p, dt) {
  p.settleT += dt / 0.22;
  p.quat.slerp(p.settleTo, Math.min(1, p.settleT));
  setMatrix(p);
  if (p.settleT >= 1) {
    p.state = 'idle';
    p.dropped = true;
    p.y0 = p.pos.y;
  }
}

function landOn(p, v, d) {
  p.hit = true;
  // Skid off the victim instead of balancing on it, which would leave it floating once v is taken.
  const nx = d > 0.01 ? (p.pos.x - v.pos.x) / d : 1;
  const nz = d > 0.01 ? (p.pos.z - v.pos.z) / d : 0;
  const push = 4 + (v.r + p.r) * 0.9;
  p.vel.x += nx * push;
  p.vel.z += nz * push;
  p.vel.y = Math.abs(p.vel.y) * 0.3;
  v.sq = 0.7;
  if (v.lane !== null) v.stopT = 2.5;
  addTrauma(0.3 + weightOf(p) * 0.35);
  audio.thud(weightOf(p));
  if (round === 'play') say(pick(LANDING_QUIPS)(p.def.label.toUpperCase(), v.def.label.toUpperCase()), 'small', 2);
}

function impact(p, speed) {
  const w = weightOf(p);
  if (speed > 4) {
    addTrauma(Math.min(0.8, 0.12 + w * 0.5));
    audio.thud(w);
  }
}

const weightOf = (p) => ({ light: 0.05, medium: 0.25, heavy: 0.55, huge: 1 })[p.def.cls];

// =============================================================== scoring
function multiplier() {
  return Math.min(COMBO_MAX, 1 + Math.floor(chain / COMBO_GRABS_PER_STEP));
}

function grab(p) {
  p.state = 'gone';
  p.scale = 0;
  setMatrix(p);
  ufoParts.hopV = Math.max(ufoParts.hopV, p.def.scenery ? 0 : 2.4);
  if (round !== 'play') return;

  if (p.def.scenery) {
    score += p.def.value;
    if (++hoverWheat === 14 && !saidCropCircle) {
      saidCropCircle = true;
      say('CROP CIRCLE! CLASSIC.', 'small', 1);
    }
    audio.tick();
    return;
  }
  chain++;
  chainT = COMBO_WINDOW;
  const mult = multiplier();
  const pts = p.def.value * mult;
  score += pts;
  stats.grabs++;
  if (p.def.ghost) stats.ghosts++;
  if (pts > stats.bestPts) {
    stats.bestPts = pts;
    stats.best = `${p.def.label} (+${pts})`;
  }
  pop(`+${pts}`, pts >= 600);
  audio.grab(p.def.value, mult);

  if (p.def.value >= BIG_LOOT) {
    addTrauma(clamp(0.3 + p.def.value / 3000, 0.3, 0.95));
    audio.quack();
  }
  hoverArrivals++;
  const tier = BULK_TIERS.find(([n]) => n === hoverArrivals);
  if (tier) {
    score += tier[1];
    say(tier[2], 'big', 3);
    pop(`+${tier[1]} BONUS`, true);
    audio.bulk();
  } else if (p.def.quips && (p.def.value >= 150 || Math.random() < 0.3)) {
    say(pick(p.def.quips), p.def.value >= BIG_LOOT ? 'big' : 'small', p.def.value >= BIG_LOOT ? 2 : 1);
  }
}

function updateCombo(dt) {
  if (chainT > 0 && (chainT -= dt) <= 0) chain = 0;
}

// =============================================================== ghosts, animals, crows, cars
function startDive(p) {
  p.state = 'dive';
  p.pen = null;
}

function updateGhosts(dt) {
  const on = beam.state === 'on' && round === 'play';
  for (const g of movers.ghosts) {
    const ground = heightAt(g.pos.x, g.pos.z);
    const d = Math.hypot(g.pos.x - ufo.pos.x, g.pos.z - ufo.pos.z);
    if (g.state === 'hidden') {
      if (on && d < GHOST_SENSE_RADIUS) {
        g.state = 'peek';
        g.pos.y = ground - 2.6;
        g.scale = g.base;
        audio.boo();
        if (!saidGhost) {
          saidGhost = true;
          say('BOO! SOMETHING IS UNDER THERE!', 'small', 2);
        }
      }
    } else if (g.state === 'peek') {
      if (!on) {
        startDive(g);
      } else {
        g.pos.y = Math.min(ground + 0.15 + Math.sin(clock * 3 + g.phase) * 0.12, g.pos.y + 3.5 * dt);
        // Curious little things: they drift into the beam by themselves.
        const step = Math.min(d, 1.9 * dt) / Math.max(d, 0.001);
        g.pos.x += (ufo.pos.x - g.pos.x) * step;
        g.pos.z += (ufo.pos.z - g.pos.z) * step;
        if (d < BEAM_RADIUS && g.pos.y > ground - 0.1) startLift(g);
      }
      setMatrix(g);
    } else if (g.state === 'dive') {
      g.pos.y -= 6 * dt;
      if (g.pos.y < ground - 2.6) {
        g.state = 'hidden';
        g.scale = 0;
      }
      setMatrix(g);
    }
  }
}

function updateAnimals(dt) {
  for (const p of movers.animals) {
    if (p.state !== 'idle' || !p.pen) continue;
    const dx = p.tx - p.pos.x;
    const dz = p.tz - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (p.wait > 0) {
      p.wait -= dt;
      if (p.wait <= 0) {
        p.tx = p.pen.x + rand(-p.pen.hw, p.pen.hw);
        p.tz = p.pen.z + rand(-p.pen.hd, p.pen.hd);
      }
      p.pos.y = heightAt(p.pos.x, p.pos.z);
      p.quat.setFromAxisAngle(UP, p.home.rot);
    } else if (d < 0.25) {
      p.wait = rand(0.8, 4);
    } else {
      p.pos.x += (dx / d) * p.walk * dt;
      p.pos.z += (dz / d) * p.walk * dt;
      const target = Math.atan2(dx, dz);
      let delta = target - p.home.rot;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      p.home.rot += delta * Math.min(1, dt * 4);
      // Toy-box waddle: bob up and rock side to side.
      const w = clock * (5 + p.walk * 5) + p.phase;
      p.pos.y = heightAt(p.pos.x, p.pos.z) + Math.abs(Math.sin(w)) * 0.09;
      p.quat.setFromEuler(e1.set(0, p.home.rot, Math.sin(w) * 0.09));
    }
    setMatrix(p);
  }
}

function updateCrows(dt) {
  for (const p of movers.crows) {
    if (p.state !== 'idle' || !p.fly) continue;
    p.flyA += p.fly.w * dt;
    p.pos.x = p.fly.x + Math.cos(p.flyA) * p.fly.r;
    p.pos.z = p.fly.z + Math.sin(p.flyA) * p.fly.r;
    p.pos.y = p.fly.h + Math.sin(p.flyA * 2.3) * 0.5;
    p.quat.setFromEuler(e1.set(0.1, -p.flyA + Math.PI, 0.35));
    setMatrix(p);
  }
}

function placeCar(p) {
  const dir = p.lane ? -1 : 1;
  const a = road.sample(dir > 0 ? p.s : road.length - p.s);
  const hx = a.tx * dir;
  const hz = a.tz * dir;
  // Drive on the right.
  const x = a.x - hz * 1.85;
  const z = a.z + hx * 1.85;
  p.pos.set(x, heightAt(x, z) + 0.09, z);
  p.quat.setFromAxisAngle(UP, Math.atan2(hx, hz));
  setMatrix(p);
  if (p.poolId >= 0) {
    m4.makeRotationY(Math.atan2(hx, hz));
    m4.scale(v1.set(4.6, 1, POOLS.head[0]));
    m4.setPosition(x + hx * 6.2, p.pos.y + 0.07, z + hz * 6.2);
    pools.setMatrixAt(p.poolId, m4);
    pools.instanceMatrix.needsUpdate = true;
  }
}

function updateTraffic(dt) {
  const L = road.length;
  const cars = movers.cars.filter((c) => c.onRoad);
  // Anything low on the road blocks traffic: dropped loot, or a car mid-lift.
  const obstacles = solids.filter((p) => p.h > 0.5 && ((p.dropped && p.state === 'idle') || (p.state === 'settle')
    || ((p.state === 'lift' || p.state === 'fall') && p.pos.y < 3.4 && p.def.cls !== 'light')));
  for (const lane of [0, 1]) {
    const inLane = cars.filter((c) => c.lane === lane).sort((a, b) => a.s - b.s);
    inLane.forEach((c, i) => {
      let limit = CAR_SPEED;
      if (inLane.length > 1) {
        const next = inLane[(i + 1) % inLane.length];
        const gap = ((next.s - c.s + L) % L) - (c.r + next.r);
        limit = Math.min(limit, CAR_SPEED * clamp((gap - CAR_GAP) / 9, 0, 1));
      }
      if (c.stopT > 0) {
        c.stopT -= dt;
        limit = 0;
      }
      const dir = lane ? -1 : 1;
      const a = road.sample(dir > 0 ? c.s : L - c.s);
      const hx = a.tx * dir;
      const hz = a.tz * dir;
      for (const o of obstacles) {
        if (o === c) continue;
        const ox = o.pos.x - c.pos.x;
        const oz = o.pos.z - c.pos.z;
        const ahead = ox * hx + oz * hz;
        const side = Math.abs(ox * hz - oz * hx);
        if (ahead < 0 || ahead > 16 + c.r + o.r || side > 1.6 + o.r) continue;
        const gap = ahead - c.r - o.r;
        limit = Math.min(limit, CAR_SPEED * clamp((gap - CAR_GAP) / 9, 0, 1));
        if (limit === 0 && !saidJam && round === 'play') {
          saidJam = true;
          say('TRAFFIC JAM! NICE ONE.', 'small', 1);
        }
      }
      const rate = c.carSpeed > limit ? 22 : 5; // brakes bite harder than the engine pulls
      c.carSpeed += clamp(limit - c.carSpeed, -rate * dt, rate * dt);
      c.s = (c.s + c.carSpeed * dt) % L;
    });
  }
  for (const c of cars) placeCar(c);
}

function updateSquash(dt) {
  for (const p of solids) {
    if (p.sq <= 0) continue;
    p.sq = Math.max(0, p.sq - dt);
    if (p.state === 'idle') setMatrix(p);
  }
}

// =============================================================== camera & visuals
function addTrauma(t) {
  cam.trauma = Math.min(1, cam.trauma + t);
}

function updateCamera(dt) {
  // Sideways travel slowly turns the view, so the far side of the map is reachable.
  const sin = Math.sin(cam.yaw);
  const cos = Math.cos(cam.yaw);
  const lateral = ufo.vel.x * cos - ufo.vel.z * sin;
  cam.yaw -= lateral * CAMERA_YAW_RATE * dt;

  const dist = CAMERA_DISTANCE + ufo.speed * 0.2;
  const tx = ufo.pos.x + Math.sin(cam.yaw) * dist;
  const tz = ufo.pos.z + Math.cos(cam.yaw) * dist;
  const follow = 1 - Math.exp(-7 * dt);
  cam.pos.x += (tx - cam.pos.x) * follow;
  cam.pos.z += (tz - cam.pos.z) * follow;
  // Crane up while a building stands between the camera and the spot the beam lands on.
  let wantHeight = CAMERA_HEIGHT;
  const fx = ufo.pos.x - cam.pos.x;
  const fz = ufo.pos.z - cam.pos.z;
  const len2 = fx * fx + fz * fz;
  for (const p of occluders) {
    if (p.state !== 'idle') continue;
    const t = clamp(((p.pos.x - cam.pos.x) * fx + (p.pos.z - cam.pos.z) * fz) / len2, 0, 0.9);
    const dx = cam.pos.x + fx * t - p.pos.x;
    const dz = cam.pos.z + fz * t - p.pos.z;
    if (dx * dx + dz * dz < (p.r + 0.5) ** 2) wantHeight = Math.max(wantHeight, (p.h + 0.6 - t) / (1 - t));
  }
  cam.height += (Math.min(wantHeight, CAMERA_MAX_HEIGHT) - cam.height) * (1 - Math.exp(-2.5 * dt));
  cam.pos.y = heightAt(cam.pos.x, cam.pos.z) + cam.height;

  cam.trauma = Math.max(0, cam.trauma - dt * 1.4);
  const shake = cam.trauma * cam.trauma;
  camera.position.set(
    cam.pos.x + Math.sin(clock * 37) * shake * 0.9,
    cam.pos.y + Math.sin(clock * 43 + 1) * shake * 0.7,
    cam.pos.z + Math.sin(clock * 31 + 2) * shake * 0.9,
  );
  camera.lookAt(ufo.pos.x, 8.6, ufo.pos.z);
  camera.rotation.z += Math.sin(clock * 29) * shake * 0.03;

  // Keep the UFO in the sharp plane at all times, moving or not.
  camera.getWorldDirection(v1);
  cam.focus = v2.copy(ufo.pos).sub(camera.position).dot(v1);

  moonRig.sky.position.copy(camera.position);
  moonRig.moon.position.set(ufo.pos.x - 40, 80, ufo.pos.z + 30);
  moonRig.moon.target.position.set(ufo.pos.x, 0, ufo.pos.z);
}

function updateUfoVisuals(dt) {
  const P = ufoParts;
  const bob = Math.sin(clock * 1.7) * 0.13;
  P.root.position.set(ufo.pos.x, ufo.pos.y + bob, ufo.pos.z);
  // Leans towards the camera a little so the cockpit stays visible from below, plus into the tilt.
  P.tiltGroup.rotation.set(0.17 - THREE.MathUtils.degToRad(smoothTilt.pitch) * 0.6, cam.yaw,
    -THREE.MathUtils.degToRad(smoothTilt.roll) * 0.6, 'YXZ');
  P.lights.rotation.y += dt * 1.1;
  // The joystick follows the player's tilt one-to-one (exaggerated so it reads at this distance).
  P.stick.rotation.set(-THREE.MathUtils.degToRad(tilt.pitch) * 1.5, 0, -THREE.MathUtils.degToRad(tilt.roll) * 1.5);
  // The duck hangs on: leans with the tilt and hops with joy at every grab.
  P.hopV -= 22 * dt;
  P.hop = Math.max(0, P.hop + P.hopV * dt);
  if (P.hop === 0) P.hopV = 0;
  P.duck.position.y = P.hop * 0.4 + Math.abs(Math.sin(clock * 2.3)) * 0.02;
  P.duck.rotation.set(-THREE.MathUtils.degToRad(smoothTilt.pitch) * 0.5, Math.sin(clock * 0.9) * 0.12,
    -THREE.MathUtils.degToRad(smoothTilt.roll) * 0.7);

  const F = beamFx;
  const ground = heightAt(ufo.pos.x, ufo.pos.z);
  const top = ufo.pos.y - 0.9 + bob;
  for (const c of [F.cone, F.inner]) {
    c.position.set(ufo.pos.x, top, ufo.pos.z);
    c.scale.y = top - ground;
    c.visible = beam.level > 0.001;
  }
  F.coneMat.uniforms.level.value = beam.level;
  F.coneMat.uniforms.time.value = clock;
  F.spot.position.set(ufo.pos.x, ground + 0.19, ufo.pos.z);
  F.spot.material.opacity = beam.level * 0.5;
  F.reticle.position.set(ufo.pos.x, ground + 0.22, ufo.pos.z);
  F.reticle.material.opacity = 0.22 + 0.5 * beam.level;
  F.light.position.set(ufo.pos.x, ground + 4.5, ufo.pos.z);
  F.light.intensity = beam.level * 42;

  F.sparks.visible = beam.level > 0.001;
  F.sparks.material.opacity = beam.level;
  if (F.sparks.visible) {
    const a = F.sparks.geometry.attributes.position;
    F.seeds.forEach((s, i) => {
      const h = (s.p + clock * s.s) % 1;
      const r = (BEAM_RADIUS * 0.9 - h * (BEAM_RADIUS - 1.2)) * s.r;
      const ang = s.a + clock * 0.8 + h * 2;
      a.setXYZ(i, ufo.pos.x + Math.cos(ang) * r, ground + h * (top - ground), ufo.pos.z + Math.sin(ang) * r);
    });
    a.needsUpdate = true;
  }
  // Tow lines: visible proof that a light object is still attached with the beam off.
  const t = F.tow.geometry.attributes.position;
  let n = 0;
  if (beam.state !== 'on') {
    for (const p of active) {
      if (p.state !== 'lift' || n >= 40) continue;
      t.setXYZ(n * 2, ufo.pos.x, top, ufo.pos.z);
      t.setXYZ(n * 2 + 1, p.pos.x, p.pos.y + (p.h * p.scale) / (2 * p.base), p.pos.z);
      n++;
    }
  }
  F.tow.geometry.setDrawRange(0, n * 2);
  t.needsUpdate = n > 0;
}

// =============================================================== HUD
function updateHud() {
  $('scoreNum').textContent = score;
  document.querySelector('#bar i').style.width = `${Math.min(100, (score / TARGET_SCORE) * 100)}%`;
  const mult = multiplier();
  const m = $('mult');
  m.textContent = `x${mult}`;
  m.classList.toggle('on', chain > 0 && round === 'play');
  const bar = $('multBar');
  bar.style.opacity = chain > 0 && round === 'play' ? 1 : 0;
  bar.style.transform = `scaleX(${clamp(chainT / COMBO_WINDOW, 0, 1)})`;

  // An HTML label, not a 3D one, so depth of field can't blur it. Sticks to the screen edge when
  // the ring is out of view, doubling as a pointer.
  const label = $('ringLabel');
  label.style.display = ring.group.visible ? 'block' : 'none';
  if (ring.group.visible) {
    v1.set(ring.x, heightAt(ring.x, ring.z) + 6.5 + Math.sin(clock * 1.6) * 0.3, ring.z).project(camera);
    if (v1.z > 1) {
      v1.x = -v1.x;
      v1.y = -1;
    }
    label.style.left = `${clamp(v1.x * 0.5 + 0.5, 0.12, 0.88) * innerWidth}px`;
    label.style.top = `${clamp(-v1.y * 0.5 + 0.5, 0.2, 0.9) * innerHeight}px`;
  }
}

// Quips: a more important one interrupts a lesser one, never the other way round.
function say(text, style = 'small', rank = 1) {
  if (clock - lastQuipT < 1.1 && rank < lastQuipRank) return;
  lastQuipT = clock;
  lastQuipRank = rank;
  const el = $('quip');
  el.textContent = text;
  el.className = '';
  void el.offsetWidth; // restart the CSS animation
  el.className = `pop${style === 'big' ? ' big' : ''}${style === 'sad' ? ' sad' : ''}`;
}

function pop(text, large) {
  v1.copy(ufo.pos).setY(ufo.pos.y - 4.5).project(camera);
  const el = document.createElement('div');
  el.className = `pts${large ? ' large' : ''}`;
  el.textContent = text;
  el.style.left = `${(v1.x * 0.5 + 0.5) * innerWidth + rand(-46, 46)}px`;
  el.style.top = `${(-v1.y * 0.5 + 0.5) * innerHeight + rand(-16, 16)}px`;
  el.addEventListener('animationend', () => el.remove());
  $('pops').append(el);
}

// =============================================================== main loop
function tick(dt) {
  clock += dt;
  updateInput(dt);
  updateFlight(dt);
  updateBeam(dt);
  updateRound(dt);
  updateCapture();
  updateActive(dt);
  updateGhosts(dt);
  updateTraffic(dt);
  updateAnimals(dt);
  updateCrows(dt);
  updateSquash(dt);
  updateCombo(dt);
  updateCamera(dt);
  updateUfoVisuals(dt);
  updateHud();
  flushBatches();
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  tick(dt);
  pipeline.render(cam.focus);
}

// Inspection hook for the automated tests; touches no input device.
if (q.has('debug') || MANUAL) {
  window.__game = {
    tick, advance(seconds) { for (let i = 0, n = Math.round(seconds * 60); i < n; i++) tick(1 / 60); },
    render() { pipeline.render(cam.focus); },
    get round() { return round; }, get score() { return score; }, get timeLeft() { return timeLeft; },
    get chain() { return chain; }, get mult() { return multiplier(); }, get layout() { return layout; }, get road() { return road; },
    get ring() { return ring; }, info: renderer.info, renderer, pipeline, scene, props, movers, ufo, beam, stats, cam, camera, BEAM_RADIUS, HOVER_SPEED_ON, HOVER_SPEED_OFF, TARGET_SCORE,
    teleport(x, z) { ufo.pos.x = x; ufo.pos.z = z; ufo.vel.set(0, 0, 0); ufo.speed = 0; cam.pos.set(x + Math.sin(cam.yaw) * CAMERA_DISTANCE, cam.pos.y, z + Math.cos(cam.yaw) * CAMERA_DISTANCE); },
    setTime(t) { timeLeft = t; },
    setScore(s) { score = s; },
  };
}

load().catch((e) => {
  console.error(e);
  $('loading').textContent = `Load failed: ${e.message}`;
});
