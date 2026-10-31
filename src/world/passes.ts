// Mountain passes: some local grid edges in the mountains climb over a ridge by hairpin bends and come down the other
// side the same way. The ridge is part of the land (`ridge`, added to the smooth height roads sit on), twisted so each
// leg of the zigzag lies along it: the road follows the land up, and no leg stands on an embankment.
import { smoothstep } from './fields.ts';
import { hash } from './hash.ts';
import { GRID, type Nodes } from './nodes.ts';

const R = 22; // m hairpin radius; legs are 2R apart, so the carving beside one leg just meets the next one's
const W = 110; // m of straight leg between hairpins
const GRADE = 0.085; // along the zigzag
const CREST = 60; // m of level road over the top
const SIDE = 160; // m over which the ridge falls away beside the zigzags
const FADE = 100; // m before and after a pass over which the land comes to its level
const APPROACH = 150; // m of ordinary road at least, from each node to the pass
const ARC_STEP = 3; // m between road points on hairpins

/** A pass in its frame: u along the edge from the entry, v across it toward the zigzags. */
export interface Pass {
  ox: number; // the entry, where the pass leaves the ordinary road
  oz: number;
  ax: number; // unit axis, from the edge's first node toward its second
  az: number;
  bx: number; // unit across, toward the zigzags
  bz: number;
  n: number; // legs up each face (even, so the road leaves each face on the axis)
  len: number; // m along the axis, entry to exit
  h0: number; // the land's height at the entry and at the exit: the pass stands on a plane between them
  h1: number;
  top: number; // m the crest stands above that plane
  box: [number, number, number, number]; // x0, z0, x1, z1 of the land it shapes
}

export type Passes = ReturnType<typeof makePasses>;

/** Triangle wave through 0 at even t and ±1 at odd t: 1 at t = 1, -1 at t = 3. */
const tri = (t: number) => 1 - Math.abs(((((t + 1) % 4) + 4) % 4) - 2);

