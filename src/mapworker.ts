// Draws map tiles off the main thread: land and sea, then roads, on an OffscreenCanvas. The cafés and stations on a
// tile go back as points, so the main thread can badge them at a constant size.
import { COAST_C, type Sample, smoothstep } from './world/fields.ts';
import { regionsIn } from './world/places.ts';
import type { PoiKind } from './world/pois.ts';
import { ROAD_HALF } from './world/roads.ts';
import { type World, makeWorld } from './world/world.ts';

/** A tile to draw: world corner (x0, z0), `m` metres per pixel, `px` pixels a side, the coast traced every `step` m. */
export interface MapJob {
  seed: number;
  key: string;
  x0: number;
  z0: number;
  m: number;
  px: number;
  step: number;
}

export interface MapTile {
  key: string;
  bitmap: ImageBitmap;
  places: { kind: PoiKind; x: number; z: number }[];
  regions: { name: string; x: number; z: number }[]; // region names whose centre is on this tile
}

const DEEP = [28, 64, 92];
const SHALLOW = [74, 140, 160];
const SAND = [214, 196, 152];
const LOW = [130, 160, 96];
const HIGH = [176, 168, 120];
const ALPINE = [128, 138, 116];
const SNOW = [236, 238, 242];
const DESERT = [222, 182, 126];
const PAD = 120; // m of roads beyond the tile: strokes run on across its edge, and POIs see junctions out there
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

let world: World | null = null;

self.onmessage = (e: MessageEvent<MapJob>) => {
  const { seed, key, x0, z0, m, px, step } = e.data;
  world ??= makeWorld(seed);
  const size = px * m;
  const canvas = new OffscreenCanvas(px, px);
  const g = canvas.getContext('2d')!;

  // Land and sea, one sample per 2×2 pixels, scaled up smoothly: coloured by the kind of country (mountains, snow up
  // high, desert) and hill-shaded from the north-west, so ranges read at a glance. One extra row and column of
  // heights lets each pixel shade against its neighbours.
  const n = px / 2;
  const s: Sample = { c: 0, smooth: 0, detail: 0, peak: 0, alpine: 0, arid: 0 };
  const heights = new Float32Array((n + 1) * (n + 1));
  const colours: number[][] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      world.fields.sample(x0 + (i - 0.5) * 2 * m, z0 + (j - 0.5) * 2 * m, s);
      const h = s.c < 0 ? 0 : s.smooth + s.detail + s.peak;
      heights[j * (n + 1) + i] = h;
      if (i === 0 || j === 0) continue;
      let rgb = s.c < 0 ? mix(SHALLOW, DEEP, Math.min(1, -s.c * 6)) : s.c < COAST_C * 0.4 ? SAND : mix(LOW, HIGH, Math.min(1, s.c * 1.5));
      if (s.c >= 0) rgb = mix(mix(mix(rgb, ALPINE, s.alpine), DESERT, s.arid), SNOW, smoothstep(430, 520, h));
      colours[(j - 1) * n + i - 1] = rgb;
    }
  }
  const img = new ImageData(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = heights[(j + 1) * (n + 1) + i + 1];
      const slope = (h - heights[j * (n + 1) + i]) / (2 * m * Math.SQRT2); // up toward the south-east
      const shade = Math.min(1.25, Math.max(0.6, 1 + slope * 1.6));
      const rgb = colours[j * n + i];
      img.data.set([rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, 255], (j * n + i) * 4);
    }
  }
  const small = new OffscreenCanvas(n, n);
  small.getContext('2d')!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(small, 0, 0, px, px);

  // Roads: local ones first, then highways (wider, warm yellow), the coast road on top.
  const { roads, pois } = world.mapData(x0 - PAD, z0 - PAD, x0 + size + PAD, z0 + size + PAD, step);
  const dpr = px / 256;
  g.lineCap = g.lineJoin = 'round';
  for (const [tier, colour, width] of [[0, '#eee8da', 2.2], [1, '#f2cf72', 3.4], [2, '#fff6e2', 3.4]] as const) {
    g.strokeStyle = colour;
    g.lineWidth = width * dpr;
    g.beginPath();
    for (const r of roads) {
      if ((r.coast ? 2 : r.half > ROAD_HALF ? 1 : 0) !== tier) continue;
      r.x.forEach((x, k) => (k ? g.lineTo : g.moveTo).call(g, (x - x0) / m, (r.z[k] - z0) / m));
    }
    g.stroke();
  }

  // Each café and station belongs to the one tile it stands in.
  const places = pois
    .filter((p) => p.kind !== 'hoarding' && p.x >= x0 && p.x < x0 + size && p.z >= z0 && p.z < z0 + size)
    .map(({ kind, x, z }) => ({ kind, x, z }));
  const regions = regionsIn(world.fields, x0, z0, x0 + size, z0 + size);
  const bitmap = canvas.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ key, bitmap, places, regions } satisfies MapTile, [bitmap]);
};
