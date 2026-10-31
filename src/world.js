// The static world: road, terrain, sky, and where every prop goes. Deterministic (seeded).
import * as THREE from 'three';

export const WORLD_HALF = 112;
export const ROAD_HALF = 3.8;

export function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function heightAt(x, z) {
  return 0.55 * Math.sin(x * 0.031 + 1) * Math.cos(z * 0.027) + 0.22 * Math.sin((x + z) * 0.06);
}

// ---------------------------------------------------------------- road (closed winding loop)
const ROAD_POINTS = [[-92, 78], [-48, 92], [0, 84], [46, 96], [92, 74], [100, 22], [74, -12], [98, -58], [62, -96],
  [14, -84], [-30, -100], [-84, -88], [-100, -38], [-72, 2], [-98, 40]];

export function makeRoad() {
  const curve = new THREE.CatmullRomCurve3(ROAD_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const length = curve.getLength();
  const n = Math.round(length / 2);
  const pts = curve.getSpacedPoints(n).slice(0, n);
  const nodes = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    return { x: p.x, z: p.z, tx: (q.x - p.x) / d, tz: (q.z - p.z) / d };
  });
  const step = length / n;
  return {
    length,
    nodes,
    // Position and unit tangent at arc length s (wraps around).
    sample(s, out = {}) {
      const u = ((s % length) + length) % length / step;
      const i = Math.floor(u) % n;
      const a = nodes[i];
      const b = nodes[(i + 1) % n];
      const f = u - Math.floor(u);
      out.x = a.x + (b.x - a.x) * f;
      out.z = a.z + (b.z - a.z) * f;
      const tx = a.tx + (b.tx - a.tx) * f;
      const tz = a.tz + (b.tz - a.tz) * f;
      const l = Math.hypot(tx, tz);
      out.tx = tx / l;
      out.tz = tz / l;
      return out;
    },
    distTo(x, z) {
      let best = Infinity;
      for (const p of nodes) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    },
  };
}

