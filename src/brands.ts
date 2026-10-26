// The brands that live in the world. A new project is a new entry here plus its 2:1 posters in public/brands/.
export interface Brand {
  id: string;
  name: string;
  posters: string[];
  weight: number; // how often its hoardings come up, relative to the others
}

export const BRANDS: Brand[] = [
  { id: 'paperboxd', name: 'paperboxd', posters: ['/brands/paperboxd-1.jpg', '/brands/paperboxd-2.jpg'], weight: 3 },
  { id: 'stickynotes', name: 'stickynotes', posters: ['/brands/stickynotes-1.jpg', '/brands/stickynotes-2.jpg'], weight: 2 },
  { id: 'thelocalcode', name: 'thelocalcode', posters: ['/brands/thelocalcode-1.jpg', '/brands/thelocalcode-2.jpg'], weight: 2 },
];

/** The poster a hoarding shows, chosen from its POI hash by brand weight. */
export function posterFor(pick: number): string {
  const total = BRANDS.reduce((sum, b) => sum + b.weight, 0);
  let roll = ((pick >>> 8) % 1000) / 1000 * total;
  for (const b of BRANDS) {
    roll -= b.weight;
    if (roll < 0) return b.posters[(pick >>> 20) % b.posters.length];
  }
  return BRANDS[0].posters[0];
}
