// Builds tiles off the main thread: one world per worker, one tile per message.
import { buildTile, transfers } from './tile.ts';
import { type World, makeWorld } from './world/world.ts';

let world: World | null = null;

self.onmessage = (e: MessageEvent<{ seed: number; cx: number; cz: number; lod: number }>) => {
  const { seed, cx, cz, lod } = e.data;
  world ??= makeWorld(seed);
  const tile = buildTile(world, cx, cz, lod);
  (self as unknown as Worker).postMessage(tile, transfers(tile));
};
