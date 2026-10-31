// Autodrive: keeps the car in the right lane of the road it is on, slows for bends, picks a way at junctions (at random,
// or toward a target: the police use it to chase along roads).
import type { Intent } from './physics.ts';
import { CHUNK } from './world/chunk.ts';
import { type Road, laneOf } from './world/roads.ts';
import type { World } from './world/world.ts';

const WHEELBASE = 2.65; // m, front to rear axle
const CRUISE = 22; // m/s, about 80 km/h
const PASS = 12; // m/s, about 45 km/h, over mountain passes: hairpins come every 180 m
const GRIP = 3; // m/s² of sideways acceleration it allows in bends
const LINK = 2.5; // m within which road ends count as joined

interface Cursor {
  r: Road;
  k: number; // segment from vertex k to k + 1
  sign: 1 | -1; // walking toward k + 1 (1) or k (-1)
}

/** `grip`: the sideways acceleration it allows in bends, m/s². */
export function createAutodrive(world: World, grip = GRIP) {
  const choices = new Map<string, number>(); // junction → way taken, so the choice holds while passing it

  /** Ways on from (x, z) heading (dx, dz): road starts and ends there, or the middle of a road it meets. */
  function ways(roads: Road[], from: Road, x: number, z: number, dx: number, dz: number): Cursor[] {
    const out: { c: Cursor; angle: number }[] = [];
    const offer = (c: Cursor, tx: number, tz: number) => {
      const l = Math.hypot(tx, tz) || 1;
      if ((tx * dx + tz * dz) / l < -0.2) return; // no U-turns
      out.push({ c, angle: Math.atan2(dx * tz - dz * tx, dx * tx + dz * tz) });
    };
    for (const r of roads) {
      if (r === from) continue;
      const n = r.x.length;
      if (Math.hypot(r.x[0] - x, r.z[0] - z) < LINK) offer({ r, k: 0, sign: 1 }, r.x[1] - r.x[0], r.z[1] - r.z[0]);
      else if (Math.hypot(r.x[n - 1] - x, r.z[n - 1] - z) < LINK) offer({ r, k: n - 2, sign: -1 }, r.x[n - 2] - r.x[n - 1], r.z[n - 2] - r.z[n - 1]);
      else {
        for (let k = 0; k + 1 < n; k++) {
          if (segDist(r, k, x, z) > LINK) continue;
          offer({ r, k, sign: 1 }, r.x[k + 1] - r.x[k], r.z[k + 1] - r.z[k]);
          offer({ r, k, sign: -1 }, r.x[k] - r.x[k + 1], r.z[k] - r.z[k + 1]);
          break;
        }
      }
    }
    return out.sort((a, b) => a.angle - b.angle).map((o) => o.c);
  }

  /**
   * An inland road starting on the coast road's segment k, if the car decides (once, 30%) to turn into it; with a
   * target, if the road points at it better than the coast road does.
   */
  function branch(roads: Road[], from: Road, k: number, dx: number, dz: number, toward: Target): Cursor | null {
    if (!from.coast) return null;
    for (const r of roads) {
      if (r.coast) continue;
      const n = r.x.length;
      const starts: Cursor[] = [{ r, k: 0, sign: 1 }, { r, k: n - 2, sign: -1 }];
      for (const c of starts) {
        const end = c.sign > 0 ? 0 : n - 1;
        if (segDist(from, k, r.x[end], r.z[end]) > LINK) continue;
        const [tx, tz] = dir(r, c.k, c.sign);
        if (tx * dx + tz * dz < -0.2) continue;
        if (toward) {
          if (pointing(toward, r.x[end], r.z[end], tx, tz) > pointing(toward, r.x[end], r.z[end], dx, dz)) return c;
          continue;
        }
        const key = `side ${Math.round(r.x[end])},${Math.round(r.z[end])}`;
        let take = choices.get(key);
        if (take === undefined) choices.set(key, (take = Math.random() < 0.3 ? 1 : 0));
        if (take) return c;
      }
    }
    return null;
  }

  return {
    /**
     * Pedals and steering for a car at world (x, z) heading `yaw` at `v` m/s, or null with no road nearby. At junctions
     * it takes the way that points most nearly at world point `toward`, if given; it cruises at up to `cruise` m/s.
     */
    drive(x: number, z: number, yaw: number, v: number, toward: Target = null, cruise = CRUISE): Intent | null {
      const roads = world.area(Math.floor(x / CHUNK), Math.floor(z / CHUNK)).roads;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      // The road under the car: nearest segment, preferring ones that run the way the car is facing.
      let cur: Cursor | null = null;
      let best = 25;
      for (const r of roads) {
        for (let k = 0; k + 1 < r.x.length; k++) {
          const dx = r.x[k + 1] - r.x[k];
          const dz = r.z[k + 1] - r.z[k];
          const align = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
          const score = segDist(r, k, x, z) + (1 - Math.abs(align)) * 12;
          if (score < best) {
            best = score;
            cur = { r, k, sign: align >= 0 ? 1 : -1 };
          }
        }
      }
      if (!cur) return null;

      // Walk ahead along the road: aim at `look` metres, read the bends over twice that.
      // Over a pass it looks closer: pursuing a point 15 m round a 22 m hairpin cuts the bend by ~1.7 m.
      const look = cur.r.pass ? 4 + Math.abs(v) * 0.6 : 8 + Math.abs(v) * 0.9;
      let { r, k, sign } = cur;
      let px = r.x[k];
      let pz = r.z[k];
      {
        const t = project(r, k, x, z);
        px += (r.x[k + 1] - r.x[k]) * t;
        pz += (r.z[k + 1] - r.z[k]) * t;
      }
      let walked = 0;
      let turned = 0;
      let sharp = false;
      let aim: [number, number, number, number, number] | null = null; // x, z, direction x, z, lane
      let [dx, dz] = dir(r, k, sign);
      for (let step = 0; step < 60 && walked < look * 2; step++) {
        const vi = sign > 0 ? k + 1 : k;
        const gap = Math.hypot(r.x[vi] - px, r.z[vi] - pz);
        if (!aim && walked + gap >= look) {
          const t = (look - walked) / (gap || 1);
          aim = [px + (r.x[vi] - px) * t, pz + (r.z[vi] - pz) * t, dx, dz, laneOf(r)];
        }
        walked += gap;
        px = r.x[vi];
        pz = r.z[vi];
        let next = branch(roads, r, k, dx, dz, toward);
        if (next) {
          px = next.r.x[next.sign > 0 ? 0 : next.r.x.length - 1];
          pz = next.r.z[next.sign > 0 ? 0 : next.r.z.length - 1];
        } else if (sign > 0 ? vi + 1 < r.x.length : vi - 1 >= 0) next = { r, k: sign > 0 ? vi : vi - 1, sign };
        else {
          const options = ways(roads, r, px, pz, dx, dz);
          if (options.length > 0 && toward) {
            const score = (c: Cursor) => pointing(toward, px, pz, ...dir(c.r, c.k, c.sign));
            next = options.reduce((a, b) => (score(b) > score(a) ? b : a));
          } else if (options.length > 0) {
            const key = `${Math.round(px)},${Math.round(pz)}`;
            let pick = choices.get(key);
            if (pick === undefined) {
              pick = Math.floor(Math.random() * options.length);
              choices.set(key, pick);
              if (choices.size > 200) choices.delete(choices.keys().next().value!);
            }
            next = options[pick % options.length];
          }
        }
        if (!next) break;
        const [nx, nz] = dir(next.r, next.k, next.sign);
        const bend = Math.acos(Math.max(-1, Math.min(1, dx * nx + dz * nz)));
        turned += bend;
        if (bend > 0.5) sharp = true;
        ({ r, k, sign } = next);
        [dx, dz] = [nx, nz];
      }
      aim ??= [px, pz, dx, dz, laneOf(r)];

      // Pure pursuit on the middle of the right lane.
      const tx = aim[0] - aim[3] * aim[4] - x; // right of (dx, dz) is (-dz, dx)
      const tz = aim[1] + aim[2] * aim[4] - z;
      const ahead = Math.hypot(tx, tz) || 1;
      const side = (tx * Math.cos(yaw) - tz * Math.sin(yaw)) / ahead; // sine of the angle to the aim, + is left
      const angle = Math.atan((2 * WHEELBASE * side) / ahead);
      const lock = 0.55 - 0.4 * Math.min(Math.abs(v) / 30, 1); // matches the car's speed-sensitive lock
      const steer = Math.max(-1, Math.min(1, angle / lock));

      const bendiness = turned / Math.max(walked, 1);
      let target = Math.min(cur.r.pass ? Math.min(PASS, cruise) : cruise, Math.sqrt(grip / Math.max(bendiness, 1e-4)));
      if (sharp) target = Math.min(target, 9);
      const dv = target - v;
      return { steer, throttle: dv > 0 ? Math.min(1, dv / 4) : 0, brake: dv < -1.5 ? Math.min(1, -dv / 6) : 0 };
    },
  };
}

/** A world point to head for, or none. */
type Target = [number, number] | null;

/** How directly unit direction (dx, dz) from (x, z) points at `t`: the cosine of the angle between them. */
function pointing(t: [number, number], x: number, z: number, dx: number, dz: number) {
  return (dx * (t[0] - x) + dz * (t[1] - z)) / (Math.hypot(t[0] - x, t[1] - z) || 1);
}

function project(r: Road, k: number, x: number, z: number) {
  const dx = r.x[k + 1] - r.x[k];
  const dz = r.z[k + 1] - r.z[k];
  const l2 = dx * dx + dz * dz;
  return l2 > 0 ? Math.min(1, Math.max(0, ((x - r.x[k]) * dx + (z - r.z[k]) * dz) / l2)) : 0;
}

function segDist(r: Road, k: number, x: number, z: number) {
  const t = project(r, k, x, z);
  return Math.hypot(r.x[k] + (r.x[k + 1] - r.x[k]) * t - x, r.z[k] + (r.z[k + 1] - r.z[k]) * t - z);
}

function dir(r: Road, k: number, sign: number): [number, number] {
  const dx = (r.x[k + 1] - r.x[k]) * sign;
  const dz = (r.z[k + 1] - r.z[k]) * sign;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}
