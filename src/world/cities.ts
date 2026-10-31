// Cities: few, big places at fixed spots in the endless world, each with its own twist (PLAN, Phase 3). The first is
// Prakashi, a dystopian river city of light after Kashi. A ring road closes it, and inland roads end on the ring in
// T-junctions as they end on the coast road. Inside: level ground; a crescent river, held by barrages at both ends, with
// ghats stepping down to it on the city's bank; streets in arcs along the river and lanes running out from it.
// Pure, like the rest of world/: a seed always puts the same city in the same place.
import { rand } from './hash.ts';

export interface City {
  name: string;
  x: number; // the middle
  z: number;
  ring: number; // m: radius of the ring road
  level: number; // m: the city's ground and streets
  water: number; // m: the river's surface
  ox: number; // the middle of the river's arc; the city lies outside it, the far bank inside
  oz: number;
  arc: number; // m: radius of the river's centreline about (ox, oz)
  half: number; // m: half the river's width
  beta: number; // angle about (ox, oz) toward the city's middle
  span: number; // radians either side of beta that the river runs, to its barrages
  phase: number; // turns the wander of the city's edge
}

/** What placing a city reads from the fields (no passes or roads yet: those are built around it). */
export interface Probe {
  continent(x: number, z: number): number;
  alpine(x: number, z: number): number;
  arid(x: number, z: number): number;
  base(x: number, z: number): number; // the land's height roads would sit on
}

const RINGS = [1800, 1500, 1300]; // m: the biggest city that fits somewhere, else a smaller one
const ARC = 2200;
const HALF = 140;
const NEAR = 1 / 3; // of the ring's radius, from the city's middle to the near bank
export const GHAT = 36; // m of steps from the city's ground down into the river
const DROP = 11; // m from the city's ground down to the water
const BED = 4; // m of water over the riverbed
const SHORE = 90; // m over which the far bank's sand rises to the city's ground
const CHECK = 450; // m beyond the ring that must be land, and level enough, for a city to fit
const FADE = 900; // m beyond the ring over which the land comes back
const OUTSKIRTS = 0.4; // of the ring's radius, over which the city thins out to open land at its edge
const BARRAGE = 250; // m inside the ring the river's barrages stand
/** The barrages' wall: its middle in m past the river's end, its thickness, and its crest in m over the city's ground,
 * low enough for the expressway's ramps to pass over it and too high to drive onto. */
export const DAM = { past: 2, thick: 10, crest: 1 };
export const FRONT = 70; // m from the near bank to the riverfront avenue: the ghats' palaces stand between
export const BLOCK = 150; // m between the avenues that follow the river
export const LANES = 0.054; // radians between the lanes out from the river (~130 m at the riverfront)

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** An angle wrapped into (-π, π]. */
export const wrap = (a: number) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

/**
 * Prakashi for this seed: the first spot, ringing out from the origin, where a whole city fits on land well clear of the
 * coast road, not in the mountains or the desert, and not too steep to level (it levels its own ground, to the land's
 * average there); the biggest city that fits within 40 km, else a smaller one. Null if none does.
 */
export function placeCity(seed: number, p: Probe): City | null {
  const turn = rand(seed, 0, 0, 90) * Math.PI * 2;
  for (const ring of RINGS) {
    for (let dist = 5000; dist <= 40000; dist += 1000) {
      const n = Math.ceil((2 * Math.PI * dist) / 2000); // spots about 2 km apart round each circle
      for (let k = 0; k < n; k++) {
        const t = turn + (k * 2 * Math.PI) / n;
        const [x, z] = [Math.cos(t) * dist, Math.sin(t) * dist];
        const level = fit(p, x, z, ring);
        if (level === null) continue;
        const toward = rand(seed, k, dist, 91) * Math.PI * 2; // the river's side of the city
        const off = NEAR * ring + HALF + ARC;
        const [ox, oz] = [x + Math.cos(toward) * off, z + Math.sin(toward) * off];
        const reach = ring - BARRAGE;
        const span = Math.acos((off * off + ARC * ARC - reach * reach) / (2 * off * ARC));
        const phase = rand(seed, k, dist, 92) * Math.PI * 2;
        return { name: 'Prakashi', x, z, ring, level, water: level - DROP, ox, oz, arc: ARC, half: HALF, beta: toward + Math.PI, span, phase };
      }
    }
  }
  return null;
}

