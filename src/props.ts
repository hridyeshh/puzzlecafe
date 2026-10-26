// Hoardings, paperboxd cafés and petrol stations: built once from primitives, cloned at each POI.
import * as THREE from 'three/webgpu';
import { color, texture } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

// "paperboxd café" and the logo in dark letters on the pale fascia, as in the concept art.
function cafeLetters(fascia: string) {
  const t = canvasTexture(1024, 128, (g) => {
    g.fillStyle = fascia;
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#1d1c1a';
    g.font = '600 74px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('paperboxd café', 160, 66);
  });
  const logo = new Image();
  logo.onload = () => {
    const g = (t.image as HTMLCanvasElement).getContext('2d')!;
    g.globalCompositeOperation = 'multiply'; // the file is black on white: the white drops out on the fascia
    g.drawImage(logo, 24, 4, 120, 120);
    t.needsUpdate = true;
  };
  logo.src = '/brands/paperboxd-logo.png';
  return t;
}

/** Parts gathered per material and merged into one mesh each, so a prop of a hundred parts is a few draw calls. */
function kit() {
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  return {
    add(material: THREE.Material, geometry: THREE.BufferGeometry, x: number, y: number, z: number, turn = 0) {
      const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).rotateY(turn).translate(x, y, z);
      const list = parts.get(material);
      if (list) list.push(g);
      else parts.set(material, [g]);
    },
    into(group: THREE.Group) {
      for (const [material, list] of parts) {
        const mesh = new THREE.Mesh(mergeGeometries(list), material);
        mesh.castShadow = mesh.receiveShadow = !(material as THREE.MeshStandardMaterial).transparent;
        group.add(mesh);
      }
      return group;
    },
  };
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
  const back = -0.25 - thick / 2; // posts stand behind the board's back plate, never through the poster
  for (const x of posts) g.add(part(box(thick, cy, thick), steel, x, cy / 2, back));
  g.add(part(box(w + 0.3, h + 0.3, 0.2), charcoal, 0, cy, -0.12));
  const face = part(new THREE.PlaneGeometry(w, h), charcoal, 0, cy, 0);
  face.name = 'poster';
  g.add(face);
  for (const x of [-w / 3, 0, w / 3]) g.add(part(box(0.25, 0.12, 0.9), lamp, x, bottom + h + 0.25, 0.45));
  return { object: g, boxes: posts.map((x) => ({ x, y: cy / 2, z: back, hx: thick / 2, hy: cy / 2, hz: thick / 2 })) };
}

const stone = mat(0xd9cdb5, 0.92);
const paving = mat(0xc8baa0, 0.95);
const leaves = mat(0x4f6a35, 0.9);
const terracotta = mat(0xb0623d, 0.85);
const canvasCloth = new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.9, side: THREE.DoubleSide });
const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4bd, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22 });
const inside = new THREE.MeshStandardNodeMaterial({ color: 0xd9b98f, roughness: 0.9 }); // lit from within, warmer at night
inside.emissiveNode = color(0xd9b98f).mul(night.mul(0.55).add(0.06));

/** A café in the style of its country: walls, trim, terrace deck, the fascia's colour, and a pitched roof or none. */
interface CafeStyle {
  walls: THREE.Material;
  trim: THREE.Material;
  deck: THREE.Material;
  fascia: string;
  roof: THREE.Material | null;
}
const STYLES: Record<string, CafeStyle> = {
  coast: { walls: stone, trim: stone, deck: paving, fascia: '#d9cdb5', roof: null },
  country: { walls: mat(0xa45a44, 0.9), trim: plaster, deck: wood, fascia: '#efe9df', roof: mat(0xa0522d, 0.8) }, // farmhouse
  mountains: { walls: mat(0x6e4c31, 0.85), trim: mat(0x4a3322, 0.8), deck: wood, fascia: '#e6d3ad', roof: mat(0x45484f, 0.75) }, // lodge
  desert: { walls: mat(0xd8a26b, 0.95), trim: terracotta, deck: mat(0xc0764f, 0.9), fascia: '#f0dcc0', roof: null }, // diner
};

/**
 * A paperboxd bookstore café after the concept art: a pale stone front with a deep glass room of bookshelves and
 * pendant lamps, the name across the fascia, and a raised terrace (tables, parasols, planters, string lights) facing
 * the road (+z). The fascia letters glow at night.
 */
