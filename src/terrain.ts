// Terrain tile vertices from a sampled grid: positions, normals and colours, and a skirt that hides LOD cracks.
// Pure (no three.js), so workers build it.
import { CHUNK, type Grid } from './world/chunk.ts';
import { smoothstep } from './world/fields.ts';
import { ROAD_HALF } from './world/roads.ts';

const SKIRT = 12; // m a tile's skirt hangs below its edge
// linear RGB
const SAND = [0.47, 0.4, 0.28];
const GRASS = [0.2, 0.27, 0.085]; // olive, Mediterranean
const DRY = [0.42, 0.36, 0.15]; // golden, late summer
const ROCK = [0.32, 0.3, 0.27];
const GRAVEL = [0.26, 0.24, 0.21];
const MEADOW = [0.15, 0.25, 0.1]; // mountain grass
const SNOW = [0.8, 0.83, 0.88];
const DESERT = [0.6, 0.44, 0.27];
const RED_ROCK = [0.48, 0.26, 0.16];

export interface TileMesh {
  position: Float32Array; // relative to the tile centre
  normal: Float32Array;
  color: Float32Array;
  cold: Float32Array; // 0–1 per vertex: where winter's snow can lie (inland, not desert)
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
export function terrainMesh({ heights, cont, roadDist, alpine, arid }: Grid, res: number, skirt: boolean): TileMesh {
  const n = res + 3;
  const m = res + 1;
  const step = CHUNK / res;
  const edge = skirt ? perimeter(res) : [];
  const count = m * m + edge.length;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const cold = new Float32Array(count);
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
      // Grass drying out uphill, mountain meadows, desert sand, sand by the sea, rock on steep ground (more of it in
      // the mountains, red in the desert), snow up high where it can lie, gravel along the road edges.
      const a = alpine[at];
      const d = arid[at];
      const steep = 1 - ny;
      c[0] = GRASS[0];
      c[1] = GRASS[1];
      c[2] = GRASS[2];
      toward(DRY, smoothstep(50, 130, h) * (1 - a));
      toward(MEADOW, a);
      toward(DESERT, d);
      toward(SAND, (1 - smoothstep(1.5, 4, h)) * (1 - smoothstep(0.03, 0.06, cont[at])));
      toward(d > 0.5 ? RED_ROCK : ROCK, smoothstep(0.12 - 0.05 * a, 0.25 - 0.08 * a, steep));
      toward(SNOW, smoothstep(400, 470, h) * (1 - smoothstep(0.3, 0.5, steep)));
      toward(GRAVEL, 1 - smoothstep(ROAD_HALF + 0.5, ROAD_HALF + 3, roadDist[at]));
      cold[v / 3] = (1 - d) * smoothstep(0.12, 0.3, cont[at]);
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
    cold[m * m + k] = cold[g];
  });
  return { position, normal, color, cold };
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
