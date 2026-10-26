import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutodrive } from './autodrive.ts';
import { CHUNK } from './world/chunk.ts';
import { LANE } from './world/roads.ts';
import { makeWorld } from './world/world.ts';

// A coast T-junction near the spawn, and a point in the right lane of the coast road 40 m before it, coming from the
// side from which its road is a turn rather than a U-turn.
const world = makeWorld(1);
const start = world.spawn();
function approach() {
  for (let dx = -6; dx <= 6; dx++) {
    for (let dz = -6; dz <= 6; dz++) {
      const area = world.area(Math.floor(start.x / CHUNK) + dx, Math.floor(start.z / CHUNK) + dz);
      for (const j of area.junctions) {
        const ends = area.roads.flatMap((s) => (s.coast ? [] : [[s, 0, 1], [s, s.x.length - 1, s.x.length - 2]] as const));
        const end = ends.find(([s, e]) => Math.hypot(s.x[e] - j.x, s.z[e] - j.z) < 3);
        if (!end) continue;
        const [s, e, n] = end;
        for (const r of area.roads) {
          if (!r.coast) continue;
          const k = r.x.findIndex((x, i) => Math.hypot(x - j.x, r.z[i] - j.z) < 6);
          if (k < 6 || k + 6 >= r.x.length) continue;
          // Head along the coast road the way the side road leaves it.
          const sign = (r.x[k + 1] - r.x[k - 1]) * (s.x[n] - s.x[e]) + (r.z[k + 1] - r.z[k - 1]) * (s.z[n] - s.z[e]) > 0 ? 1 : -1;
          const b = k - 5 * sign; // ~40 m back, heading toward the junction
          const tx = r.x[b + sign] - r.x[b];
          const tz = r.z[b + sign] - r.z[b];
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
