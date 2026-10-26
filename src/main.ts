import * as THREE from 'three/webgpu';
import { color, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createAudio } from './audio.ts';
import { createAutodrive } from './autodrive.ts';
import { createDaylight, night } from './daylight.ts';
import { createHud } from './hud.ts';
import { createMap } from './map.ts';
import { createOcean } from './ocean.ts';
import { createCar, createWorld, type Intent } from './physics.ts';
import { createStreaming } from './streaming.ts';
import { CHUNK } from './world/chunk.ts';
import { LANE } from './world/roads.ts';
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
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr));
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

// Time of day: starts late afternoon (?t=hours picks), one game hour every two real minutes; T skips an hour.
let hours = Number(params.get('t') ?? 16.5) % 24;
const daylight = createDaylight(renderer, scene, { shadowSize: quality.shadows || 512, fogFar: (quality.far + 0.5) * CHUNK });
const ocean = createOcean();
scene.add(ocean.mesh);
// Render through a pipeline so bright things (sun on the water, lights at night) bloom.
const pipeline = new THREE.RenderPipeline(renderer);
const hdr = pass(scene, camera).getTextureNode('output');
const glow = bloom(hdr, 0.3, 0.4, 1);
pipeline.outputNode = hdr.add(glow);

// ---------- terrain tiles, streamed around the car

const physics = await createWorld();
const tiles = createStreaming(scene, physics, origin, SEED, quality.far);

// Start in the right lane of the coast road, or at ?at=x,z,yaw, with the origin moved there.
const at = params.get('at')?.split(',').map(Number);
const start = at?.length === 3 && at.every(Number.isFinite) ? { x: at[0], z: at[1], yaw: at[2] } : world.spawn();
origin.x = Math.floor(start.x / CHUNK) * CHUNK;
origin.z = Math.floor(start.z / CHUNK) * CHUNK;
while (!tiles.ready(start.x, start.z)) {
  tiles.update(start.x, start.z, 50);
  await new Promise((resolve) => setTimeout(resolve, 16));
}

// ---------- the car: physics body plus a placeholder model

const car = createCar(physics, start.x - origin.x, world.heightAt(start.x, start.z) + 1.2, start.z - origin.z, start.yaw);
const carModel = new THREE.Group();
const paint = new THREE.MeshStandardMaterial({ color: 0xb8432f, roughness: 0.35, metalness: 0.3 });
const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6 });
const shell = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 4.2), paint);
shell.position.y = 0.05;
const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 2.1), dark);
cabin.position.set(0, 0.55, -0.25);
const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20).rotateZ(Math.PI / 2);
const wheels = Array.from({ length: 4 }, () => new THREE.Mesh(wheelGeometry, dark));
for (const part of [shell, cabin, ...wheels]) {
  part.castShadow = true;
  carModel.add(part);
}
for (const wheel of wheels) wheel.rotation.order = 'YXZ'; // spin about the axle, then steer
// Lamps glow at night; the headlight beam is one spotlight between them.
const headLamp = new THREE.MeshStandardNodeMaterial({ color: 0x222222 });
headLamp.emissiveNode = color(0xfff3dd).mul(night.mul(6).add(0.15));
const tailLamp = new THREE.MeshStandardNodeMaterial({ color: 0x220806 });
tailLamp.emissiveNode = color(0xff2a14).mul(night.mul(3).add(0.1));
for (const side of [-1, 1]) {
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.04), headLamp);
  head.position.set(side * 0.62, 0.12, 2.11);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.04), tailLamp);
  tail.position.set(side * 0.62, 0.15, -2.11);
  carModel.add(head, tail);
}
const headlight = new THREE.SpotLight(0xfff1d6, 0, 90, 0.55, 0.5, 1.3);
headlight.position.set(0, 0.4, 2.2);
headlight.target.position.set(0, -0.6, 20);
carModel.add(headlight, headlight.target);
scene.add(carModel);

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
const TANK = 45_000; // m a full tank lasts at a steady cruise
let fuel = Math.min(1, Math.max(0, Number(params.get('fuel') ?? 1)));
let zen = params.has('zen'); // Z: endless fuel
const hud = createHud();
const map = createMap(world);
const autodrive = createAutodrive(world);
const audio = createAudio();
const DRIVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
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
  return { steer, throttle, brake };
}

