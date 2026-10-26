import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { RAPIER, addTerrain, createCar, createWorld, type Intent } from './physics.ts';
import { CHUNK, N, RES, STEP, colliderHeights, makeHeight, sampleChunk } from './world.ts';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 1);
const RING = 3; // chunks kept loaded in each direction around the car
const REBASE = 1024; // m the car may get from the origin before the world shifts back under it
const DT = 1 / 60; // fixed physics step

const height = makeHeight(SEED);
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
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// A fixed afternoon sun; time of day arrives in phase 1.
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(215));
const sky = new SkyMesh();
sky.scale.setScalar(4000);
(sky.material as THREE.NodeMaterial).fog = false; // the box sits beyond the fog's far distance
sky.turbidity.value = 3;
sky.rayleigh.value = 1.2;
sky.sunPosition.value.copy(sunDir);
scene.add(sky);
scene.fog = new THREE.Fog(0xbfcfdc, 250, 760);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5b4b36, 1.2));
const sun = new THREE.DirectionalLight(0xfff0dc, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.05;
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target);

// ---------- terrain chunks: a mesh and a heightfield collider each

const world = await createWorld();
const M = RES + 1;
// Every chunk has the same grid, so they share one index buffer.
const index = new THREE.BufferAttribute(new Uint16Array(RES * RES * 6), 1);
for (let i = 0, k = 0; i < RES; i++) {
  for (let j = 0; j < RES; j++, k += 6) {
    const a = i * M + j;
    const b = a + M;
    index.array.set([a, a + 1, b, b, a + 1, b + 1], k);
  }
}
const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
const GRASS = new THREE.Color(0.17, 0.27, 0.09);
const DRY = new THREE.Color(0.36, 0.33, 0.16);
const ROCK = new THREE.Color(0.32, 0.3, 0.27);

interface Chunk { cx: number; cz: number; mesh: THREE.Mesh; collider: RAPIER.Collider }
const chunks = new Map<string, Chunk>();
const centre = (cx: number, cz: number) => [cx * CHUNK + CHUNK / 2 - origin.x, cz * CHUNK + CHUNK / 2 - origin.z] as const;

function buildChunk(cx: number, cz: number): Chunk {
  const s = sampleChunk(height, cx, cz);
  const pos = new Float32Array(M * M * 3);
  const nor = new Float32Array(M * M * 3);
  const col = new Float32Array(M * M * 3);
  const c = new THREE.Color();
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      const v = (i * M + j) * 3;
      const at = (i + 1) * N + j + 1;
      const dx = (s[at + N] - s[at - N]) / (2 * STEP);
      const dz = (s[at + 1] - s[at - 1]) / (2 * STEP);
      const ny = 1 / Math.hypot(dx, 1, dz);
      pos[v] = i * STEP - CHUNK / 2;
      pos[v + 1] = s[at];
      pos[v + 2] = j * STEP - CHUNK / 2;
      nor[v] = -dx * ny;
      nor[v + 1] = ny;
      nor[v + 2] = -dz * ny;
      // Grass that dries out uphill, rock on steep ground. Real materials arrive in phase 1.
      c.lerpColors(GRASS, DRY, THREE.MathUtils.smoothstep(s[at], 10, 60)).lerp(ROCK, THREE.MathUtils.smoothstep(1 - ny, 0.05, 0.16));
      col[v] = c.r;
      col[v + 1] = c.g;
      col[v + 2] = c.b;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geometry, ground);
  mesh.castShadow = mesh.receiveShadow = true;
  const [x, z] = centre(cx, cz);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  return { cx, cz, mesh, collider: addTerrain(world, colliderHeights(s), x, z) };
}

