// A city's buildings: a dense fabric between its streets in rows out from the river, thinning out and coming down over
// its outskirts to open land (see `urban`); tall havelis and palaces along the ghats; tenements with rooftop water tanks,
// stair rooms, wooden water towers and aerials, neon blade signs over the streets; Art Deco towers in setbacks crowned
// with temple spires, gathered downtown; mandirs among the houses (the Bebop-era concepts, art-src/concepts/
// prakashi-bebop-c*); temple spires on the riverfront; broadcast towers. Pure: decided once per world from the seed, the
// city and its streets, then handed out by area.
import { CHUNK } from './chunk.ts';
import { type City, urban } from './cities.ts';
import { rand } from './hash.ts';
import { HIGHWAY_HALF, type Near, ROAD_HALF, type Road, RoadIndex } from './roads.ts';

/**
 * A box of a building: its middle, the way its front faces (local +z, toward the river), its size in metres, its foot
 * `y` m over the city's level, and a style: a 0–1 tone plus ROOM for a stair room on a roof (plain walls and a door), or
 * TIER for a tower's upper tier (no shops).
 */
export interface Block {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  y: number;
  style: number;
}
export const ROOM = 2;
export const TIER = 4;

/** A temple spire (a shikhara) in scaffolding: its middle, the radius of its foot, its height, the way it faces. */
export interface Spire {
  x: number;
  z: number;
  r: number;
  h: number;
  yaw: number;
}

/** A palace on the ghats (the generated model): its middle, the way its front faces (toward the river), its height. */
export interface Palace {
  x: number;
  z: number;
  yaw: number;
  h: number;
}
/** The palace model's footprint per metre of its height: across its front, and deep. */
export const PALACE = { w: 0.57, d: 0.69 };

/** A broadcast tower: its foot, its height and the way its loudspeakers face. */
export interface Tower {
  x: number;
  z: number;
  h: number;
  yaw: number;
}

/**
 * A small thing on or by a building, drawn instanced by kind (city.ts): its place, its foot `y` m over the city's level,
 * the way it faces, a size `s` and its kind.
 */
export interface Prop {
  x: number;
  z: number;
  y: number;
  yaw: number;
  s: number;
  kind: number;
}
export const TANK = 0; // a black plastic water tank on a roof
export const WATER_TOWER = 1; // an old wooden water tower on legs
export const AERIAL = 2;
export const DISH = 3;
export const SIGN = 4; // a neon blade sign out over the street, s m tall; its local +z points out from the wall
export const CROWN = 5; // a temple spire crowning a tower, s m the radius of its foot
export const MANDIR = 6; // a street temple, s m tall
/** m a mandir's plinth reaches from its middle, per metre of its height. */
export const MANDIR_FOOT = 0.31;

const DEEP = 15; // m between rows of buildings, out from the river
const WIDE = 13; // m between buildings along a row
const FLOOR = 3.2; // m
const WALK = 2.5; // m of pavement between a street's asphalt and a building
const SKYSCRAPERS = 160; // tries at an Art Deco tower downtown

export type Blocks = ReturnType<typeof makeBlocks>;