/** The level a city of radius `ring` at (x, z) would have, or null if it does not fit there. */
function fit(p: Probe, x: number, z: number, ring: number): number | null {
  const heights: number[] = [];
  for (const r of [0, ring / 2, ring, ring + CHECK]) {
    for (let k = 0; k < (r ? 12 : 1); k++) {
      const [sx, sz] = [x + Math.cos((k * Math.PI) / 6) * r, z + Math.sin((k * Math.PI) / 6) * r];
      if (p.continent(sx, sz) < 0.12 || p.alpine(sx, sz) > 0.25 || p.arid(sx, sz) > 0.35) return null;
      heights.push(p.base(sx, sz));
    }
  }
  const level = heights.reduce((a, b) => a + b, 0) / heights.length;
  return level >= 15 && heights.every((h) => Math.abs(h - level) <= 60) ? level : null;
}

/** + outside the ring, - inside, in units of continentalness (0.03 is 300 m): roads treat the inside as they do the sea. */
export const cityGap = (c: City, x: number, z: number) => (Math.hypot(x - c.x, z - c.z) - c.ring) * 1e-4;

/** m from the river's centreline (+ toward the city), and m along it past the nearer barrage (- within the river). */
export function riverAt(c: City, x: number, z: number, out: { across: number; past: number }) {
  out.across = Math.hypot(x - c.ox, z - c.oz) - c.arc;
  out.past = (Math.abs(wrap(Math.atan2(z - c.oz, x - c.ox) - c.beta)) - c.span) * c.arc;
  return out;
}

const at = { across: 0, past: 0 };

/** Is (x, z) on the river (water at least 1 m deep), where a car would sink? */
export function inRiver(c: City, x: number, z: number): boolean {
  riverAt(c, x, z, at);
  return at.past < 0 && at.across > -c.half && at.across < c.half - GHAT + 3;
}

/**
 * 0–1: how built up the city is at (x, z). Full in its middle and along the ghats (the old city), it thins out and comes
 * down over its outskirts to open land before the ring, along an edge that wanders in and out rather than a circle.
 * Nothing is built on the river or across it: the far bank stays open land, as Kashi's does.
 */
export function urban(c: City, x: number, z: number): number {
  const d = Math.hypot(x - c.x, z - c.z);
  if (d >= c.ring) return 0;
  riverAt(c, x, z, at);
  if (at.across < c.half) return 0;
  const t = Math.atan2(z - c.z, x - c.x);
  const edge = c.ring * (0.84 + 0.07 * Math.sin(3 * t + c.phase) + 0.05 * Math.sin(5 * t + 2.3 * c.phase) + 0.03 * Math.sin(9 * t + 4.1 * c.phase));
  const old = at.past < 0 ? (1 - ss(250, 600, at.across - c.half)) * (1 - ss(edge - 0.5 * OUTSKIRTS * c.ring, edge, d)) : 0;
  return Math.max(1 - ss(edge - OUTSKIRTS * c.ring, edge, d), old);
}

/** 0–1: how far the city has levelled the land at (x, z): all of it within the ring, none FADE m beyond. */
export const cityFade = (c: City, x: number, z: number) => 1 - ss(c.ring + 40, c.ring + FADE, Math.hypot(x - c.x, z - c.z));

/** The ground at (x, z), given the land's height `h` there: the city's (riverGround) within the ring, back to the land over FADE m beyond it. */
export function cityGround(c: City, x: number, z: number, h: number): number {
  const k = cityFade(c, x, z);
  return k > 0 ? h + (riverGround(c, x, z) - h) * k : h;
}

/** The city's ground: its level, or the river's channel: ghats down from the city, the bed, shallows, the far bank's sand. */
function riverGround(c: City, x: number, z: number): number {
  riverAt(c, x, z, at);
  const { across, past } = at;
  if (across > c.half || across < -c.half - SHORE || past > 12) return c.level;
  const bed = c.water - BED;
  let g: number;
  if (across > c.half - GHAT) g = c.water - 1 + ((c.level - c.water + 1) * (across - c.half + GHAT)) / GHAT;
  else if (across > -c.half + 30) g = bed;
  else if (across > -c.half) g = bed + (c.water + 0.5 - bed) * ss(-c.half + 30, -c.half, across);
  else g = c.water + 0.5 + (c.level - c.water - 0.5) * ss(-c.half, -c.half - SHORE, across);
  return past > 0 ? g + (c.level - g) * ss(0, 12, past) : g; // the channel closes at the barrage
}

/** 0–1: how much of the city is at (x, z): 1 inside the ring, fading out over 40 m beyond it. */
export const cityWeight = (c: City | null, x: number, z: number) => (c ? 1 - ss(c.ring, c.ring + 40, Math.hypot(x - c.x, z - c.z)) : 0);