/** Keep the ring of chunks around world (px, pz) loaded. With `smooth`, build at most one chunk per call. */
function stream(px: number, pz: number, smooth: boolean) {
  const ccx = Math.floor(px / CHUNK);
  const ccz = Math.floor(pz / CHUNK);
  for (const [key, c] of chunks) {
    if (Math.abs(c.cx - ccx) <= RING + 1 && Math.abs(c.cz - ccz) <= RING + 1) continue;
    scene.remove(c.mesh);
    c.mesh.geometry.setIndex(null); // the index is shared; dispose only this chunk's own buffers
    c.mesh.geometry.dispose();
    world.removeCollider(c.collider, false);
    chunks.delete(key);
  }
  // ponytail: one chunk per frame on the main thread (~5 ms); phase 1 moves building to workers with LOD
  let next: [number, number] | null = null;
  let nearest = Infinity;
  for (let dx = -RING; dx <= RING; dx++) {
    for (let dz = -RING; dz <= RING; dz++) {
      const cx = ccx + dx;
      const cz = ccz + dz;
      if (chunks.has(`${cx},${cz}`)) continue;
      if (!smooth) chunks.set(`${cx},${cz}`, buildChunk(cx, cz));
      else if (dx * dx + dz * dz < nearest) {
        nearest = dx * dx + dz * dz;
        next = [cx, cz];
      }
    }
  }
  if (next) chunks.set(`${next[0]},${next[1]}`, buildChunk(next[0], next[1]));
}

// ponytail: spawn on the flattest ground near the origin; phase 1 spawns on a road
let [spawnX, spawnZ, flattest] = [0, 0, Infinity];
for (let x = -200; x <= 200; x += 10) {
  for (let z = -200; z <= 200; z += 10) {
    const slope = Math.abs(height(x + 2, z) - height(x - 2, z)) + Math.abs(height(x, z + 2) - height(x, z - 2));
    if (slope < flattest) [spawnX, spawnZ, flattest] = [x, z, slope];
  }
}
stream(spawnX, spawnZ, false); // the whole ring before the car drops in

// ---------- the car: physics body plus a placeholder model

const car = createCar(world, spawnX, height(spawnX, spawnZ) + 1.2, spawnZ);
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
scene.add(carModel);

// ---------- input: keyboard and the first gamepad (standard mapping)

let hood = false;
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyC') hood = !hood;
  if (e.code === 'KeyR') resetCar();
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

/** Put the car back on its wheels where it is, keeping its heading. */
function resetCar() {
  const p = car.body.translation();
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(carModel.quaternion);
  const yaw = Math.atan2(f.x, f.z);
  car.body.setTranslation({ x: p.x, y: height(p.x + origin.x, p.z + origin.z) + 1.5, z: p.z }, true);
  car.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
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

const forward = new THREE.Vector3();
const target = new THREE.Vector3();
const look = currPos.clone();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
camera.position.set(currPos.x, currPos.y + 3, currPos.z - 8);

function updateCamera(dt: number) {
  if (hood) {
    camera.position.set(0, 0.75, 0.6).applyQuaternion(carModel.quaternion).add(carModel.position);
    camera.quaternion.copy(carModel.quaternion).multiply(FLIP); // cameras look down -z, the car faces +z
    return;
  }
  forward.set(0, 0, 1).applyQuaternion(carModel.quaternion).setY(0).normalize();
  target.copy(carModel.position).addScaledVector(forward, -7.5).setY(carModel.position.y + 2.6);
  camera.position.lerp(target, 1 - Math.exp(-6 * dt));
  const floor = height(camera.position.x + origin.x, camera.position.z + origin.z) + 1;
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
  for (const c of chunks.values()) {
    const [x, z] = centre(c.cx, c.cz);
    c.mesh.position.set(x, 0, z);
    c.collider.setTranslation({ x, y: 0, z });
  }
}

// ---------- ?debug overlay

const debug = params.has('debug') ? debugOverlay() : null;
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
      `draws ${drawCalls}  tris ${Math.round(triangles / 1000)}k  chunks ${chunks.size}\n` +
      `${Math.round(car.speed() * 3.6)} km/h  x ${Math.round(carModel.position.x + origin.x)}  z ${Math.round(carModel.position.z + origin.z)}  seed ${SEED}`;
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
  const intent = readIntent();
  acc += dt;
  while (acc >= DT) {
    prevPos.copy(currPos);
    prevQuat.copy(currQuat);
    car.update(intent, DT);
    world.step();
    snapshot();
    acc -= DT;
  }
  if (Math.abs(currPos.x) > REBASE || Math.abs(currPos.z) > REBASE) rebase();

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
  sun.position.copy(carModel.position).addScaledVector(sunDir, 200);
  sun.target.position.copy(carModel.position);
  sky.position.copy(camera.position);
  stream(carModel.position.x + origin.x, carModel.position.z + origin.z, true);

  renderer.render(scene, camera);
  debug?.(now, dt);
});
