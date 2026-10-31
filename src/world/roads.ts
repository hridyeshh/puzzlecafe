// Roads: the coast road follows a contour of continentalness; an inland grid of curved roads ends on it in T-junctions.
// Every third grid line is a highway (~3 km cells): straighter, unbroken, with shoulders; the rest are narrow local roads.
import { BLOCK, type City, DAM, FRONT, GHAT, LANES, riverAt, urban } from './cities.ts';
import { COAST_C, type Fields, smoothstep } from './fields.ts';
import { hash } from './hash.ts';
import { GRID } from './nodes.ts';

export const ROAD_HALF = 4; // m: two 3.5 m lanes and their edge lines (the coast road), the width distances assume
export const HIGHWAY_HALF = 6.2; // m: the same lanes with 2.5 m shoulders
export const LOCAL_HALF = 3.3; // m: narrow lanes, too narrow for edge lines
export const LANE = ROAD_HALF / 2; // m from the centreline to the middle of a lane
/** The middle of a lane on road `r`: LANE, or the middle of a local road's narrower lane. */
export const laneOf = (r: { half: number }) => Math.min(LANE, r.half / 2);
export const MS = 8; // m between road vertices, and the marching-squares step
const CELL = 32; // m buckets for nearest-road queries

/** A road polyline as flat per-vertex arrays. */
export interface Road {
  coast: boolean;
  pass: boolean; // climbs over a mountain pass in hairpins
  city?: true; // a city's street: no countryside cafés, stations or hoardings on it
  deck?: true; // raised on stilts: the land is not carved to it (RoadIndex leaves it out unless asked)
  id: number; // hash of the grid edge piece; 0 on the coast road
  half: number; // m from the centreline to the edge of the asphalt
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
  half: number; // of the widest road meeting here
}

type Point = [number, number, number, number]; // x, z, unit tangent x, z

function newRoad(coast: boolean, id: number, half: number, pass = false): Road {
  return { coast, pass, id, half, x: [], z: [], h: [], nx: [], nz: [] };
}

function add(f: Fields, r: Road, x: number, z: number, nx: number, nz: number) {
  r.x.push(x);
  r.z.push(z);
  r.h.push(f.smooth(x, z));
  r.nx.push(nx);
  r.nz.push(nz);
}

const EASE = 150; // m either side over which an inland road's heights are averaged
const JOIN = 20; // m at each end that keep the junction's height, so arms meeting there overlap level
const RAMP = 140; // m over which a road then eases from its junction's height onto its averaged heights

/** The coast road's (or a city's ring road's) point beside (x, z): a few Newton steps along the gradient onto open = COAST_C. */
function ontoCoast(f: Fields, x: number, z: number): [number, number] {
  for (let it = 0; it < 4; it++) {
    const c = f.open(x, z) - COAST_C;
    const gx = (f.open(x + 1, z) - f.open(x - 1, z)) / 2;
    const gz = (f.open(x, z + 1) - f.open(x, z - 1)) / 2;
    const g2 = gx * gx + gz * gz || 1;
    x -= (c * gx) / g2;
    z -= (c * gz) / g2;
  }
  return [x, z];
}

/**
 * An inland road's heights, averaged over ±EASE m along it: the land's bumps (sharpened by the coastline's warp, and
 * stacked on the climb into the mountains) would otherwise make ramps of 20% and more. Each end keeps its junction's
 * height for JOIN m (at a T-junction, the coast road's height beside it), then eases onto the averages over RAMP m,
 * so arms leaving a junction overlap level instead of at the land's raw slope there. `tees`: which ends are T-junctions.
 */
