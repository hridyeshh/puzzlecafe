// A tile is one chunk at one level of detail, built off the main thread from the pure world code.
import { type TileMesh, terrainMesh } from './terrain.ts';
import { RES, type RoadMesh, type WallMesh, colliderHeights } from './world/chunk.ts';
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
  pois: (Poi & { base: number; variant: string })[]; // base: the ground its prop stands on; variant: a café's style
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
    };
  }
  const { res } = LODS[lod];
  const g = world.grid(cx, cz, res, lod === 1);
  const mesh = terrainMesh(g, res, true);
  return { cx, cz, lod, mesh, collider: null, ribbon: null, plants: null, wall: null, rail: null, signs: null, pois: [] };
}

/** The buffers in a tile, to transfer to the main thread rather than copy. */
export function transfers(t: Tile): ArrayBuffer[] {
  const { ribbon, wall, rail } = t;
  const arrays = [t.mesh.position, t.mesh.normal, t.mesh.color, t.mesh.cold, t.collider, t.plants, ribbon?.position, ribbon?.uv, ribbon?.mark, ribbon?.index, wall?.position, wall?.normal, wall?.uv, wall?.boxes, rail?.position, rail?.normal, rail?.uv, rail?.boxes, t.signs];
  return arrays.filter((a) => a !== null && a !== undefined).map((a) => a.buffer as ArrayBuffer);
}
