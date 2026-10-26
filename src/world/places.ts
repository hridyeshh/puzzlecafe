// Places: what kind of country a point is in, the name of the region around it, and where to find each kind.
// Pure, like the rest of world/: names come from hashes, so a seed always names the same places the same way.
import { CHUNK } from './chunk.ts';
import type { Fields } from './fields.ts';
import { hash, rand } from './hash.ts';
import { laneOf } from './roads.ts';
import type { World } from './world.ts';

export type Biome = 'sea' | 'coast' | 'country' | 'mountains' | 'desert';
export const BIOMES: Exclude<Biome, 'sea'>[] = ['coast', 'country', 'mountains', 'desert'];

export function biomeAt(f: Fields, x: number, z: number): Biome {
  const c = f.continent(x, z);
  if (c < 0) return 'sea';
  if (f.alpine(x, z) > 0.5) return 'mountains';
  if (f.arid(x, z) > 0.5) return 'desert';
  return c < 0.18 ? 'coast' : 'country';
}

const WORDS: Record<Exclude<Biome, 'sea'>, [string[], string[]]> = {
  coast: [['Lavender', 'Olive', 'Cypress', 'Saffron', 'Lemon', 'Fig', 'Azure', 'Salt'], ['Coast', 'Bay', 'Shore', 'Riviera', 'Cove', 'Point']],
  country: [['Golden', 'Willow', 'Meadow', 'Hazel', 'Barley', 'Linden', 'Clover'], ['Hills', 'Vale', 'Downs', 'Fields', 'Hollow']],
  mountains: [['Granite', 'Eagle', 'Silver', 'Frost', 'Pine', 'Cloud', 'High'], ['Peaks', 'Range', 'Pass', 'Ridge', 'Heights']],
  desert: [['Red', 'Amber', 'Copper', 'Sun', 'Dune', 'Ochre', 'Mirage'], ['Mesa', 'Flats', 'Sands', 'Basin', 'Canyon']],
};
const CELL = 9000; // m: regions are cells about this big, around a jittered centre each

/** A region's centre: one per CELL cell, jittered. */
function centre(seed: number, i: number, j: number): [number, number] {
  return [(i + 0.2 + rand(seed, i, j, 41) * 0.6) * CELL, (j + 0.2 + rand(seed, i, j, 42) * 0.6) * CELL];
}

/** The region (x, z) is in: the nearest centre's, named for the kind of country at it (or at x, z if that is sea). */
export function regionAt(f: Fields, x: number, z: number): { id: string; name: string; biome: Biome; x: number; z: number } {
  const ci = Math.floor(x / CELL);
  const cj = Math.floor(z / CELL);
  let best: [number, number, number, number] = [0, 0, 0, 0];
  let bestD = Infinity;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const [px, pz] = centre(f.seed, i, j);
      const d = Math.hypot(px - x, pz - z);
      if (d < bestD) [bestD, best] = [d, [i, j, px, pz]];
    }
  }
  const [i, j, px, pz] = best;
  let biome = biomeAt(f, px, pz);
  if (biome === 'sea') biome = biomeAt(f, x, z);
  if (biome === 'sea') return { id: 'sea', name: '', biome, x: px, z: pz };
  const [first, second] = WORDS[biome];
  const h = hash(f.seed, 43, i, j);
  return { id: `${i},${j}`, name: `${first[h % first.length]} ${second[(h >>> 8) % second.length]}`, biome, x: px, z: pz };
}

/** Region centres inside [x0, x1) × [z0, z1), named, for map labels. */
export function regionsIn(f: Fields, x0: number, z0: number, x1: number, z1: number) {
  const out: { name: string; x: number; z: number }[] = [];
  for (let i = Math.floor(x0 / CELL) - 1; i <= Math.floor(x1 / CELL) + 1; i++) {
    for (let j = Math.floor(z0 / CELL) - 1; j <= Math.floor(z1 / CELL) + 1; j++) {
      const [px, pz] = centre(f.seed, i, j);
      if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
      const r = regionAt(f, px, pz);
      if (r.name) out.push({ name: r.name, x: px, z: pz });
    }
  }
  return out;
}

/** The right lane of the road nearest (x, z) within two chunks, facing along it; `keep` picks which road points count. */
export function roadNear(world: World, x: number, z: number, keep = (_x: number, _z: number) => true): { x: number; z: number; yaw: number } | null {
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  let best: { x: number; z: number; yaw: number } | null = null;
  let bestD = Infinity;
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      for (const r of world.area(cx + a, cz + b).roads) {
        for (let k = 1; k + 1 < r.x.length; k += 4) {
          const d = Math.hypot(r.x[k] - x, r.z[k] - z);
          if (d >= bestD || !keep(r.x[k], r.z[k])) continue;
          const dx = r.x[k + 1] - r.x[k - 1];
          const dz = r.z[k + 1] - r.z[k - 1];
          const l = Math.hypot(dx, dz) || 1;
          bestD = d;
          best = { x: r.x[k] - (dz / l) * laneOf(r), z: r.z[k] + (dx / l) * laneOf(r), yaw: Math.atan2(dx, dz) }; // right of (dx, dz) is (-dz, dx)
        }
      }
    }
  }
  return best;
}

/**
 * The right lane of a road in `biome`, nearest (x, z): the land is searched in rings 1.5 km apart, out to 90 km, and the
 * first spot of that kind gives the nearest road around it that is itself in that kind of country. Null if there is
 * none that close.
 */
export function findPlace(world: World, biome: Exclude<Biome, 'sea'>, x: number, z: number): { x: number; z: number; yaw: number } | null {
  const f = world.fields;
  for (let ring = 0; ring <= 60; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const px = x + i * 1500;
        const pz = z + j * 1500;
        if (biomeAt(f, px, pz) !== biome) continue;
        const best = roadNear(world, px, pz, (rx, rz) => biomeAt(f, rx, rz) === biome);
        if (best) return best;
      }
    }
  }
  return null;
}