function ease(f: Fields, r: Road, tees: [boolean, boolean]) {
  const n = r.x.length;
  if (n < 3) return;
  const s = [0];
  for (let k = 1; k < n; k++) s.push(s[k - 1] + Math.hypot(r.x[k] - r.x[k - 1], r.z[k] - r.z[k - 1]));
  const total = s[n - 1];
  // The mean is taken from the heights' integral along the road, so it slides smoothly however closely the road is
  // sampled (hairpins are sampled closer than straights; whole vertices entering and leaving the window made steps).
  const area = [0];
  for (let k = 1; k < n; k++) area.push(area[k - 1] + ((r.h[k] + r.h[k - 1]) / 2) * (s[k] - s[k - 1]));
  /** The integral from the start to t, for t that never decreases between calls. */
  const integral = () => {
    let j = 0;
    return (t: number) => {
      while (j + 2 < n && s[j + 1] < t) j++;
      const h = r.h[j] + (r.h[j + 1] - r.h[j]) * Math.min(1, Math.max(0, (t - s[j]) / (s[j + 1] - s[j] || 1)));
      return area[j] + ((r.h[j] + h) / 2) * (t - s[j]);
    };
  };
  const [lo, hi] = [integral(), integral()];
  // The junction's height beside each vertex, from end e (0: the start, 1: the finish): the node's, or at a T-junction
  // the coast road's beside it, held at its value JOIN m in.
  const junction = (e: number) => {
    const t = new Float64Array(n);
    let h = r.h[e ? n - 1 : 0];
    for (let i = 0; i < n; i++) {
      const k = e ? n - 1 - i : i;
      if (tees[e] && (e ? total - s[k] : s[k]) < JOIN + MS) h = f.smooth(...ontoCoast(f, r.x[k], r.z[k]));
      t[k] = h;
    }
    return t;
  };
  const [ja, jb] = [junction(0), junction(1)];
  const out = r.h.slice();
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, s[k] - EASE);
    const b = Math.min(total, s[k] + EASE);
    const mean = b > a ? (hi(b) - lo(a)) / (b - a) : r.h[k];
    let wa = 1 - smoothstep(JOIN, JOIN + RAMP, s[k]);
    let wb = 1 - smoothstep(JOIN, JOIN + RAMP, total - s[k]);
    if (wa + wb > 1) [wa, wb] = [wa / (wa + wb), wb / (wa + wb)]; // a short road: all junction
    out[k] = mean * (1 - wa - wb) + ja[k] * wa + jb[k] * wb;
  }
  r.h = out;
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
    const r = newRoad(true, 0, ROAD_HALF);
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

/** A cubic Hermite curve from a, heading along unit (ta), to b, heading along unit (tb), every ~MS m; a left out. */
function hermite(a: number[], ta: number[], b: number[], tb: number[]): Point[] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.ceil((l * 1.15) / MS);
  const out: Point[] = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const [h00, h10, h01, h11] = [2 * t ** 3 - 3 * t * t + 1, t ** 3 - 2 * t * t + t, 3 * t * t - 2 * t ** 3, t ** 3 - t * t];
    const [d00, d10, d01, d11] = [6 * t * t - 6 * t, 3 * t * t - 4 * t + 1, 6 * t - 6 * t * t, 3 * t * t - 2 * t];
    const at = (k: number) => [h00 * a[k] + h10 * ta[k] * l + h01 * b[k] + h11 * tb[k] * l, d00 * a[k] + d10 * ta[k] * l + d01 * b[k] + d11 * tb[k] * l];
    const [x, dx] = at(0);
    const [z, dz] = at(1);
    const d = Math.hypot(dx, dz) || 1;
    out.push([x, z, dx / d, dz / d]);
  }
  return out;
}

interface Edge {
  pieces: Road[];
  boxes: number[][]; // min x, min z, max x, max z per piece
  tees: Junction[]; // where the pieces meet the coast road
}

