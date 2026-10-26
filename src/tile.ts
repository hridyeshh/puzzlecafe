// A tile is one chunk at one level of detail, built off the main thread from the pure world code.
import { type TileMesh, terrainMesh } from './terrain.ts';
import { RES, type RoadMesh, colliderHeights } from './world/chunk.ts';
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
  pois: (Poi & { base: number })[]; // base: the ground height its prop stands on
}

export function buildTile(world: World, cx: number, cz: number, lod: number): Tile {
  if (lod === 0) {
    const d = world.chunk(cx, cz);
    const pois = d.pois.map((p) => ({ ...p, base: p.kind === 'hoarding' ? world.heightAt(p.x, p.z) : p.h }));
    return {
      cx,
      cz,
      lod,
      mesh: terrainMesh(d.heights, d.cont, d.roadDist, RES, false),
      collider: colliderHeights(d.heights),
      ribbon: d.ribbon,
      plants: d.plants,
      pois,
    };
  }
  const { res } = LODS[lod];
  const g = world.grid(cx, cz, res, lod === 1);
  return { cx, cz, lod, mesh: terrainMesh(g.heights, g.cont, g.roadDist, res, true), collider: null, ribbon: null, plants: null, pois: [] };
}

/** The buffers in a tile, to transfer to the main thread rather than copy. */
export function transfers(t: Tile): ArrayBuffer[] {
  const arrays = [t.mesh.position, t.mesh.normal, t.mesh.color, t.collider, t.plants, t.ribbon?.position, t.ribbon?.uv, t.ribbon?.mark, t.ribbon?.index];
  return arrays.filter((a) => a !== null && a !== undefined).map((a) => a.buffer as ArrayBuffer);
}