function cafe(style: CafeStyle): Prop {
  const k = kit();
  // Shell: walls, fascia, pillars, roof, plinth.
  k.add(style.walls, box(14, 4.4, 0.3), 0, 2.2, -4.35);
  for (const x of [-6.85, 6.85]) k.add(style.walls, box(0.3, 4.4, 9), x, 2.2, 0);
  k.add(style.trim, box(14, 1.3, 0.35), 0, 3.75, 4.33);
  for (const x of [-6.8, -2.3, 2.3, 6.8]) k.add(style.trim, box(0.4, 3.1, 0.4), x, 1.55, 4.3);
  if (style.roof) {
    // Pitched: two slopes meeting over the middle, gable walls at the ends.
    for (const side of [-1, 1]) k.add(style.roof, box(15, 0.25, 5.9).rotateX(side * 0.5), 0, 5.75, side * 2.55);
    const gable = new THREE.Shape([new THREE.Vector2(-4.8, 0), new THREE.Vector2(4.8, 0), new THREE.Vector2(0, 2.6)]);
    for (const x of [-7, 6.7]) k.add(style.walls, new THREE.ExtrudeGeometry(gable, { depth: 0.3, bevelEnabled: false }).rotateY(Math.PI / 2), x, 4.4, 0);
  } else k.add(style.walls, box(14.6, 0.3, 9.6), 0, 4.55, 0);
  k.add(style.trim, box(14.4, 0.3, 9.4), 0, 0.15, 0);
  // The room: floor, ceiling, tables, pendant lamps; the back wall is books (below).
  k.add(wood, box(13.4, 0.05, 8.4), 0, 0.31, 0);
  k.add(inside, box(13.4, 0.05, 8.4), 0, 3.12, 0);
  for (const x of [-6.6, 6.6]) k.add(inside, box(0.05, 2.8, 8.4), x, 1.75, 0);
  for (const x of [-4.2, 0, 4.2]) k.add(wood, box(1.6, 0.06, 0.9), x, 1.05, 0.5);
  for (const x of [-4.5, -1.5, 1.5, 4.5]) {
    for (const z of [-1, 1.6]) {
      k.add(lamp, new THREE.SphereGeometry(0.18, 12, 8), x, 2.55, z);
      k.add(charcoal, new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4), x, 2.85, z);
    }
  }
  k.add(glass, new THREE.PlaneGeometry(13.4, 2.85), 0, 1.75, 4.25);
  for (const y of [0.34, 3.1]) k.add(charcoal, box(13.4, 0.08, 0.08), 0, y, 4.27);
  // The terrace: raised paving, steps in the middle, planters either side, eight tables, three parasols.
  k.add(style.deck, box(14, 0.45, 5.6), 0, 0.225, 7.3);
  k.add(style.deck, box(3, 0.3, 0.45), 0, 0.15, 10.3);
  k.add(style.deck, box(3, 0.15, 0.45), 0, 0.075, 10.75);
  for (const x of [-4.35, 4.35]) {
    k.add(style.trim, box(5.3, 0.55, 0.5), x, 0.72, 9.85);
    for (let i = 0; i < 5; i++) k.add(leaves, new THREE.IcosahedronGeometry(0.45, 1), x - 2 + i, 1.2, 9.85);
  }
  const top = new THREE.CylinderGeometry(0.45, 0.45, 0.04, 16);
  const stem = new THREE.CylinderGeometry(0.04, 0.04, 0.74, 6);
  const seat = box(0.42, 0.05, 0.42);
  const back = box(0.05, 0.45, 0.42);
  const leg = box(0.03, 0.46, 0.03);
  for (const [i, x] of [-4.6, -1.6, 1.6, 4.6].entries()) {
    for (const [j, z] of [6.2, 8.3].entries()) {
      k.add(wood, top, x, 1.19, z);
      k.add(charcoal, stem, x, 0.82, z);
      for (const side of [-1, 1]) {
        const cx = x + side * 0.75;
        k.add(wood, seat, cx, 0.92, z);
        k.add(wood, back, cx + side * 0.21, 1.17, z);
        for (const [dx, dz] of [[-0.18, -0.18], [-0.18, 0.18], [0.18, -0.18], [0.18, 0.18]]) k.add(charcoal, leg, cx + dx, 0.68, z + dz);
      }
      if ((i + j) % 2 !== 0) continue; // parasols over every other table
      k.add(steel, new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6), x, 1.6, z);
      k.add(canvasCloth, new THREE.ConeGeometry(1.5, 0.5, 8, 1, true), x, 2.95, z);
    }
  }
  for (const [x, z] of [[-6.3, 4.9], [6.3, 4.9], [-1.9, 4.9], [1.9, 4.9]]) {
    k.add(terracotta, new THREE.CylinderGeometry(0.3, 0.22, 0.55, 10), x, 0.72, z);
    k.add(leaves, new THREE.IcosahedronGeometry(0.5, 1), x, 1.3, z);
  }
  // String lights across the terrace, sagging between the fascia and the front corners.
  const bulb = new THREE.SphereGeometry(0.06, 6, 4);
  for (const [x0, x1] of [[-6.5, 6.5], [6.5, -6.5]]) {
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      k.add(lamp, bulb, x0 + (x1 - x0) * t, 3.05 - 0.6 * 4 * t * (1 - t), 4.6 + 5.1 * t);
    }
  }
  for (const x of [-6.5, 6.5]) k.add(steel, new THREE.CylinderGeometry(0.04, 0.04, 2.7, 6), x, 1.8, 9.75);
  // Lamp posts at the terrace's front corners, and sconces on the outer pillars: they glow at blue hour.
  for (const x of [-7.5, 7.5]) {
    k.add(charcoal, new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8), x, 1.7, 10.5);
    k.add(lamp, box(0.32, 0.36, 0.32), x, 3.55, 10.5);
    k.add(charcoal, box(0.42, 0.06, 0.42), x, 3.76, 10.5);
    k.add(lamp, box(0.18, 0.28, 0.12), Math.sign(x) * 6.8, 2.6, 4.56);
  }

  const g = k.into(new THREE.Group());
  const books = part(new THREE.PlaneGeometry(13.4, 2.8), glowing(shelves(), 0.12, 1.4), 0, 1.75, -4.18);
  const letters = cafeLetters(style.fascia);
  const signMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  signMaterial.colorNode = texture(letters);
  signMaterial.emissiveNode = texture(letters).r.oneMinus().mul(night.mul(2.2)).mul(color(0xffc27a)); // dark letters glow
  const sign = part(new THREE.PlaneGeometry(8.4, 1.05), signMaterial, 0, 3.75, 4.52);
  books.castShadow = sign.castShadow = false;
  g.add(books, sign);
  return {
    object: g,
    boxes: [
      { x: 0, y: 2.3, z: 0, hx: 7.1, hy: 2.3, hz: 4.6 },
      { x: 0, y: 0.225, z: 7.3, hx: 7, hy: 0.23, hz: 2.8 },
      { x: -4.35, y: 0.72, z: 9.85, hx: 2.65, hy: 0.3, hz: 0.25 },
      { x: 4.35, y: 0.72, z: 9.85, hx: 2.65, hy: 0.3, hz: 0.25 },
    ],
  };
}