export function makeRoads(f: Fields) {
  const seed = f.seed;
  const edges = new Map<string, Edge>();
  const { nodeAt, land, highway, exists, isJunction, around } = f.nodes;

  function buildEdge(i: number, j: number, dir: number): Edge {
    const di = 1 - dir;
    const dj = dir;
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((s) => nodeAt(i + s * di, j + s * dj));
    const la = land(i, j);
    const lb = land(i + di, j + dj);
    const pass = f.passes.at(i, j, dir);
    let pts: Point[] = [];
    if (pass) {
      // Leave the node as an ordinary road would, bend onto the pass's axis, over the pass, and on to the far node.
      const unit = (a: number[], b: number[]) => [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])];
      const over = f.passes.path(pass, MS);
      const [entry, exit] = [over[0], over[over.length - 1]];
      pts = [[p1[0], p1[1], ...unit(p0, p2)] as Point]
        .concat(hermite(p1, unit(p0, p2), entry, [pass.ax, pass.az]).slice(0, -1), over)
        .concat(hermite(exit, [pass.ax, pass.az], p2, unit(p1, p3)));
    } else {
      const steps = Math.ceil((Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 1.15) / MS);
      for (let s = 0; s <= steps; s++) pts.push(catmullRom(p0, p1, p2, p3, s / steps));
    }
    // An edge toward a sea-side node runs on in a straight line until it reaches the coast road (or a city's ring).
    const runOn = (from: Point, sign: number) => {
      const out: Point[] = [];
      for (let k = 1; k <= 100; k++) {
        const x = from[0] + from[2] * sign * MS * k;
        const z = from[1] + from[3] * sign * MS * k;
        out.push([x, z, from[2], from[3]]);
        if (f.open(x, z) < COAST_C) break;
      }
      return out;
    };
    if (!lb) pts = pts.concat(runOn(pts[pts.length - 1], 1));
    if (!la) pts = runOn(pts[0], -1).reverse().concat(pts);
    const c = pts.map((p) => f.open(p[0], p[1]) - COAST_C);
    const cross = (a: Point, b: Point, ca: number): Point => {
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 12; it++) {
        const m = (lo + hi) / 2;
        const cm = f.open(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m) - COAST_C;
        if (cm >= 0 === ca >= 0) lo = m;
        else hi = m;
      }
      const t = (lo + hi) / 2;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2], a[3]];
    };

    // Keep the stretches on land that reach a land node, cut exactly at the coast road.
    const id = hash(seed, i, j, 40 + dir);
    const half = highway(i, j, dir) ? HIGHWAY_HALF : LOCAL_HALF;
    const edge: Edge = { pieces: [], boxes: [], tees: [] };
    let run: Point[] = [];
    let tees: Point[] = [];
    let fromNode = false;
    const finish = (toNode: boolean) => {
      if (run.length > 1 && (fromNode || toNode)) {
        const r = newRoad(false, hash(seed, id, edge.pieces.length), half, pass !== null);
        for (const [x, z, tx, tz] of run) add(f, r, x, z, -tz, tx);
        ease(f, r, [!fromNode, !toNode]);
        edge.pieces.push(r);
        edge.boxes.push([Math.min(...r.x), Math.min(...r.z), Math.max(...r.x), Math.max(...r.z)]);
        for (const [x, z] of tees) edge.tees.push({ x, z, h: f.smooth(x, z), half: Math.max(half, onRing(f.city, x, z) ? HIGHWAY_HALF : ROAD_HALF) });
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
        if (!inside(x, z) || !isJunction(i, j)) continue;
        const wide = around(i, j).some(([a, b, d]) => highway(a, b, d) && exists(a, b, d));
        junctions.push({ x, z, h: f.smooth(x, z), half: wide ? HIGHWAY_HALF : LOCAL_HALF });
      }
    }
    const c = f.city;
    if (c && c.x + c.ring + 10 >= x0 && c.x - c.ring - 10 < x1 && c.z + c.ring + 10 >= z0 && c.z - c.ring - 10 < z1) {
      city ??= cityStreets(f, c, ringTees(c));
      city.roads.forEach((r, k) => {
        const [bx0, bz0, bx1, bz1] = city!.boxes[k];
        if (bx1 >= x0 && bx0 < x1 && bz1 >= z0 && bz0 < z1) roads.push(r);
      });
      for (const j of city.junctions) if (inside(j.x, j.z)) junctions.push(j);
    }
    return { roads, junctions };
  }

  // The city's streets, made once, the first time an area near it is asked for.
  let city: ReturnType<typeof cityStreets> | null = null;
  /** Where inland roads end on city c's ring road. */
  function ringTees(c: City): Junction[] {
    const out: Junction[] = [];
    const reach = c.ring + 2 * GRID;
    for (let i = Math.floor((c.x - reach) / GRID); i <= Math.floor((c.x + reach) / GRID); i++) {
      for (let j = Math.floor((c.z - reach) / GRID); j <= Math.floor((c.z + reach) / GRID); j++) {
        for (let dir = 0; dir < 2; dir++) if (exists(i, j, dir)) out.push(...edge(i, j, dir).tees.filter((t) => onRing(c, t.x, t.z)));
      }
    }
    return out;
  }

  return { area, grid, nodeAt, land, exists };
}

