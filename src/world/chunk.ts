// One chunk of terrain: heights carved around roads and pads, plus the roads, junctions and POIs it owns.
import { type Fields, type Sample, smoothstep } from './fields.ts';
import { hash, rand } from './hash.ts';
import type { Poi } from './pois.ts';
import { type Junction, type Near, ROAD_HALF, type Road, type RoadIndex } from './roads.ts';

export const CHUNK = 256; // m per chunk side
export const RES = 128; // grid cells per chunk side at full detail
export const STEP = CHUNK / RES; // 2 m between samples
export const N = RES + 3; // samples per side, with a one-sample border so edge normals match the neighbour's
export const FLAT = ROAD_HALF + 3; // half width of the flat strip a road sits on
const BLEND = 14; // m over which that strip meets the land
export const REACH = FLAT + 140; // m over which hills fade back in beside a road
const LATTICE = 16; // m between the road distances the hills fade reads
export const FAR = REACH + 50; // lattice distances are capped here, so areas that see different far roads still agree
const LIFT = 0.06; // m the road surface floats over the terrain (with polygon offset on top)
const DASH = 12; // m per centre-line dash period
const PLANT_CELL = 7; // m between plant candidates, on a world-aligned grid
export const TREE = 0;
export const PINE = 1;
export const BUSH = 2;
export const ROCK = 3;
export const CYPRESS = 4;
export const OLIVE = 5;
export const GRASS = 6; // ground cover, near roads only
export const BROOM = 7;
export const LAVENDER = 8;
export const CACTUS = 9;
const COVER_CELL = 3; // m between ground-cover candidates
const NO_ROAD: Near = { d: Infinity, h: 0 };

/** Road surface relative to the chunk centre: uv.x counts dash periods, uv.y is metres across; mark fades paint. */
export interface RoadMesh {
  position: Float32Array;
  uv: Float32Array;
  mark: Float32Array;
  index: Uint32Array;
}

/** Roads, junctions and POIs around a chunk, with a nearest-road index. */
export interface Area {
  roads: Road[];
  junctions: Junction[];
  pois: Poi[];
  index: RoadIndex;
}

/** A chunk sampled on a grid with a one-sample border, x-major: index (xi + 1)·(res + 3) + zi + 1. */
export interface Grid {
  heights: Float32Array;
  roadDist: Float32Array; // m to the nearest road centreline
  cont: Float32Array; // continentalness
  alpine: Float32Array; // 0–1, mountains
  arid: Float32Array; // 0–1, desert
}

export interface ChunkData extends Grid {
  cx: number;
  cz: number;
  roads: Road[]; // runs of road whose segments' midpoints are in this chunk
  junctions: Junction[]; // in this chunk
  pois: Poi[]; // standing in this chunk
  ribbon: RoadMesh; // this chunk's roads and junction patches
  plants: Float32Array; // x, y, z (from the chunk centre), scale, yaw, kind (TREE, PINE, BUSH, ROCK) per plant
  wall: WallMesh; // stone walls along the coast road where the ground falls away to the sea
  rail: WallMesh; // steel guardrails along inland roads where the ground falls away
  signs: Float32Array; // x, y, z (from the chunk centre), yaw, kind (SIGN_*) per road sign
}

export const SIGN_CAFE = 0; // "paperboxd café" ahead
export const SIGN_FUEL = 1;
export const SIGN_BEND_RIGHT = 2; // chevrons for a bend to the driver's right
export const SIGN_BEND_LEFT = 3;
export const SIGN_COAST = 4; // the blue coast-road sign of the concept art

/** Wall faces (non-indexed triangles; uv in metres: along, up) and one box per piece for colliders. */
export interface WallMesh {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  boxes: Float32Array; // x, y, z (from the chunk centre), yaw, half length, half height per piece
}