/**
 * A petrol station facing the road (+z): a forecourt, a white canopy with a teal band and a lit underside over two
 * pump islands (at x ±2.6, z 3: `atPump` in main.ts looks there), a shop with a glass front of book shelves, a tall
 * FUEL totem, planters. Merged per material.
 */
function station(): Prop {
  const k = kit();
  const boxes: Box[] = [];
  k.add(concrete, box(30, 0.16, 24), 0, 0.08, 0); // forecourt
  k.add(plaster, box(30, 0.3, 0.4), 0, 0.15, -11.8); // kerbs at the back and sides; the road side stays open
  for (const x of [-14.8, 14.8]) k.add(plaster, box(0.4, 0.3, 24), x, 0.15, 0);
  // The canopy, lit from below.
  k.add(plaster, box(16, 0.6, 9), 0, 5.3, 3);
  k.add(teal, box(16.1, 0.36, 9.1), 0, 4.95, 3);
  k.add(lamp, new THREE.PlaneGeometry(15, 8).rotateX(Math.PI / 2), 0, 4.76, 3);
  for (const x of [-6, 6]) {
    for (const z of [0, 6]) {
      k.add(plaster, box(0.45, 4.8, 0.45), x, 2.4, z);
      boxes.push({ x, y: 2.4, z, hx: 0.23, hy: 2.4, hz: 0.23 });
    }
  }
  // Pump islands: white pumps with a teal crown, a dark screen each side, a hose and nozzle.
  for (const x of [-2.6, 2.6]) {
    k.add(concrete, box(1.3, 0.25, 6), x, 0.2, 3);
    for (const z of [1.6, 4.4]) {
      k.add(plaster, box(0.72, 1.75, 0.5), x, 1.2, z);
      k.add(teal, box(0.76, 0.26, 0.54), x, 2.2, z);
      for (const side of [-1, 1]) k.add(charcoal, box(0.02, 0.32, 0.3), x + side * 0.37, 1.55, z);
      k.add(charcoal, new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), x + Math.sign(x) * 0.42, 1.05, z + 0.12);
      k.add(steel, box(0.08, 0.22, 0.08), x + Math.sign(x) * 0.42, 1.65, z + 0.12);
      boxes.push({ x, y: 1.1, z, hx: 0.38, hy: 0.9, hz: 0.27 });
    }
  }
  // The shop, with a teal roof edge.
  k.add(plaster, box(12, 3.8, 7), 0, 1.9, -7.5);
  k.add(teal, box(12.6, 0.3, 7.6), 0, 3.95, -7.5);
  boxes.push({ x: 0, y: 1.9, z: -7.5, hx: 6, hy: 1.9, hz: 3.5 });
  // The totem: FUEL up top, price rows under it.
  k.add(steel, box(0.5, 7, 0.5), 11.5, 3.5, 9.5);
  k.add(teal, box(2.6, 3, 0.5), 11.5, 7.9, 9.5);
  for (const y of [7.15, 7.65]) k.add(plaster, box(2, 0.32, 0.06), 11.5, y, 9.76);
  boxes.push({ x: 11.5, y: 3.5, z: 9.5, hx: 0.25, hy: 3.5, hz: 0.25 });
  for (const x of [-13.4, 13.4]) {
    k.add(concrete, box(2, 0.7, 2), x, 0.35, -10);
    for (const dx of [-0.5, 0.4]) k.add(leaves, new THREE.IcosahedronGeometry(0.55, 1), x + dx, 0.95, -10);
  }

  const g = k.into(new THREE.Group());
  const books = part(new THREE.PlaneGeometry(9, 2.4), glowing(shelves(), 0.12, 1.2), 0, 1.5, -3.99);
  const open = part(new THREE.PlaneGeometry(2.4, 0.6), glowing(words('open', '#d8e2e6', '#1f8a83'), 0.2, 1), -4.6, 3.2, -3.98);
  const fuel = part(new THREE.PlaneGeometry(2.3, 1.15), glowing(words('FUEL', '#1f8a83', '#ffffff'), 0.35, 1.2), 11.5, 8.6, 9.76);
  books.castShadow = open.castShadow = fuel.castShadow = false;
  g.add(books, open, fuel);
  return { object: g, boxes };
}

