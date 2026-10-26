// The map (M): sea, land, roads, paperboxd cafés and petrol stations, and your pins. Workers draw it in tiles that are
// kept as bitmaps, so dragging and zooming only move pictures around. Drag pans; the wheel zooms about the pointer.
// Pins are stickynotes sticky notes in its four highlighter colours: click a road to pin it, click a pin to drive there,
// right-click (or ctrl-click) to take it off. They are kept in this browser.
import type { MapJob, MapTile } from './mapworker.ts';
import { BIOMES, type Biome, roadNear } from './world/places.ts';
import type { World } from './world/world.ts';

const TRAVEL: Record<Exclude<Biome, 'sea'>, string> = { coast: 'Coast', country: 'Countryside', mountains: 'Mountains', desert: 'Desert' };

const ZOOMS = [3, 6, 12, 24, 48]; // metres per screen pixel; each level doubles, so a coarser tile can stand in
const TILE = 256; // screen pixels a side
const KEEP = 120; // tiles kept, up to 1 MB each on a high-density screen
const SEA = '#4a8ca0';
// The stickynotes extension's highlighter swatches.
const INKS = { yellow: '#f2d14b', pink: '#ef8fb7', blue: '#86b6ea', green: '#93cf8c' };
type Ink = keyof typeof INKS;
type Pin = { x: number; z: number; yaw: number; ink: Ink };

/** localStorage, which can be missing or full (private windows): then pins last the visit. */
function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not kept
  }
}

/**
 * `travel` starts the drive again elsewhere, given as `place=<biome>` (the nearest road in that kind of country: the
 * buttons along the top of the map) or `at=x,z,yaw` (a pin).
 */
