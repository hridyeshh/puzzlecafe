// A tile is one chunk at one level of detail, built off the main thread from the pure world code.
import { type TileMesh, terrainMesh } from './terrain.ts';
import { CHUNK, type Grid, RES, type RoadMesh, type WallMesh, colliderHeights } from './world/chunk.ts';
import { CROWN, MANDIR } from './world/blocks.ts';
import { biomeAt } from './world/places.ts';
import type { Poi } from './world/pois.ts';
import type { World } from './world/world.ts';

/** Cells a side per level of detail, and how many chunks out from the car each level reaches. */
export const LODS = [
  { res: RES, reach: 2 }, // 2 m: roads, props, plants, colliders
  { res: 32, reach: 5 }, // 8 m, carved for roads
  { res: 16, reach: 9 }, // 16 m, out to ~2.4 km
];

export interface Tile {
  cx: number;
  cz: number;
  lod: number;
  mesh: TileMesh;
  collider: Float32Array | null; // heightfield, full detail only
  ribbon: RoadMesh | null;
  plants: Float32Array | null;
  wall: WallMesh | null;
  rail: WallMesh | null;
  signs: Float32Array | null; // x, y, z, yaw, kind per road sign
  houses: Float32Array; // x, y, z (from the tile centre), yaw, w, h, d, tint per village house; at every detail
  blocks: Float32Array; // x, y, z (from the tile centre), yaw, w, h, d, style per city building's box; at every detail
  props: Float32Array; // x, y, z (from the tile centre), yaw, size, kind per city prop; crowns and mandirs at every detail
  pois: (Poi & { base: number; variant: string })[]; // base: the ground its prop stands on; variant: a café's style
}

/**
 * The houses standing in chunk (cx, cz) as records for houses.ts, each on the ground of `grid` (sampled at `res`) at the
 * highest corner of its footprint, so on a slope its plinth shows below rather than its door sinking into the hill.
 */
function houseRecords(world: World, grid: Grid, cx: number, cz: number, res: number): Float32Array {
  const step = CHUNK / res;
  const n = res + 3;
  const ground = (x: number, z: number) => {
    const u = Math.min(n - 1.001, Math.max(0, (x - cx * CHUNK) / step + 1));
    const v = Math.min(n - 1.001, Math.max(0, (z - cz * CHUNK) / step + 1));
    const [a, b] = [Math.floor(u), Math.floor(v)];
    const [fu, fv] = [u - a, v - b];
    const h = grid.heights;
    const k = a * n + b;
    return (h[k] * (1 - fu) + h[k + n] * fu) * (1 - fv) + (h[k + 1] * (1 - fu) + h[k + n + 1] * fu) * fv;
  };
  const out: number[] = [];
  for (const h of world.houses(cx, cz)) {
    const [c, s] = [Math.cos(h.yaw), Math.sin(h.yaw)];
    let y = -Infinity;
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [lx, lz] = [(dx * h.w) / 2, (dz * h.d) / 2];
      y = Math.max(y, ground(h.x + lx * c + lz * s, h.z - lx * s + lz * c));
    }
    out.push(h.x - (cx + 0.5) * CHUNK, y, h.z - (cz + 0.5) * CHUNK, h.yaw, h.w, h.h, h.d, h.tint);
  }
  return Float32Array.from(out);
}

/** The city buildings standing in chunk (cx, cz) as records for city.ts, on the city's level ground. */
function blockRecords(world: World, cx: number, cz: number): Float32Array {
  const level = world.fields.city?.level ?? 0;
  return Float32Array.from(world.blocks(cx, cz).flatMap((b) => [b.x - (cx + 0.5) * CHUNK, level + b.y, b.z - (cz + 0.5) * CHUNK, b.yaw, b.w, b.h, b.d, b.style]));
}

/** The city's props in chunk (cx, cz) as records for city.ts; beyond the nearest tiles only what stands over the roofs
 * (crowns, mandirs). */
function propRecords(world: World, cx: number, cz: number, far: boolean): Float32Array {
  const level = world.fields.city?.level ?? 0;
  const props = world.props(cx, cz).filter((p) => !far || p.kind === CROWN || p.kind === MANDIR);
  return Float32Array.from(props.flatMap((p) => [p.x - (cx + 0.5) * CHUNK, level + p.y, p.z - (cz + 0.5) * CHUNK, p.yaw, p.s, p.kind]));
}

export function buildTile(world: World, cx: number, cz: number, lod: number): Tile {
  if (lod === 0) {
    const d = world.chunk(cx, cz);
    // Cafés take the style of the country they stand in: a coast café, a farmhouse, a mountain lodge, a desert diner.
    const pois = d.pois.map((p) => ({
      ...p,
      base: p.kind === 'hoarding' ? world.heightAt(p.x, p.z) : p.h,
      variant: p.kind === 'cafe' ? biomeAt(world.fields, p.x, p.z) : '',
    }));
    return {
      cx,
      cz,
      lod,
      mesh: terrainMesh(d, RES, false),
      collider: colliderHeights(d.heights),
      ribbon: d.ribbon,
      plants: d.plants,
      wall: d.wall,
      rail: d.rail,
      signs: d.signs,
      pois,
      houses: houseRecords(world, d, cx, cz, RES),
      blocks: blockRecords(world, cx, cz),
      props: propRecords(world, cx, cz, false),
    };
  }
  const { res } = LODS[lod];
  const g = world.grid(cx, cz, res, lod === 1);
  const mesh = terrainMesh(g, res, true);
  return {
    cx,
    cz,
    lod,
    mesh,
    collider: null,
    ribbon: null,
    plants: null,
    wall: null,
    rail: null,
    signs: null,
    pois: [],
    houses: houseRecords(world, g, cx, cz, res),
    blocks: blockRecords(world, cx, cz),
    props: propRecords(world, cx, cz, true),
  };
}

/** The buffers in a tile, to transfer to the main thread rather than copy. */
export function transfers(t: Tile): ArrayBuffer[] {
  const { ribbon, wall, rail } = t;
  const arrays = [t.mesh.position, t.mesh.normal, t.mesh.color, t.mesh.cold, t.mesh.arid, t.mesh.town, t.collider, t.plants, ribbon?.position, ribbon?.uv, ribbon?.mark, ribbon?.index, wall?.position, wall?.normal, wall?.uv, wall?.boxes, rail?.position, rail?.normal, rail?.uv, rail?.boxes, t.signs, t.houses, t.blocks, t.props];
  return arrays.filter((a) => a !== null && a !== undefined).map((a) => a.buffer as ArrayBuffer);
}