/** Is the car beside a pump island of a loaded petrol station? Islands sit at (±2.6, 3) in the station's frame. */
function atPump(): boolean {
  const wx = currPos.x + origin.x;
  const wz = currPos.z + origin.z;
  for (const s of tiles.stations()) {
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    for (const ix of [-2.6, 2.6]) {
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
  put(p.x - p.tz * LANE - origin.x, p.h + 1.2, p.z + p.tx * LANE - origin.z, Math.atan2(p.tx, p.tz));
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
}

// ---------- ?debug overlay

const debug = params.has('debug') ? debugOverlay() : null;
if (debug) Object.assign(globalThis, { puzzlecafe: { scene, origin, world } }); // for poking at from devtools
function debugOverlay() {
  const el = document.body.appendChild(document.createElement('pre'));
  el.id = 'debug';
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  let frames = 0;
  let since = performance.now();
  let worst = 0;
  return (now: number, dt: number) => {
    frames++;
    worst = Math.max(worst, dt);
    if (now - since < 500) return;
    const { drawCalls, triangles } = renderer.info.render;
    el.textContent =
      `${backend}  ${Math.round((frames * 1000) / (now - since))} fps  worst ${(worst * 1000).toFixed(1)} ms\n` +
      `draws ${drawCalls}  tris ${Math.round(triangles / 1000)}k  tiles ${tiles.count}\n` +
      `${Math.round(car.speed() * 3.6)} km/h  x ${Math.round(carModel.position.x + origin.x)}  z ${Math.round(carModel.position.z + origin.z)}  seed ${SEED}  ` +
      `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}${auto ? '  auto' : ''}`;
    frames = 0;
    since = now;
    worst = 0;
  };
}

// ---------- loop

let acc = 0;
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  let intent = readIntent();
  if (auto) intent = autodrive.drive(currPos.x + origin.x, currPos.z + origin.z, carYaw(), car.speed()) ?? intent;
  if (!zen && fuel <= 0 && car.speed() > 5.5) intent = { ...intent, throttle: 0 }; // empty: limp at 20 km/h
  acc += dt;
  while (acc >= DT) {
    prevPos.copy(currPos);
    prevQuat.copy(currQuat);
    car.update(intent, DT);
    physics.step();
    snapshot();
    acc -= DT;
  }
  if (currPos.y < -2) rescue();
  if (Math.abs(currPos.x) > REBASE || Math.abs(currPos.z) > REBASE) rebase();

  // Fuel burns with distance (more on the throttle); hold F beside a pump to fill up.
  const v = car.speed();
  if (!zen) fuel = Math.max(0, fuel - ((Math.abs(v) * dt) / TANK) * (0.5 + 0.5 * intent.throttle));
  let message = '';
  if (Math.abs(v) < 1 && atPump()) {
    if (held('KeyF') && fuel < 1) fuel = Math.min(1, fuel + 0.25 * dt);
    message = fuel >= 1 ? 'Tank full' : held('KeyF') ? `Refuelling… ${Math.round(fuel * 100)}%` : 'Hold F to refuel';
  } else if (!zen && fuel <= 0) message = 'Out of fuel: limping at 20 km/h to the next pump';
  else if (!zen && fuel < 0.2) message = 'Fuel low: look out for a FUEL sign';
  else if (auto) message = touch ? 'Autodrive' : 'Autodrive: press any drive key to take over';
  hud.update(v * 3.6, zen ? null : fuel, hours, message);
  // Waves are loud on the beach road and gone ~1 km inland.
  const coast = world.fields.continent(currPos.x + origin.x, currPos.z + origin.z);
  audio.update(v, intent.throttle, 1 - Math.min(1, Math.max(0, (coast - 0.02) / 0.4)));
  if (map.open) map.follow(currPos.x + origin.x, currPos.z + origin.z, carYaw());

  const alpha = acc / DT;
  carModel.position.lerpVectors(prevPos, currPos, alpha);
  carModel.quaternion.slerpQuaternions(prevQuat, currQuat, alpha);
  for (let i = 0; i < wheels.length; i++) {
    const hardpoint = car.vehicle.wheelChassisConnectionPointCs(i);
    if (!hardpoint) continue;
    wheels[i].position.set(hardpoint.x, hardpoint.y - (car.vehicle.wheelSuspensionLength(i) ?? 0), hardpoint.z);
    wheels[i].rotation.y = car.vehicle.wheelSteering(i) ?? 0;
    wheels[i].rotation.x = car.vehicle.wheelRotation(i) ?? 0;
  }
  updateCamera(dt);
  hours = (hours + dt / 120) % 24;
  daylight.update(hours, camera.position, carModel.position);
  headlight.intensity = night.value * 150;
  // Bloom is for lights at night; by day it only catches the sun on the water.
  glow.strength.value = 0.1 + night.value * 0.75;
  glow.threshold.value = 1.4 - night.value * 0.6;
  ocean.follow(camera.position.x, camera.position.z, origin);
  tiles.update(carModel.position.x + origin.x, carModel.position.z + origin.z);

  pipeline.render();
  debug?.(now, dt);
});
