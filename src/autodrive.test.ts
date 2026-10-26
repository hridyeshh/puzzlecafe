import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutodrive } from './autodrive.ts';
import { CHUNK } from './world/chunk.ts';
import { LANE } from './world/roads.ts';
import { makeWorld } from './world/world.ts';

// A coast T-junction near the spawn, and a point in the right lane of the coast road 40 m before it.
const world = makeWorld(1);
const start = world.spawn();
function approach() {
  for (let dx = -6; dx <= 6; dx++) {
    for (let dz = -6; dz <= 6; dz++) {
      const area = world.area(Math.floor(start.x / CHUNK) + dx, Math.floor(start.z / CHUNK) + dz);
      for (const j of area.junctions) {
        for (const r of area.roads) {
          if (!r.coast) continue;
          const k = r.x.findIndex((x, i) => Math.hypot(x - j.x, r.z[i] - j.z) < 6);
          if (k < 6) continue;
          const b = k - 5; // ~40 m back, heading toward the junction
          const tx = r.x[b + 1] - r.x[b];
          const tz = r.z[b + 1] - r.z[b];
          const l = Math.hypot(tx, tz);
          return { x: r.x[b] - (tz / l) * LANE, z: r.z[b] + (tx / l) * LANE, yaw: Math.atan2(tx, tz) };
        }
      }
    }
  }
  throw new Error('no coast junction near the spawn');
}

test('autodrive slows for a side road it decides to take, and keeps going past one it skips', () => {
  const at = approach();
  const random = Math.random;
  try {
    Math.random = () => 0; // always take the side road
    const turning = createAutodrive(world).drive(at.x, at.z, at.yaw, 15)!;
    assert.ok(turning.brake > 0, `should brake for the turn: ${JSON.stringify(turning)}`);
    Math.random = () => 0.99; // never take it
    const passing = createAutodrive(world).drive(at.x, at.z, at.yaw, 15)!;
    assert.ok(passing.throttle > 0, `should keep going: ${JSON.stringify(passing)}`);
  } finally {
    Math.random = random;
  }
});
