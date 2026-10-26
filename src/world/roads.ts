// Roads: the coast road follows a contour of continentalness; an inland grid of curved roads ends on it in T-junctions.
import { COAST_C, type Fields } from './fields.ts';
import { hash, rand } from './hash.ts';

export const ROAD_HALF = 4; // m: two 3.5 m lanes and their edge lines
export const LANE = ROAD_HALF / 2; // m from the centreline to the middle of a lane
export const MS = 8; // m between road vertices, and the marching-squares step
export const GRID = 1024; // m between inland road nodes
const NODE_C = COAST_C + 0.03; // grid nodes stay this far inland of the coast road
const EDGE_P = 0.72; // chance a grid edge exists before dead ends are filled in
const CELL = 32; // m buckets for nearest-road queries

/** A road polyline as flat per-vertex arrays. */
export interface Road {
  coast: boolean;
  id: number; // hash of the grid edge piece; 0 on the coast road
  x: number[];
  z: number[];
  h: number[];
  nx: number[]; // unit across-road direction (inland, on the coast road)
  nz: number[];
}

export interface Junction {
  x: number;
  z: number;
  h: number;
}

type Point = [number, number, number, number]; // x, z, unit tangent x, z

function newRoad(coast: boolean, id: number): Road {
  return { coast, id, x: [], z: [], h: [], nx: [], nz: [] };
}

function add(f: Fields, r: Road, x: number, z: number, nx: number, nz: number) {
  r.x.push(x);
  r.z.push(z);
  r.h.push(f.smooth(x, z));
  r.nx.push(nx);
  r.nz.push(nz);
}

