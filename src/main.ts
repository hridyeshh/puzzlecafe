import * as THREE from 'three/webgpu';
import { cdl, float, pass, renderOutput, screenUV, smoothstep, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createAudio } from './audio.ts';
import { createAutodrive } from './autodrive.ts';
import { type CarName, GARAGE, PAINTS, createCarModel, createFlames, loadCar, turnWheels } from './car.ts';
import { LEVELS, type Level, createChase } from './chase.ts';
import { createDaylight, night, smog } from './daylight.ts';
import { createGarage } from './garage.ts';
import { createHud } from './hud.ts';
import { createMap } from './map.ts';
import { createOcean } from './ocean.ts';
import { createPoliceView } from './police.ts';
import { createCar, createWorld, type Intent } from './physics.ts';
import { blockMesh, createCityView, disposeBlocks, disposeProps, loadCityModels, propMeshes } from './city.ts';
import { disposeHouses, houseMesh } from './houses.ts';
import { disposePlants, plantMeshes } from './plants.ts';
import { ISLAND_X, loadModels, makeProp, makeSign } from './props.ts';
import { barrierSamples, createStreaming, townAt } from './streaming.ts';
import { CHUNK } from './world/chunk.ts';
import { inRiver } from './world/cities.ts';
import { laneOf } from './world/roads.ts';
import { createWeather, wet } from './weather.ts';
import { BIOMES, type Biome, biomeAt, cityStart, findPlace, regionAt } from './world/places.ts';
import { makeWorld } from './world/world.ts';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 1);
// Quality: ?q=low|medium|high. Medium on computers, low on phones and tablets (no mouse or trackpad).
const touch = !matchMedia('(any-pointer: fine)').matches;
const PRESETS = {
  low: { dpr: 1, shadows: 0, far: 6 },
  medium: { dpr: 1.5, shadows: 2048, far: 9 },
  high: { dpr: 2, shadows: 4096, far: 9 },
};
const quality = PRESETS[params.get('q') as keyof typeof PRESETS] ?? (touch ? PRESETS.low : PRESETS.medium);
const REBASE = 1024; // m the car may get from the origin before the world shifts back under it
const DT = 1 / 60; // fixed physics step

// The main thread keeps its own world for heights, autodrive and the map; workers build the tiles.
const world = makeWorld(SEED);
// Floating origin: world position of local (0, 0), kept in float64 and a multiple of CHUNK.
// Meshes and physics live in local coordinates so float32 never sees big numbers.
const origin = { x: 0, z: 0 };

