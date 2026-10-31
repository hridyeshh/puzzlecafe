import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChase } from './chase.ts';
import { addTerrain, createCar, createWorld } from './physics.ts';
import { CHUNK, colliderHeights } from './world/chunk.ts';
import { mulberry32 } from './world/hash.ts';
import { makeWorld } from './world/world.ts';

test('a chase on normal: police come and bust a car stopped on the coast road; far out of sight, it escapes', async () => {
  const random = Math.random;
  Math.random = mulberry32(5); // spawn picks
  try {
    const physics = await createWorld();
    const world = makeWorld(1);
    const s = world.spawn();
    const [cx, cz] = [Math.floor(s.x / CHUNK), Math.floor(s.z / CHUNK)];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        addTerrain(physics, colliderHeights(world.chunk(cx + dx, cz + dz).heights), (cx + dx + 0.5) * CHUNK, (cz + dz + 0.5) * CHUNK);
      }
    }
    const player = createCar(physics, s.x, world.heightAt(s.x, s.z) + 0.9, s.z, s.yaw);
    let resets = 0;
    const chase = createChase(physics, world, { x: 0, z: 0 }, player, () => resets++);
    chase.set('normal');
    const idle = { steer: 0, throttle: 0, brake: 0 };
    /** Seconds until `event` (or until `done()`), or -1 if it does not come within `seconds`. */
    const run = (seconds: number, event: string | null, done = () => false) => {
      for (let i = 0; i < seconds * 60; i++) {
        const said = chase.update(1 / 60);
        if ((event && said === event) || done()) return i / 60;
        player.update(idle, 1 / 60);
        chase.step(1 / 60);
        physics.step();
        chase.snapshot();
      }
      return -1;
    };
    assert.ok(run(10, 'police') >= 0, 'no chase began');
    const busted = run(90, 'busted');
    assert.ok(busted >= 0, `not busted within 90 s (${chase.units.length} police, heat ${chase.heat})`);
    assert.ok(run(5, null, () => resets > 0) >= 0, 'not put back on the road after the bust');

    assert.ok(run(60, 'police') >= 0, 'no second chase');
    assert.ok(run(60, null, () => chase.heat > 0) >= 0, 'never seen in the second chase');
    player.body.setTranslation({ x: s.x + 3000, y: 400, z: s.z }, true); // far beyond anyone's sight
    const escaped = run(20, 'escaped');
    assert.ok(escaped >= 9 && escaped < 12, `escape on normal takes 10 s out of sight: ${escaped}`);
    assert.equal(chase.units.length, 0, 'the police are gone after an escape');
  } finally {
    Math.random = random;
  }
});