/** Terrain height from the field sample, the exact nearby road (`near`) and the lattice road distance (`far`). */
export function shape(s: Sample, near: Near, far: number, pads: Poi[], x: number, z: number): number {
  let h = near.d < FLAT + BLEND ? near.h + (s.smooth - near.h) * smoothstep(FLAT, FLAT + BLEND, near.d) : s.smooth;
  // Hills fade in over REACH from the road; mountains over the whole FAR, squared, so a road runs up a valley.
  let hills = smoothstep(FLAT, REACH, Math.min(near.d, far));
  let peaks = smoothstep(FLAT, FAR, Math.min(near.d, far)) ** 2;
  const offRoad = smoothstep(FLAT, FLAT + 6, near.d); // pads never move the road itself
  for (const p of pads) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.pad + 80) continue;
    hills = Math.min(hills, smoothstep(p.pad, p.pad + 80, d));
    peaks = Math.min(peaks, smoothstep(p.pad, p.pad + 80, d));
    h += (p.h - h) * (1 - smoothstep(p.pad, p.pad + 20, d)) * offRoad;
  }
  h += s.detail * hills + s.peak * peaks;
  return s.c > 0.12 ? Math.max(h, 1) : h; // no inland lakes
}

/** Road distance at a world-aligned lattice point, capped; chunks and heightAt read the same values. */
export function latticeDist(index: RoadIndex, gx: number, gz: number): number {
  return Math.min(index.dist(gx * LATTICE, gz * LATTICE), FAR);
}

/** Bilinear road distance at x, z from lattice values read through `at`. */
export function farAt(x: number, z: number, at: (gx: number, gz: number) => number): number {
  const gx = Math.floor(x / LATTICE);
  const gz = Math.floor(z / LATTICE);
  const fx = x / LATTICE - gx;
  const fz = z / LATTICE - gz;
  return (at(gx, gz) * (1 - fx) + at(gx + 1, gz) * fx) * (1 - fz) + (at(gx, gz + 1) * (1 - fx) + at(gx + 1, gz + 1) * fx) * fz;
}

/** Chunk (cx, cz) sampled at `res` cells a side. Without an area the roads are left out (distant, coarse tiles). */
export function sampleGrid(f: Fields, area: Area | null, cx: number, cz: number, res: number): Grid {
  const step = CHUNK / res;
  const n = res + 3;
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const g0x = Math.floor((x0 - step) / LATTICE);
  const g0z = Math.floor((z0 - step) / LATTICE);
  const LN = Math.ceil((CHUNK + 2 * step) / LATTICE) + 2;
  const lattice = new Float64Array(LN * LN).fill(-1);
  const at = (gx: number, gz: number) => {
    const k = (gx - g0x) * LN + (gz - g0z);
    if (lattice[k] < 0) lattice[k] = latticeDist(area!.index, gx, gz);
    return lattice[k];
  };
  const pads = area ? area.pois.filter((p) => p.pad > 0) : [];
  const heights = new Float32Array(n * n);
  const roadDist = new Float32Array(n * n);
  const cont = new Float32Array(n * n);
  const alpine = new Float32Array(n * n);
  const arid = new Float32Array(n * n);
  const s: Sample = { c: 0, smooth: 0, detail: 0, peak: 0, alpine: 0, arid: 0 };
  const near: Near = { d: 0, h: 0 };
  for (let i = 0; i < n; i++) {
    const x = x0 + (i - 1) * step;
    for (let j = 0; j < n; j++) {
      const z = z0 + (j - 1) * step;
      f.sample(x, z, s);
      const far = area ? farAt(x, z, at) : FAR;
      const road = area ? area.index.near(x, z, near) : NO_ROAD;
      const k = i * n + j;
      heights[k] = shape(s, road, far, pads, x, z);
      roadDist[k] = Math.min(road.d, far);
      cont[k] = s.c;
      alpine[k] = s.alpine;
      arid[k] = s.arid;
    }
  }
  return { heights, roadDist, cont, alpine, arid };
}