// ---------------------------------------------------------------- layout
// Returns placed props plus the ground regions. dims[model] = { r, h } comes from the glb.
export function buildLayout(road, dims) {
  const rng = mulberry(1031);
  const rand = (a, b) => a + (b - a) * rng();
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const items = [];
  const blocks = [];
  const regions = [];
  const warnings = [];

  const inRegion = (x, z, pad = 0) => regions.some((r) => Math.abs(x - r.x) < r.hw + pad && Math.abs(z - r.z) < r.hd + pad);
  const isClear = (x, z, r) => Math.abs(x) < WORLD_HALF - r && Math.abs(z) < WORLD_HALF - r
    && road.distTo(x, z) > ROAD_HALF + r + 0.8
    && !blocks.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r);

  const raw = (kind, model, x, z, rot = 0, extra = {}) => {
    items.push({ kind, model, x, z, rot, ...extra });
  };
  // Hand-placed landmark: registers a footprint and reports a layout conflict.
  const put = (kind, model, x, z, rot = 0, extra = {}) => {
    const r = dims[model].r;
    if (!isClear(x, z, r * 0.8)) warnings.push(`${model} at ${x},${z}`);
    blocks.push({ x, z, r: r * 0.9 });
    raw(kind, model, x, z, rot, extra);
  };
  // Scatter: tries random spots in a disc until one is free.
  const scatter = (kind, models, n, cx, cz, radius, opts = {}) => {
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 40; tries++) {
      const model = pick(models);
      const a = rand(0, Math.PI * 2);
      const d = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const r = dims[model].r * (opts.tight ?? 0.8);
      if (!isClear(x, z, r) || (!opts.allowRegions && inRegion(x, z, r))) continue;
      blocks.push({ x, z, r });
      raw(kind, model, x, z, rand(0, Math.PI * 2), opts.extra?.() ?? {});
      placed++;
    }
  };
  // Fence ring around a rectangle; returns the real half sizes (snapped to whole sections).
  const fenceRing = (kind, models, cx, cz, hw, hd, gap = -1) => {
    const len = dims[models[0]].r * 2;
    const nx = Math.max(1, Math.round((hw * 2) / len));
    const nz = Math.max(1, Math.round((hd * 2) / len));
    hw = (nx * len) / 2;
    hd = (nz * len) / 2;
    let i = 0;
    for (const s of [-1, 1]) {
      for (let k = 0; k < nx; k++, i++) if (i !== gap) raw(kind, pick(models), cx - hw + len * (k + 0.5), cz + s * hd, 0);
      for (let k = 0; k < nz; k++, i++) if (i !== gap) raw(kind, pick(models), cx + s * hw, cz - hd + len * (k + 0.5), Math.PI / 2);
    }
    return { hw, hd };
  };
  const region = (type, x, z, hw, hd) => regions.push({ type, x, z, hw, hd });

  // Landmarks ------------------------------------------------------
  // East farmstead
  put('farmhouse', 'farmhouse_a', 32, 66, Math.PI * 0.95);
  put('barn', 'barn', 58, 44, -Math.PI / 2 + 0.1);
  put('silo', 'silo', 73, 50);
  put('silo', 'silo_house', 75, 34, 0.5);
  put('well', 'well', 45, 56);
  put('barn', 'barn_big', 56, 6, -Math.PI / 2);
  put('tower', 'water_tower', 36, -14);
  // West farmstead
  put('farmhouse', 'farmhouse_b', -30, 68, Math.PI * 1.04);
  put('barn', 'barn_small', -54, 66, Math.PI / 2);
  put('barn', 'barn_open', -62, 24, Math.PI / 2);
  put('tower', 'windmill_tower', -52, 2, 0.6);
  // North-east: a third farmhouse and the old windmill at the field's edge
  put('farmhouse', 'farmhouse_a', 16, -74, 0.25);
  put('tower', 'windmill', 72, -70, -0.5);
  put('silo', 'silo', -14, -76);

  // Spawn: a little pumpkin patch directly under the UFO teaches the hover on the first second.
  const pumpkin = ['pumpkin_1', 'pumpkin_2', 'pumpkin_3'];
  const lantern = ['pumpkin_lantern_1', 'pumpkin_lantern_2'];
  for (const [dx, dz, m] of [[0, 0, 'pumpkin_lantern_1'], [2.2, 0.8, 'pumpkin_1'], [-2, 1.4, 'pumpkin_2'], [0.8, -2.4, 'pumpkin_3'], [-2.4, -1.5, 'pumpkin_1']]) {
    raw('lantern', m, dx, 52 + dz, rand(0, 6), m.startsWith('pumpkin_lantern') ? { pool: 'small' } : {});
    if (m.startsWith('pumpkin_') && !m.includes('lantern')) items[items.length - 1].kind = 'pumpkin';
  }
  blocks.push({ x: 0, z: 52, r: 7 });

  // Pens -----------------------------------------------------------
  const pen = (kindModel, n, cx, cz, hw, hd, gap) => {
    region('pen', cx, cz, hw + 1, hd + 1);
    const size = fenceRing('fence', ['fence'], cx, cz, hw, hd, gap);
    const bounds = { x: cx, z: cz, hw: size.hw - 1.4, hd: size.hd - 1.4 };
    for (let i = 0; i < n; i++) {
      raw(kindModel, kindModel, cx + rand(-bounds.hw, bounds.hw), cz + rand(-bounds.hd, bounds.hd), rand(0, 6), { pen: bounds });
    }
    return bounds;
  };
  pen('cow', 7, 6, 22, 15, 9);
  pen('sheep', 9, -34, 16, 12, 9);
  pen('pig', 7, 36, 18, 9, 6);
  const coopBounds = pen('chicken', 14, -6, -6, 9, 6);
  raw('coop', 'coop', coopBounds.x + coopBounds.hw - 1.5, coopBounds.z - coopBounds.hd + 1.5, 0.4);

  // Wheat fields ---------------------------------------------------
  const field = (cx, cz, hw, hd) => {
    region('field', cx, cz, hw, hd);
    for (let x = -hw; x < hw; x += 1.25) {
      for (let z = -hd; z < hd; z += 1.25) {
        const px = cx + x + rand(-0.4, 0.4);
        const pz = cz + z + rand(-0.4, 0.4);
        if (road.distTo(px, pz) < ROAD_HALF + 1.5) continue;
        if (blocks.some((b) => Math.hypot(b.x - px, b.z - pz) < b.r)) continue;
        raw('wheat', 'wheat', px, pz, rand(0, 6), { scale: rand(1.0, 1.45) });
      }
    }
    const scare = [[cx - hw * 0.45, cz - hd * 0.4], [cx + hw * 0.5, cz + hd * 0.35]];
    for (const [sx, sz] of scare) {
      raw('scarecrow', 'scarecrow', sx, sz, rand(-0.4, 0.4));
      for (let i = 0; i < 3; i++) raw('crow', 'crow', sx + rand(-3, 3), sz + rand(-3, 3), rand(0, 6));
      raw('crow', 'crow', sx, sz, rand(0, 6), { fly: { x: sx, z: sz, r: rand(5, 9), h: rand(5.5, 8.5), w: rand(0.5, 0.9) } });
    }
    for (let i = 0; i < 4; i++) raw('hay', 'hay', cx + rand(-hw, hw) * 0.9, cz + rand(-hd, hd) * 0.9, rand(0, 6));
  };
  field(46, -44, 18, 17);
  field(-2, -44, 19, 16);
  field(-38, 44, 16, 11);

  // Graveyard: far from the spawn, ghosts hidden underground ---------
  const G = { x: -54, z: -54, hw: 16, hd: 13 };
  region('grave', G.x, G.z, G.hw + 1, G.hd + 1);
  fenceRing('fence', ['fence_iron_1', 'fence_iron_2', 'fence_iron_3'], G.x, G.z, G.hw, G.hd, 5);
  const graves = ['gravestone_1', 'gravestone_2', 'gravestone_3'];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      if (rng() < 0.12) continue;
      raw('tombstone', pick(graves), G.x - 12.5 + c * 5 + rand(-0.8, 0.8), G.z - 9 + r * 6 + rand(-0.8, 0.8), rand(-0.25, 0.25));
    }
  }
  for (const [x, z] of [[-9, 7], [8, -7], [-2, -2], [12, 8], [-13, -6], [4, 5], [-6, -10]]) {
    raw('ghost', Math.abs(x) % 2 ? 'ghost_a' : 'ghost_b', G.x + x, G.z + z, rand(-0.5, 0.5), { hidden: true });
  }
  for (const [kind, model, x, z] of [['coffin', 'coffin', -3, 8.5], ['coffin', 'coffin', 9, 2.5], ['cauldron', 'cauldron', 0, -5],
    ['pillar', 'pillar', -15.5, -14.5], ['pillar', 'pillar', -11, -14.5], ['urn', 'urn', 3, -11], ['urn', 'urn', -14, 3],
    ['skull', 'wolf_skull', 7, 9], ['skull', 'wolf_skull', -9, 0], ['stone', 'stone', 13, -9], ['stone', 'stone', -12, 10],
    ['tree', 'tree_dead_3', -13, -11], ['tree', 'tree_dead_2', 12, -2], ['tree', 'tree_dead_1', 2, 10], ['tree', 'tree_dead_1', -5, -3]]) {
    raw(kind, model, G.x + x, G.z + z, rand(-3, 3));
  }
  for (const [x, z] of [[-10, -3], [6, -9], [10, 9]]) raw('lantern', pick(lantern), G.x + x, G.z + z, rand(0, 6), { pool: 'small' });

  // Picket yards around the farmhouses
  const yard = (cx, cz, hw, hd, gap) => fenceRing('fence', ['fence_picket'], cx, cz, hw, hd, gap);
  yard(32, 66, 12.2, 9.2, 1);
  yard(-30, 68, 12.2, 9.2, 1);

  // Pumpkin patches ------------------------------------------------
  for (const [cx, cz, n, r] of [[-12, 38, 7, 5], [28, 40, 8, 5.5], [24, -8, 6, 4.5], [-28, -18, 7, 5], [76, 6, 6, 4], [-74, -14, 6, 4]]) {
    scatter('pumpkin', pumpkin, n - 1, cx, cz, r, { tight: 0.7 });
    scatter('lantern', lantern, 1, cx, cz, r, { tight: 0.7, extra: () => ({ pool: 'small' }) });
  }
  // Hay around the barns, crows along the fields, odd bits and pieces
  scatter('hay', ['hay'], 7, 62, 28, 9);
  scatter('hay', ['hay'], 6, -60, 42, 9);
  scatter('crow', ['crow'], 7, 16, 2, 22);
  scatter('crow', ['crow'], 5, -22, -30, 14);
  for (let i = 0; i < 7; i++) {
    const cx = rand(-70, 70);
    const cz = rand(-70, 70);
    raw('crow', 'crow', cx, cz, 0, { fly: { x: cx, z: cz, r: rand(6, 12), h: rand(6, 9.5), w: rand(0.4, 0.8) } });
  }

  // Street lamps along the road -------------------------------------
  for (let s = 8; s < road.length; s += 29) {
    const p = road.sample(s);
    const side = Math.floor(s / 29) % 2 ? 1 : -1;
    const x = p.x - p.tz * side * (ROAD_HALF + 1.6);
    const z = p.z + p.tx * side * (ROAD_HALF + 1.6);
    if (blocks.some((b) => Math.hypot(b.x - x, b.z - z) < b.r)) continue;
    // Kit's lantern arm points along +X; swing it out over the road.
    raw('lamp', 'lamp', x, z, Math.atan2(p.tx * side, p.tz * side), { pool: 'lamp' });
    blocks.push({ x, z, r: 1 });
  }

  // Cars ------------------------------------------------------------
  const models = ['car_a', 'pickup_a', 'car_b', 'car_c', 'pickup_b', 'car_a', 'car_b'];
  models.forEach((model, i) => {
    const lane = i % 2;
    const count = lane ? 3 : 4;
    raw('car', model, 0, 0, 0, { lane, s: (Math.floor(i / 2) + rand(0.1, 0.4)) * road.length / count + lane * 37, pool: 'head' });
  });

  // Trees last, in whatever is still free. Keep the opening view of the farm clear.
  regions.push({ type: 'clear', x: 0, z: 68, hw: 20, hd: 22 });
  scatter('tree', ['tree_round', 'tree_round', 'pine', 'tree_dead_2', 'tree_dead_3', 'tree_dead_1'], 46, 0, 0, WORLD_HALF * 1.25, { tight: 0.45 });
  scatter('stone', ['stone'], 12, 0, 0, WORLD_HALF * 1.2);

  return { items, regions, warnings, graveyard: G };
}

