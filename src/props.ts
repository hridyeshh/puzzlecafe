// Hoardings, paperboxd cafés and petrol stations: built once from primitives, cloned at each POI.
import * as THREE from 'three/webgpu';
import { color, texture } from 'three/tsl';
import { posterFor } from './brands.ts';
import { night } from './daylight.ts';
import { mulberry32 } from './world/hash.ts';
import type { Poi } from './world/pois.ts';

/** A collider box in a prop's own frame (+z faces the road): centre and half sizes, metres. */
export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface Prop {
  object: THREE.Object3D;
  boxes: Box[];
}

const mat = (hex: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness, metalness });
const steel = mat(0x6d7277, 0.45, 0.6);
const charcoal = mat(0x2b2b2d, 0.85);
const plaster = mat(0xe9e5dc, 0.9);
const concrete = mat(0x8f8b85, 0.95);
const teal = mat(0x1f8a83, 0.6);
const wood = mat(0x8a6240, 0.7);
const lamp = new THREE.MeshStandardNodeMaterial({ color: 0x333333 });
lamp.emissiveNode = color(0xfff1d8).mul(night.mul(4).add(0.05));

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
function part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A lit surface: `day` is its glow by day, `boost` how much brighter it gets at night. */
function glowing(map: THREE.Texture, day: number, boost: number) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35 });
  const t = texture(map);
  m.colorNode = t.mul(0.35);
  m.emissiveNode = t.mul(night.mul(boost).add(day));
  return m;
}

const posters = new Map<string, THREE.Material>();
function posterMaterial(url: string) {
  let m = posters.get(url);
  if (!m) {
    const map = new THREE.TextureLoader().load(url);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const lit = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    lit.colorNode = texture(map);
    lit.emissiveNode = texture(map).mul(night.mul(0.9)); // the lamps light it at night
    posters.set(url, (m = lit));
  }
  return m;
}

// A café's warm interior: shelves of books.
function shelves() {
  return canvasTexture(512, 256, (g) => {
    g.fillStyle = '#5a3d27';
    g.fillRect(0, 0, 512, 256);
    const random = mulberry32(3);
    const spines = ['#b5523b', '#d9a441', '#3f6e5a', '#2f4a6e', '#c9c1b0', '#7a3b4f', '#e2d3b5'];
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = 14 + shelf * 60;
      for (let x = 6; x < 506; ) {
        const w = 6 + random() * 10;
        const h = 30 + random() * 18;
        g.fillStyle = spines[Math.floor(random() * spines.length)];
        g.fillRect(x, y + 48 - h, w, h);
        x += w + 1;
      }
      g.fillStyle = '#3a2716';
      g.fillRect(0, y + 48, 512, 6);
    }
    const light = g.createRadialGradient(256, 100, 20, 256, 128, 300);
    light.addColorStop(0, 'rgba(255, 214, 150, 0.35)');
    light.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
    g.fillStyle = light;
    g.fillRect(0, 0, 512, 256);
  });
}

// "paperboxd café" in off-white on black, with the logo (black on white in the file, so drawn inverted).
function cafeSign() {
  const t = canvasTexture(1024, 128, (g) => {
    g.fillStyle = '#111111';
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#f3efe6';
    g.font = '600 74px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('paperboxd café', 160, 66);
  });
  const logo = new Image();
  logo.onload = () => {
    const g = (t.image as HTMLCanvasElement).getContext('2d')!;
    g.filter = 'invert(1)';
    g.drawImage(logo, 24, 4, 120, 120);
    t.needsUpdate = true;
  };
  logo.src = '/brands/paperboxd-logo.png';
  return t;
}

function words(text: string, background: string, ink: string) {
  return canvasTexture(512, 256, (g) => {
    g.fillStyle = background;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = ink;
    g.font = '700 120px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 136);
  });
}

function hoarding(big: boolean): Prop {
  const g = new THREE.Group();
  const [w, h, bottom] = big ? [10, 5, 7.5] : [6, 3, 2.6];
  const cy = bottom + h / 2;
  const posts = big ? [0] : [-w * 0.3, w * 0.3];
  const thick = big ? 0.7 : 0.22;
  for (const x of posts) g.add(part(box(thick, cy, thick), steel, x, cy / 2, -0.35));
  g.add(part(box(w + 0.3, h + 0.3, 0.2), charcoal, 0, cy, -0.12));
  const face = part(new THREE.PlaneGeometry(w, h), charcoal, 0, cy, 0);
  face.name = 'poster';
  g.add(face);
  for (const x of [-w / 3, 0, w / 3]) g.add(part(box(0.25, 0.12, 0.9), lamp, x, bottom + h + 0.25, 0.45));
  return { object: g, boxes: posts.map((x) => ({ x, y: cy / 2, z: -0.35, hx: thick / 2, hy: cy / 2, hz: thick / 2 })) };
}