export function buildChunk(f: Fields, area: Area, cx: number, cz: number): ChunkData {
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const grid = sampleGrid(f, area, cx, cz, RES);
  const owns = (x: number, z: number) => x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK;
  const roads: Road[] = [];
  for (const r of area.roads) {
    let start = -1;
    for (let k = 0; k < r.x.length; k++) {
      const mine = k + 1 < r.x.length && owns((r.x[k] + r.x[k + 1]) / 2, (r.z[k] + r.z[k + 1]) / 2);
      if (mine && start < 0) start = k;
      if (!mine && start >= 0) {
        roads.push(slice(r, start, k + 1));
        start = -1;
      }
    }
  }
  const junctions = area.junctions.filter((j) => owns(j.x, j.z));
  const near: Near = { d: 0, h: 0 };
  const roadH = (x: number, z: number, fallback: number) => {
    area.index.near(x, z, near);
    return near.d < Infinity ? near.h : fallback;
  };
  return {
    cx,
    cz,
    ...grid,
    roads,
    junctions,
    pois: area.pois.filter((p) => owns(p.x, p.z)),
    ribbon: roadMesh(roads, area.junctions, junctions, roadH, x0 + CHUNK / 2, z0 + CHUNK / 2),
    plants: plants(f, cx, cz, grid, area.pois),
    ...barriers(f, area.roads, area.junctions, area.pois, owns, x0 + CHUNK / 2, z0 + CHUNK / 2),
    signs: signs(f, roads, area, owns, x0 + CHUNK / 2, z0 + CHUNK / 2),
  };
}

const SIGN_OFF = 1.8; // m beyond the asphalt
const AHEAD = 90; // m before a café or station; short enough that the chunk holding the sign knows the POI

/**
 * Road signs this chunk owns: café and fuel signs 90 m before each café and station, on the driver's right in both
 * directions; chevrons on the outside of sharp bends, one per direction; now and then a coast-road sign.
 */
