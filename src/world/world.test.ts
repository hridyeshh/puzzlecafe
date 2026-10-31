import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK, N } from './chunk.ts';
import { CROWN, MANDIR } from './blocks.ts';
import { DAM, inRiver, riverAt, urban } from './cities.ts';
import { COAST_C } from './fields.ts';
import { GRID } from './nodes.ts';
import { ROAD_HALF, RoadIndex } from './roads.ts';
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
  assert.deepEqual([...kinds].sort(), ['bookstore', 'cafe', 'hoarding', 'station']);
});

test('villages stand on land near the spawn, the same every time, clear of roads, with nothing growing through them', () => {
  const box = [start.x - 3000, start.z - 3000, start.x + 3000, start.z + 3000] as const;
  const houses = world.villages.houses(...box);
  assert.ok(houses.length > 20, `only ${houses.length} houses within 3 km of the spawn`);
  assert.deepEqual(makeWorld(1).villages.houses(...box), houses);
  const near = { d: 0, h: 0 };
  for (const h of houses) {
    assert.ok(world.fields.continent(h.x, h.z) > 0.04, `a house in the sea at ${h.x}, ${h.z}`);
    const d = world.area(Math.floor(h.x / CHUNK), Math.floor(h.z / CHUNK)).index.near(h.x, h.z, near).d;
    assert.ok(d > 18 + Math.hypot(h.w, h.d) / 2, `a house ${d.toFixed(1)} m from a road at ${h.x}, ${h.z}`);
  }
  const h = houses[0];
  const [cx, cz] = [Math.floor(h.x / CHUNK), Math.floor(h.z / CHUNK)];
  const p = world.chunk(cx, cz).plants;
  for (let i = 0; i < p.length; i += 6) {
    const d = Math.hypot(p[i] + (cx + 0.5) * CHUNK - h.x, p[i + 2] + (cz + 0.5) * CHUNK - h.z);
    assert.ok(d > Math.hypot(h.w, h.d) / 2, `a plant inside the house at ${h.x}, ${h.z}`);
  }
});

test('mountain passes climb in hairpins at road grades, with the land rising under them and no other road near', () => {
  const passes: [number, number, number][] = [];
  const [ci, cj] = [Math.floor(start.x / GRID), Math.floor(start.z / GRID)];
  for (let i = ci - 6; i <= ci + 6; i++) for (let j = cj - 6; j <= cj + 6; j++) for (const dir of [0, 1]) if (world.fields.passes.at(i, j, dir)) passes.push([i, j, dir]);
  assert.ok(passes.length > 0, 'no pass within 6 km of the spawn');
  const p = world.fields.passes.at(...passes[0])!;
  const [mx, mz] = [p.ox + (p.ax * p.len) / 2, p.oz + (p.az * p.len) / 2];
  const { roads } = world.area(Math.floor(mx / CHUNK), Math.floor(mz / CHUNK));
  const road = roads.find((r) => r.pass && r.x.some((x, k) => Math.hypot(x - mx, r.z[k] - mz) < 40))!;
  let turned = 0;
  for (let k = 1; k + 1 < road.x.length; k++) {
    const a = Math.atan2(road.z[k] - road.z[k - 1], road.x[k] - road.x[k - 1]);
    const b = Math.atan2(road.z[k + 1] - road.z[k], road.x[k + 1] - road.x[k]);
    turned += Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    // Over the pass itself (its ends meet the nodes as any road does), the grade holds near 8.5% and the land is there.
    const u = (road.x[k] - p.ox) * p.ax + (road.z[k] - p.oz) * p.az;
    if (u < 0 || u > p.len) continue;
    const grade = Math.abs(road.h[k + 1] - road.h[k]) / Math.hypot(road.x[k + 1] - road.x[k], road.z[k + 1] - road.z[k]);
    assert.ok(grade < 0.11, `${(grade * 100).toFixed(1)}% at ${road.x[k]}, ${road.z[k]}`);
    const land = world.fields.smooth(road.x[k], road.z[k]);
    assert.ok(Math.abs(land - road.h[k]) < 6, `road ${(road.h[k] - land).toFixed(1)} m off the land at ${road.x[k]}, ${road.z[k]}`);
    for (const r of roads) if (r !== road) assert.ok(r.x.every((x, m) => Math.hypot(x - road.x[k], r.z[m] - road.z[k]) > 40), 'another road crosses the pass');
  }
  // Each face turns through n half turns (n - 1 hairpins and a quarter turn at each end).
  assert.ok(turned > 0.9 * 2 * p.n * Math.PI, `only ${((turned * 180) / Math.PI).toFixed(0)}° of bends`);
  for (const [cx, cz] of [[Math.floor(mx / CHUNK), Math.floor(mz / CHUNK)]]) {
    for (const r of world.chunk(cx, cz).roads) {
      for (let k = 0; k < r.x.length; k += 3) assert.ok(Math.abs(world.heightAt(r.x[k], r.z[k]) - r.h[k]) < 1e-3, 'road off the terrain on the pass');
    }
  }
});

