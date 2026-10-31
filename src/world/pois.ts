// Places along roads: paperboxd cafés and bookstores, petrol stations and hoardings. Anchored to road geometry, so pure and local.
import { COAST_C, type Fields } from './fields.ts';
import { hash } from './hash.ts';
import { biomeAt } from './places.ts';
import { ROAD_HALF, type Junction, type Near, type Road, type RoadIndex, gradient } from './roads.ts';

export type PoiKind = 'cafe' | 'station' | 'hoarding' | 'bookstore';

/** A place by a road. Its local +z: buildings face the road, hoardings face oncoming traffic (right-hand). */
export interface Poi {
  kind: PoiKind;
  x: number;
  z: number;
  h: number; // road height at the anchor; pads flatten to it
  yaw: number;
  pad: number; // radius of flattened ground, 0 for none
  pick: number; // hash for choosing brand, poster and format
}

const LINE = 640; // m between the lines whose crossings with the coast road anchor POIs
const CLEAR = 60; // m kept free of POIs around junctions
// m from the centreline of a road as wide as the coast road; wider roads push them out by their extra half width.
// A café's terrace front is 11 m ahead of it (props.ts), so it ends 3 m past the asphalt, as in the concept art.
export const SETBACK: Record<PoiKind, number> = { cafe: 18, station: 34, hoarding: ROAD_HALF + 7, bookstore: 24 };
const PAD: Record<PoiKind, number> = { cafe: 16, station: 22, hoarding: 0, bookstore: 12 };
const TILT = (20 * Math.PI) / 180; // hoardings turn this far toward the road

/** Where the coast (C = COAST_C) crosses the line x = line (axis 0) or z = line (axis 1), searching lo..hi. */
function crossing(f: Fields, axis: number, line: number, lo: number, hi: number): number | null {
  const at = (u: number) => (axis ? f.continent(u, line) : f.continent(line, u)) - COAST_C;
  let flo = at(lo);
  if (flo >= 0 === at(hi) >= 0) return null;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const fm = at(mid);
    if (fm >= 0 === flo >= 0) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** POIs anchored inside [x0, x1) × [z0, z1). `junctions` and `index` must cover 60 m beyond it. */
export function placePois(
  f: Fields,
  roads: Road[],
  junctions: Junction[],
  index: RoadIndex,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): Poi[] {
  const out: Poi[] = [];
  const seen = new Set<number>();
  const near: Near = { d: 0, h: 0 };
  // side +1 puts the POI along the road's across direction (nx, nz), -1 opposite
  const place = (kind: PoiKind, ax: number, az: number, ah: number, nx: number, nz: number, side: number, pick: number, half: number) => {
    if (ax < x0 || ax >= x1 || az < z0 || az >= z1 || seen.has(pick)) return;
    if (junctions.some((j) => Math.hypot(j.x - ax, j.z - az) < CLEAR)) return;
    const sx = nx * side;
    const sz = nz * side;
    const x = ax + sx * (SETBACK[kind] + half - ROAD_HALF);
    const z = az + sz * (SETBACK[kind] + half - ROAD_HALF);
    // Would stand on another road: its own road must be the nearest, and the back half of its pad 4 m clear of any
    // asphalt (the front half reaches to its own road). Under 32 m, so the bucketed query is exact (a full scan made
    // big maps slow).
    if (index.near(x, z, near).d < SETBACK[kind] - 1.5) return;
    for (const a of [-1, -0.5, 0, 0.5, 1]) {
      const [c, s] = [Math.cos((a * Math.PI) / 2), Math.sin((a * Math.PI) / 2)];
      if (index.near(x + (sx * c - sz * s) * PAD[kind], z + (sz * c + sx * s) * PAD[kind], near).d < ROAD_HALF + 4) return;
    }
    let yaw: number;
    if (kind === 'hoarding') {
      // Drivers with the board on their right travel along (sz, -sx); it faces them, turned toward the road.
      yaw = Math.atan2(-sz * Math.cos(TILT) - sx * Math.sin(TILT), sx * Math.cos(TILT) - sz * Math.sin(TILT));
    } else yaw = Math.atan2(-sx, -sz); // front to the road
    seen.add(pick);
    out.push({ kind, x, z, h: ah, yaw, pad: PAD[kind], pick });
  };

  for (const r of roads) {
    if (r.city) continue; // cities place their own
    if (r.coast) {
      // Where the coast road crosses the lines x = m·LINE and z = m·LINE.
      for (let k = 0; k + 1 < r.x.length; k++) {
        for (const axis of [0, 1]) {
          const a = axis ? r.z[k] : r.x[k];
          const b = axis ? r.z[k + 1] : r.x[k + 1];
          const m = Math.floor(Math.max(a, b) / LINE);
          if (a < m * LINE === b < m * LINE) continue;
          // The true contour's crossing with the line, not the traced segment's, so a coarse map trace agrees.
          const other = axis ? [r.x[k], r.x[k + 1]] : [r.z[k], r.z[k + 1]];
          const u = crossing(f, axis, m * LINE, Math.min(...other) - 16, Math.max(...other) + 16);
          if (u === null) continue;
          const px = axis ? u : m * LINE;
          const pz = axis ? m * LINE : u;
          const ph = f.smooth(px, pz);
          const [nx, nz] = gradient(f, px, pz);
          const key = hash(f.seed, axis + 1, m, Math.round(u));
          const roll = key / 4294967296;
          // n points inland, so -1 is the sea side: there only where the land is, and not a cliff falling away
          const seaSide = (gap: number) => f.continent(px - nx * gap, pz - nz * gap) > 0.015 && f.smooth(px - nx * gap, pz - nz * gap) > ph - 4;
          if (roll < 0.18) place('cafe', px, pz, ph, nx, nz, seaSide(SETBACK.cafe + PAD.cafe) ? -1 : 1, key, r.half);
          else if (roll < 0.36) place('station', px, pz, ph, nx, nz, 1, key, r.half);
          else if (roll < 0.76) {
            const side = key & 512 && seaSide(SETBACK.hoarding) ? -1 : 1;
            place('hoarding', px, pz, ph, nx, nz, side, key, r.half);
          }
        }
      }
    } else if (r.pass) {
      // A pass: half the time a café at the top (a lodge, in the mountains), nothing on the hairpins.
      const k = r.h.indexOf(Math.max(...r.h));
      const key = hash(f.seed, r.id, 3);
      if (key / 4294967296 < 0.5) place('cafe', r.x[k], r.z[k], r.h[k], r.nx[k], r.nz[k], key & 512 ? 1 : -1, key, r.half);
    } else if (r.x.length >= 12) {
      // Inland roads: a station or a café halfway along, hoardings a quarter of the way in from each end.
      for (let slot = 0; slot < 3; slot++) {
        const k = Math.floor((r.x.length * (slot + 1)) / 4);
        const key = hash(f.seed, r.id, slot);
        const roll = key / 4294967296;
        const side = key & 512 ? 1 : -1;
        // Halfway along: a station, or a paperboxd café (a lodge in the mountains, a diner in the desert, see props),
        // or in the countryside a paperboxd bookstore.
        const book = roll >= 0.22 && roll < 0.3 && biomeAt(f, r.x[k], r.z[k]) === 'country';
        const kind = slot !== 1 ? (roll < 0.5 ? 'hoarding' : null) : roll < 0.12 ? 'station' : roll < 0.22 ? 'cafe' : book ? 'bookstore' : null;
        if (kind) place(kind, r.x[k], r.z[k], r.h[k], r.nx[k], r.nz[k], side, key, r.half);
      }
    }
  }
  return out;
}
