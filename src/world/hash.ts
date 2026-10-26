// Integer hashing and seeded randomness for world generation. Never Math.random: a seed must rebuild the same world.

/** lowbias32 by Chris Wellons: a fast, well-mixed 32-bit integer hash step. */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of a seed and up to three integers. */
export function hash(seed: number, a = 0, b = 0, c = 0): number {
  return mix(mix(mix(mix(seed) ^ a) ^ b) ^ c);
}

/** Uniform in [0, 1), from a seed and up to three integers. */
export function rand(seed: number, a = 0, b = 0, c = 0): number {
  return hash(seed, a, b, c) / 4294967296;
}

/** Seeded PRNG (mulberry32), used to seed the noise tables. */
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
