// The inland road grid: jittered nodes every GRID m, which edges between them exist, and which are highways.
// Decided from hashes and continentalness alone, so the land (mountain passes, in fields) and the roads share it.
import { hash, rand } from './hash.ts';

export const GRID = 1024; // m between inland road nodes
const EDGE_P = 0.72; // chance a grid edge exists before dead ends are filled in

export type Nodes = ReturnType<typeof makeNodes>;

/** The grid for `seed`; nodes stand where continentalness is over `nodeC`. Edge (i, j, dir) joins node (i, j) to its +x (dir 0) or +z (1) neighbour. */
export function makeNodes(seed: number, continent: (x: number, z: number) => number, nodeC: number) {
  // Highways run along every third grid line; their nodes barely move across them, so they run nearly straight.
  const major = (n: number) => ((n % 3) + 3) % 3 === 0;
  const highway = (i: number, j: number, dir: number) => major(dir === 0 ? j : i);
  const nodeAt = (i: number, j: number): [number, number] => [
    (i + 0.5 + (rand(seed, i, j, 11) - 0.5) * (major(i) ? 0.12 : 0.6)) * GRID,
    (j + 0.5 + (rand(seed, i, j, 12) - 0.5) * (major(j) ? 0.12 : 0.6)) * GRID,
  ];
  const land = (i: number, j: number) => {
    const [x, z] = nodeAt(i, j);
    return continent(x, z) > nodeC;
  };
  const base = (i: number, j: number, dir: number) => highway(i, j, dir) || rand(seed, i, j, 20 + dir) < EDGE_P;
  // A node's four edges as [i, j, dir]: +x, +z, -x, -z.
  const around = (i: number, j: number) => [[i, j, 0], [i, j, 1], [i - 1, j, 0], [i, j - 1, 1]];
  // Edges a node adds so it is no dead end. Decided from base edges only, so both ends of an edge agree.
  const forced = (i: number, j: number) => {
    const all = around(i, j);
    const missing = all.filter(([a, b, d]) => !base(a, b, d));
    const need = 2 - (all.length - missing.length);
    if (need <= 0) return [];
    return missing
      .sort((p, q) => hash(seed, p[0], p[1], 30 + p[2]) - hash(seed, q[0], q[1], 30 + q[2]))
      .slice(0, need)
      .map(([a, b, d]) => `${a},${b},${d}`);
  };
  const exists = (i: number, j: number, dir: number) => {
    const bi = i + 1 - dir;
    const bj = j + dir;
    const la = land(i, j);
    const lb = land(bi, bj);
    if (!la && !lb) return false;
    if (base(i, j, dir)) return true;
    const key = `${i},${j},${dir}`;
    return (la && forced(i, j).includes(key)) || (lb && forced(bi, bj).includes(key));
  };
  // Junction unless the road just runs straight through.
  const isJunction = (i: number, j: number) => {
    if (!land(i, j)) return false;
    const e = around(i, j).map(([a, b, d]) => exists(a, b, d));
    const n = e.filter(Boolean).length;
    return n >= 3 || (n === 2 && !(e[0] && e[2]) && !(e[1] && e[3]));
  };

  return { nodeAt, land, highway, exists, isJunction, around };
}
