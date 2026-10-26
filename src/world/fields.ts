// The noise fields everything else is built from: continentalness (land and sea), the road-safe height, and hills.
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { hash, mulberry32 } from './hash.ts';

/** Continentalness of the coast road. The sea is C < 0 and C grows inland. */
export const COAST_C = 0.05;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The fields at one point. */
export interface Sample {
  c: number; // continentalness
  smooth: number; // height roads sit on, m
  detail: number; // hills (and dunes) on top of it, m
  peak: number; // mountains on top of that, m: they rise further from the roads than hills do
  alpine: number; // 0–1, mountains
  arid: number; // 0–1, desert
}

export interface Fields {
  seed: number;
  continent(x: number, z: number): number;
  smooth(x: number, z: number): number;
  sample(x: number, z: number, out: Sample): Sample;
  /** 0–1; woods grow where it is high. */
  woods(x: number, z: number): number;
  /** 0–1: mountains, well inland. */
  alpine(x: number, z: number): number;
  /** 0–1: desert, inland and away from the mountains. */
  arid(x: number, z: number): number;
}

export function makeFields(seed: number): Fields {
  const noise = (salt: number) => new SimplexNoise({ random: mulberry32(hash(seed, salt)) });
  const [warpX, warpZ, broad, coastline, cliffs, swell, hills, forest, peaks, dry, ridges, dunes, buttes] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(noise);

  // Places, at the scale of a long drive: mountain ranges and deserts tens of kilometres across. They are land through
  // and through (they lift continentalness), and the Mediterranean coast and its islands lie between them.
  const mountain = (x: number, z: number) => peaks.noise(x / 30000, z / 30000);
  const desert = (x: number, z: number) => dry.noise(x / 34000 + 17, z / 34000);
  const alpineAt = (x: number, z: number) => smoothstep(0.15, 0.45, mountain(x, z));
  const aridAt = (x: number, z: number, a: number) => smoothstep(0.15, 0.45, desert(x, z)) * (1 - a);
  // How far the land has risen toward a mountain range (or out into a desert): the same fields over wider spans, so
  // the rise is spread over many kilometres and roads climb gently.
  const liftAt = (x: number, z: number) => smoothstep(-0.05, 0.65, mountain(x, z));
  // Domain-warped, so coastlines wander into bays and headlands.
  const continent = (x: number, z: number) => {
    const wx = x + warpX.noise(x / 3000, z / 3000) * 700;
    const wz = z + warpZ.noise(x / 3000, z / 3000) * 700;
    const inland = Math.max(liftAt(x, z), smoothstep(-0.05, 0.65, desert(x, z)));
    return broad.noise(wx / 8000, wz / 8000) * 0.75 + coastline.noise(wx / 2600, wz / 2600) * 0.25 + 0.12 + 0.55 * inland;
  };

  // Seabed below 0; on land a slope inland, cliffs where `cliffs` says so, and a gentle swell; mountains lift it as a
  // whole over many kilometres, so roads climb at 4–6%, and the peaks (detail) rise beside them.
  const smoothAt = (x: number, z: number, c: number) => {
    if (c < 0) return c * 400;
    const cliff = smoothstep(-0.15, 0.35, cliffs.noise(x / 3200, z / 3200));
    return Math.min(c, 0.2) * 150 + Math.max(c - 0.2, 0) * 60 + 30 * smoothstep(0.002, 0.014, c) * cliff + swell.noise(x / 1700, z / 1700) * 9 * smoothstep(0, 0.06, c) + 260 * liftAt(x, z);
  };

  return {
    seed,
    continent,
    smooth: (x, z) => smoothAt(x, z, continent(x, z)),
    woods: (x, z) => forest.noise(x / 1400, z / 1400) * 0.5 + 0.5,
    alpine: alpineAt,
    arid: (x, z) => aridAt(x, z, alpineAt(x, z)),
    sample(x, z, out) {
      const a = alpineAt(x, z);
      const d = aridAt(x, z, a);
      const c = continent(x, z);
      out.c = c;
      out.alpine = a;
      out.arid = d;
      out.smooth = smoothAt(x, z, c);
      // Hills: low by the coast, rolling inland, flatter in the desert.
      const amp = (4 + 34 * smoothstep(0.06, 0.4, c)) * smoothstep(0, 0.04, c) * (1 - 0.6 * d);
      let h = 0;
      for (let octave = 0, w = 1, f = 1 / 700; amp > 0 && octave < 5; octave++, w *= 0.45, f *= 2.1) {
        h += w * hills.noise(x * f, z * f);
      }
      // Peaks: ridged noise, sharp crests; dunes: soft ridges a few metres high.
      let peak = 0;
      for (let octave = 0, w = 0.6, f = 1 / 1800; a > 0 && octave < 4; octave++, w *= 0.5, f *= 2.2) {
        const r = 1 - Math.abs(ridges.noise(x * f, z * f));
        peak += w * r * r;
      }
      const dune = d > 0 ? (1 - Math.abs(dunes.noise(x / 260, z / 220))) ** 2 * 9 * d : 0;
      out.detail = h * amp + dune;
      // Mesas in the desert: flat-topped buttes with steep sides (the rock colour finds them by slope).
      const mesa = d > 0 ? smoothstep(0.42, 0.5, buttes.noise(x / 900, z / 900)) * 55 * d : 0;
      out.peak = peak * 250 * a + mesa;
      return out;
    },
  };
}