/** Passes on the grid `nodes` where `alpine` says mountains, on land that would otherwise stand at `base`. */
export function makePasses(seed: number, nodes: Nodes, alpine: (x: number, z: number) => number, base: (x: number, z: number) => number) {
  /** The pass on grid edge (i, j, dir), if it is one. */
  function decide(i: number, j: number, dir: number): Pass | null {
    // At most one pass meets each node, so two never cross: nodes pair up in 2×2 blocks, across or along by hash,
    // and only those pairs may be passes.
    if ((hash(seed, Math.floor(i / 2), Math.floor(j / 2), 50) & 1) !== dir || ((dir === 0 ? i : j) & 1) !== 0) return null;
    if (nodes.highway(i, j, dir) || !nodes.exists(i, j, dir) || !nodes.land(i, j) || !nodes.land(i + 1 - dir, j + dir)) return null;
    const [x0, z0] = nodes.nodeAt(i, j);
    const [x1, z1] = nodes.nodeAt(i + 1 - dir, j + dir);
    if (alpine((x0 + x1) / 2, (z0 + z1) / 2) < 0.5) return null;
    const chord = Math.hypot(x1 - x0, z1 - z0);
    const n = [6, 4].find((legs) => 4 * legs * R + CREST + 2 * APPROACH <= chord);
    if (!n) return null;
    const len = 4 * n * R + CREST; // two faces of n legs 2R apart, and the crest between them
    const ax = (x1 - x0) / chord;
    const az = (z1 - z0) / chord;
    const side = hash(seed, i, j, 51 + dir) & 1 ? 1 : -1;
    const [bx, bz] = [-az * side, ax * side];
    const ox = (x0 + x1) / 2 - (ax * len) / 2;
    const oz = (z0 + z1) / 2 - (az * len) / 2;
    // Only on gentle land: the pass makes its own climb, and a steep slope under it would add to one face or the
    // approaches (rises of 3–5 m in 50 m happen where the mountains' fields line up).
    const h0 = base(ox, oz);
    const h1 = base(ox + ax * len, oz + az * len);
    if (Math.abs(h1 - h0) > 0.04 * len) return null;
    for (let s = 50, prev = base(x0, z0); s < chord + 50; s += 50) {
      const h = base(x0 + ax * Math.min(s, chord), z0 + az * Math.min(s, chord));
      if (Math.abs(h - prev) > 5) return null;
      prev = h;
    }
    const xs: number[] = [];
    const zs: number[] = [];
    for (const [u, v] of [[-FADE, -SIDE], [len + FADE, -SIDE], [-FADE, W + 2 * R + SIDE], [len + FADE, W + 2 * R + SIDE]]) {
      xs.push(ox + ax * u + bx * v);
      zs.push(oz + az * u + bz * v);
    }
    const top = GRADE * n * (W + Math.PI * R); // each leg and each hairpin climbs at GRADE
    return { ox, oz, ax, az, bx, bz, n, len, h0, h1, top, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  }

  const edges = new Map<string, Pass | null>();
  /** The pass on grid edge (i, j, dir), or null. */
  function at(i: number, j: number, dir: number): Pass | null {
    const key = `${i},${j},${dir}`;
    let p = edges.get(key);
    if (p === undefined) {
      p = decide(i, j, dir);
      if (edges.size >= 4096) edges.delete(edges.keys().next().value!);
      edges.set(key, p);
    }
    return p;
  }

  // The passes whose ridge reaches each GRID cell; the last cell asked about is kept, since asks come in runs.
  const cells = new Map<number, Pass[]>();
  let lastKey = NaN;
  let last: Pass[] = [];
  function passesNear(x: number, z: number): Pass[] {
    const ci = Math.floor(x / GRID);
    const cj = Math.floor(z / GRID);
    const key = (ci + 1048576) * 2097152 + (cj + 1048576);
    if (key === lastKey) return last;
    let list = cells.get(key);
    if (!list) {
      list = [];
      // A pass stays within its edge's span and SIDE + W + 2R of it, so edges from these nodes are all that reach.
      for (let i = ci - 2; i <= ci + 1; i++) {
        for (let j = cj - 2; j <= cj + 1; j++) {
          for (let dir = 0; dir < 2; dir++) {
            const p = at(i, j, dir);
            if (p && p.box[0] < (ci + 1) * GRID && p.box[2] > ci * GRID && p.box[1] < (cj + 1) * GRID && p.box[3] > cj * GRID) list.push(p);
          }
        }
      }
      if (cells.size >= 4096) cells.delete(cells.keys().next().value!);
      cells.set(key, list);
    }
    lastKey = key;
    last = list;
    return list;
  }

  /** m pass p moves the land at x, z, which would otherwise stand at `base`. */
  function lift(p: Pass, x: number, z: number, base: number): number {
    const dx = x - p.ox;
    const dz = z - p.oz;
    const u = dx * p.ax + dz * p.az;
    const inside = Math.min(u, p.len - u); // m from the nearer end, negative beyond the pass
    if (inside <= -FADE) return 0;
    const v = dx * p.bx + dz * p.bz;
    const out = Math.max(-v, v - W - 2 * R, 0); // m beyond the zigzags, across
    if (out >= SIDE) return 0;
    // A plane from the entry's height to the exit's, and on it the ridge: up one face, over the crest, down the other.
    let h = p.h0 + (p.h1 - p.h0) * Math.min(1, Math.max(0, u / p.len));
    const face = 2 * p.n * R; // m along the axis each face takes
    if (inside > 0) h += p.top * Math.min(1, inside / face);
    // Legs run across a face climbing at GRADE, alternately out and back, so the land twists between them to meet each
    // one along its length: a triangle wave along the axis times the distance across from the legs' middles. Hairpins
    // lie within a metre of it; beyond them it flattens out.
    if (inside > 0 && inside < face) h += GRADE * (Math.min(Math.max(v, R), W + R) - R - W / 2) * tri(inside / R) * (1 - smoothstep(0, R, out));
    return (h - base) * (1 - smoothstep(0, SIDE, out)) * smoothstep(-FADE, 0, inside);
  }

  return {
    at,
    /** m the passes move the land at x, z, which would otherwise stand at `base`: 0 away from them. */
    ridge(x: number, z: number, base: number): number {
      let h = 0;
      for (const p of passesNear(x, z)) {
        if (x > p.box[0] && x < p.box[2] && z > p.box[1] && z < p.box[3]) h += lift(p, x, z, base);
      }
      return h;
    },
    /**
     * The road over pass p as [x, z, unit tangent x, z], entry to exit: up one face in hairpins, over the crest and
     * down the other face the same way. `step` m between points on straights, ARC_STEP on hairpins.
     */
    path(p: Pass, step: number): [number, number, number, number][] {
      const face: number[][] = [[0, 0, 1, 0]]; // u, v, tangent u, v: up the first face
      const line = (u0: number, v0: number, u1: number, v1: number) => {
        const l = Math.hypot(u1 - u0, v1 - v0);
        const n = Math.ceil(l / step);
        for (let s = 1; s <= n; s++) face.push([u0 + ((u1 - u0) * s) / n, v0 + ((v1 - v0) * s) / n, (u1 - u0) / l, (v1 - v0) / l]);
      };
      const arc = (cu: number, cv: number, a0: number, a1: number) => {
        const n = Math.ceil((Math.abs(a1 - a0) * R) / ARC_STEP);
        const turn = Math.sign(a1 - a0);
        for (let s = 1; s <= n; s++) {
          const a = a0 + ((a1 - a0) * s) / n;
          face.push([cu + R * Math.cos(a), cv + R * Math.sin(a), -Math.sin(a) * turn, Math.cos(a) * turn]);
        }
      };
      arc(0, R, 1.5 * Math.PI, 2 * Math.PI); // off the axis onto the first leg
      for (let k = 0; k < p.n; k++) {
        const u = (2 * k + 1) * R;
        const out = k % 2 === 0; // even legs run out across the face, odd ones back
        line(u, out ? R : W + R, u, out ? W + R : R);
        if (k + 1 === p.n) arc(u + R, R, Math.PI, 1.5 * Math.PI); // back onto the axis
        else if (out) arc(u + R, W + R, Math.PI, 0);
        else arc(u + R, R, Math.PI, 2 * Math.PI);
      }
      const span = 2 * p.n * R;
      const pts = face.slice();
      for (let s = 1, n = Math.ceil(CREST / step); s <= n; s++) pts.push([span + (CREST * s) / n, 0, 1, 0]);
      // Down the other face: the first one mirrored along the axis and walked backwards.
      for (let k = face.length - 2; k >= 0; k--) pts.push([p.len - face[k][0], face[k][1], face[k][2], -face[k][3]]);
      return pts.map(([u, v, tu, tv]) => [p.ox + p.ax * u + p.bx * v, p.oz + p.az * u + p.bz * v, p.ax * tu + p.bx * tv, p.az * tu + p.bz * tv]);
    },
  };
}
