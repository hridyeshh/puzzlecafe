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
  detail: number; // hills on top of it, m
}

export interface Fields {
  seed: number;
  continent(x: number, z: number): number;
  smooth(x: number, z: number): number;
  sample(x: number, z: number, out: Sample): Sample;
  /** 0–1; woods grow where it is high. */
  woods(x: number, z: number): number;
}

export function makeFields(seed: number): Fields {
  const noise = (salt: number) => new SimplexNoise({ random: mulberry32(hash(seed, salt)) });
  const [warpX, warpZ, broad, coastline, cliffs, swell, hills, forest] = [1, 2, 3, 4, 5, 6, 7, 8].map(noise);

  // Domain-warped, so coastlines wander into bays and headlands.
  const continent = (x: number, z: number) => {
    const wx = x + warpX.noise(x / 3000, z / 3000) * 700;
    const wz = z + warpZ.noise(x / 3000, z / 3000) * 700;
    return broad.noise(wx / 8000, wz / 8000) * 0.75 + coastline.noise(wx / 2600, wz / 2600) * 0.25 + 0.12;
  };

  // Seabed below 0; on land a slope inland, cliffs where `cliffs` says so, and a gentle swell. Grades stay under ~8%.
  const smoothAt = (x: number, z: number, c: number) => {
    if (c < 0) return c * 400;
    const cliff = smoothstep(-0.15, 0.35, cliffs.noise(x / 3200, z / 3200));
    return c * 150 + 30 * smoothstep(0.002, 0.014, c) * cliff + swell.noise(x / 1700, z / 1700) * 9 * smoothstep(0, 0.06, c);
  };

  return {
    seed,
    continent,
    smooth: (x, z) => smoothAt(x, z, continent(x, z)),
    woods: (x, z) => forest.noise(x / 1400, z / 1400) * 0.5 + 0.5,
    sample(x, z, out) {
      const c = continent(x, z);
      out.c = c;
      out.smooth = smoothAt(x, z, c);
      // Hills: low by the coast, rolling inland.
      const amp = (4 + 34 * smoothstep(0.06, 0.4, c)) * smoothstep(0, 0.04, c);
      let h = 0;
      for (let octave = 0, a = 1, f = 1 / 700; amp > 0 && octave < 5; octave++, a *= 0.45, f *= 2.1) {
        h += a * hills.noise(x * f, z * f);
      }
      out.detail = h * amp;
      return out;
    },
  };
}