// ---------- road signs: a pole and a panel, the face painted on a canvas; they catch the headlights at night

function reflective(map: THREE.Texture) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
  m.colorNode = texture(map);
  m.emissiveNode = texture(map).mul(night.mul(0.35));
  return m;
}

const SIGN_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
/** The faces, by sign kind (SIGN_* in world/chunk.ts): café, fuel, bend right, bend left, coast road. */
const faces: (() => THREE.Texture)[] = [
  () => {
    const t = canvasTexture(512, 256, (g) => {
      g.fillStyle = '#f3efe6';
      g.fillRect(0, 0, 512, 256);
      g.strokeStyle = '#1d1c1a';
      g.lineWidth = 14;
      g.strokeRect(7, 7, 498, 242);
      g.fillStyle = '#1d1c1a';
      g.textBaseline = 'middle';
      g.font = `700 78px ${SIGN_FONT}`;
      g.fillText('café', 196, 94);
      g.font = `600 56px ${SIGN_FONT}`;
      g.fillText('100 m →', 196, 180);
    });
    const logo = new Image();
    logo.onload = () => {
      const g = (t.image as HTMLCanvasElement).getContext('2d')!;
      g.globalCompositeOperation = 'multiply';
      g.drawImage(logo, 34, 58, 140, 140);
      t.needsUpdate = true;
    };
    logo.src = '/brands/paperboxd-logo.png';
    return t;
  },
  () =>
    canvasTexture(512, 256, (g) => {
      g.fillStyle = '#1f8a83';
      g.fillRect(0, 0, 512, 256);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 12;
      g.strokeRect(14, 14, 484, 228);
      g.fillStyle = '#ffffff';
      g.fillRect(52, 70, 70, 120); // the pump
      g.fillRect(122, 96, 26, 12);
      g.fillRect(142, 96, 12, 60);
      g.fillStyle = '#1f8a83';
      g.fillRect(64, 84, 46, 34);
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      g.font = `800 78px ${SIGN_FONT}`;
      g.fillText('FUEL', 190, 98);
      g.font = `600 52px ${SIGN_FONT}`;
      g.fillText('100 m →', 190, 182);
    }),
  ...[1, -1].map((dir) => () =>
    canvasTexture(256, 256, (g) => {
      g.fillStyle = '#f2c230';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#111111';
      for (const x of [40, 104, 168]) {
        g.beginPath();
        const at = (px: number) => 128 + dir * (px - 128);
        g.moveTo(at(x), 40);
        g.lineTo(at(x + 48), 128);
        g.lineTo(at(x), 216);
        g.lineTo(at(x + 26), 216);
        g.lineTo(at(x + 74), 128);
        g.lineTo(at(x + 26), 40);
        g.closePath();
        g.fill();
      }
    }),
  ),
  () =>
    canvasTexture(256, 256, (g) => {
      g.fillStyle = '#2563b0';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 10;
      g.strokeRect(14, 14, 228, 228);
      g.fillStyle = '#ffffff';
      g.beginPath(); // the cliff, and the road along its top
      g.moveTo(40, 150);
      g.lineTo(110, 70);
      g.lineTo(200, 70);
      g.lineTo(200, 150);
      g.closePath();
      g.fill();
      g.lineWidth = 9;
      for (const y of [178, 206]) {
        g.beginPath(); // waves
        g.moveTo(40, y);
        for (let x = 40; x <= 216; x += 22) g.quadraticCurveTo(x + 11, y - 14, x + 22, y);
        g.stroke();
      }
    }),
];

