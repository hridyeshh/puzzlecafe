// Pure world generation: no DOM, no renderer, no Math.random. The same seed always builds the same world.
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export const CHUNK = 256; // metres per chunk side
export const RES = 128; // grid cells per chunk side
export const STEP = CHUNK / RES; // 2 m between samples
export const N = RES + 3; // samples per side, including a one-sample border so edge normals match the neighbour's

/** Seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Height = (x: number, z: number) => number;

/** Terrain height in metres at world x, z. Rolling hills for now; places and roads arrive in phase 1. */
export function makeHeight(seed: number): Height {
  const noise = new SimplexNoise({ random: mulberry32(seed) });
  return (x, z) => {
    let h = 0;
    let amp = 1;
    let f = 1 / 1000;
    for (let octave = 0; octave < 5; octave++) {
      h += amp * noise.noise(x * f, z * f);
      amp *= 0.42;
      f *= 2.05;
    }
    return h * 55;
  };
}

/** Heights of chunk (cx, cz) plus a one-sample border, x-major: index (xi + 1) * N + (zi + 1), xi and zi in -1..RES + 1. */
export function sampleChunk(height: Height, cx: number, cz: number): Float32Array {
  const out = new Float32Array(N * N);
  const x0 = cx * CHUNK - STEP;
  const z0 = cz * CHUNK - STEP;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) out[i * N + j] = height(x0 + i * STEP, z0 + j * STEP);
  return out;
}

/** The chunk's (RES + 1)² heights without the border, in Rapier heightfield order (column-major: x outer, z inner). */
export function colliderHeights(samples: Float32Array): Float32Array {
  const M = RES + 1;
  const out = new Float32Array(M * M);
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) out[i * M + j] = samples[(i + 1) * N + j + 1];
  return out;
}
