import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK, N } from './chunk.ts';
import { COAST_C } from './fields.ts';
import { makeWorld } from './world.ts';

const world = makeWorld(1);
const start = world.spawn();
const cx = Math.floor(start.x / CHUNK);
const cz = Math.floor(start.z / CHUNK);
const around = (r: number) => {
  const out: [number, number][] = [];
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) out.push([cx + dx, cz + dz]);
  return out;
};

test('the same seed builds the same world; another seed does not', () => {
  const again = makeWorld(1);
  for (const [x, z] of [[start.x, start.z], [start.x + 300, start.z - 170], [-5000, 7000]]) {
    assert.equal(world.heightAt(x, z), again.heightAt(x, z));
  }
  assert.notEqual(world.heightAt(start.x + 300, start.z - 170), makeWorld(2).heightAt(start.x + 300, start.z - 170));
});

test('neighbouring chunks share their edge heights exactly', () => {
  for (const [ax, az] of around(1)) {
    const left = world.chunk(ax, az).heights;
    const right = world.chunk(ax + 1, az).heights;
    for (let j = 0; j < N; j++) assert.equal(left[(N - 2) * N + j], right[N + j], `seam at chunk ${ax},${az}`);
  }
});

test('the car spawns on the coast road, and no road runs into the sea', () => {
  assert.ok(world.area(cx, cz).roads.some((r) => r.coast), 'no coast road at the spawn');
  for (const [ax, az] of around(2)) {
    for (const r of world.area(ax, az).roads) {
      for (let k = 0; k < r.x.length; k++) {
        assert.ok(world.fields.continent(r.x[k], r.z[k]) > COAST_C - 1e-3, `road in the sea at ${r.x[k]}, ${r.z[k]}`);
      }
    }
  }
});

test('no coast road loops so small that the road folds into a blob', () => {
  for (const [ax, az] of around(3)) {
    for (const r of world.area(ax, az).roads) {
      const n = r.x.length;
      if (!r.coast || Math.hypot(r.x[0] - r.x[n - 1], r.z[0] - r.z[n - 1]) > 1e-6) continue; // closed loops only
      const span = Math.max(Math.max(...r.x) - Math.min(...r.x), Math.max(...r.z) - Math.min(...r.z));
      assert.ok(span >= 150, `a ${span.toFixed(0)} m coast loop at ${r.x[0]}, ${r.z[0]}`);
    }
  }
});

test('roads sit on the terrain: the height at the centreline is the road height', () => {
  for (const [ax, az] of around(1)) {
    for (const r of world.chunk(ax, az).roads) {
      for (let k = 0; k < r.x.length; k += 3) {
        const off = world.heightAt(r.x[k], r.z[k]) - r.h[k];
        assert.ok(Math.abs(off) < 1e-3, `road ${off.toFixed(3)} m off the terrain at ${r.x[k]}, ${r.z[k]}`);
      }
    }
  }
});

test('POIs stand on land, clear of junctions, with every kind somewhere near the spawn', () => {
  const kinds = new Set<string>();
  for (const [ax, az] of around(6)) {
    const { pois, junctions } = world.area(ax, az);
    for (const p of pois) {
      kinds.add(p.kind);
      if (p.kind !== 'hoarding') assert.ok(world.fields.continent(p.x, p.z) > 0, `${p.kind} in the sea at ${p.x}, ${p.z}`);
      for (const j of junctions) assert.ok(Math.hypot(j.x - p.x, j.z - p.z) > 40, `${p.kind} on a junction at ${p.x}, ${p.z}`);
    }
  }
  assert.deepEqual([...kinds].sort(), ['cafe', 'hoarding', 'station']);
});