function signs(f: Fields, roads: Road[], area: Area, owns: (x: number, z: number) => boolean, ox: number, oz: number) {
  const out: number[] = [];
  const clear = (x: number, z: number) => !area.junctions.some((j) => Math.hypot(j.x - x, j.z - z) < j.half + 14);
  // A sign beside road r at (x, z, h) for drivers heading (tx, tz): on their right (side 1) or left (-1), facing them.
  const put = (r: Road, x: number, z: number, h: number, tx: number, tz: number, kind: number, side = 1) => {
    const sx = x - tz * (r.half + SIGN_OFF) * side;
    const sz = z + tx * (r.half + SIGN_OFF) * side;
    if (owns(sx, sz) && clear(sx, sz)) out.push(sx - ox, h, sz - oz, Math.atan2(-tx, -tz), kind);
  };

  // Café and fuel signs: find the road at the POI's front, walk AHEAD metres each way, face back toward it.
  for (const p of area.pois) {
    if (p.kind === 'hoarding') continue;
    const ax = p.x + Math.sin(p.yaw) * 34;
    const az = p.z + Math.cos(p.yaw) * 34;
    let road: Road | null = null;
    let at = 0;
    let best = 12;
    for (const r of area.roads) {
      for (let k = 0; k < r.x.length; k++) {
        const d = Math.hypot(r.x[k] - ax, r.z[k] - az);
        if (d < best) [best, road, at] = [d, r, k];
      }
    }
    if (!road) continue;
    for (const step of [1, -1]) {
      let walked = 0;
      let k = at;
      while (walked < AHEAD && k + step >= 0 && k + step < road.x.length) {
        walked += Math.hypot(road.x[k + step] - road.x[k], road.z[k + step] - road.z[k]);
        k += step;
      }
      if (walked < AHEAD) continue; // the road leaves this area first; the chunk that owns the spot places it
      const l = Math.hypot(road.x[k - step] - road.x[k], road.z[k - step] - road.z[k]) || 1;
      put(road, road.x[k], road.z[k], road.h[k], (road.x[k - step] - road.x[k]) / l, (road.z[k - step] - road.z[k]) / l, p.kind === 'cafe' ? SIGN_CAFE : SIGN_FUEL);
    }
  }

  // Bends: where the road turns more than ~17° within ±24 m, at the sharpest point, for both directions.
  const apexes: [number, number][] = [];
  for (const r of roads) {
    const turn = (k: number) => {
      const ax = r.x[k] - r.x[k - 3];
      const az = r.z[k] - r.z[k - 3];
      const bx = r.x[k + 3] - r.x[k];
      const bz = r.z[k + 3] - r.z[k];
      return Math.atan2(ax * bz - az * bx, ax * bx + az * bz); // > 0: a right turn going up k
    };
    for (let k = 4; k + 4 < r.x.length; k++) {
      const t = turn(k);
      if (Math.abs(t) < 0.3 || Math.abs(t) < Math.abs(turn(k - 1)) || Math.abs(t) < Math.abs(turn(k + 1))) continue;
      if (apexes.some(([x, z]) => Math.hypot(x - r.x[k], z - r.z[k]) < 60)) continue;
      apexes.push([r.x[k], r.z[k]]);
      const l = Math.hypot(r.x[k + 1] - r.x[k - 1], r.z[k + 1] - r.z[k - 1]) || 1;
      const [tx, tz] = [(r.x[k + 1] - r.x[k - 1]) / l, (r.z[k + 1] - r.z[k - 1]) / l];
      // Both on the outside of the bend, one facing each way: on the left of whoever turns right, and the right of
      // whoever turns left (the same bend, driven the other way).
      const right = t > 0; // going up k
      put(r, r.x[k] - tx * 1.5, r.z[k] - tz * 1.5, r.h[k], tx, tz, right ? SIGN_BEND_RIGHT : SIGN_BEND_LEFT, right ? -1 : 1);
      put(r, r.x[k] + tx * 1.5, r.z[k] + tz * 1.5, r.h[k], -tx, -tz, right ? SIGN_BEND_LEFT : SIGN_BEND_RIGHT, right ? 1 : -1);
    }
  }

  // Now and then on the coast road, the blue coast-road sign.
  for (const r of roads) {
    if (!r.coast) continue;
    for (let k = 1; k + 1 < r.x.length; k++) {
      if (hash(f.seed, 9, Math.round(r.x[k]), Math.round(r.z[k])) % 80 !== 0) continue;
      const l = Math.hypot(r.x[k + 1] - r.x[k - 1], r.z[k + 1] - r.z[k - 1]) || 1;
      put(r, r.x[k], r.z[k], r.h[k], (r.x[k + 1] - r.x[k - 1]) / l, (r.z[k + 1] - r.z[k - 1]) / l, SIGN_COAST);
    }
  }
  return Float32Array.from(out);
}

const OUT = 0.8; // m beyond the asphalt to a barrier's road face
const WALL_THICK = 0.6;
const WALL_HIGH = 0.9; // m above the road
const WALL_DEEP = 2; // m below the road, so it reaches into falling ground
const RAIL_LOW = 0.45; // m above the road: the steel beam's bottom and top
const RAIL_HIGH = 0.8;
const POST_EVERY = 4; // m between guardrail posts

/** Faces in one material (non-indexed triangles; uv in metres: along, up) and their collider boxes. */
function faces(ox: number, oz: number) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const boxes: number[] = [];
  return {
    boxes,
    // One flat quad a, b, c, d; the normal follows its winding, and the materials are two-sided.
    quad(q: number[][], u: number[], v: number[]) {
      const [a, b, c] = q;
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(q[i][0] - ox, q[i][1], q[i][2] - oz);
        nor.push(n[0] / l, n[1] / l, n[2] / l);
        uv.push(u[i], v[i]);
      }
    },
    mesh: (): WallMesh => ({ position: Float32Array.from(pos), normal: Float32Array.from(nor), uv: Float32Array.from(uv), boxes: Float32Array.from(boxes) }),
  };
}

