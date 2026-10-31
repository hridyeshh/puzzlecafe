// Villages: clusters of houses on the hills behind the coast and in the countryside, off the roads, as in the concept
// art. Pure: decided from the seed, the fields, the roads and POIs around them (through `area`) and the terrain.
import { type Area, CHUNK } from './chunk.ts';
import { type Fields, smoothstep } from './fields.ts';
import { hash, rand } from './hash.ts';
import type { Near } from './roads.ts';

/** A house: its middle, the way its front faces (local +z), its size in metres (walls h high) and a 0–1 tint. */
export interface House {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  tint: number;
}

export interface Village {
  x: number;
  z: number;
  r: number; // m from the middle to beyond its last house
  houses: House[];
}

const CELL = 2200; // m: at most one village in each cell
const CHANCE = 0.55;
const REACH = 240; // m: no village reaches further than this from its middle
const CLEAR = 18; // m from a road's centreline to the edge of a house, past the land the road levels

export type Villages = ReturnType<typeof makeVillages>;

/** `area(cx, cz)`: the roads and POIs around chunk (cx, cz); `heightAt`: the terrain. */
export function makeVillages(f: Fields, area: (cx: number, cz: number) => Area, heightAt: (x: number, z: number) => number) {
  const seed = f.seed;
  const near: Near = { d: 0, h: 0 };
  const areaAt = (x: number, z: number) => area(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  const roadDist = (x: number, z: number) => areaAt(x, z).index.near(x, z, near).d;
  const sample = { c: 0, smooth: 0, detail: 0, peak: 0, alpine: 0, arid: 0 };
  /** The land at x, z without the roads' levelling: enough to find a hill. */
  const land = (x: number, z: number) => {
    f.sample(x, z, sample);
    return sample.smooth + sample.detail + sample.peak;
  };

  function decide(i: number, j: number): Village | null {
    if (rand(seed, i, j, 60) > CHANCE) return null;
    // The middle: of a few spots in the cell on the coast's or the country's hills, the one standing highest over the
    // land around it, nearer the sea the better (where the coast road sees it).
    let best: [number, number] | null = null;
    let top = -Infinity;
    for (let k = 0; k < 6; k++) {
      const x = (i + 0.15 + 0.7 * rand(seed, i, j, 61 + 2 * k)) * CELL;
      const z = (j + 0.15 + 0.7 * rand(seed, i, j, 62 + 2 * k)) * CELL;
      const c = f.continent(x, z);
      if (c < 0.07 || f.alpine(x, z) > 0.3 || f.arid(x, z) > 0.3) continue;
      if (f.city && Math.hypot(x - f.city.x, z - f.city.z) < f.city.ring + 400) continue; // not up against a city
      let around = 0;
      for (let a = 0; a < 4; a++) around += land(x + Math.cos(a * 1.57) * 140, z + Math.sin(a * 1.57) * 140) / 4;
      const score = land(x, z) - around + 25 * (1 - smoothstep(0.07, 0.3, c));
      if (score > top && roadDist(x, z) > 70) [top, best] = [score, [x, z]];
    }
    if (!best) return null;
    const [vx, vz] = best;
    const salt = hash(seed, i, j, 70);
    const count = 16 + (salt % 29);
    const spread = 24 + 1.9 * count; // m: houses some 20 m apart, tighter toward the middle
    const houses: House[] = [];
    for (let k = 0; houses.length < count && k < count * 6; k++) {
      const r = (s: number) => rand(seed, salt, k, s);
      const out = spread * Math.sqrt(r(1));
      const a = r(2) * Math.PI * 2;
      const x = vx + Math.cos(a) * out;
      const z = vz + Math.sin(a) * out;
      const w = 6 + r(3) * 5;
      const d = 5 + r(4) * 3;
      const foot = Math.hypot(w, d) / 2;
      if (houses.some((o) => Math.hypot(o.x - x, o.z - z) < 0.8 * (foot + Math.hypot(o.w, o.d) / 2) + 1)) continue;
      if (f.continent(x, z) < 0.04 || roadDist(x, z) < CLEAR + foot) continue;
      if (areaAt(x, z).pois.some((p) => Math.hypot(p.x - x, p.z - z) < (p.pad > 0 ? p.pad + 6 : 14) + foot)) continue;
      const gx = heightAt(x + 3, z) - heightAt(x - 3, z);
      const gz = heightAt(x, z + 3) - heightAt(x, z - 3);
      const slope = Math.hypot(gx, gz) / 6;
      if (slope > 0.5) continue;
      // Along the hillside, the front looking down it; on the level, square to the village's lanes.
      const yaw = slope > 0.06 ? Math.atan2(-gx, -gz) + (r(5) - 0.5) * 0.3 : Math.floor(r(5) * 4) * (Math.PI / 2) + (r(6) - 0.5) * 0.2;
      const middle = 1 - out / spread; // taller houses toward the middle
      const floors = 1 + (r(7) < 0.25 + 0.5 * middle ? 1 : 0) + (r(8) < 0.25 * middle ? 1 : 0);
      houses.push({ x, z, yaw, w, d, h: floors * 3 + 0.3, tint: r(9) });
    }
    return houses.length >= 6 ? { x: vx, z: vz, r: spread + 8, houses } : null;
  }

  const cells = new Map<string, Village | null>();
  /** The village in cell (i, j), if there is one. */
  function at(i: number, j: number): Village | null {
    const key = `${i},${j}`;
    let v = cells.get(key);
    if (v === undefined) {
      v = decide(i, j);
      if (cells.size >= 1024) cells.delete(cells.keys().next().value!);
      cells.set(key, v);
    }
    return v;
  }

  return {
    at,
    /** Houses whose middles are in [x0, x1) × [z0, z1). */
    houses(x0: number, z0: number, x1: number, z1: number): House[] {
      const out: House[] = [];
      for (let i = Math.floor((x0 - REACH) / CELL); i <= Math.floor((x1 + REACH) / CELL); i++) {
        for (let j = Math.floor((z0 - REACH) / CELL); j <= Math.floor((z1 + REACH) / CELL); j++) {
          // A village's middle lies inside its cell, so one whose cell is beyond REACH of the box cannot reach it.
          if ((i + 1) * CELL < x0 - REACH || i * CELL > x1 + REACH || (j + 1) * CELL < z0 - REACH || j * CELL > z1 + REACH) continue;
          const v = at(i, j);
          if (!v || v.x + v.r < x0 || v.x - v.r >= x1 || v.z + v.r < z0 || v.z - v.r >= z1) continue;
          for (const h of v.houses) if (h.x >= x0 && h.x < x1 && h.z >= z0 && h.z < z1) out.push(h);
        }
      }
      return out;
    },
  };
}