// ---------------------------------------------------------------- environment
const hex = (h) => new THREE.Color(h);

function groundColor(x, z, road, layout, rng, out) {
  const n = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.09);
  let c;
  const reg = layout.regions.find((r) => Math.abs(x - r.x) < r.hw && Math.abs(z - r.z) < r.hd);
  if (road.distTo(x, z) < ROAD_HALF + 2.2) c = GROUND.shoulder;
  else if (reg?.type === 'field') c = GROUND.field;
  else if (reg?.type === 'pen') c = GROUND.pen;
  else if (reg?.type === 'grave') c = GROUND.grave;
  else c = out.copy(GROUND.grassA).lerp(GROUND.grassB, n);
  out.copy(c).multiplyScalar(0.9 + rng() * 0.2);
  return out;
}
const GROUND = {
  shoulder: hex('#57496a'), field: hex('#6b5238'), pen: hex('#54465a'), grave: hex('#2f2c55'),
  grassA: hex('#2a4a58'), grassB: hex('#3e4274'),
};

function buildTerrain(scene, road, layout) {
  const rng = mulberry(55);
  const SIZE = 300;
  const N = 110;
  const cell = SIZE / N;
  const vx = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const edge = i === 0 || j === 0 || i === N || j === N;
      const x = -SIZE / 2 + i * cell + (edge ? 0 : (rng() - 0.5) * cell * 0.55);
      const z = -SIZE / 2 + j * cell + (edge ? 0 : (rng() - 0.5) * cell * 0.55);
      vx.push([x, heightAt(x, z), z]);
    }
  }
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const tri = (a, b, d) => {
    pos.push(...a, ...b, ...d);
    groundColor((a[0] + b[0] + d[0]) / 3, (a[2] + b[2] + d[2]) / 3, road, layout, rng, c);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const a = vx[i * (N + 1) + j];
      const b = vx[i * (N + 1) + j + 1];
      const d = vx[(i + 1) * (N + 1) + j];
      const e = vx[(i + 1) * (N + 1) + j + 1];
      if ((i + j) % 2) { tri(a, b, d); tri(b, e, d); } else { tri(a, b, e); tri(a, e, d); }
    }
  }
  // Far hills: coarse polar rings out into the fog.
  const SEG = 48;
  const ring = (r, i) => {
    const a = (i / SEG) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const hill = r <= 212 ? -1 : (r - 212) * 0.05 * (1.4 + Math.sin(a * 5) + 0.6 * Math.sin(a * 11 + r));
    return [x, hill, z];
  };
  const dark = hex('#191a44');
  // Starts just under the square terrain's edge, so no sky shows through between the two.
  const radii = [140, 212, 300, 420, 600, 900];
  for (let k = 0; k < radii.length - 1; k++) {
    for (let i = 0; i < SEG; i++) {
      const a = ring(radii[k], i);
      const b = ring(radii[k], i + 1);
      const d = ring(radii[k + 1], i);
      const e = ring(radii[k + 1], i + 1);
      pos.push(...a, ...b, ...d, ...b, ...e, ...d);
      for (let v = 0; v < 6; v++) col.push(dark.r, dark.g, dark.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildRoad(scene, road) {
  const pos = [];
  const col = [];
  const asphalt = hex('#3b3752');
  const paint = hex('#d9bd7a');
  const quad = (a, b, c, d, color) => {
    pos.push(...a, ...b, ...c, ...b, ...d, ...c);
    for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
  };
  const n = road.nodes.length;
  const edge = (p, off, lift) => {
    const x = p.x - p.tz * off;
    const z = p.z + p.tx * off;
    return [x, heightAt(x, z) + lift, z];
  };
  for (let i = 0; i < n; i++) {
    const p = road.nodes[i];
    const q = road.nodes[(i + 1) % n];
    quad(edge(p, -ROAD_HALF, 0.07), edge(p, ROAD_HALF, 0.07), edge(q, -ROAD_HALF, 0.07), edge(q, ROAD_HALF, 0.07), asphalt);
    if (i % 3 === 0) quad(edge(p, -0.1, 0.1), edge(p, 0.1, 0.1), edge(q, -0.1, 0.1), edge(q, 0.1, 0.1), paint);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildSky(scene) {
  const sky = new THREE.Group();
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(1600, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 p; void main(){ p=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 p; void main(){
      float h = clamp(p.y, 0., 1.);
      vec3 c = mix(vec3(.060,.034,.135), vec3(.006,.006,.038), pow(h, .5));
      gl_FragColor = vec4(c, 1.); }`,
  })));
  const rng = mulberry(9);
  const sp = [];
  for (let i = 0; i < 700; i++) {
    const a = rng() * Math.PI * 2;
    const y = 0.04 + rng() * 0.96;
    const r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * r * 1500, y * 1500, Math.sin(a) * r * 1500);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sky.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: new THREE.Color(1.5, 1.5, 1.8), size: 1.8, sizeAttenuation: false, fog: false, depthWrite: false })));
  const moonDir = new THREE.Vector3(-0.42, 0.42, -1).normalize();
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(52, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.75, 1.62, 1.3), fog: false }));
  moon.position.copy(moonDir).multiplyScalar(1400);
  sky.add(moon);
  scene.add(sky);
  return sky;
}

function buildForest(scene, nodes) {
  // Unreachable tree line past the map edge, so the world doesn't just stop.
  const rng = mulberry(77);
  for (const [model, n] of [['pine', 170], ['tree_dead_3', 40], ['tree_round', 50]]) {
    for (const part of nodes[model]) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, n);
      const r2 = mulberry(model.length * 31);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const a = r2() * Math.PI * 2;
        const r = 122 + r2() * 85;
        const x = Math.cos(a) * r * (Math.abs(Math.cos(a)) > 0.7 ? 1.05 : 1);
        const z = Math.sin(a) * r;
        const s = 1 + r2() * 0.8;
        m.compose(new THREE.Vector3(x, heightAt(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r2() * 6), new THREE.Vector3(s, s, s));
        inst.setMatrixAt(i, m);
      }
      inst.frustumCulled = false;
      scene.add(inst);
    }
  }
  return rng;
}

function buildAura(scene, G) {
  // Sickly light column over the graveyard: a far-off beacon that says "something's over there".
  const g = new THREE.CylinderGeometry(5, 11, 60, 14, 1, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: 'varying float h; varying vec3 n; varying vec3 e; void main(){ h=uv.y; vec4 mv=modelViewMatrix*vec4(position,1.); n=normalMatrix*normal; e=-mv.xyz; gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'varying float h; varying vec3 n; varying vec3 e; void main(){ float f=pow(abs(dot(normalize(n),normalize(e))),2.5); gl_FragColor=vec4(vec3(.40,.20,.85)*pow(max(1.-h,0.),2.6)*f*.11,1.); }',
  });
  const m = new THREE.Mesh(g, mat);
  m.position.set(G.x, 30, G.z);
  scene.add(m);
}

export function buildEnvironment(scene, road, layout, nodes) {
  scene.fog = new THREE.FogExp2('#150f36', 0.0058);
  buildTerrain(scene, road, layout);
  buildRoad(scene, road);
  buildForest(scene, nodes);
  buildAura(scene, layout.graveyard);
  const sky = buildSky(scene);

  scene.add(new THREE.HemisphereLight('#a08ef0', '#4a3468', 1.4));
  const moon = new THREE.DirectionalLight('#c4ccff', 1.9);
  moon.position.set(-40, 80, 30);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = sc.bottom = -62;
  sc.right = sc.top = 62;
  sc.near = 5;
  sc.far = 240;
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.06;
  scene.add(moon, moon.target);
  return { sky, moon };
}