/**
 * Barriers where the ground falls away within 12 m of a road's edge: low stone walls on the sea side of the coast road
 * (a drop of 2 m), steel guardrails on either side of inland roads (3 m), their ends dipping into the ground. Open at junctions
 * and by cafés and stations so the car can turn in. Built along whole roads, keeping the segments this chunk `owns`,
 * so runs, posts and stone courses carry on across chunk edges.
 */
function barriers(f: Fields, roads: Road[], junctions: Junction[], pois: Poi[], owns: (x: number, z: number) => boolean, ox: number, oz: number) {
  const wall = faces(ox, oz);
  const rail = faces(ox, oz);
  for (const r of roads) {
    // n points inland on the coast road, so its sea side is -1.
    for (const side of r.coast ? [-1] : [-1, 1]) {
      const kept: (boolean | undefined)[] = [];
      const keep = (k: number): boolean => {
        if (k < 0 || k >= r.x.length) return false;
        if (kept[k] !== undefined) return kept[k];
        const [x, z] = [r.x[k], r.z[k]];
        const out = (r.half + 12) * side;
        return (kept[k] =
          r.h[k] - f.smooth(x + r.nx[k] * out, z + r.nz[k] * out) >= (r.coast ? 2 : 3) &&
          !junctions.some((j) => Math.hypot(j.x - x, j.z - z) < j.half + 12) &&
          !pois.some((p) => p.kind !== 'hoarding' && Math.hypot(p.x - x, p.z - z) < 50));
      };
      // Road point j, d metres out on this side, at height y.
      const at = (j: number, d: number, y: number) => [r.x[j] + r.nx[j] * d * side, y, r.z[j] + r.nz[j] * d * side];
      const box = (k: number, d: number, lo: number, hi: number, len: number) => {
        const cx = (r.x[k] + r.x[k + 1]) / 2 + ((r.nx[k] + r.nx[k + 1]) / 2) * d * side;
        const cz = (r.z[k] + r.z[k + 1]) / 2 + ((r.nz[k] + r.nz[k + 1]) / 2) * d * side;
        const yaw = Math.atan2(r.x[k + 1] - r.x[k], r.z[k + 1] - r.z[k]);
        return [cx - ox, (r.h[k] + r.h[k + 1]) / 2 + (lo + hi) / 2, cz - oz, yaw, len / 2, (hi - lo) / 2];
      };
      const face = r.half + OUT;
      let along = 0;
      for (let k = 0; k + 1 < r.x.length; k++) {
        const len = Math.hypot(r.x[k + 1] - r.x[k], r.z[k + 1] - r.z[k]);
        if (!owns((r.x[k] + r.x[k + 1]) / 2, (r.z[k] + r.z[k + 1]) / 2) || !keep(k) || !keep(k + 1)) {
          along += len;
          continue;
        }
        const [u0, u1] = [along, along + len];
        if (r.coast) {
          // Corners at A (k) and B (k + 1): road face, far face, top, and an end face only where the wall stops.
          const top = [r.h[k] + LIFT + WALL_HIGH, r.h[k + 1] + LIFT + WALL_HIGH];
          const bottom = [r.h[k] - WALL_DEEP, r.h[k + 1] - WALL_DEEP];
          const t = WALL_DEEP + WALL_HIGH;
          for (const d of [face, face + WALL_THICK]) {
            wall.quad([at(k, d, bottom[0]), at(k + 1, d, bottom[1]), at(k + 1, d, top[1]), at(k, d, top[0])], [u0, u1, u1, u0], [0, 0, t, t]);
          }
          wall.quad([at(k, face, top[0]), at(k + 1, face, top[1]), at(k + 1, face + WALL_THICK, top[1]), at(k, face + WALL_THICK, top[0])], [u0, u1, u1, u0], [t, t, t + 0.5, t + 0.5]);
          for (const [j, y] of [[k, 0], [k + 1, 1]]) {
            if (keep(j === k ? k - 1 : k + 2)) continue;
            wall.quad([at(j, face, bottom[y]), at(j, face + WALL_THICK, bottom[y]), at(j, face + WALL_THICK, top[y]), at(j, face, top[y])], [0, 0.5, 0.5, 0], [0, 0, t, t]);
          }
          wall.boxes.push(...box(k, face + WALL_THICK / 2, -WALL_DEEP, WALL_HIGH + LIFT, len));
        } else {
          // The beam: a face toward the road, a back and a top; at the ends of a run it dips into the ground.
          const lo = [k, k + 1].map((j, y) => r.h[j] + LIFT + (keep(y ? k + 2 : k - 1) ? RAIL_LOW : -0.15));
          const hi = [k, k + 1].map((j, y) => r.h[j] + LIFT + (keep(y ? k + 2 : k - 1) ? RAIL_HIGH : -0.05));
          const v = RAIL_HIGH - RAIL_LOW;
          for (const d of [face, face + 0.1]) rail.quad([at(k, d, lo[0]), at(k + 1, d, lo[1]), at(k + 1, d, hi[1]), at(k, d, hi[0])], [u0, u1, u1, u0], [0, 0, v, v]);
          rail.quad([at(k, face, hi[0]), at(k + 1, face, hi[1]), at(k + 1, face + 0.1, hi[1]), at(k, face + 0.1, hi[0])], [u0, u1, u1, u0], [v, v, v, v]);
          // Posts behind it, every POST_EVERY metres of the run.
          for (let s = Math.ceil(u0 / POST_EVERY) * POST_EVERY; s < u1; s += POST_EVERY) {
            const t = (s - u0) / len;
            const lerp = (d: number, y: number) => {
              const [a, b] = [at(k, d, y), at(k + 1, d, y)];
              return [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
            };
            const h = r.h[k] + (r.h[k + 1] - r.h[k]) * t + LIFT;
            const [lo2, hi2] = [h - 1, h + RAIL_HIGH - 0.05];
            const tx = ((r.x[k + 1] - r.x[k]) / len) * 0.06;
            const tz = ((r.z[k + 1] - r.z[k]) / len) * 0.06;
            for (const [d0, d1, s0, s1] of [[face + 0.1, face + 0.22, -1, -1], [face + 0.22, face + 0.22, -1, 1], [face + 0.22, face + 0.1, 1, 1], [face + 0.1, face + 0.1, 1, -1]]) {
              const [p, q] = [lerp(d0, 0), lerp(d1, 0)];
              const c = [[p[0] + tx * s0, p[2] + tz * s0], [q[0] + tx * s1, q[2] + tz * s1]];
              rail.quad([[c[0][0], lo2, c[0][1]], [c[1][0], lo2, c[1][1]], [c[1][0], hi2, c[1][1]], [c[0][0], hi2, c[0][1]]], [0, 0.1, 0.1, 0], [0, 0, 0, 0]);
            }
          }
          rail.boxes.push(...box(k, face + 0.05, -1, RAIL_HIGH + LIFT, len));
        }
        along += len;
      }
    }
  }
  return { wall: wall.mesh(), rail: rail.mesh() };
}

function slice(r: Road, a: number, b: number): Road {
  return { coast: r.coast, id: r.id, half: r.half, x: r.x.slice(a, b), z: r.z.slice(a, b), h: r.h.slice(a, b), nx: r.nx.slice(a, b), nz: r.nz.slice(a, b) };
}

/** m radius of a junction's asphalt patch: just covers its widest roads crossing. */
const disc = (j: Junction) => j.half + 2;

/** Ribbons for `roads` and discs for the junctions in `own`; paint fades near any junction in `near`. */
function roadMesh(
  roads: Road[],
  near: Junction[],
  own: Junction[],
  roadH: (x: number, z: number, fallback: number) => number,
  ox: number,
  oz: number,
): RoadMesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const mark: number[] = [];
  const idx: number[] = [];
  const fade = (x: number, z: number) => {
    let d = Infinity;
    for (const j of near) d = Math.min(d, Math.hypot(j.x - x, j.z - z) - disc(j));
    return smoothstep(2, 10, d);
  };
  for (const r of roads) {
    const n = r.x.length;
    const along = [0];
    for (let k = 1; k < n; k++) along.push(along[k - 1] + Math.hypot(r.x[k] - r.x[k - 1], r.z[k] - r.z[k - 1]));
    // A whole number of dash periods per piece keeps dashes in step across chunks, in either direction.
    const periods = Math.max(1, Math.round(along[n - 1] / DASH));
    const up = r.nz[0] * (r.x[1] - r.x[0]) - r.nx[0] * (r.z[1] - r.z[0]) > 0; // winding that faces up
    const first = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const m = fade(r.x[k], r.z[k]);
      for (const side of [-1, 1]) {
        pos.push(r.x[k] + r.nx[k] * r.half * side - ox, r.h[k] + LIFT, r.z[k] + r.nz[k] * r.half * side - oz);
        uv.push(along[n - 1] > 0 ? (along[k] / along[n - 1]) * periods : 0, side * r.half);
        mark.push(m);
      }
      if (k === 0) continue;
      const a = first + (k - 1) * 2;
      if (up) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  // Junction patches: plain asphalt that follows the roads around them.
  for (const j of own) {
    const c = pos.length / 3;
    pos.push(j.x - ox, j.h + LIFT + 0.015, j.z - oz);
    uv.push(0, 0);
    mark.push(0);
    for (let s = 0; s < 24; s++) {
      const a = (s / 24) * Math.PI * 2;
      const x = j.x + Math.cos(a) * disc(j);
      const z = j.z + Math.sin(a) * disc(j);
      pos.push(x - ox, roadH(x, z, j.h) + LIFT + 0.015, z - oz);
      uv.push(0, 0);
      mark.push(0);
      idx.push(c, c + 1 + ((s + 1) % 24), c + 1 + s);
    }
  }
  return { position: Float32Array.from(pos), uv: Float32Array.from(uv), mark: Float32Array.from(mark), index: Uint32Array.from(idx) };
}

/**
 * Trees, pines, bushes and rocks: one candidate per world-aligned cell, kept by place (woods, coast, slope). Near the
 * sea it is Mediterranean: thick scrub, olives, cypresses and the odd pine.
 */
function plants(f: Fields, cx: number, cz: number, { heights, roadDist, cont, alpine, arid }: Grid, pois: Poi[]) {
  const out: number[] = [];
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const at = { h: 0, c: 0, road: 0, slope: 0, a: 0, d: 0 };
  /** Ground at world (x, z) in this chunk, from the sample grid; false where nothing should grow. */
  const ground = (x: number, z: number) => {
    const u = (x - x0) / STEP + 1;
    const v = (z - z0) / STEP + 1;
    const a = Math.floor(u);
    const b = Math.floor(v);
    const k = a * N + b;
    const fu = u - a;
    const fv = v - b;
    at.h = (heights[k] * (1 - fu) + heights[k + N] * fu) * (1 - fv) + (heights[k + 1] * (1 - fu) + heights[k + N + 1] * fu) * fv;
    at.c = cont[k];
    at.road = roadDist[k];
    at.slope = Math.hypot(heights[k + N] - heights[k - N], heights[k + 1] - heights[k - 1]) / (2 * STEP);
    at.a = alpine[k];
    at.d = arid[k];
    // Clear of cafés' and stations' pads, and of hoardings out to the road, so nothing hides a board.
    return at.h >= 2.5 && at.c >= 0.03 && !pois.some((p) => Math.hypot(x - p.x, z - p.z) < (p.pad > 0 ? p.pad + 8 : 22));
  };
  const push = (x: number, z: number, scale: number, yaw: number, kind: number) =>
    out.push(x - (x0 + CHUNK / 2), at.h - 0.15, z - (z0 + CHUNK / 2), scale, yaw, kind);

  for (let i = Math.floor(x0 / PLANT_CELL); i <= Math.floor((x0 + CHUNK) / PLANT_CELL); i++) {
    for (let j = Math.floor(z0 / PLANT_CELL); j <= Math.floor((z0 + CHUNK) / PLANT_CELL); j++) {
      const r = (salt: number) => rand(f.seed, i, j, salt);
      const x = (i + r(1)) * PLANT_CELL;
      const z = (j + r(2)) * PLANT_CELL;
      if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
      if (!ground(x, z) || at.road < ROAD_HALF + 2.5) continue;
      const { h, c, slope, a, d } = at;
      const nearRoad = at.road < FLAT + 4; // only scrub this close, up to the shoulder; trees and rocks stand back
      const woods = smoothstep(0.45, 0.75, f.woods(x, z)) * smoothstep(0.08, 0.16, c);
      const coastal = 1 - smoothstep(0.1, 0.2, c);
      // Mountains: conifer forest up to the tree line and rock; desert: a dry bush or a rock here and there.
      const tree = (0.015 + 0.4 * woods + 0.05 * coastal + 0.25 * a * (1 - smoothstep(380, 460, h))) * (1 - smoothstep(0.1, 0.4, d));
      const bush = (0.05 + 0.22 * coastal) * (1 - 0.5 * d);
      const roll = r(3);
      const pick = r(4);
      let kind = -1;
      if (slope > 0.7) kind = roll < 0.06 ? ROCK : -1;
      else if (roll < tree && coastal > 0.5) kind = pick < 0.3 ? CYPRESS : pick < 0.85 ? OLIVE : PINE;
      else if (roll < tree) kind = a > 0.4 || h > 55 || pick < 0.35 ? PINE : TREE;
      else if (roll < tree + bush) kind = BUSH;
      else if (roll < tree + bush + 0.012 + 0.03 * a + 0.02 * d) kind = ROCK;
      else if (roll < tree + bush + 0.032 + 0.03 * a + 0.05 * d && d > 0.5) kind = CACTUS;
      if (kind < 0 || (nearRoad && kind !== BUSH && kind !== CACTUS)) continue;
      push(x, z, 0.75 + r(5) * 0.6, r(6) * Math.PI * 2, kind);
    }
  }

  // Ground cover along the roads, where the eye is: dry grass, yellow broom, lavender near the sea.
  for (let i = Math.floor(x0 / COVER_CELL); i <= Math.floor((x0 + CHUNK) / COVER_CELL); i++) {
    for (let j = Math.floor(z0 / COVER_CELL); j <= Math.floor((z0 + CHUNK) / COVER_CELL); j++) {
      const r = (salt: number) => rand(f.seed, i, j, salt + 20);
      const x = (i + r(1)) * COVER_CELL;
      const z = (j + r(2)) * COVER_CELL;
      if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
      if (!ground(x, z) || at.road < ROAD_HALF + 1.5 || at.road > 45 || at.slope > 0.5) continue;
      const roll = r(3);
      if (roll > 0.72 * (1 - 0.7 * at.d)) continue; // sparse in the desert
      // Flowers: lavender by the sea and in alpine meadows, broom elsewhere; the desert has only dry grass.
      const kind = roll < 0.55 || at.d > 0.5 ? GRASS : (at.c < 0.15 || at.a > 0.5) && r(4) < 0.5 ? LAVENDER : BROOM;
      push(x, z, 0.7 + r(5) * 0.6, r(6) * Math.PI * 2, kind);
    }
  }
  return Float32Array.from(out);
}

/** A chunk's (RES + 1)² heights without the border, in Rapier heightfield order (column-major: x outer, z inner). */
export function colliderHeights(heights: Float32Array): Float32Array {
  const M = RES + 1;
  const out = new Float32Array(M * M);
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) out[i * M + j] = heights[(i + 1) * N + j + 1];
  return out;
}