/** Unit direction in which continentalness grows (inland). */
export function gradient(f: Fields, x: number, z: number): [number, number] {
  const gx = f.continent(x + 1, z) - f.continent(x - 1, z);
  const gz = f.continent(x, z + 1) - f.continent(x, z - 1);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

/**
 * The coast road inside [x0, x1] × [z0, z1]: the C = COAST_C contour, by marching squares on a world-aligned grid.
 * The world traces at MS; the map traces coarser.
 */
export function traceCoast(f: Fields, x0: number, z0: number, x1: number, z1: number, step = MS): Road[] {
  const i0 = Math.floor(x0 / step);
  const j0 = Math.floor(z0 / step);
  const W = Math.ceil(x1 / step) - i0 + 1;
  const H = Math.ceil(z1 / step) - j0 + 1;
  const v = new Float64Array(W * H);
  for (let a = 0; a < W; a++) for (let b = 0; b < H; b++) v[a * H + b] = f.continent((i0 + a) * step, (j0 + b) * step) - COAST_C;

  // Edge 2k joins sample k = a·H + b to (a + 1, b); edge 2k + 1 joins it to (a, b + 1).
  const links = new Map<number, number[]>();
  const link = (p: number, q: number) => {
    for (const [e, other] of [[p, q], [q, p]]) {
      const list = links.get(e);
      if (list) list.push(other);
      else links.set(e, [other]);
    }
  };
  for (let a = 0; a < W - 1; a++) {
    for (let b = 0; b < H - 1; b++) {
      const k = a * H + b;
      const s00 = v[k] >= 0;
      const s10 = v[k + H] >= 0;
      const s01 = v[k + 1] >= 0;
      const s11 = v[k + H + 1] >= 0;
      const bottom = s00 !== s10 ? 2 * k : -1;
      const top = s01 !== s11 ? 2 * (k + 1) : -1;
      const left = s00 !== s01 ? 2 * k + 1 : -1;
      const right = s10 !== s11 ? 2 * (k + H) + 1 : -1;
      const cut = [bottom, right, top, left].filter((e) => e >= 0);
      if (cut.length === 2) link(cut[0], cut[1]);
      else if (cut.length === 4) {
        // A saddle: the cell centre decides which corners connect.
        if ((v[k] + v[k + H] + v[k + 1] + v[k + H + 1] >= 0) === s00) {
          link(bottom, right);
          link(top, left);
        } else {
          link(bottom, left);
          link(right, top);
        }
      }
    }
  }

  const at = (e: number): [number, number] => {
    const k = e >> 1;
    const a = Math.floor(k / H);
    const b = k - a * H;
    const t = v[k] / (v[k] - v[e & 1 ? k + 1 : k + H]);
    return e & 1 ? [(i0 + a) * step, (j0 + b + t) * step] : [(i0 + a + t) * step, (j0 + b) * step];
  };
  const roads: Road[] = [];
  const seen = new Set<number>();
  const walk = (start: number) => {
    const r = newRoad(true, 0);
    let prev = -1;
    let e = start;
    while (e >= 0) {
      seen.add(e);
      const [x, z] = at(e);
      const [nx, nz] = gradient(f, x, z);
      add(f, r, x, z, nx, nz);
      const next = links.get(e)!.find((n) => n !== prev && !seen.has(n));
      prev = e;
      e = next ?? -1;
    }
    // Close a loop. Loops under 150 m across (contours round a small bump) are dropped: an 8 m road folds into a
    // blob of asphalt in a curve that tight, and it leads nowhere.
    if (links.get(start)!.length === 2 && links.get(prev)!.includes(start)) {
      if (Math.max(Math.max(...r.x) - Math.min(...r.x), Math.max(...r.z) - Math.min(...r.z)) < 150) return;
      add(f, r, r.x[0], r.z[0], r.nx[0], r.nz[0]);
    }
    if (r.x.length > 1) roads.push(r);
  };
  for (const [e, list] of links) if (list.length === 1 && !seen.has(e)) walk(e);
  for (const e of links.keys()) if (!seen.has(e)) walk(e);
  return roads;
}

function catmullRom(p0: number[], p1: number[], p2: number[], p3: number[], t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const pos = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  const der = (a: number, b: number, c: number, d: number) =>
    0.5 * (c - a + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (3 * b - a - 3 * c + d) * t2);
  const tx = der(p0[0], p1[0], p2[0], p3[0]);
  const tz = der(p0[1], p1[1], p2[1], p3[1]);
  const l = Math.hypot(tx, tz) || 1;
  return [pos(p0[0], p1[0], p2[0], p3[0]), pos(p0[1], p1[1], p2[1], p3[1]), tx / l, tz / l];
}

interface Edge {
  pieces: Road[];
  boxes: number[][]; // min x, min z, max x, max z per piece
  tees: Junction[]; // where the pieces meet the coast road
}

export function makeRoads(f: Fields) {
  const seed = f.seed;
  const edges = new Map<string, Edge>();

  const nodeAt = (i: number, j: number): [number, number] => [
    (i + 0.5 + (rand(seed, i, j, 11) - 0.5) * 0.6) * GRID,
    (j + 0.5 + (rand(seed, i, j, 12) - 0.5) * 0.6) * GRID,
  ];
  const land = (i: number, j: number) => {
    const [x, z] = nodeAt(i, j);
    return f.continent(x, z) > NODE_C;
  };
  const base = (i: number, j: number, dir: number) => rand(seed, i, j, 20 + dir) < EDGE_P;
  // A node's four edges as [i, j, dir]: +x, +z, -x, -z.
  const around = (i: number, j: number) => [[i, j, 0], [i, j, 1], [i - 1, j, 0], [i, j - 1, 1]];
  // Edges a node adds so it is no dead end. Decided from base edges only, so both ends of an edge agree.
  const forced = (i: number, j: number) => {
    const all = around(i, j);
    const missing = all.filter(([a, b, d]) => !base(a, b, d));
    const need = 2 - (all.length - missing.length);
    if (need <= 0) return [];
    return missing
      .sort((p, q) => hash(seed, p[0], p[1], 30 + p[2]) - hash(seed, q[0], q[1], 30 + q[2]))
      .slice(0, need)
      .map(([a, b, d]) => `${a},${b},${d}`);
  };
  const exists = (i: number, j: number, dir: number) => {
    const bi = i + 1 - dir;
    const bj = j + dir;
    const la = land(i, j);
    const lb = land(bi, bj);
    if (!la && !lb) return false;
    if (base(i, j, dir)) return true;
    const key = `${i},${j},${dir}`;
    return (la && forced(i, j).includes(key)) || (lb && forced(bi, bj).includes(key));
  };
  // Junction unless the road just runs straight through.
  const isJunction = (i: number, j: number) => {
    if (!land(i, j)) return false;
    const e = around(i, j).map(([a, b, d]) => exists(a, b, d));
    const n = e.filter(Boolean).length;
    return n >= 3 || (n === 2 && !(e[0] && e[2]) && !(e[1] && e[3]));
  };

  function buildEdge(i: number, j: number, dir: number): Edge {
    const di = 1 - dir;
    const dj = dir;
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((s) => nodeAt(i + s * di, j + s * dj));
    const la = land(i, j);
    const lb = land(i + di, j + dj);
    const steps = Math.ceil((Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 1.15) / MS);
    let pts: Point[] = [];
    for (let s = 0; s <= steps; s++) pts.push(catmullRom(p0, p1, p2, p3, s / steps));
    // An edge toward a sea-side node runs on in a straight line until it reaches the coast road.
    const runOn = (from: Point, sign: number) => {
      const out: Point[] = [];
      for (let k = 1; k <= 100; k++) {
        const x = from[0] + from[2] * sign * MS * k;
        const z = from[1] + from[3] * sign * MS * k;
        out.push([x, z, from[2], from[3]]);
        if (f.continent(x, z) < COAST_C) break;
      }
      return out;
    };
    if (!lb) pts = pts.concat(runOn(pts[pts.length - 1], 1));
    if (!la) pts = runOn(pts[0], -1).reverse().concat(pts);
    const c = pts.map((p) => f.continent(p[0], p[1]) - COAST_C);
    const cross = (a: Point, b: Point, ca: number): Point => {
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 12; it++) {
        const m = (lo + hi) / 2;
        const cm = f.continent(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m) - COAST_C;
        if (cm >= 0 === ca >= 0) lo = m;
        else hi = m;
      }
      const t = (lo + hi) / 2;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2], a[3]];
    };

    // Keep the stretches on land that reach a land node, cut exactly at the coast road.
    const id = hash(seed, i, j, 40 + dir);
    const edge: Edge = { pieces: [], boxes: [], tees: [] };
    let run: Point[] = [];
    let tees: Point[] = [];
    let fromNode = false;
    const finish = (toNode: boolean) => {
      if (run.length > 1 && (fromNode || toNode)) {
        const r = newRoad(false, hash(seed, id, edge.pieces.length));
        for (const [x, z, tx, tz] of run) add(f, r, x, z, -tz, tx);
        edge.pieces.push(r);
        edge.boxes.push([Math.min(...r.x), Math.min(...r.z), Math.max(...r.x), Math.max(...r.z)]);
        for (const [x, z] of tees) edge.tees.push({ x, z, h: f.smooth(x, z) });
      }
      run = [];
      tees = [];
    };
    for (let k = 0; k < pts.length; k++) {
      if (c[k] >= 0) {
        if (run.length === 0) {
          fromNode = k === 0 && la;
          if (k > 0) {
            const p = cross(pts[k - 1], pts[k], c[k - 1]);
            run.push(p);
            tees.push(p);
          }
        }
        run.push(pts[k]);
      } else if (run.length > 0) {
        const p = cross(pts[k - 1], pts[k], c[k - 1]);
        run.push(p);
        tees.push(p);
        finish(false);
      }
    }
    if (run.length > 0) finish(lb);
    return edge;
  }

  const edge = (i: number, j: number, dir: number): Edge => {
    const key = `${i},${j},${dir}`;
    let e = edges.get(key);
    if (!e) {
      e = buildEdge(i, j, dir);
      if (edges.size >= 4096) edges.delete(edges.keys().next().value!);
      edges.set(key, e);
    }
    return e;
  };

  /** Every road touching [x0, x1) × [z0, z1), and the junctions inside it. */
  function area(x0: number, z0: number, x1: number, z1: number): { roads: Road[]; junctions: Junction[] } {
    const inland = grid(x0, z0, x1, z1);
    return { roads: traceCoast(f, x0, z0, x1, z1).concat(inland.roads), junctions: inland.junctions };
  }

  /** The inland roads touching [x0, x1) × [z0, z1), and every junction inside it. */
  function grid(x0: number, z0: number, x1: number, z1: number): { roads: Road[]; junctions: Junction[] } {
    const roads: Road[] = [];
    const junctions: Junction[] = [];
    const inside = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;
    for (let i = Math.floor(x0 / GRID) - 3; i <= Math.floor(x1 / GRID) + 1; i++) {
      for (let j = Math.floor(z0 / GRID) - 3; j <= Math.floor(z1 / GRID) + 1; j++) {
        for (let dir = 0; dir < 2; dir++) {
          if (!exists(i, j, dir)) continue;
          const e = edge(i, j, dir);
          e.pieces.forEach((p, k) => {
            const [bx0, bz0, bx1, bz1] = e.boxes[k];
            if (bx1 >= x0 && bx0 < x1 && bz1 >= z0 && bz0 < z1) roads.push(p);
          });
          for (const t of e.tees) if (inside(t.x, t.z)) junctions.push(t);
        }
        const [x, z] = nodeAt(i, j);
        if (inside(x, z) && isJunction(i, j)) junctions.push({ x, z, h: f.smooth(x, z) });
      }
    }
    return { roads, junctions };
  }

  return { area, grid, nodeAt, land, exists };
}

