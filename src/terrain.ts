// Terrain tile vertices from a sampled grid: positions, normals and colours, and a skirt that hides LOD cracks.
// Pure (no three.js), so workers build it.
import { CHUNK } from './world/chunk.ts';
import { smoothstep } from './world/fields.ts';
import { ROAD_HALF } from './world/roads.ts';

const SKIRT = 12; // m a tile's skirt hangs below its edge
// linear RGB
const SAND = [0.47, 0.4, 0.28];
const GRASS = [0.17, 0.27, 0.09];
const DRY = [0.36, 0.33, 0.16];
const ROCK = [0.32, 0.3, 0.27];
const GRAVEL = [0.26, 0.24, 0.21];

export interface TileMesh {
  position: Float32Array; // relative to the tile centre
  normal: Float32Array;
  color: Float32Array;
}

/** Grid vertices around a tile's edge, in order: 4·res of them. The skirt hangs from these. */
function perimeter(res: number): number[] {
  const m = res + 1;
  const out: number[] = [];
  for (let j = 0; j < res; j++) out.push(j);
  for (let i = 0; i < res; i++) out.push(i * m + res);
  for (let j = res; j > 0; j--) out.push(res * m + j);
  for (let i = res; i > 0; i--) out.push(i * m);
  return out;
}

/**
 * Vertices for a tile sampled at `res` cells a side (arrays with a one-sample border, (res + 3)² each).
 * Coarse tiles get a skirt; full-detail tiles don't, because they cast shadows and only meet seamless neighbours or
 * coarse ones whose skirts already cover the crack.
 */
export function terrainMesh(heights: Float32Array, cont: Float32Array, roadDist: Float32Array, res: number, skirt: boolean): TileMesh {
  const n = res + 3;
  const m = res + 1;
  const step = CHUNK / res;
  const edge = skirt ? perimeter(res) : [];
  const count = m * m + edge.length;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const c = [0, 0, 0];
  const toward = (to: number[], t: number) => {
    for (let i = 0; i < 3; i++) c[i] += (to[i] - c[i]) * t;
  };
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const v = (i * m + j) * 3;
      const at = (i + 1) * n + j + 1;
      const dx = (heights[at + n] - heights[at - n]) / (2 * step);
      const dz = (heights[at + 1] - heights[at - 1]) / (2 * step);
      const ny = 1 / Math.hypot(dx, 1, dz);
      const h = heights[at];
      position[v] = i * step - CHUNK / 2;
      position[v + 1] = h;
      position[v + 2] = j * step - CHUNK / 2;
      normal[v] = -dx * ny;
      normal[v + 1] = ny;
      normal[v + 2] = -dz * ny;
      // Grass drying out uphill, sand by the sea, rock on steep ground, gravel along the road edges.
      c[0] = GRASS[0];
      c[1] = GRASS[1];
      c[2] = GRASS[2];
      toward(DRY, smoothstep(50, 130, h));
      toward(SAND, (1 - smoothstep(1.5, 4, h)) * (1 - smoothstep(0.03, 0.06, cont[at])));
      toward(ROCK, smoothstep(0.12, 0.25, 1 - ny));
      toward(GRAVEL, 1 - smoothstep(ROAD_HALF + 0.5, ROAD_HALF + 3, roadDist[at]));
      color[v] = c[0];
      color[v + 1] = c[1];
      color[v + 2] = c[2];
    }
  }
  // The skirt: each edge vertex again, hanging below.
  edge.forEach((g, k) => {
    const v = (m * m + k) * 3;
    position.set(position.subarray(g * 3, g * 3 + 3), v);
    position[v + 1] -= SKIRT;
    normal.set(normal.subarray(g * 3, g * 3 + 3), v);
    color.set(color.subarray(g * 3, g * 3 + 3), v);
  });
  return { position, normal, color };
}

/** Triangles for a tile at `res`: the grid, then any skirt from both sides so it shows from anywhere. */
export function terrainIndex(res: number, skirt: boolean): Uint32Array {
  const m = res + 1;
  const edge = skirt ? perimeter(res) : [];
  const out: number[] = [];
  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      const a = i * m + j;
      const b = a + m;
      out.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  edge.forEach((g, k) => {
    const next = (k + 1) % edge.length;
    const s = m * m + k;
    const s2 = m * m + next;
    out.push(g, edge[next], s, edge[next], s2, s, g, s, edge[next], edge[next], s, s2);
  });
  return Uint32Array.from(out);
}