// ---------- renderer and scene

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.has('webgl') });
try {
  await renderer.init();
} catch (error) {
  document.body.textContent = 'puzzlecafe needs WebGPU or WebGL 2, and this browser could not start either.';
  throw error;
}
const DPR = Math.min(devicePixelRatio, quality.dpr);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = quality.shadows > 0 && params.get('shadows') !== '0';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 5000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Time of day: starts late afternoon (?t=hours picks), one game hour every two real minutes (slower around sunrise and
// sunset); T skips an hour.
let hours = Number(params.get('t') ?? 16.5) % 24;
const daylight = createDaylight(renderer, scene, { shadowSize: quality.shadows || 512, fogFar: (quality.far + 0.5) * CHUNK });
const ocean = createOcean(daylight.seaEnvironment);
// ?weather=clear|cloudy|fog|rain|snow (N for the next); ?season=spring|summer|autumn|winter (G for the next).
const weather = createWeather(scene, params.get('weather'), params.get('season'));
scene.add(ocean.mesh);
// Render through a pipeline: bright things (sun on the water, lights at night) bloom; then, after tone mapping, a grade
// like the concept art's (warm highlights, cool lifted shadows, a little more colour) and a soft vignette.
const pipeline = new THREE.RenderPipeline(renderer);
// MSAA: 4 samples on a 1x screen; at 1.5x and up the pixels are fine enough for 2, which costs ~2.5 ms less a frame
// (2880×1620: 86 fps against 71 with the GPU unthrottled).
const hdr = pass(scene, camera, { samples: DPR > 1 ? 2 : 4 }).getTextureNode('output');
const glow = bloom(hdr, 0.3, 0.4, 1);
pipeline.outputColorTransform = false;
const graded = cdl(renderOutput(hdr.add(glow)), vec3(1.04, 1, 0.95), vec3(0.002, 0.004, 0.008), vec3(1), float(1.1));
pipeline.outputNode = vec4(graded.rgb.mul(smoothstep(0.35, 0.85, screenUV.sub(0.5).length()).mul(0.28).oneMinus()), 1);

// ---------- terrain tiles, streamed around the car

const models = loadModels(); // before any tile makes a prop
const physics = await createWorld();
const tiles = createStreaming(scene, physics, origin, SEED, quality.far);
// Prakashi's river, ghats, spires, towers and light-forms (its streets and buildings stream in with the tiles).
const city = world.fields.city;
const cityView = city && world.buildings ? createCityView(scene, physics, city, world.buildings, origin, await loadCityModels().catch(() => null)) : null;
if (city) townAt.value.set(city.x, city.z, city.ring, city.level);

// Start in the right lane of the coast road; at ?at=x,z,yaw; or on the nearest road in ?place=coast|country|mountains|
// desert to ?from=x,z (the spawn if not given). The origin moves there.
const at = params.get('at')?.split(',').map(Number);
const place = params.get('place') as Biome | null;
const from = params.get('from')?.split(',').map(Number);
const spawn = world.spawn();
const start =
  at?.length === 3 && at.every(Number.isFinite)
    ? { x: at[0], z: at[1], yaw: at[2] }
    : (place as string) === 'city'
      ? (cityStart(world) ?? spawn)
      : place && (BIOMES as string[]).includes(place) && place !== 'sea'
        ? (findPlace(world, place, from?.[0] ?? spawn.x, from?.[1] ?? spawn.z) ?? spawn)
        : spawn;
origin.x = Math.floor(start.x / CHUNK) * CHUNK;
origin.z = Math.floor(start.z / CHUNK) * CHUNK;
await models;
while (!tiles.ready(start.x, start.z)) {
  tiles.update(start.x, start.z, 50);
  await new Promise((resolve) => setTimeout(resolve, 16));
}

// ---------- the car: physics body plus its model: a garage car (?car=roadster|coupe|…, else the one last picked in the
// garage, else the coupé), or the built-in roadster in a paint (?car=champagne|green|silver|red, or if a model fails)

// Just above where it rests on its springs (0.77 m): dropped from higher it lands rolling, too fast for the hold on a ramp.
const SET_DOWN = 0.9;
const car = createCar(physics, start.x - origin.x, ((start as { h?: number }).h ?? world.heightAt(start.x, start.z)) + SET_DOWN, start.z - origin.z, start.yaw);
/** A setting kept in localStorage, where storage allows. */
function kept(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null; // no storage: the default
  }
}
let carName = params.get('car') ?? kept('puzzlecafe.car') ?? 'coupe';
const garageCar = carName in GARAGE ? await loadCar(carName as CarName).catch(() => null) : null;
const first = garageCar ?? createCarModel(carName in PAINTS ? (carName as keyof typeof PAINTS) : 'champagne');
let carModel = first.group;
let wheels = first.wheels;
const headlight = first.beam; // kept across car swaps: a new light would recompile every lit material
const tail = () => new THREE.Box3().setFromObject(carModel).min.z + 0.05; // with the model unmoved, in its own frame
let flames = createFlames(tail());
carModel.add(flames);
scene.add(carModel);

/** Drive another garage car from here on (the garage's Enter): its model in place of this one, on the same body. */
async function swapCar(name: CarName) {
  const next = await loadCar(name).catch(() => null);
  if (!next) return;
  scene.remove(carModel);
  next.group.remove(next.beam, next.beam.target);
  headlight.position.copy(next.beam.position);
  next.group.add(headlight, headlight.target);
  [carModel, wheels, carName] = [next.group, next.wheels, name];
  flames = createFlames(tail());
  carModel.add(flames);
  carModel.position.copy(currPos);
  carModel.quaternion.copy(currQuat);
  scene.add(carModel);
  kept('puzzlecafe.car', name);
  await renderer.compileAsync(scene, camera);
}

