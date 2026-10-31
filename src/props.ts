// Hoardings, paperboxd cafés and petrol stations: built once from primitives, cloned at each POI.
import * as THREE from 'three/webgpu';
import { color, texture, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
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

export function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void) {
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

// "paperboxd café" and the logo in dark letters on the pale fascia, as in the concept art; the letters glow at night.
function cafeSign(fascia: string, name = 'paperboxd café') {
  const t = canvasTexture(1024, 128, (g) => {
    g.fillStyle = fascia;
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#1d1c1a';
    g.font = '600 74px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(name, 160, 66);
  });
  const logo = new Image();
  logo.onload = () => {
    const g = (t.image as HTMLCanvasElement).getContext('2d')!;
    g.globalCompositeOperation = 'multiply'; // the file is black on white: the white drops out on the fascia
    g.drawImage(logo, 24, 4, 120, 120);
    t.needsUpdate = true;
  };
  logo.src = '/brands/paperboxd-logo.png';
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  m.colorNode = texture(t);
  m.emissiveNode = texture(t).rgb.sub(vec3(...new THREE.Color(fascia).toArray())).length().mul(night.mul(2.2)).mul(color(0xffc27a)); // the letters glow, not the board
  return m;
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
function cafe(style: CafeStyle, name?: string): Prop {
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
  const sign = part(new THREE.PlaneGeometry(8.4, 1.05), cafeSign(style.fascia, name), 0, 3.75, 4.52);
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

// ---------- generated models (image-to-3D from a studio shot; masters and the processing script in art-src/)

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** A generated model's mesh in its file's frame and units, its attributes as plain floats (gltfpack quantizes them). */
export async function loadModel(url: string) {
  const source = (await loader.loadAsync(url)).scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
  source.updateWorldMatrix(true, false);
  const geometry = source.geometry;
  for (const [key, a] of Object.entries(geometry.attributes)) {
    const f = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
    geometry.setAttribute(key, new THREE.BufferAttribute(f, a.itemSize));
  }
  geometry.applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  return { geometry, material: source.material as THREE.MeshStandardMaterial };
}

/** The model's triangles sorted by `which` (from its centre and its normal's y): an index into the parts, or -1 to drop it.
 * The parts share the model's attributes, so a transform of the model afterwards moves them all. */
function split(geometry: THREE.BufferGeometry, count: number, which: (x: number, y: number, z: number, ny: number) => number) {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const lists: number[][] = Array.from({ length: count }, () => []);
  const [a, b, c, ab, ac] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < index.count; t += 3) {
    const [i, j, l] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, j);
    c.fromBufferAttribute(pos, l);
    const ny = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize().y;
    const w = which((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3, ny);
    if (w >= 0) lists[w].push(i, j, l);
  }
  return lists.map((list) => {
    const g = new THREE.BufferGeometry();
    for (const [key, attribute] of Object.entries(geometry.attributes)) g.setAttribute(key, attribute);
    g.setIndex(list);
    return g;
  });
}

/** Model units to metres in a prop's frame: scale k, the model's point (mx, my, mz) to the prop's (px, py, pz). */
function frame(k: number, mx: number, my: number, mz: number, px: number, py: number, pz: number) {
  const X = (x: number) => (x - mx) * k + px;
  const Y = (y: number) => (y - my) * k + py;
  const Z = (z: number) => (z - mz) * k + pz;
  const matrix = new THREE.Matrix4().makeTranslation(X(0), Y(0), Z(0)).multiply(new THREE.Matrix4().makeScale(k, k, k));
  const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box => {
    const [a, b, c, d, e, f] = [X(x0), X(x1), Y(y0), Y(y1), Z(z0), Z(z1)];
    return { x: (a + b) / 2, y: (c + d) / 2, z: (e + f) / 2, hx: Math.abs(b - a) / 2, hy: Math.abs(d - c) / 2, hz: Math.abs(f - e) / 2 };
  };
  return { X, Y, Z, matrix, block };
}

/** A lit copy of a model's material: it glows from within at night (windows, the lamps under a canopy). */
function litFrom(m: THREE.MeshStandardMaterial, day: number, boost: number) {
  const lit = new THREE.MeshStandardNodeMaterial({ map: m.map, roughness: 0.85 });
  lit.emissiveNode = texture(m.map!).mul(night.mul(boost).add(day));
  return lit;
}

function meshes(parts: THREE.BufferGeometry[], materials: THREE.Material[], g: THREE.Group) {
  parts.forEach((geometry, i) => {
    const mesh = new THREE.Mesh(geometry, materials[i]);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  });
}

/**
 * Cafés, measured once in each file's frame (front +z, up +y, model units): metres per unit (tables 0.75 m high), the
 * building [x0, x1, z0, z1] and its roof, the terrace deck's top, the glass (its plane, height, and the two panes
 * either side of the open middle bay) and the fascia's middle [x, y, z]. The panes come out black, so a room of books
 * goes behind each one. Each is centred across, on the pad, its front where the procedural café's ends.
 */
const MODELS: Record<string, { scale: number; shell: number[]; roof: number; deck: number; glass: { z: number; y: number[]; panes: number[][] }; fascia: number[] }> = {
  coast: { scale: 15, shell: [-0.281, 0.395, -0.501, 0.212], roof: 0.17, deck: -0.123, glass: { z: 0.195, y: [-0.118, 0.099], panes: [[-0.228, -0.098], [0.208, 0.342]] }, fascia: [0.057, 0.128, 0.218] },
  // The farmhouse: brick, a terracotta roof, three glass bays (all of them panes) under a white beam, a timber deck.
  country: { scale: 12, shell: [-0.37, 0.39, -0.46, 0.19], roof: 0.07, deck: -0.184, glass: { z: 0.165, y: [-0.17, 0.005], panes: [[-0.29, -0.14], [-0.1, 0.105], [0.15, 0.3]] }, fascia: [0.005, 0.037, 0.192] },
};
const ROOM = 2.4; // m: how deep the rooms behind the panes are

async function modelCafe(style: string): Promise<Prop> {
  const spec = MODELS[style];
  const { geometry, material } = await loadModel(`/cafes/${style}.glb`);
  const { min, max } = geometry.boundingBox!.clone(); // model units: applyMatrix4 below remeasures the box in metres, in place
  const k = spec.scale;
  const { X, Y, Z, matrix, block } = frame(k, (min.x + max.x) / 2, min.y, max.z, 0, -0.05, 11);

  // Inside a room behind a pane: dropped, the pane with it. In the open bay's room: it glows at night.
  const { z: gz, y: [y0, y1], panes } = spec.glass;
  const rooms = panes.map(([p0, p1]) => [p0 - 0.1 / k, p1 + 0.1 / k]);
  const parts = split(geometry, 2, (x, y, z) => {
    const bay = y > y0 && y < y1 && z < gz + 0.013;
    if (bay && z > gz - ROOM / k && rooms.some(([r0, r1]) => x > r0 && x < r1)) return -1;
    return bay && z < gz - 0.005 && x > panes[0][1] && x < panes[1][0] ? 1 : 0;
  });
  geometry.applyMatrix4(matrix);
  const g = new THREE.Group();
  meshes(parts, [material, litFrom(material, 0.06, 1.2)], g);

  // Behind each pane, as in the procedural café: books on the back wall, a floor, a ceiling, pendant lamps; glass across.
  const k2 = kit();
  const books = glowing(shelves(), 0.12, 1.4);
  const [bottom, top, front] = [Y(y0), Y(y1), Z(gz)];
  const h = top - bottom;
  for (const [r0, r1] of rooms) {
    const [a, b] = [X(r0), X(r1)];
    const [w, mid, back] = [b - a, (a + b) / 2, front - ROOM];
    const wall = new THREE.PlaneGeometry(w, h);
    const uv = wall.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * w) / 13.4); // books as wide as on the 13.4 m procedural wall
    k2.add(books, wall, mid, bottom + h / 2, back);
    k2.add(wood, new THREE.PlaneGeometry(w, ROOM).rotateX(-Math.PI / 2), mid, bottom + 0.02, front - ROOM / 2);
    k2.add(inside, new THREE.PlaneGeometry(w, ROOM).rotateX(Math.PI / 2), mid, top, front - ROOM / 2);
    for (const [x, turn] of [[a, 1], [b, -1]]) k2.add(inside, new THREE.PlaneGeometry(ROOM, h), x, bottom + h / 2, front - ROOM / 2, (turn * Math.PI) / 2);
    for (let x = a + 0.8; x < b - 0.4; x += 1.4) {
      for (const z of [back + 0.7, back + 1.6]) {
        k2.add(lamp, new THREE.SphereGeometry(0.16, 12, 8), x, top - 0.7, z);
        k2.add(charcoal, new THREE.CylinderGeometry(0.01, 0.01, 0.55, 4), x, top - 0.33, z);
      }
    }
  }
  const [left, right] = [X(panes[0][0]), X(panes[1][1])];
  k2.add(glass, new THREE.PlaneGeometry(right - left, h), (left + right) / 2, bottom + h / 2, front + 0.08);
  k2.into(g);
  const [fx, fy, fz] = spec.fascia;
  const sign = part(new THREE.PlaneGeometry(5.4, 0.675), cafeSign(STYLES[style].fascia), X(fx), Y(fy), Z(fz));
  sign.castShadow = false;
  g.add(sign);

  // Colliders: the building, and the terrace up to its deck.
  const [sx0, sx1, sz0, sz1] = spec.shell;
  return { object: g, boxes: [block(sx0, sx1, min.y, spec.roof, sz0, sz1), block(min.x, max.x, min.y, spec.deck, sz1, max.z)] };
}