/** `streets()`: the city's roads. */
export function makeBlocks(seed: number, c: City, streets: () => Road[]) {
  const OC = Math.hypot(c.x - c.ox, c.z - c.oz);
  /** The point at angle a (from beta) and radius rho about the river's centre. */
  const P = (a: number, rho: number): [number, number] => [c.ox + Math.cos(c.beta + a) * rho, c.oz + Math.sin(c.beta + a) * rho];
  /** Facing the river from angle a: local +z toward the river's centre. */
  const facing = (a: number) => Math.atan2(-Math.cos(c.beta + a), -Math.sin(c.beta + a));
  /** World point of local (lx, lz) on something at (x, z) turned by yaw (as the shaders turn it: local +z to (sin, cos)). */
  const to = (x: number, z: number, yaw: number, lx: number, lz: number): [number, number] => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z + lz * Math.cos(yaw) - lx * Math.sin(yaw)];

  function make() {
    const index = new RoadIndex(streets(), true); // the expressway's ramps cross the riverfront rows
    const near: Near = { d: 0, h: 0 };
    // m from the asphalt's edge to (x, z)
    const clear = (x: number, z: number) => index.near(x, z, near).d - ROAD_HALF;
    const inside = (x: number, z: number, foot: number) => Math.hypot(x - c.x, z - c.z) < c.ring - HIGHWAY_HALF - WALK - foot;
    // Spires on the riverfront, spread along the river, right behind the ghats.
    const spires: Spire[] = [];
    const count = Math.round((2 * c.span * c.arc) / 320);
    for (let k = 0; k < count; k++) {
      const r = (s: number) => rand(seed, k, s, 95);
      const a = c.span * (-0.85 + (1.7 * (k + 0.5 + (r(1) - 0.5) * 0.5)) / count);
      const foot = 13 + r(2) * 5;
      const [x, z] = P(a, c.arc + c.half + 5 + foot);
      spires.push({ x, z, r: foot, h: 60 + r(3) * 40, yaw: facing(a) }); // they rise far over the city, as in the concepts
    }
    // Broadcast towers: one out on the far bank's sand, three among the streets.
    const towers: Tower[] = [];
    for (const [a, rho, h] of [[0.05, c.arc - c.half - 150, 120], [-0.28, c.arc + c.half + 330, 90], [0.3, c.arc + c.half + 520, 100], [0.08, c.arc + c.half + 1100, 110]]) {
      const [x, z] = P(a, rho);
      if (inside(x, z, 10) && clear(x, z) > 12) towers.push({ x, z, h, yaw: facing(a) });
    }

    const blocks = new Map<string, Block[]>();
    const props = new Map<string, Prop[]>();
    const put = <T extends { x: number; z: number }>(into: Map<string, T[]>, t: T) => {
      const key = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
      const list = into.get(key);
      if (list) list.push(t);
      else into.set(key, [t]);
    };
    const palaces: Palace[] = [];

    // Downtown, a little inland of the city's middle: Art Deco towers in setbacks, each crowned with a temple spire.
    const sky: { x: number; z: number; foot: number }[] = [];
    for (let k = 0; k < SKYSCRAPERS; k++) {
      const r = (s: number) => rand(seed, k, s, 110);
      const out = 700 * Math.sqrt(r(1));
      const t = r(2) * Math.PI * 2;
      const [x, z] = [c.x + Math.cos(t) * out + Math.cos(c.beta) * 250, c.z + Math.sin(t) * out + Math.sin(c.beta) * 250];
      const [w, d] = [16 + r(3) * 10, 16 + r(4) * 10];
      const foot = Math.hypot(w, d) / 2;
      if (urban(c, x, z) < 0.85 || !inside(x, z, foot) || clear(x, z) < WALK + foot || sky.some((o) => Math.hypot(o.x - x, o.z - z) < o.foot + foot + 24)) continue;
      if (spires.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 10 + foot) || towers.some((o) => Math.hypot(o.x - x, o.z - z) < 16 + foot)) continue;
      sky.push({ x, z, foot });
      const yaw = Math.atan2(c.ox - x, c.oz - z) + (r(5) - 0.5) * 0.2; // more or less toward the river
      const floors = 14 + Math.floor(r(6) * r(7) * 30);
      const style = 0.45 + r(8) * 0.47; // cream, brick, indigo wash, concrete: not the soot of the outskirts
      // Three setbacks, narrowing, and the spire on the last.
      let y = 0;
      for (const [s, share, tier] of [[1, 0.48, 0], [0.78, 0.3, TIER], [0.56, 0.22, TIER]]) {
        const h = Math.max(2, Math.round(floors * share)) * FLOOR + 0.6;
        put(blocks, { x, z, yaw, w: w * s, d: d * s, h, y, style: style + tier });
        y += h;
      }
      put(props, { x, z, y, yaw, s: 0.4 * 0.56 * Math.min(w, d), kind: CROWN });
      if (r(9) < 0.5) {
        const [tx, tz] = to(x, z, yaw, w * 0.36, d * 0.3); // a water tower on the first setback
        put(props, { x: tx, z: tz, y: Math.max(2, Math.round(floors * 0.48)) * FLOOR + 0.6, yaw, s: 1, kind: WATER_TOWER });
      }
    }

    for (let i = 0; ; i++) {
      const rho = c.arc + c.half + 3 + DEEP / 2 + i * DEEP; // the first row stands on the ghats' top, behind a 3 m walk
      if (rho > OC + c.ring) break;
      const step = WIDE / rho;
      const reach = Math.ceil(Math.asin(Math.min(1, c.ring / OC)) / step) + 1;
      for (let j = -reach; j < reach; j++) {
        const r = (s: number) => rand(seed, i, j, 100 + s);
        const a = (j + 0.5 + (r(1) - 0.5) * 0.15) * step;
        const [x, z] = P(a, rho);
        const u = urban(c, x, z);
        const riverfront = i === 0 && Math.abs(a) < c.span;
        if (u < 0.03 && !riverfront) continue;
        const small = riverfront ? 1 : 0.75 + 0.25 * u; // houses in the outskirts are smaller
        const w = (8 + r(2) * 3.5) * small; // along the row
        const d = (9 + r(3) * 4.5) * small; // out from the river
        const foot = Math.hypot(w, d) / 2;
        // Courtyards and gaps: a few in the old city, more and more of them out toward open land.
        if (!riverfront && r(4) > 0.94 * (0.1 + 0.9 * u)) continue;
        if (!inside(x, z, foot) || clear(x, z) < WALK + foot) continue;
        if (spires.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 6 + foot) || towers.some((t) => Math.hypot(t.x - x, t.z - z) < 14 + foot)) continue;
        if (sky.some((s) => Math.hypot(s.x - x, s.z - z) < s.foot + foot + 3)) continue;
        const yaw = facing(a);
        // The riverfront along the river is palaces, 18 to 20 m tall so they fit the row's cells.
        if (riverfront) {
          palaces.push({ x, z, yaw, h: 18 + r(10) * 2 });
          continue;
        }
        // Now and then a mandir in the old city, its spire over the roofs.
        if (u > 0.55 && r(38) < 0.02) {
          put(props, { x, z, y: 0, yaw, s: Math.min(w, d) / (2 * MANDIR_FOOT), kind: MANDIR });
          continue;
        }
        // Tall havelis by the ghats; further out three to eight floors, coming down to one or two in the outskirts. The
        // old city by the river is sandstone, ochre, rose and cream (tones under 0.6); brick, indigo wash, concrete, soot
        // and neon further out.
        const floors = i < 2 ? 5 + Math.floor(r(5) * 5) : Math.max(1, Math.round((1 + 5 * u) * (0.55 + 0.9 * r(6))));
        const h = floors * FLOOR + 0.6;
        const style = i < 8 ? r(8) * 0.6 : r(8);
        put(blocks, { x, z, yaw, w, d, h, y: 0, style });

        // The roof: a stair room, water tanks, now and then a wooden water tower, an aerial, a dish.
        const corner = (k: number, inset: number): [number, number] => to(x, z, yaw, (k & 1 ? 1 : -1) * (w / 2 - inset), (k & 2 ? 1 : -1) * (d / 2 - inset));
        const first = Math.floor(r(11) * 4);
        if (floors >= 2 && r(12) < 0.55) {
          const [rx, rz] = corner(first, 1.9);
          put(blocks, { x: rx, z: rz, yaw, w: 2.8, d: 3.4, h: 2.6, y: h, style: style + ROOM });
          if (r(13) < 0.4) put(props, { x: rx, z: rz, y: h + 2.6, yaw, s: 0.9, kind: TANK });
        }
        const tanks = r(14) < 0.8 ? 1 + Math.floor(r(15) * 1.6) : 0;
        for (let k = 1; k <= tanks; k++) {
          const [tx, tz] = corner(first + k, 1.4);
          put(props, { x: tx, z: tz, y: h, yaw: r(15 + k) * 6.28, s: 0.85 + r(18 + k) * 0.4, kind: TANK });
        }
        if (floors >= 5 && r(22) < 0.22) {
          const [tx, tz] = to(x, z, yaw, (r(23) - 0.5) * (w - 4), (r(24) - 0.5) * (d - 4));
          put(props, { x: tx, z: tz, y: h, yaw, s: 0.9 + r(25) * 0.3, kind: WATER_TOWER });
        }
        if (r(26) < 0.35) {
          const [ax, az] = to(x, z, yaw, (r(27) - 0.5) * w * 0.8, (r(28) - 0.5) * d * 0.8);
          put(props, { x: ax, z: az, y: h, yaw: r(29) * 6.28, s: 0.7 + r(30) * 0.7, kind: AERIAL });
        }
        if (r(31) < 0.2) {
          const [ax, az] = corner(first + 3, 0.9);
          put(props, { x: ax, z: az, y: h, yaw: r(32) * 6.28, s: 0.8 + r(33) * 0.5, kind: DISH });
        }
        // A neon blade sign out over a street, on a wall that fronts one: more of them toward the middle.
        if (floors >= 2 && r(34) < 0.15 + 0.35 * u) {
          const start = Math.floor(r(35) * 4);
          for (let k = 0; k < 4; k++) {
            const f = (start + k) % 4; // the walls: front, right, back, left
            const [nx, nz] = [[0, 1], [1, 0], [0, -1], [-1, 0]][f];
            const half = nx ? w / 2 : d / 2;
            const [px, pz] = to(x, z, yaw, nx * (half + 1.5), nz * (half + 1.5));
            if (clear(px, pz) > 5) continue;
            const along = (r(36) - 0.5) * ((nx ? d : w) - 2);
            const [sx, sz] = to(x, z, yaw, nx * (half + 0.55) - nz * along, nz * (half + 0.55) + nx * along);
            put(props, { x: sx, z: sz, y: 3.6, yaw: yaw + [0, Math.PI / 2, Math.PI, -Math.PI / 2][f], s: Math.min(h - 4.4, 3 + r(37) * 7), kind: SIGN });
            break;
          }
        }
      }
    }
    return { blocks, props, spires, towers, palaces };
  }
  let made: ReturnType<typeof make> | null = null;
  const get = () => (made ??= make());
  /** What `into` holds whose middles are in [x0, x1) × [z0, z1). */
  const within = <T extends { x: number; z: number }>(into: Map<string, T[]>, x0: number, z0: number, x1: number, z1: number): T[] => {
    if (x1 < c.x - c.ring || x0 > c.x + c.ring || z1 < c.z - c.ring || z0 > c.z + c.ring) return [];
    const out: T[] = [];
    for (let i = Math.floor(x0 / CHUNK); i <= Math.floor((x1 - 1e-6) / CHUNK); i++) {
      for (let j = Math.floor(z0 / CHUNK); j <= Math.floor((z1 - 1e-6) / CHUNK); j++) {
        for (const b of into.get(`${i},${j}`) ?? []) if (b.x >= x0 && b.x < x1 && b.z >= z0 && b.z < z1) out.push(b);
      }
    }
    return out;
  };

  return {
    /** Buildings' boxes whose middles are in [x0, x1) × [z0, z1). */
    blocks: (x0: number, z0: number, x1: number, z1: number): Block[] => within(get().blocks, x0, z0, x1, z1),
    /** Props whose middles are in [x0, x1) × [z0, z1). */
    props: (x0: number, z0: number, x1: number, z1: number): Prop[] => within(get().props, x0, z0, x1, z1),
    spires: () => get().spires,
    towers: () => get().towers,
    palaces: () => get().palaces,
    /** The expressway on stilts, if the city has one. */
    deck: () => streets().find((r) => r.deck) ?? null,
  };
}