/** Nearest road point: distance to the centreline and the road height there. */
export interface Near {
  d: number;
  h: number;
}

const cellKey = (gx: number, gz: number) => (gx + 1048576) * 2097152 + (gz + 1048576);

/** Road segments bucketed for nearest-road queries. */
export class RoadIndex {
  private seg: Float64Array; // ax, az, bx, bz, ah, bh per segment
  private cells = new Map<number, number[]>();

  constructor(roads: Road[]) {
    const s: number[] = [];
    for (const r of roads) for (let k = 0; k + 1 < r.x.length; k++) s.push(r.x[k], r.z[k], r.x[k + 1], r.z[k + 1], r.h[k], r.h[k + 1]);
    this.seg = Float64Array.from(s);
    for (let i = 0; i < s.length; i += 6) {
      for (let gx = Math.floor(Math.min(s[i], s[i + 2]) / CELL); gx <= Math.floor(Math.max(s[i], s[i + 2]) / CELL); gx++) {
        for (let gz = Math.floor(Math.min(s[i + 1], s[i + 3]) / CELL); gz <= Math.floor(Math.max(s[i + 1], s[i + 3]) / CELL); gz++) {
          const key = cellKey(gx, gz);
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  /** Nearest road within at least CELL m of x, z; `out.d` is Infinity when there is none. */
  near(x: number, z: number, out: Near): Near {
    out.d = Infinity;
    out.h = 0;
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gz - 1; b <= gz + 1; b++) {
        const list = this.cells.get(cellKey(a, b));
        if (list) for (const i of list) this.test(i, x, z, out);
      }
    }
    return out;
  }

  /** The nearest road point anywhere in the index, with the road's direction there; null if there are no roads. */
  closest(x: number, z: number): { x: number; z: number; h: number; tx: number; tz: number } | null {
    const out = { d: Infinity, h: 0 };
    let at = -1;
    for (let i = 0; i < this.seg.length; i += 6) {
      const d = out.d;
      this.test(i, x, z, out);
      if (out.d < d) at = i;
    }
    if (at < 0) return null;
    const s = this.seg;
    const dx = s[at + 2] - s[at];
    const dz = s[at + 3] - s[at + 1];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - s[at]) * dx + (z - s[at + 1]) * dz) / l2));
    const l = Math.sqrt(l2);
    return { x: s[at] + dx * t, z: s[at + 1] + dz * t, h: out.h, tx: dx / l, tz: dz / l };
  }

  /** Distance to the nearest road anywhere in the index. */
  dist(x: number, z: number): number {
    const out = { d: Infinity, h: 0 };
    for (let i = 0; i < this.seg.length; i += 6) this.test(i, x, z, out);
    return out.d;
  }

  private test(i: number, x: number, z: number, out: Near) {
    const s = this.seg;
    const ax = s[i];
    const az = s[i + 1];
    const dx = s[i + 2] - ax;
    const dz = s[i + 3] - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < out.d) {
      out.d = d;
      out.h = s[i + 4] + (s[i + 5] - s[i + 4]) * t;
    }
  }
}