test('Prakashi: one place every time, level, with its river; country roads end on its ring; streets and buildings clear of the river and each other', () => {
  const c = world.fields.city!;
  assert.ok(c, 'no city within 30 km');
  assert.deepEqual(makeWorld(1).fields.city, c);
  // Level ground, and the river deep in the middle of its course.
  const P = (a: number, rho: number) => [c.ox + Math.cos(c.beta + a) * rho, c.oz + Math.sin(c.beta + a) * rho] as const;
  assert.ok(Math.abs(world.fields.smooth(...P(0, c.arc + c.half + 40)) - c.level) < 1e-6, 'the riverfront is not level');
  assert.ok(world.heightAt(...P(0, c.arc)) < c.water - 3, 'no river');
  assert.ok(inRiver(c, ...P(0.1, c.arc)) && !inRiver(c, ...P(c.span + 0.02, c.arc)), 'the river runs past its barrages');

  const { roads } = world.mapData(c.x - c.ring - 600, c.z - c.ring - 600, c.x + c.ring + 600, c.z + c.ring + 600, 16);
  const streets = roads.filter((r) => r.city);
  let ends = 0;
  for (const r of roads) {
    for (let k = 0; k < r.x.length; k++) {
      const d = Math.hypot(r.x[k] - c.x, r.z[k] - c.z);
      if (!r.city) assert.ok(d > c.ring - 1, `a country road inside the ring at ${r.x[k]}, ${r.z[k]}`);
      else if (r.deck) assert.ok(r.h[k] >= c.level - 1e-6 && (!inRiver(c, r.x[k], r.z[k]) || r.h[k] > c.water + 10), `the expressway low over the river at ${r.x[k]}, ${r.z[k]}`);
      else {
        assert.ok(d < c.ring + 1 && !inRiver(c, r.x[k], r.z[k]), `a street out of the city or in the river at ${r.x[k]}, ${r.z[k]}`);
        assert.ok(Math.abs(r.h[k] - c.level) < 1e-6, `a street off the level at ${r.x[k]}, ${r.z[k]}`);
      }
    }
    if (!r.city && [0, r.x.length - 1].some((k) => Math.abs(Math.hypot(r.x[k] - c.x, r.z[k] - c.z) - c.ring) < 2)) ends++;
  }
  assert.ok(streets.length > 100 && ends > 0, `${streets.length} streets, ${ends} country roads on the ring`);
  const deck = streets.find((r) => r.deck)!;
  assert.ok(deck && deck.x.some((x, k) => inRiver(c, x, deck.z[k])), 'no expressway over the river');
  for (const k of [0, deck.x.length - 1]) assert.ok(Math.abs(deck.h[k] - c.level) < 1e-6, 'the expressway does not come down to the streets');
  // Its ramps pass over the barrages: there its slab (1.4 m deep, 4.6 m to the side) clears their crest.
  const river = { across: 0, past: 0 };
  for (let k = 0; k < deck.x.length; k++) {
    if (Math.abs(riverAt(c, deck.x[k], deck.z[k], river).past - DAM.past) > DAM.thick / 2 + 4.6) continue;
    assert.ok(deck.h[k] - 1.4 > c.level + DAM.crest + 0.3, `the expressway runs into a barrage at ${deck.x[k]}, ${deck.z[k]}`);
  }

  // Buildings: plenty, on the city's side of the river, clear of the streets; nothing grows in the middle.
  const blocks = world.buildings!.blocks(c.x - c.ring, c.z - c.ring, c.x + c.ring, c.z + c.ring);
  assert.ok(blocks.length > 2000, `only ${blocks.length} buildings`);
  const index = new RoadIndex(streets);
  const near = { d: 0, h: 0 };
  const at = { across: 0, past: 0 };
  for (const b of blocks) {
    const clear = index.near(b.x, b.z, near).d - ROAD_HALF - Math.hypot(b.w, b.d) / 2;
    assert.ok(clear > 2.4, `a building ${clear.toFixed(1)} m into a street at ${b.x}, ${b.z}`);
    assert.ok(riverAt(c, b.x, b.z, at).across > c.half, `a building on the ghats or in the river at ${b.x}, ${b.z}`);
  }
  const palaces = world.buildings!.palaces();
  assert.ok(palaces.length > 10, `only ${palaces.length} palaces on the ghats`);
  for (const p of palaces) assert.ok(riverAt(c, p.x, p.z, at).across > c.half && at.across < c.half + 15 && at.past < 0, `a palace off the riverfront at ${p.x}, ${p.z}`);
  const [cx, cz] = [Math.floor(c.x / CHUNK), Math.floor(c.z / CHUNK)];
  assert.equal(world.chunk(cx, cz).plants.length, 0, 'plants in the city');
  assert.ok(world.blocks(cx, cz).length > 0, 'no buildings in the middle chunk');
});