export function createMap(world: World, travel: (where: string) => void) {
  const canvas = document.body.appendChild(document.createElement('canvas'));
  canvas.id = 'map';
  canvas.hidden = true;
  const bar = document.body.appendChild(document.createElement('div'));
  bar.id = 'travel';
  bar.hidden = true;
  for (const biome of BIOMES) {
    const b = bar.appendChild(document.createElement('button'));
    b.textContent = TRAVEL[biome];
    b.title = `Go to the nearest ${TRAVEL[biome].toLowerCase()}`;
    b.addEventListener('click', () => travel(`place=${biome}`));
  }
  const pins = load<Pin[]>('puzzlecafe.pins', []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.yaw) && p.ink in INKS);
  let ink = load<Ink>('puzzlecafe.ink', 'yellow');
  if (!(ink in INKS)) ink = 'yellow';
  const swatches = bar.appendChild(document.createElement('div'));
  swatches.className = 'inks';
  for (const [name, hex] of Object.entries(INKS)) {
    const b = swatches.appendChild(document.createElement('button'));
    b.style.background = hex;
    b.title = `Pin roads in ${name}`;
    b.setAttribute('aria-label', `${name} pins`);
    b.setAttribute('aria-pressed', String(name === ink));
    b.addEventListener('click', () => {
      ink = name as Ink;
      save('puzzlecafe.ink', ink);
      for (const s of swatches.children) s.setAttribute('aria-pressed', String(s === b));
      draw();
    });
  }
  const g = canvas.getContext('2d')!;
  const tiles = new Map<string, MapTile>(); // least recently drawn first
  const asked = new Set<string>();
  const idle: Worker[] = [];
  let hired = false;
  let zoom = 1;
  let cx = 0; // world point at the centre of the screen
  let cz = 0;
  let car = { x: 0, z: 0, yaw: 0 };
  let drag: { x: number; y: number; cx: number; cz: number } | null = null;
  let wheel = 0;

  function hire() {
    hired = true;
    const count = Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./mapworker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<MapTile>) => {
        asked.delete(e.data.key);
        tiles.set(e.data.key, e.data);
        for (const [key, old] of tiles) {
          if (tiles.size <= KEEP) break;
          old.bitmap.close();
          tiles.delete(key);
        }
        idle.push(w);
        draw();
      };
      idle.push(w);
    }
  }

  function draw() {
    if (canvas.hidden) return;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const px = Math.round(TILE * dpr);
    const m = ZOOMS[zoom] / dpr; // metres per canvas pixel
    const ox = Math.round(w / 2 - cx / m); // canvas position of world (0, 0)
    const oy = Math.round(h / 2 - cz / m);
    const step = Math.max(8, Math.round((ZOOMS[zoom] * 2.5) / 8) * 8);
    g.fillStyle = SEA;
    g.fillRect(0, 0, w, h);

    const places: MapTile['places'] = [];
    const regions: MapTile['regions'] = [];
    const missing: [number, MapJob][] = [];
    for (let tx = Math.floor(-ox / px); ox + tx * px < w; tx++) {
      for (let tz = Math.floor(-oy / px); oy + tz * px < h; tz++) {
        const sx = ox + tx * px;
        const sy = oy + tz * px;
        const key = `${zoom}/${tx}/${tz}/${px}`;
        const tile = tiles.get(key);
        if (tile) {
          tiles.delete(key); // to the back of the queue for eviction
          tiles.set(key, tile);
          g.drawImage(tile.bitmap, sx, sy);
          places.push(...tile.places);
          regions.push(...tile.regions);
          continue;
        }
        standIn(tx, tz, px, sx, sy);
        if (asked.has(key)) continue;
        const job = { seed: world.seed, key, x0: tx * px * m, z0: tz * px * m, m, px, step };
        missing.push([Math.hypot(sx + px / 2 - w / 2, sy + px / 2 - h / 2), job]);
      }
    }
    // Nearest the middle of the screen first.
    missing.sort((a, b) => a[0] - b[0]);
    for (const [, job] of missing) {
      const worker = idle.pop();
      if (!worker) break;
      asked.add(job.key);
      worker.postMessage(job);
    }

    // Places: badges when close in, dots further out, none at the widest view, where they would bury the map.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of places) {
      if (ZOOMS[zoom] > 24) break;
      const cafe = p.kind === 'cafe';
      const [x, y, fill] = [ox + p.x / m, oy + p.z / m, cafe ? '#111111' : '#1f8a83'];
      if (ZOOMS[zoom] <= 12) badge(x, y, fill, cafe ? 'pb' : 'F', dpr);
      else dot(x, y, fill, dpr);
    }
    // Region names when zoomed out, white with a dark halo.
    if (ZOOMS[zoom] >= 12) {
      g.font = `600 ${16 * dpr}px ui-serif, Georgia, serif`;
      g.lineWidth = 5 * dpr;
      g.strokeStyle = 'rgba(12, 14, 18, 0.7)';
      g.fillStyle = '#ffffff';
      for (const r of regions) {
        g.strokeText(r.name, ox + r.x / m, oy + r.z / m);
        g.fillText(r.name, ox + r.x / m, oy + r.z / m);
      }
    }
    for (const p of pins) note(ox + p.x / m, oy + p.z / m, p.ink, dpr);
    drawCar(ox + car.x / m, oy + car.z / m, dpr);
    legend(h, dpr);
  }

  /** While a tile loads, the nearest coarser tile that covers it stands in, scaled up. */
  function standIn(tx: number, tz: number, px: number, sx: number, sy: number) {
    for (let up = 1; zoom + up < ZOOMS.length; up++) {
      const f = 2 ** up;
      const ux = Math.floor(tx / f);
      const uz = Math.floor(tz / f);
      const coarse = tiles.get(`${zoom + up}/${ux}/${uz}/${px}`);
      if (!coarse) continue;
      const part = px / f;
      g.drawImage(coarse.bitmap, (tx - ux * f) * part, (tz - uz * f) * part, part, part, sx, sy, px, px);
      return;
    }
  }

  function badge(x: number, y: number, fill: string, label: string, dpr: number) {
    g.fillStyle = fill;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(x, y, 10 * dpr, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = `700 ${9 * dpr}px system-ui, sans-serif`;
    g.fillText(label, x, y + 0.5 * dpr);
  }

  function dot(x: number, y: number, fill: string, dpr: number) {
    g.fillStyle = fill;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    g.arc(x, y, 4 * dpr, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  /** A sticky note, a little askew (each its own way), with its corner turned up. */
  function note(x: number, y: number, ink: Ink, dpr: number) {
    const s = 10 * dpr;
    g.save();
    g.translate(x, y);
    g.rotate(((Math.abs(Math.round(x * 0.37 + y * 0.61)) % 13) - 6) * (Math.PI / 180));
    g.shadowColor = 'rgba(0, 0, 0, 0.4)';
    g.shadowBlur = 5 * dpr;
    g.shadowOffsetY = 2 * dpr;
    g.fillStyle = INKS[ink];
    g.beginPath();
    g.moveTo(-s, -s);
    g.lineTo(s, -s);
    g.lineTo(s, s * 0.35);
    g.lineTo(s * 0.35, s);
    g.lineTo(-s, s);
    g.closePath();
    g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = 'rgba(0, 0, 0, 0.2)';
    g.beginPath();
    g.moveTo(s, s * 0.35);
    g.lineTo(s * 0.35, s * 0.35);
    g.lineTo(s * 0.35, s);
    g.closePath();
    g.fill();
    g.fillRect(-s * 0.6, -s * 0.35, s * 1.2, dpr); // two lines of writing
    g.fillRect(-s * 0.6, s * 0.15, s * 0.8, dpr);
    g.restore();
  }

  function drawCar(x: number, y: number, dpr: number) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(Math.cos(car.yaw), Math.sin(car.yaw))); // heading (sin, cos) in screen x, y
    g.fillStyle = '#e76f51';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(12 * dpr, 0);
    g.lineTo(-8 * dpr, 7 * dpr);
    g.lineTo(-4 * dpr, 0);
    g.lineTo(-8 * dpr, -7 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  function legend(h: number, dpr: number) {
    g.fillStyle = 'rgba(12, 14, 18, 0.6)';
    g.beginPath();
    g.roundRect(8 * dpr, 10 * dpr, 150 * dpr, 96 * dpr, 12 * dpr);
    g.fill();
    g.textAlign = 'center';
    badge(24 * dpr, 28 * dpr, '#111111', 'pb', dpr);
    badge(24 * dpr, 58 * dpr, '#1f8a83', 'F', dpr);
    note(24 * dpr, 88 * dpr, ink, dpr);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = `600 ${13 * dpr}px system-ui, sans-serif`;
    g.fillText('paperboxd café', 42 * dpr, 28 * dpr);
    g.fillText('fuel', 42 * dpr, 58 * dpr);
    g.fillText('your pins', 42 * dpr, 88 * dpr);
    const hint = 'drag to move · scroll to zoom · click a road to pin it · click a pin to go there · right-click to unpin · M to close';
    g.font = `${12 * dpr}px system-ui, sans-serif`;
    g.fillStyle = 'rgba(12, 14, 18, 0.6)';
    g.beginPath();
    g.roundRect(8 * dpr, h - 31 * dpr, g.measureText(hint).width + 14 * dpr, 26 * dpr, 13 * dpr);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillText(hint, 15 * dpr, h - 18 * dpr);
  }

  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, cx, cz };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cx = drag.cx - (e.clientX - drag.x) * ZOOMS[zoom];
    cz = drag.cz - (e.clientY - drag.y) * ZOOMS[zoom];
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) click(e);
    drag = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /** A click that didn't drag: on a pin, drive to it (right- or ctrl-click: take it off); elsewhere, pin the nearest road. */
  function click(e: PointerEvent) {
    const x = cx + (e.clientX - innerWidth / 2) * ZOOMS[zoom];
    const z = cz + (e.clientY - innerHeight / 2) * ZOOMS[zoom];
    const hit = pins.find((p) => Math.hypot(p.x - x, p.z - z) < 12 * ZOOMS[zoom]);
    const off = e.button === 2 || e.ctrlKey;
    if (hit && !off) return travel(`at=${hit.x.toFixed(1)},${hit.z.toFixed(1)},${hit.yaw.toFixed(3)}`);
    if (hit) pins.splice(pins.indexOf(hit), 1);
    else if (!off) {
      const road = roadNear(world, x, z);
      if (road) pins.push({ ...road, ink });
    }
    save('puzzlecafe.pins', pins);
    draw();
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheel += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; // lines (Firefox) to pixels
    if (Math.abs(wheel) < 50) return; // trackpads send many small steps
    const next = Math.max(0, Math.min(ZOOMS.length - 1, zoom + Math.sign(wheel)));
    wheel = 0;
    if (next === zoom) return;
    // Keep the point under the pointer where it is.
    cx += (e.clientX - innerWidth / 2) * (ZOOMS[zoom] - ZOOMS[next]);
    cz += (e.clientY - innerHeight / 2) * (ZOOMS[zoom] - ZOOMS[next]);
    zoom = next;
    draw();
  });

  return {
    get open() {
      return !canvas.hidden;
    },
    /** Open centred on the car at world (x, z), or close. */
    toggle(x: number, z: number, yaw: number) {
      canvas.hidden = !canvas.hidden;
      bar.hidden = canvas.hidden;
      if (canvas.hidden) return;
      if (!hired) hire();
      car = { x, z, yaw };
      cx = x;
      cz = z;
      draw();
    },
    close() {
      canvas.hidden = bar.hidden = true;
    },
    /** Move the car marker while the map is open. */
    follow(x: number, z: number, yaw: number) {
      car = { x, z, yaw };
      draw();
    },
  };
}
