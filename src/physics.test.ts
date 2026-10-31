import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAPIER, addFixed, addTerrain, createCar, createWorld, type Intent } from './physics.ts';
import { CHUNK, N, RES, STEP, colliderHeights } from './world/chunk.ts';
import { makeWorld } from './world/world.ts';

test('a chunk collider matches the chunk heights at its grid points', async () => {
  const world = await createWorld();
  const { heights } = makeWorld(7).chunk(3, -2);
  addTerrain(world, colliderHeights(heights), 3 * CHUNK + CHUNK / 2, -2 * CHUNK + CHUNK / 2);
  world.step(); // registers the collider with scene queries
  for (const [xi, zi] of [[5, 90], [100, 17], [64, 64], [1, 127]]) {
    const x = 3 * CHUNK + xi * STEP;
    const z = -2 * CHUNK + zi * STEP;
    const hit = world.castRay(new RAPIER.Ray({ x, y: 500, z }, { x: 0, y: -1, z: 0 }), 1000, true);
    assert.ok(hit, `no ground under ${xi},${zi}`);
    assert.ok(Math.abs(500 - hit.timeOfImpact - heights[(xi + 1) * N + zi + 1]) < 1e-3, `wrong height at ${xi},${zi}`);
  }
});

test('with no input the car holds still on a 22% slope, on a tile with props', async () => {
  const world = await createWorld();
  const M = RES + 1;
  const ramp = new Float32Array(M * M);
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) ramp[i * M + j] = j * STEP * 0.22; // rises toward +z
  // As streamed: the ground on a fixed body that also holds the tile's props, here one far-off box.
  const tile = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  addTerrain(world, ramp, 0, 0, tile);
  addFixed(world, RAPIER.ColliderDesc.cuboid(2, 2, 2).setTranslation(100, 0, 100), tile);
  const car = createCar(world, 0, (RES / 2) * STEP * 0.22 + 1, 0);
  const idle = { steer: 0, throttle: 0, brake: 0 };
  const step = () => {
    car.update(idle, 1 / 60);
    world.step();
  };
  for (let i = 0; i < 60; i++) step(); // settle on the springs
  const z = car.body.translation().z;
  for (let i = 0; i < 180; i++) step();
  assert.ok(Math.abs(car.body.translation().z - z) < 0.3, `rolled ${car.body.translation().z - z} m`);
});

test('the car drives: throttle goes forward, +steer turns left (+x), brake stops it, holding brake reverses', async () => {
  const world = await createWorld();
  addTerrain(world, new Float32Array((RES + 1) ** 2), 0, 0); // flat ground, 256 m square
  const car = createCar(world, 0, 1, -100);
  const drive = (intent: Intent, seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) {
      car.update(intent, 1 / 60);
      world.step();
    }
  };
  drive({ steer: 0, throttle: 0, brake: 0 }, 1); // settle on the springs
  drive({ steer: 0, throttle: 1, brake: 0 }, 4);
  assert.ok(car.speed() > 12, `speed after 4 s: ${car.speed()} m/s`);
  const p = car.body.translation();
  assert.ok(p.z > -80, `forward is +z: z ${p.z}`);
  drive({ steer: 1, throttle: 0.3, brake: 0 }, 1.5);
  assert.ok(car.body.translation().x > p.x + 1, 'steer +1 turns toward +x');
  const brake = { steer: 0, throttle: 0, brake: 1 };
  let steps = 0;
  for (; car.speed() > 0.5 && steps < 300; steps++) drive(brake, 1 / 60);
  assert.ok(steps < 300, `still moving at ${car.speed()} m/s after 5 s of braking`);
  drive(brake, 2);
  assert.ok(car.speed() < -1, `holding brake at a stop reverses: ${car.speed()} m/s`);
});
