// The world: pure functions of a seed. Areas around chunks are cached; chunks are built on demand.
import { type Area, CHUNK, buildChunk, farAt, latticeDist, sampleGrid, shape } from './chunk.ts';
import { COAST_C, type Sample, makeFields } from './fields.ts';
import { placePois } from './pois.ts';
import { LANE, type Near, RoadIndex, makeRoads, traceCoast } from './roads.ts';

const MARGIN = 200; // m of roads and junctions loaded around a chunk
const POI_MARGIN = 140; // m around a chunk within which its area places POIs

export type World = ReturnType<typeof makeWorld>;

export function makeWorld(seed: number) {
  const fields = makeFields(seed);
  const roads = makeRoads(fields);
  const areas = new Map<string, Area>();

  /** Roads, junctions and POIs around chunk (cx, cz). */
  function area(cx: number, cz: number): Area {
    const key = `${cx},${cz}`;
    const cached = areas.get(key);
    if (cached) return cached;
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const found = roads.area(x0 - MARGIN, z0 - MARGIN, x0 + CHUNK + MARGIN, z0 + CHUNK + MARGIN);
    const index = new RoadIndex(found.roads);
    const box = [x0 - POI_MARGIN, z0 - POI_MARGIN, x0 + CHUNK + POI_MARGIN, z0 + CHUNK + POI_MARGIN] as const;
    const made = { ...found, index, pois: placePois(fields, found.roads, found.junctions, index, ...box) };
    if (areas.size >= 256) areas.delete(areas.keys().next().value!);
    areas.set(key, made);
    return made;
  }

  const sample: Sample = { c: 0, smooth: 0, detail: 0 };
  const near: Near = { d: 0, h: 0 };
  /** Terrain height at x, z; equal to the chunk meshes at their vertices. */
  function heightAt(x: number, z: number): number {
    const a = area(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    const far = farAt(x, z, (gx, gz) => latticeDist(a.index, gx, gz));
    const pads = a.pois.filter((p) => p.pad > 0);
    return shape(fields.sample(x, z, sample), a.index.near(x, z, near), far, pads, x, z);
  }

  /** The right lane of the coast road nearest the origin, heading with the sea on the right. */
  function spawn(): { x: number; z: number; yaw: number } {
    for (let ring = 0; ring < 40; ring++) {
      for (let cx = -ring; cx <= ring; cx++) {
        for (let cz = -ring; cz <= ring; cz++) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== ring) continue;
          let lo = Infinity;
          let hi = -Infinity;
          for (let a = 0; a <= 4; a++) {
            for (let b = 0; b <= 4; b++) {
              const c = fields.continent(cx * CHUNK + a * 64, cz * CHUNK + b * 64);
              lo = Math.min(lo, c);
              hi = Math.max(hi, c);
            }
          }
          if (lo > COAST_C || hi < COAST_C) continue;
          const mx = (cx + 0.5) * CHUNK;
          const mz = (cz + 0.5) * CHUNK;
          let best: [number, number, number, number] | null = null;
          let bestD = CHUNK / 2;
          for (const r of area(cx, cz).roads) {
            if (!r.coast) continue;
            for (let k = 0; k < r.x.length; k++) {
              const d = Math.max(Math.abs(r.x[k] - mx), Math.abs(r.z[k] - mz));
              if (d < bestD) {
                bestD = d;
                best = [r.x[k], r.z[k], r.nx[k], r.nz[k]];
              }
            }
          }
          if (best) {
            const [x, z, nx, nz] = best;
            // n points inland: heading (-nz, nx) keeps the sea on the right, and the right lane is on the sea side
            return { x: x - nx * LANE, z: z - nz * LANE, yaw: Math.atan2(-nz, nx) };
          }
        }
      }
    }
    return { x: 0, z: 0, yaw: 0 };
  }

  /** Roads and POIs over a large rectangle for the map, the coast traced every `step` metres. */
  function mapData(x0: number, z0: number, x1: number, z1: number, step: number) {
    const inland = roads.grid(x0, z0, x1, z1);
    const all = traceCoast(fields, x0, z0, x1, z1, step).concat(inland.roads);
    return { roads: all, pois: placePois(fields, all, inland.junctions, new RoadIndex(all), x0, z0, x1, z1) };
  }

  return {
    seed,
    fields,
    area,
    heightAt,
    spawn,
    mapData,
    chunk: (cx: number, cz: number) => buildChunk(fields, area(cx, cz), cx, cz),
    /** Chunk (cx, cz) sampled at `res` cells a side for distant tiles; roads carve it only when `roads` is set. */
    grid: (cx: number, cz: number, res: number, roads: boolean) => sampleGrid(fields, roads ? area(cx, cz) : null, cx, cz, res),
  };
}