/**
 * The station, measured once (model units): metres per unit (the canopy's underside 5 m up), the forecourt's top, the
 * pump islands (x of each, z of their middle, their top), the canopy's underside, its four columns [x, z], and the
 * shop [x0, x1, z0, z1, roof]; it faces +z, its shop's glass shows lit shelves. The pump (one dispenser on its own kerb,
 * screens and hoses on both ±x faces): metres per unit (cabinet 1.8 m) and its kerb's bottom.
 */
const STATION = { scale: 20, ground: -0.151, islands: [-0.282, 0.18], islandZ: 0.22, islandTop: -0.133, canopy: 0.11, columns: [[-0.285, 0.06], [-0.285, 0.375], [0.18, 0.105], [0.18, 0.3]], shop: [-0.12, 0.39, -0.485, -0.17, 0.025] };
const PUMP = { scale: 1.94, base: -0.5 };
/** m: the pump islands' x either side of the station's middle, at z 3 (atPump in main.ts reads it). */
export let ISLAND_X = 2.6;

async function modelStation(): Promise<Prop> {
  const [s, p] = await Promise.all([loadModel('/props/station.glb'), loadModel('/props/pump.glb')]);
  s.material.metalnessMap = null; // its map makes the forecourt metal, a mirror of the dim horizon
  s.material.metalness = 0;
  const k = STATION.scale;
  // The islands either side of x 0, their middle at z 3 as in the procedural station; the forecourt 8 cm above the pad.
  const { X, Y, matrix, block } = frame(k, (STATION.islands[0] + STATION.islands[1]) / 2, STATION.ground, STATION.islandZ, 0, 0.08, 3);
  // The canopy's underside and the shop's inside glow at night.
  const [x0, x1, z0, z1, roof] = STATION.shop;
  const parts = split(s.geometry, 2, (x, y, z, ny) => ((ny < -0.9 && y > STATION.canopy - 0.01 && z > 0) || (x > x0 + 0.02 && x < x1 - 0.02 && z > z0 + 0.02 && z < z1 - 0.02 && y < roof - 0.01) ? 1 : 0));
  s.geometry.applyMatrix4(matrix);
  const g = new THREE.Group();
  meshes(parts, [s.material, litFrom(s.material, 0.05, 0.45)], g);
  const boxes = [...STATION.columns.map(([x, z]) => block(x - 0.008, x + 0.008, STATION.ground, STATION.canopy, z - 0.008, z + 0.008)), block(x0, x1, STATION.ground, roof, z0, z1)];

  // Two pumps on each island.
  const kp = PUMP.scale;
  p.geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -PUMP.base * kp, 0).multiply(new THREE.Matrix4().makeScale(kp, kp, kp)));
  ISLAND_X = X(STATION.islands[1]);
  for (const x of [-ISLAND_X, ISLAND_X]) {
    for (const z of [1.6, 4.4]) {
      const pump = part(p.geometry, p.material, x, Y(STATION.islandTop), z);
      g.add(pump);
      boxes.push({ x, y: 1.1, z, hx: 0.3, hy: 0.9, hz: 0.6 });
    }
  }
  const k2 = kit();
  const fuel = totem(k2, boxes);
  k2.into(g);
  g.add(fuel);
  return { object: g, boxes };
}