const onRing = (c: City | null, x: number, z: number) => !!c && Math.abs(Math.hypot(x - c.x, z - c.z) - c.ring) < 2;

/**
 * A city's streets: its ring road, avenues along the river (arcs about the river's centre, BLOCK m apart, from the
 * riverfront avenue FRONT m behind the ghats out to the ring) and lanes out from the river (every LANES radians, from the
 * riverfront avenue to the ring). Every crossing is a junction where the pieces end, as are the inland roads' T-junctions
 * on the ring (`tees`), so autodrive picks a way at each. Flat, at the city's level.
 */
function cityStreets(f: Fields, c: City, tees: Junction[]) {
  const roads: Road[] = [];
  const boxes: number[][] = [];
  const junctions: Junction[] = [];
  const OC = Math.hypot(c.x - c.ox, c.z - c.oz);
  /** The point at angle a (from beta) and radius rho about the river's centre. */
  const P = (a: number, rho: number): [number, number] => [c.ox + Math.cos(c.beta + a) * rho, c.oz + Math.sin(c.beta + a) * rho];
  const piece = (pts: [number, number][], half: number, id: number) => {
    const r: Road = { coast: false, pass: false, city: true, id: hash(f.seed, 77, id), half, x: [], z: [], h: [], nx: [], nz: [] };
    pts.forEach(([x, z], k) => {
      const [ax, az] = pts[Math.max(0, k - 1)];
      const [bx, bz] = pts[Math.min(pts.length - 1, k + 1)];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      add(f, r, x, z, -(bz - az) / l, (bx - ax) / l);
    });
    roads.push(r);
    boxes.push([Math.min(...r.x), Math.min(...r.z), Math.max(...r.x), Math.max(...r.z)]);
  };
  /** Points every ~MS m along t → point(t) from t0 to t1, `length` m long. */
  const sample = (t0: number, t1: number, length: number, point: (t: number) => [number, number]) => {
    const n = Math.max(1, Math.ceil(length / MS));
    return Array.from({ length: n + 1 }, (_, s) => point(t0 + ((t1 - t0) * s) / n));
  };
  const joint = (x: number, z: number, half: number) => junctions.push({ x, z, h: f.smooth(x, z), half });

  // Avenues, each between where it meets the ring (±psi); lanes, from the riverfront avenue to where they meet the ring.
  const rho0 = c.arc + c.half + FRONT;
  const avenues: { rho: number; psi: number; half: number; cuts?: number[] }[] = [];
  for (let m = 0, rho = rho0; rho < OC + c.ring - 60; m++, rho += BLOCK) {
    const cos = (OC * OC + rho * rho - c.ring * c.ring) / (2 * OC * rho);
    avenues.push({ rho, psi: Math.acos(Math.max(-1, Math.min(1, cos))), half: m % 2 === 0 ? ROAD_HALF : LOCAL_HALF });
  }
  const lanes: { a: number; end: number; half: number }[] = [];
  const reach = Math.floor(avenues[0].psi / LANES);
  for (let k = -reach; k <= reach; k++) {
    const a = k * LANES;
    if (Math.abs(a) > avenues[0].psi - 0.004) continue; // it would meet the ring right where the avenue does
    lanes.push({ a, end: OC * Math.cos(a) + Math.sqrt(c.ring ** 2 - (OC * Math.sin(a)) ** 2), half: k % 3 === 0 ? ROAD_HALF : LOCAL_HALF });
  }
  const ringAt: [number, number][] = tees.map((t) => [Math.atan2(t.z - c.z, t.x - c.x), HIGHWAY_HALF]); // angle about the middle, half width
  // The riverside expressway on stilts: over the water along the ghats, DECK m above the city, from near one barrage to
  // near the other; at each end it swings inland over the ghats and comes down onto the riverfront avenue, between two
  // lanes. One road from end to end.
  {
    const DECK = 3;
    const rhoE = c.arc + c.half - GHAT - 30;
    const aE = c.span - 0.03;
    const aJ = (Math.floor((aE + 0.057) / LANES) + 0.5) * LANES;
    const unit = (a: number) => [-Math.sin(c.beta + a), Math.cos(c.beta + a)]; // along increasing a
    const out = (a: number) => [Math.cos(c.beta + a), Math.sin(c.beta + a)]; // away from the river's centre
    const ramp = (sign: number): Point[] => {
      const [ta, tb] = [unit(sign * aE).map((v) => v * sign), out(sign * aJ)];
      return hermite(P(sign * aE, rhoE), ta, P(sign * aJ, rho0), tb);
    };
    // Each ramp, from the deck out to the avenue, keeps the deck's height until it has passed over the barrage (its slab
    // reaches 4.6 m to the side), then comes down.
    const river = { across: 0, past: 0 };
    const fall = (r: Point[]) => {
      const k0 = Math.max(0, r.findIndex(([x, z]) => riverAt(c, x, z, river).past > DAM.past + DAM.thick / 2 + 12));
      return r.map((_, k) => c.level + DECK * (1 - smoothstep(k0, r.length, k + 1)));
    };
    const [down, up] = [ramp(-1), ramp(1)];
    const pts: [number, number][] = down.map(([x, z]): [number, number] => [x, z]).reverse(); // from the avenue up onto the deck
    const heights = fall(down).reverse();
    for (const [x, z] of sample(-aE, aE, 2 * aE * rhoE, (a) => P(a, rhoE))) {
      pts.push([x, z]);
      heights.push(c.level + DECK);
    }
    pts.push(...up.map(([x, z]): [number, number] => [x, z]));
    heights.push(...fall(up));
    piece(pts, ROAD_HALF, 800000);
    const r = roads[roads.length - 1];
    r.deck = true;
    r.h = heights;
    for (const sign of [-1, 1]) joint(...P(sign * aJ, rho0), ROAD_HALF);
    avenues[0].cuts = [-aJ, aJ];
  }

  // Out in the open land of the outskirts the avenues give out, and only the lanes run on to the ring.
  avenues.forEach((v, m) => {
    const crossing = lanes.filter((l) => Math.abs(l.a) < v.psi && l.end > v.rho + 1);
    const cuts = [-v.psi, ...crossing.map((l) => l.a), ...(v.cuts ?? []), v.psi].sort((a, b) => a - b);
    const ends = new Set<number>();
    for (let k = 0; k + 1 < cuts.length; k++) {
      if (m > 0 && urban(c, ...P((cuts[k] + cuts[k + 1]) / 2, v.rho)) < 0.05) continue;
      piece(sample(cuts[k], cuts[k + 1], (cuts[k + 1] - cuts[k]) * v.rho, (a) => P(a, v.rho)), v.half, m * 1000 + k);
      ends.add(cuts[k]).add(cuts[k + 1]);
    }
    for (const l of crossing) if (ends.has(l.a)) joint(...P(l.a, v.rho), Math.max(v.half, l.half));
    for (const a of [-v.psi, v.psi]) {
      if (!ends.has(a)) continue;
      const [x, z] = P(a, v.rho);
      ringAt.push([Math.atan2(z - c.z, x - c.x), v.half]);
    }
  });
  lanes.forEach((l, k) => {
    const cuts = [rho0, ...avenues.slice(1).filter((v) => Math.abs(l.a) < v.psi && v.rho < l.end - 1).map((v) => v.rho), l.end];
    for (let s = 0; s + 1 < cuts.length; s++) piece(sample(cuts[s], cuts[s + 1], cuts[s + 1] - cuts[s], (rho) => P(l.a, rho)), l.half, 500000 + k * 100 + s);
    const [x, z] = P(l.a, l.end);
    ringAt.push([Math.atan2(z - c.z, x - c.x), l.half]);
  });
  // The ring road, in arcs between everything that meets it.
  ringAt.sort((p, q) => p[0] - q[0]);
  const around = (t: number): [number, number] => [c.x + Math.cos(t) * c.ring, c.z + Math.sin(t) * c.ring];
  ringAt.forEach(([t, half], k) => {
    const next = k + 1 < ringAt.length ? ringAt[k + 1][0] : ringAt[0][0] + Math.PI * 2;
    if (next - t > 1e-4) piece(sample(t, next, (next - t) * c.ring, around), HIGHWAY_HALF, 900000 + k);
    joint(...around(t), Math.max(half, HIGHWAY_HALF));
  });
  return { roads, boxes, junctions };
}