function signPrefab(kind: number): Prop {
  const g = new THREE.Group();
  const wide = kind <= 1;
  const [w, h, y] = wide ? [1.6, 0.8, 2.1] : [0.8, 0.8, kind === 4 ? 2.1 : 1.5];
  g.add(part(new THREE.CylinderGeometry(0.05, 0.05, y + h / 2, 8), steel, 0, (y + h / 2) / 2, -0.06));
  g.add(part(box(w, h, 0.05), steel, 0, y, -0.03));
  const face = part(new THREE.PlaneGeometry(w, h), reflective(faces[kind]()), 0, y, 0.001);
  face.castShadow = false;
  g.add(face);
  return { object: g, boxes: [{ x: 0, y: y / 2, z: -0.06, hx: 0.06, hy: y / 2, hz: 0.06 }] };
}

/** A road sign of `kind` (SIGN_* in world/chunk.ts), its face toward +z. */
export function makeSign(kind: number): Prop {
  const base = prefab(`sign${kind}`, () => signPrefab(kind));
  return { object: base.object.clone(), boxes: base.boxes };
}

const prefabs = new Map<string, Prop>();
function prefab(key: string, build: () => Prop) {
  let p = prefabs.get(key);
  if (!p) prefabs.set(key, (p = build()));
  return p;
}

/** The prop standing at a POI, in its own frame: place it at the POI and turn it by poi.yaw. A café's `variant` is
 * the kind of country it stands in (coast, country, mountains, desert), which picks its style. */
export function makeProp(poi: Poi & { variant?: string }): Prop {
  if (poi.kind === 'hoarding') {
    const big = ((poi.pick >>> 4) & 3) === 0; // a quarter are tall single-pole boards
    const base = big ? prefab('big', () => hoarding(true)) : prefab('small', () => hoarding(false));
    const object = base.object.clone();
    (object.getObjectByName('poster') as THREE.Mesh).material = posterMaterial(posterFor(poi.pick));
    return { object, boxes: base.boxes };
  }
  const style = poi.variant && poi.variant in STYLES ? poi.variant : 'coast';
  const base = poi.kind === 'cafe' ? prefab(`cafe-${style}`, () => cafe(STYLES[style])) : prefab('station', station);
  return { object: base.object.clone(), boxes: base.boxes };
}
