// One chunk of terrain: heights carved around roads and pads, plus the roads, junctions and POIs it owns.
import { type Fields, type Sample, smoothstep } from './fields.ts';
import { rand } from './hash.ts';
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
const DISC = ROAD_HALF + 2; // m radius of a junction's asphalt patch: just covers two roads crossing
const PLANT_CELL = 7; // m between plant candidates, on a world-aligned grid
export const TREE = 0;
export const PINE = 1;
export const BUSH = 2;
export const ROCK = 3;
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
}

export interface ChunkData extends Grid {
  cx: number;
  cz: number;
  roads: Road[]; // runs of road whose segments' midpoints are in this chunk
  junctions: Junction[]; // in this chunk
  pois: Poi[]; // standing in this chunk
  ribbon: RoadMesh; // this chunk's roads and junction patches
  plants: Float32Array; // x, y, z (from the chunk centre), scale, yaw, kind (TREE, PINE, BUSH, ROCK) per plant
}

/** Terrain height from the field sample, the exact nearby road (`near`) and the lattice road distance (`far`). */
export function shape(s: Sample, near: Near, far: number, pads: Poi[], x: number, z: number): number {
  let h = near.d < FLAT + BLEND ? near.h + (s.smooth - near.h) * smoothstep(FLAT, FLAT + BLEND, near.d) : s.smooth;
  let hills = smoothstep(FLAT, REACH, Math.min(near.d, far));
  const offRoad = smoothstep(FLAT, FLAT + 6, near.d); // pads never move the road itself
  for (const p of pads) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.pad + 80) continue;
    hills = Math.min(hills, smoothstep(p.pad, p.pad + 80, d));
    h += (p.h - h) * (1 - smoothstep(p.pad, p.pad + 20, d)) * offRoad;
  }
  h += s.detail * hills;
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
  const s: Sample = { c: 0, smooth: 0, detail: 0 };
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
    }
  }
  return { heights, roadDist, cont };
}

export function buildChunk(f: Fields, area: Area, cx: number, cz: number): ChunkData {
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const { heights, roadDist, cont } = sampleGrid(f, area, cx, cz, RES);
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
  const pads = area.pois.filter((p) => p.pad > 0);
  return {
    cx,
    cz,
    heights,
    roadDist,
    cont,
    roads,
    junctions,
    pois: area.pois.filter((p) => owns(p.x, p.z)),
    ribbon: roadMesh(roads, area.junctions, junctions, roadH, x0 + CHUNK / 2, z0 + CHUNK / 2),
    plants: plants(f, cx, cz, heights, roadDist, cont, pads),
  };
}

function slice(r: Road, a: number, b: number): Road {
  return { coast: r.coast, id: r.id, x: r.x.slice(a, b), z: r.z.slice(a, b), h: r.h.slice(a, b), nx: r.nx.slice(a, b), nz: r.nz.slice(a, b) };
}

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
    for (const j of near) d = Math.min(d, Math.hypot(j.x - x, j.z - z));
    return smoothstep(DISC + 2, DISC + 10, d);
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
        pos.push(r.x[k] + r.nx[k] * ROAD_HALF * side - ox, r.h[k] + LIFT, r.z[k] + r.nz[k] * ROAD_HALF * side - oz);
        uv.push(along[n - 1] > 0 ? (along[k] / along[n - 1]) * periods : 0, side * ROAD_HALF);
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
      const x = j.x + Math.cos(a) * DISC;
      const z = j.z + Math.sin(a) * DISC;
      pos.push(x - ox, roadH(x, z, j.h) + LIFT + 0.015, z - oz);
      uv.push(0, 0);
      mark.push(0);
      idx.push(c, c + 1 + ((s + 1) % 24), c + 1 + s);
    }
  }
  return { position: Float32Array.from(pos), uv: Float32Array.from(uv), mark: Float32Array.from(mark), index: Uint32Array.from(idx) };
}

/** Trees, pines, bushes and rocks: one candidate per world-aligned cell, kept by place (woods, coast, slope). */
function plants(f: Fields, cx: number, cz: number, heights: Float32Array, roadDist: Float32Array, cont: Float32Array, pads: Poi[]) {
  const out: number[] = [];
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  for (let i = Math.floor(x0 / PLANT_CELL); i <= Math.floor((x0 + CHUNK) / PLANT_CELL); i++) {
    for (let j = Math.floor(z0 / PLANT_CELL); j <= Math.floor((z0 + CHUNK) / PLANT_CELL); j++) {
      const r = (salt: number) => rand(f.seed, i, j, salt);
      const x = (i + r(1)) * PLANT_CELL;
      const z = (j + r(2)) * PLANT_CELL;
      if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
      const u = (x - x0) / STEP + 1; // position in the sample grid
      const v = (z - z0) / STEP + 1;
      const a = Math.floor(u);
      const b = Math.floor(v);
      const k = a * N + b;
      const fu = u - a;
      const fv = v - b;
      const h = (heights[k] * (1 - fu) + heights[k + N] * fu) * (1 - fv) + (heights[k + 1] * (1 - fu) + heights[k + N + 1] * fu) * fv;
      const c = cont[k];
      if (roadDist[k] < FLAT + 4 || h < 2.5 || c < 0.03) continue;
      if (pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.pad + 8)) continue;
      const slope = Math.hypot(heights[k + N] - heights[k - N], heights[k + 1] - heights[k - 1]) / (2 * STEP);
      const woods = smoothstep(0.45, 0.75, f.woods(x, z)) * smoothstep(0.08, 0.16, c);
      const tree = 0.015 + 0.4 * woods;
      const bush = c < 0.1 ? 0.1 : 0.05; // the coast is scrubby
      const roll = r(3);
      let kind = -1;
      if (slope > 0.7) kind = roll < 0.06 ? ROCK : -1;
      else if (roll < tree) kind = h > 55 || r(4) < 0.35 ? PINE : TREE;
      else if (roll < tree + bush) kind = BUSH;
      else if (roll < tree + bush + 0.012) kind = ROCK;
      if (kind < 0) continue;
      out.push(x - (x0 + CHUNK / 2), h - 0.15, z - (z0 + CHUNK / 2), 0.75 + r(5) * 0.6, r(6) * Math.PI * 2, kind);
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