/** Swap in the generated models, where they load; the rest stay procedural. Call before any prop is made. */
export async function loadModels() {
  const made = await Promise.all([
    ...Object.keys(MODELS).map(async (style) => [`cafe-${style}`, await modelCafe(style).catch(() => null)] as const),
    (async () => ['station', await modelStation().catch(() => null)] as const)(),
  ]);
  for (const [key, p] of made) if (p) prefabs.set(key, p);
}

/** The totem at the forecourt's front corner: FUEL up top, price rows under it. Returns the FUEL face, to add after the kit. */
function totem(k: ReturnType<typeof kit>, boxes: Box[]) {
  k.add(steel, box(0.5, 7, 0.5), 11.5, 3.5, 9.5);
  k.add(teal, box(2.6, 3, 0.5), 11.5, 7.9, 9.5);
  for (const y of [7.15, 7.65]) k.add(plaster, box(2, 0.32, 0.06), 11.5, y, 9.76);
  boxes.push({ x: 11.5, y: 3.5, z: 9.5, hx: 0.25, hy: 3.5, hz: 0.25 });
  const fuel = part(new THREE.PlaneGeometry(2.3, 1.15), glowing(words('FUEL', '#1f8a83', '#ffffff'), 0.35, 1.2), 11.5, 8.6, 9.76);
  fuel.castShadow = false;
  return fuel;
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
  const fuel = totem(k, boxes);
  for (const x of [-13.4, 13.4]) {
    k.add(concrete, box(2, 0.7, 2), x, 0.35, -10);
    for (const dx of [-0.5, 0.4]) k.add(leaves, new THREE.IcosahedronGeometry(0.55, 1), x + dx, 0.95, -10);
  }

  const g = k.into(new THREE.Group());
  const books = part(new THREE.PlaneGeometry(9, 2.4), glowing(shelves(), 0.12, 1.2), 0, 1.5, -3.99);
  const open = part(new THREE.PlaneGeometry(2.4, 0.6), glowing(words('open', '#d8e2e6', '#1f8a83'), 0.2, 1), -4.6, 3.2, -3.98);
  books.castShadow = open.castShadow = false;
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
  if (kind === 5) {
    // A street lamp (SIGN_LAMP): a 7 m pole, an arm out over the road, its lens lit from below at night.
    const metal = [new THREE.CylinderGeometry(0.05, 0.08, 7, 8).translate(0, 3.5, 0), box(0.06, 0.06, 1.7).translate(0, 6.95, 0.8), box(0.24, 0.1, 0.55).translate(0, 6.92, 1.65)];
    g.add(part(mergeGeometries(metal), steel, 0, 0, 0)); // one draw for the steel
    const lens = part(new THREE.PlaneGeometry(0.18, 0.44).rotateX(Math.PI / 2), lamp, 0, 6.86, 1.65);
    lens.castShadow = false;
    g.add(lens);
    return { object: g, boxes: [{ x: 0, y: 3.5, z: 0, hx: 0.08, hy: 3.5, hz: 0.08 }] };
  }
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
  // ponytail: a bookstore is the farmhouse café with its own name until its model is made (art-src/props/bookstore.jpg)
  const base = poi.kind === 'cafe' ? prefab(`cafe-${style}`, () => cafe(STYLES[style])) : poi.kind === 'bookstore' ? prefab('bookstore', () => cafe(STYLES.country, 'paperboxd books')) : prefab('station', station);
  return { object: base.object.clone(), boxes: base.boxes };
}