test('Prakashi thins out over its outskirts to open land, with trees in it; towers carry their spires, mandirs stand in the streets', () => {
  const c = world.fields.city!;
  const box = [c.x - c.ring, c.z - c.ring, c.x + c.ring, c.z + c.ring] as const;
  const blocks = world.buildings!.blocks(...box);
  const feet = blocks.filter((b) => b.y === 0);
  const density = (lo: number, hi: number) => feet.filter((b) => Math.hypot(b.x - c.x, b.z - c.z) >= lo && Math.hypot(b.x - c.x, b.z - c.z) < hi).length / (hi * hi - lo * lo);
  assert.ok(density(0, c.ring / 2) > 8 * density(0.85 * c.ring, c.ring), 'the city ends in a wall of buildings, not in outskirts');

  const props = world.buildings!.props(...box);
  const crowns = props.filter((p) => p.kind === CROWN);
  assert.ok(crowns.length > 10, `only ${crowns.length} towers`);
  for (const p of crowns) assert.ok(blocks.some((b) => b.x === p.x && b.z === p.z && Math.abs(b.y + b.h - p.y) < 1e-6), `a spire off its tower at ${p.x}, ${p.z}`);
  assert.ok(props.filter((p) => p.kind === MANDIR).length > 50, 'few mandirs');

  // Open land inside the ring grows trees and scrub, never through a building.
  let grown = 0;
  for (let cx = Math.floor(box[0] / CHUNK); cx <= Math.floor(box[2] / CHUNK) && grown < 3; cx++) {
    for (let cz = Math.floor(box[1] / CHUNK); cz <= Math.floor(box[3] / CHUNK) && grown < 3; cz++) {
      const [mx, mz] = [(cx + 0.5) * CHUNK, (cz + 0.5) * CHUNK];
      const u = urban(c, mx, mz);
      if (Math.hypot(mx - c.x, mz - c.z) > c.ring - 200 || u < 0.1 || u > 0.4) continue;
      const p = world.chunk(cx, cz).plants;
      if (p.length === 0) continue;
      grown++;
      const near = world.buildings!.blocks(cx * CHUNK - 20, cz * CHUNK - 20, (cx + 1) * CHUNK + 20, (cz + 1) * CHUNK + 20);
      for (let i = 0; i < p.length; i += 6) {
        const [x, z] = [p[i] + mx, p[i + 2] + mz];
        assert.ok(near.every((b) => Math.hypot(x - b.x, z - b.z) > Math.hypot(b.w, b.d) / 2), `a plant inside a building at ${x}, ${z}`);
      }
    }
  }
  assert.ok(grown > 0, 'nothing grows in the outskirts');
});