// ---------- fixed-step physics, interpolated for rendering

const prevPos = new THREE.Vector3();
const currPos = new THREE.Vector3();
const prevQuat = new THREE.Quaternion();
const currQuat = new THREE.Quaternion();
function snapshot() {
  const t = car.body.translation();
  const r = car.body.rotation();
  currPos.set(t.x, t.y, t.z);
  currQuat.set(r.x, r.y, r.z, r.w);
}
snapshot();
prevPos.copy(currPos);
prevQuat.copy(currQuat);
const heading = new THREE.Vector3();
const carYaw = () => {
  heading.set(0, 0, 1).applyQuaternion(currQuat);
  return Math.atan2(heading.x, heading.z);
};

// ---------- driving: input, autodrive, fuel, HUD, map

let hood = false;
let auto = touch || params.has('auto'); // Q: the car drives itself until a drive key is pressed; phones start in it
const cruise = Number(params.get('cruise') ?? 22); // m/s autodrive keeps to (?cruise= for soak tests at speed)
const TANK = 45_000; // m a full tank lasts at a steady cruise
let fuel = Math.min(1, Math.max(0, Number(params.get('fuel') ?? 1)));
let zen = params.has('zen'); // Z: endless fuel
let nitro = 1; // Shift: the boost tank, 0–1
const hud = createHud();
// Chase mode (P): police, then a helicopter, chase you. Off unless picked on the landing page or with
// ?chase=easy|normal|hard; P switches it on (at the level last picked, else normal) and off.
const chase = createChase(physics, world, origin, car, rescue);
const police = createPoliceView(scene, chase, renderer, camera);
const picked = params.get('chase') ?? kept('puzzlecafe.chase');
if (picked && picked in LEVELS) chase.set(picked as Level);
const garage = createGarage(renderer, swapCar);
// Travelling (the map's buttons and pins) starts the drive again there, at the same hour and in the same season.
const map = createMap(world, (where) => {
  location.search = `?play&${where}&from=${Math.round(currPos.x + origin.x)},${Math.round(currPos.z + origin.z)}&t=${hours.toFixed(2)}&season=${weather.season}&car=${carName}&chase=${chase.level ?? 'off'}`;
});
const autodrive = createAutodrive(world);
const audio = createAudio();
const DRIVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyB' && !map.open) {
    if (garage.open) garage.close();
    else void garage.show(carName);
  }
  if (garage.open) return; // its own keys
  keys.add(e.code);
  if (DRIVE_KEYS.includes(e.code)) auto = false;
  if (e.code === 'KeyQ') auto = !auto;
  if (e.code === 'KeyC') hood = !hood;
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyT') hours = (hours + 1) % 24;
  if (e.code === 'KeyZ') zen = !zen;
  if (e.code === 'KeyM') map.toggle(currPos.x + origin.x, currPos.z + origin.z, carYaw());
  if (e.code === 'Escape') map.close();
  if (e.code === 'KeyV') audio.toggle();
  if (e.code === 'KeyP') {
    const level = picked && picked in LEVELS ? (picked as Level) : 'normal';
    chase.set(chase.level ? null : level);
    hud.place(chase.level ? `Chase mode: ${chase.level}` : 'Chase mode off');
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const held = (...codes: string[]) => codes.some((code) => keys.has(code));

function readIntent(): Intent {
  let steer = (held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0);
  let throttle = held('KeyW', 'ArrowUp') ? 1 : 0;
  let brake = held('KeyS', 'ArrowDown', 'Space') ? 1 : 0;
  const pad = navigator.getGamepads().find((p) => p);
  if (pad) {
    const x = pad.axes[0] ?? 0;
    if (Math.abs(x) > 0.12) steer = -x; // stick right means steer right
    throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
    brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
  }
  const boost = held('ShiftLeft', 'ShiftRight') || !!pad?.buttons[0]?.pressed ? 1 : 0;
  return { steer, throttle, brake, boost };
}

/** Is the car beside a pump island of a loaded petrol station? Islands sit at (±ISLAND_X, 3) in the station's frame. */
function atPump(): boolean {
  const wx = currPos.x + origin.x;
  const wz = currPos.z + origin.z;
  for (const s of tiles.stations()) {
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    for (const ix of [-ISLAND_X, ISLAND_X]) {
      if (Math.hypot(s.x + ix * cos + 3 * sin - wx, s.z - ix * sin + 3 * cos - wz) < 6.5) return true;
    }
  }
  return false;
}

/** Set the car down, still, at local (x, y, z) heading `yaw`. */
function put(x: number, y: number, z: number, yaw: number) {
  car.body.setTranslation({ x, y, z }, true);
  car.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/** Put the car back on its wheels where it is, keeping its heading. */
function resetCar() {
  const p = car.body.translation();
  put(p.x, world.heightAt(p.x + origin.x, p.z + origin.z) + 1.5, p.z, carYaw());
}

/** A car that ends up in the sea goes back to the right lane of the nearest road. */
function rescue() {
  const wx = currPos.x + origin.x;
  const wz = currPos.z + origin.z;
  const p = world.area(Math.floor(wx / CHUNK), Math.floor(wz / CHUNK)).index.closest(wx, wz);
  if (!p) return;
  put(p.x - p.tz * laneOf(p) - origin.x, p.h + SET_DOWN, p.z + p.tx * laneOf(p) - origin.z, Math.atan2(p.tx, p.tz));
  snapshot();
  prevPos.copy(currPos);
  prevQuat.copy(currQuat);
}

// ---------- camera

const forward = new THREE.Vector3();
const target = new THREE.Vector3();
const look = currPos.clone();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
camera.position.set(currPos.x - Math.sin(start.yaw) * 8, currPos.y + 3, currPos.z - Math.cos(start.yaw) * 8);

function updateCamera(dt: number) {
  if (hood) {
    camera.position.set(0, 0.75, 0.6).applyQuaternion(carModel.quaternion).add(carModel.position);
    camera.quaternion.copy(carModel.quaternion).multiply(FLIP); // cameras look down -z, the car faces +z
    return;
  }
  forward.set(0, 0, 1).applyQuaternion(carModel.quaternion).setY(0).normalize();
  target.copy(carModel.position).addScaledVector(forward, -7.5).setY(carModel.position.y + 2.6);
  camera.position.lerp(target, 1 - Math.exp(-6 * dt));
  const floor = world.heightAt(camera.position.x + origin.x, camera.position.z + origin.z) + 1;
  if (camera.position.y < floor) camera.position.y = floor;
  target.copy(carModel.position).addScaledVector(forward, 4).setY(carModel.position.y + 1);
  look.lerp(target, 1 - Math.exp(-12 * dt));
  camera.lookAt(look);
}

/** Shift the world back under the car once it is far from the origin. */
function rebase() {
  const sx = Math.round(currPos.x / CHUNK) * CHUNK;
  const sz = Math.round(currPos.z / CHUNK) * CHUNK;
  origin.x += sx;
  origin.z += sz;
  const t = car.body.translation();
  car.body.setTranslation({ x: t.x - sx, y: t.y, z: t.z - sz }, true);
  for (const v of [prevPos, currPos, camera.position, look]) {
    v.x -= sx;
    v.z -= sz;
  }
  tiles.shift(sx, sz);
  chase.shift(sx, sz);
}

// ---------- ?debug overlay, and a log of slow frames with where their time went

// CPU ms per part of the last frame; a slow frame is blamed on the frame before it.
const laps = { drive: 0, physics: 0, world: 0, camera: 0, light: 0, tiles: 0, render: 0 };
let lapAt = 0;
function lap(part: keyof typeof laps) {
  const t = performance.now();
  laps[part] = t - lapAt;
  lapAt = t;
}

const debug = params.has('debug') ? debugOverlay() : null;
function debugOverlay() {
  const el = document.body.appendChild(document.createElement('pre'));
  el.id = 'debug';
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  let frames = 0;
  let since = performance.now();
  let worst = 0;
  const slow: Record<string, number>[] = []; // frames over 25 ms: when, how long, and the laps before them
  const totals = { frames: 0, over25: 0, over50: 0 };
  let before = { ...laps };
  Object.assign(globalThis, { puzzlecafe: { renderer, scene, camera, origin, world, car, physics, chase, garage, tiles, slow, totals } }); // for devtools and soak tests
  return (now: number, dt: number) => {
    const ms = dt * 1000;
    totals.frames++;
    if (ms > 25) {
      totals.over25++;
      if (ms > 50) totals.over50++;
      slow.push({ at: Math.round(now), ms: Math.round(ms), ...Object.fromEntries(Object.entries(before).map(([k, v]) => [k, Math.round(v * 10) / 10])) });
      if (slow.length > 500) slow.shift();
    }
    before = { ...laps };
    frames++;
    worst = Math.max(worst, dt);
    if (now - since < 500) return;
    const { drawCalls, triangles } = renderer.info.render;
    el.textContent =
      `${backend}  ${Math.round((frames * 1000) / (now - since))} fps  worst ${(worst * 1000).toFixed(1)} ms\n` +
      `draws ${drawCalls}  tris ${Math.round(triangles / 1000)}k  tiles ${tiles.count}  res ${Math.round(scale * 100)}%\n` +
      `${Math.round(car.speed() * 3.6)} km/h  x ${Math.round(carModel.position.x + origin.x)}  z ${Math.round(carModel.position.z + origin.z)}  seed ${SEED}  ` +
      `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}${auto ? '  auto' : ''}`;
    frames = 0;
    since = now;
    worst = 0;
  };
}

// ---------- warm-up, while the landing page still shows

// Compile the shaders of everything that streams in later (props, plants), so nothing stalls when it first comes into view.
const warm = new THREE.Group();
for (const [kind, pick] of [['cafe', 0], ['station', 0], ['hoarding', 0], ['hoarding', 16], ['bookstore', 0]] as const) {
  warm.add(makeProp({ kind, x: 0, z: 0, h: 0, yaw: 0, pad: 0, pick }).object); // pick 0 is the tall board, 16 the small one
}
const warmPlants = plantMeshes(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 3]));
const warmBarriers = barrierSamples();
const warmHouses = houseMesh(new Float32Array([0, 0, 0, 0, 8, 6.3, 6, 0.5]));
const warmBlocks = blockMesh(new Float32Array([0, 0, 12, 0, 10, 13, 12, 0.5]));
const warmKit = propMeshes(new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 4, 4])); // a tank, and a sign (its own shader)
warm.add(...warmPlants, ...warmBarriers, warmHouses, warmBlocks, ...warmKit);
for (let kind = 0; kind < 6; kind++) warm.add(makeSign(kind).object);
for (const variant of ['country', 'mountains', 'desert']) warm.add(makeProp({ kind: 'cafe', x: 0, z: 0, h: 0, yaw: 0, pad: 0, pick: 0, variant }).object);
warm.add(...police.warmers());
flames.visible = true; // and the nitro's
warm.position.copy(currPos);
warm.traverse((o) => (o.frustumCulled = false));
scene.add(warm);
cityView?.warm(true);
// Pose everything as the first frame will see it: the car, the camera, the sky and the sea around them.
carModel.position.copy(currPos);
carModel.quaternion.copy(currQuat);
updateCamera(1);
daylight.update(hours, camera.position, currPos);
ocean.follow(camera.position.x, camera.position.z, origin);
await renderer.compileAsync(scene, camera);
pipeline.render();
physics.step(); // the first step builds the collision tree for every collider loaded so far
scene.remove(warm);
cityView?.warm(false);
flames.visible = false;
for (const m of warmPlants) disposePlants(m);
for (const b of warmBarriers) b.geometry.dispose();
disposeHouses(warmHouses);
disposeBlocks(warmBlocks);
for (const m of warmKit) disposeProps(m);