/**
 * Nearest road point: distance and the road height there. The distance is from the edge of the asphalt plus ROAD_HALF,
 * as if every road were the coast road's width, so the strip a road sits on, verges and clearances scale with it.
 */
export interface Near {
  d: number;
  h: number;
}

const cellKey = (gx: number, gz: number) => (gx + 1048576) * 2097152 + (gz + 1048576);

/** Road segments bucketed for nearest-road queries. */
export class RoadIndex {
  private seg: Float64Array; // ax, az, bx, bz, ah, bh, extra half width per segment
  private cells = new Map<number, number[]>();

  /** `decks`: count roads on stilts too (they are left out by default: the land is not carved to them). */
  constructor(roads: Road[], decks = false) {
    const s: number[] = [];
    for (const r of roads) {
      if (r.deck && !decks) continue;
      for (let k = 0; k + 1 < r.x.length; k++) s.push(r.x[k], r.z[k], r.x[k + 1], r.z[k + 1], r.h[k], r.h[k + 1], r.half - ROAD_HALF);
    }
    this.seg = Float64Array.from(s);
    for (let i = 0; i < s.length; i += 7) {
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

  /** The nearest road point anywhere in the index, with the road's direction and half width; null if there are no roads. */
  closest(x: number, z: number): { x: number; z: number; h: number; tx: number; tz: number; half: number } | null {
    const out = { d: Infinity, h: 0 };
    let at = -1;
    for (let i = 0; i < this.seg.length; i += 7) {
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
    return { x: s[at] + dx * t, z: s[at + 1] + dz * t, h: out.h, tx: dx / l, tz: dz / l, half: s[at + 6] + ROAD_HALF };
  }

  /** Distance to the nearest road anywhere in the index. */
  dist(x: number, z: number): number {
    const out = { d: Infinity, h: 0 };
    for (let i = 0; i < this.seg.length; i += 7) this.test(i, x, z, out);
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
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z) - s[i + 6];
    if (d < out.d) {
      out.d = d;
      out.h = s[i + 4] + (s[i + 5] - s[i + 4]) * t;
    }
  }
}