function cafe(): Prop {
  const g = new THREE.Group();
  g.add(part(box(14, 4.2, 9), charcoal, 0, 2.1, 0));
  g.add(part(box(14.8, 0.35, 9.8), plaster, 0, 4.37, 0.2));
  const window = part(new THREE.PlaneGeometry(12, 2.7), glowing(shelves(), 0.12, 1.4), 0, 1.55, 4.51);
  const sign = part(new THREE.PlaneGeometry(8, 1), glowing(cafeSign(), 0.25, 0.9), 0, 3.5, 4.52);
  window.castShadow = sign.castShadow = false;
  g.add(window, sign);
  g.add(part(box(12.5, 0.12, 2.2), charcoal, 0, 3, 5.6)); // awning
  g.add(part(box(14, 0.12, 5), concrete, 0, 0.06, 7)); // terrace
  const top = new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20);
  const leg = new THREE.CylinderGeometry(0.05, 0.05, 0.74, 8);
  const seat = box(0.45, 0.9, 0.45);
  for (const x of [-4.5, 0, 4.5]) {
    g.add(part(top, wood, x, 0.76, 7.4), part(leg, steel, x, 0.37, 7.4));
    for (const dx of [-0.85, 0.85]) g.add(part(seat, charcoal, x + dx, 0.45, 7.4));
  }
  return { object: g, boxes: [{ x: 0, y: 2.1, z: 0, hx: 7, hy: 2.1, hz: 4.5 }] };
}

function station(): Prop {
  const g = new THREE.Group();
  g.add(part(box(30, 0.16, 24), concrete, 0, 0.08, 0)); // forecourt
  g.add(part(box(16, 0.7, 9), plaster, 0, 5.25, 3)); // canopy
  g.add(part(box(16.06, 0.26, 9.06), teal, 0, 5, 3));
  const lights = part(new THREE.PlaneGeometry(15, 8), lamp, 0, 4.86, 3);
  lights.rotation.x = Math.PI / 2; // faces down
  lights.castShadow = false;
  g.add(lights);
  const boxes: Box[] = [];
  const pillar = box(0.45, 4.9, 0.45);
  for (const x of [-6, 6]) {
    for (const z of [0, 6]) {
      g.add(part(pillar, plaster, x, 2.45, z));
      boxes.push({ x, y: 2.45, z, hx: 0.23, hy: 2.45, hz: 0.23 });
    }
  }
  const island = box(1.3, 0.25, 6);
  const pump = box(0.8, 1.7, 0.55);
  for (const x of [-2.6, 2.6]) {
    g.add(part(island, concrete, x, 0.2, 3));
    for (const z of [1.6, 4.4]) {
      g.add(part(pump, plaster, x, 1.1, z));
      boxes.push({ x, y: 1.1, z, hx: 0.4, hy: 0.85, hz: 0.28 });
    }
  }
  g.add(part(box(12, 3.6, 7), plaster, 0, 1.8, -7.5)); // shop
  boxes.push({ x: 0, y: 1.8, z: -7.5, hx: 6, hy: 1.8, hz: 3.5 });
  const shop = part(new THREE.PlaneGeometry(9, 2), glowing(words('open', '#d8e2e6', '#1f8a83'), 0.15, 1), 0, 1.45, -3.99);
  shop.castShadow = false;
  g.add(shop);
  g.add(part(box(0.3, 6, 0.3), steel, 11, 3, 9)); // sign totem
  const sign = part(box(2.2, 1.2, 0.4), glowing(words('FUEL', '#1f8a83', '#ffffff'), 0.35, 1.2), 11, 6.4, 9);
  g.add(sign);
  return { object: g, boxes };
}

const prefabs = new Map<string, Prop>();
function prefab(key: string, build: () => Prop) {
  let p = prefabs.get(key);
  if (!p) prefabs.set(key, (p = build()));
  return p;
}

/** The prop standing at a POI, in its own frame: place it at the POI and turn it by poi.yaw. */
export function makeProp(poi: Poi): Prop {
  if (poi.kind === 'hoarding') {
    const big = ((poi.pick >>> 4) & 3) === 0; // a quarter are tall single-pole boards
    const base = big ? prefab('big', () => hoarding(true)) : prefab('small', () => hoarding(false));
    const object = base.object.clone();
    (object.getObjectByName('poster') as THREE.Mesh).material = posterMaterial(posterFor(poi.pick));
    return { object, boxes: base.boxes };
  }
  const base = poi.kind === 'cafe' ? prefab('cafe', cafe) : prefab('station', station);
  return { object: base.object.clone(), boxes: base.boxes };
}