// ---------- loop

let acc = 0;
let last = performance.now();
let shown = 0; // when the last frame was drawn (the frame's timestamp)
let region = '';
let regionCheck = 0;
let here: Biome = 'coast';
let season = '';
renderer.setAnimationLoop((time) => {
  // At most one frame per ~1/60 s: on a 120 Hz screen a GPU that manages 70–110 fps shows frames at uneven intervals,
  // which reads as stutter (and keeps a fanless laptop hot). 120 Hz draws every other refresh, 144 Hz at 72 fps; 90 Hz
  // and below draw every refresh.
  if (time - shown < 10) return;
  shown = time;
  const now = performance.now();
  const interval = (now - last) / 1000;
  const dt = Math.min(interval, 0.1);
  last = now;
  lapAt = now;
  if (garage.open) {
    garage.render(dt); // the drive waits
    return;
  }
  let intent = readIntent();
  if (auto) intent = { ...(autodrive.drive(currPos.x + origin.x, currPos.z + origin.z, carYaw(), car.speed(), null, cruise) ?? intent), boost: intent.boost };
  if (!zen && fuel <= 0 && car.speed() > 5.5) intent = { ...intent, throttle: 0 }; // empty: limp at 20 km/h
  if (chase.phase === 'busted') intent = { steer: 0, throttle: 0, brake: 0 }; // held where they stopped you
  // Nitro: with the throttle down it lasts ~4 s and refills over ~20 s.
  const boosting = !!intent.boost && intent.throttle > 0 && nitro > 0;
  nitro = boosting ? Math.max(0, nitro - dt / 4) : Math.min(1, nitro + dt / 20);
  intent.boost = boosting ? 1 : 0;
  const said = chase.update(dt);
  if (said) hud.place(said === 'police' ? 'Police' : said === 'busted' ? 'Busted' : `Escaped after ${clock(chase.time)}`);
  lap('drive');
  acc += dt;
  while (acc >= DT) {
    prevPos.copy(currPos);
    prevQuat.copy(currQuat);
    car.update(intent, DT);
    chase.step(DT);
    physics.step();
    snapshot();
    chase.snapshot();
    acc -= DT;
  }
  if (currPos.y < -2 || (city && currPos.y < city.water - 0.5 && inRiver(city, currPos.x + origin.x, currPos.z + origin.z))) rescue();
  if (Math.abs(currPos.x) > REBASE || Math.abs(currPos.z) > REBASE) rebase();
  lap('physics');

  // Fuel burns with distance (more on the throttle); hold F beside a pump to fill up.
  const v = car.speed();
  if (!zen) fuel = Math.max(0, fuel - ((Math.abs(v) * dt) / TANK) * (0.5 + 0.5 * intent.throttle));
  let message = '';
  if (Math.abs(v) < 1 && atPump()) {
    if (held('KeyF') && fuel < 1) fuel = Math.min(1, fuel + 0.25 * dt);
    message = fuel >= 1 ? 'Tank full' : held('KeyF') ? `Refuelling… ${Math.round(fuel * 100)}%` : 'Hold F to refuel';
  } else if (chase.phase === 'busted') message = 'Busted';
  else if (chase.heat && chase.bust > 0.05) message = 'Stopped beside the police: get moving!';
  else if (chase.heat && chase.lost > 0) message = `Out of sight: ${Math.ceil(chase.escape - chase.lost)} s to lose them`;
  else if (chase.heat) message = 'Lose the police: break their line of sight';
  else if (chase.phase === 'chase') message = 'Sirens: the police are coming';
  else if (!zen && fuel <= 0) message = 'Out of fuel: limping at 20 km/h to the next pump';
  else if (!zen && fuel < 0.2) message = 'Fuel low: look out for a FUEL sign';
  else if (auto) message = touch ? 'Autodrive' : 'Autodrive: press any drive key to take over';
  hud.update(v * 3.6, zen ? null : fuel, hours, message, nitro);
  hud.wanted(chase.heat, chase.time, chase.lost > 0);
  // Waves are loud on the beach road and gone ~1 km inland.
  const coast = world.fields.continent(currPos.x + origin.x, currPos.z + origin.z);
  audio.update(v, intent.throttle, 1 - Math.min(1, Math.max(0, (coast - 0.02) / 0.4)), wet.value);
  const near = chase.units.reduce((d, u) => Math.min(d, Math.hypot(u.curr[0] - currPos.x, u.curr[2] - currPos.z)), Infinity);
  const heli = chase.heli ? Math.hypot(chase.heli.x - currPos.x, chase.heli.y - currPos.y, chase.heli.z - currPos.z) : Infinity;
  audio.chase(Math.max(0, 1 - near / 250) ** 1.5, Math.max(0, 1 - heli / 450), boosting ? 1 : 0);
  if (map.open) map.follow(currPos.x + origin.x, currPos.z + origin.z, carYaw());
  // Entering a new region: its name, for a few seconds. Checked about once a second.
  if (now - regionCheck > 1000) {
    regionCheck = now;
    const r = regionAt(world.fields, currPos.x + origin.x, currPos.z + origin.z);
    here = biomeAt(world.fields, currPos.x + origin.x, currPos.z + origin.z);
    if (r.id !== region) {
      region = r.id;
      if (r.name) hud.place(r.name);
    }
    if (weather.season !== season) {
      if (season) hud.place(weather.season[0].toUpperCase() + weather.season.slice(1));
      season = weather.season;
    }
  }
  weather.update(dt, (dt / 120) * daylight.pace, here, currPos.y);
  lap('world');

  const alpha = acc / DT;
  carModel.position.lerpVectors(prevPos, currPos, alpha);
  carModel.quaternion.slerpQuaternions(prevQuat, currQuat, alpha);
  turnWheels(wheels, car.vehicle);
  police.update(alpha, dt, carModel.position);
  flames.visible = boosting;
  if (boosting) for (const f of flames.children) f.scale.set(1, 1, 0.6 + Math.random() * 0.7);
  // The boost widens the view.
  camera.fov += ((boosting ? 66 : 60) - camera.fov) * (1 - Math.exp(-4 * dt)); // wider costs the GPU: 66° shows ~1.25× the scene
  camera.updateProjectionMatrix();
  updateCamera(dt);
  cityView?.update(camera, dt);
  // The city's smog: thickest inside its ring, thinning out over 2.5 km beyond it.
  smog.value = city ? 1 - THREE.MathUtils.smoothstep(Math.hypot(camera.position.x + origin.x - city.x, camera.position.z + origin.z - city.z), city.ring, city.ring + 2500) : 0;
  lap('camera');
  hours = (hours + (dt / 120) * daylight.pace) % 24;
  daylight.update(hours, camera.position, carModel.position);
  headlight.intensity = night.value * 150;
  // Bloom is for lights at night; by day it only catches the sun on the water.
  glow.strength.value = 0.1 + night.value * 0.75;
  glow.threshold.value = 1.4 - night.value * 0.6;
  ocean.follow(camera.position.x, camera.position.z, origin);
  lap('light');
  tiles.update(carModel.position.x + origin.x, carModel.position.z + origin.z);
  lap('tiles');

  if (!map.open) pipeline.render(); // the map covers the whole screen
  lap('render');
  adapt(interval, now);
  debug?.(now, interval);
});

// Dynamic resolution: when frames run long (a slower GPU, a big screen) draw fewer pixels, down to half; draw more again
// once there is room. Judged once a second from the average frame interval, so a single hitch changes nothing. A scale
// that proved too slow is not tried again for a minute, so a GPU at its limit (a hard chase, a hot fanless laptop)
// settles just under it instead of swinging back into slow frames every few seconds.
let scale = 1;
let average = 1 / 60;
let judged = 0;
let calm = 0;
let ceiling = 1; // the last scale found too slow
let ceilingUntil = 0;
function adapt(interval: number, now: number) {
  average += (Math.min(interval, 0.1) - average) * 0.05;
  if ((judged += interval) < 1) return;
  judged = 0;
  calm = average < 1 / 58 ? calm + 1 : 0;
  let next = scale;
  if (average > 1 / 52) {
    [ceiling, ceilingUntil] = [scale, now + 60_000];
    next = Math.max(0.5, scale * 0.85);
  } else if (calm >= 4) next = Math.min(now < ceilingUntil ? ceiling * 0.95 : 1, scale * 1.1);
  if (Math.abs(next - scale) < 0.01) return;
  scale = next;
  renderer.setPixelRatio(DPR * scale);
}

/** m:ss */
function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
