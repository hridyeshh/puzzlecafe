// Prakashi as drawn. Its buildings: one box and one shader for all of them, instanced per tile like the village houses
// (see plants.ts for why not InstancedMesh): sandstone, ochre, brick, indigo-washed and soot-dark walls streaked with
// grime, arched windows, many lit at night, shop shutters on the ground floor, and a neon strip under the roof of some.
// Its props, likewise per tile: water tanks, wooden water towers, aerials and dishes on the roofs, neon blade signs over
// the streets, temple spires crowning the Art Deco towers, mandirs. Then its set pieces (createCityView): the black river
// and its floating lamps, the ghats, the barrages, temple spires in scaffolding, broadcast towers, and the light-forms
// turning in the sky.
import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  color,
  cos,
  float,
  floor,
  fract,
  hash,
  length,
  max,
  min,
  mix,
  mod,
  normalLocal,
  normalize,
  positionLocal,
  positionView,
  sin,
  smoothstep,
  step,
  texture,
  time,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';
// @ts-expect-error: three ships no types for it
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { night } from './daylight.ts';
import { RAPIER, addFixed } from './physics.ts';
import { piece } from './plants.ts';
import { loadModel } from './props.ts';
import { AERIAL, type Blocks, CROWN, DISH, MANDIR, MANDIR_FOOT, PALACE, SIGN, TANK, WATER_TOWER } from './world/blocks.ts';
import { type City, DAM, GHAT, cityGround } from './world/cities.ts';
import { mulberry32 } from './world/hash.ts';

const SINK = 4; // m the walls reach below the ground, where a coarse tile's ground dips under a building's front
const FLOOR = 3.2; // m, as in world/blocks.ts
const BAY = 2.4; // m between windows

/** A box from y = 0 to 1 and x, z from -0.5 to 0.5: four walls and a roof, each face with its own normal. */
function shape() {
  const pos: number[] = [];
  const nor: number[] = [];
  const face = (n: number[], corners: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...corners[i]);
      nor.push(...n);
    }
  };
  face([0, 0, 1], [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]]);
  face([0, 0, -1], [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]]);
  face([1, 0, 0], [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]]);
  face([-1, 0, 0], [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]]);
  face([0, 1, 0], [[-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
const SHAPE = shape();
const ATTRIBUTES = ['position', 'normal'];

const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.88 });
{
  const at = attribute('iAt', 'vec4'); // x, y, z, yaw
  const size = attribute('iSize', 'vec4'); // w, h, d, style
  const p = attribute('position', 'vec3');
  const local = vec3(p.x.mul(size.x), p.y.mul(size.y.add(SINK)).sub(SINK), p.z.mul(size.z));
  const yaw = (v: THREE.Node<'vec3'>) => vec3(v.x.mul(cos(at.w)).add(v.z.mul(sin(at.w))), v.y, v.z.mul(cos(at.w)).sub(v.x.mul(sin(at.w))));
  material.positionNode = Fn(() => {
    normalLocal.assign(yaw(normalLocal));
    return yaw(local).add(at.xyz);
  })();

  const n = attribute('normal', 'vec3');
  // The style: a 0–1 tone, plus ROOM for a stair room on a roof (plain walls, a door) or TIER for a tower's upper tier.
  const kind = floor(size.w.div(2));
  const style = size.w.sub(kind.mul(2));
  const [isRoom, isTier] = [step(0.5, kind).mul(step(kind, 1.5)), step(1.5, kind)];
  const roof = step(0.5, n.y);
  const along = mix(local.x, local.z, step(0.5, abs(n.x))).add(style.mul(7)); // m along the wall
  const up = local.y;
  const storey = floor(up.div(FLOOR));
  const bay = floor(along.div(BAY));
  const [u, v] = [fract(along.div(BAY)), fract(up.div(FLOOR))];
  const wall = roof.oneMinus().mul(step(up, size.y.sub(0.7))).mul(isRoom.oneMinus()); // below the parapet
  // Windows with arched heads, as in the havelis (a tier's start a floor up the tower, so it has them from its foot), a
  // sill under each; shops on the ground floor.
  const [cu, cv] = [u.sub(0.51).div(0.21), v.sub(0.62).div(0.18)];
  const opening = wall.mul(step(isTier.oneMinus(), storey));
  const pane = opening.mul(step(0.3, v)).mul(step(cu.mul(cu).add(cv.mul(cv).mul(step(0, cv))), 1));
  const sill = opening.mul(step(abs(cu), 1.3)).mul(step(0.24, v)).mul(step(v, 0.3));
  const shop = wall.mul(isTier.oneMinus()).mul(step(storey, 0.5)).mul(step(0.08, fract(along.div(4)))).mul(step(fract(along.div(4)), 0.92)).mul(step(0.25, up)).mul(step(up, 2.7));
  const slab = opening.mul(step(1, storey)).mul(step(v, 0.07)); // floor edges and balcony slabs
  const door = isRoom.mul(step(0.5, n.z)).mul(step(abs(local.x), 0.5)).mul(step(up, 2.1));
  // Walls: sandstone, ochre, pale rose and weathered cream in the old city; brick, an indigo wash, grey concrete and soot
  // further out. Darker toward the street, and streaked with grime down from the roofs.
  const tone = mix(
    mix(mix(color(0xc9a77a), color(0xc58b4e), step(0.2, style)), mix(color(0xd2a08c), color(0xd6cdbb), step(0.45, style)), step(0.35, style)),
    mix(mix(color(0x8e5038), color(0x6c7a9c), step(0.72, style)), mix(color(0x8c8780), color(0x5f5650), step(0.92, style)), step(0.8, style)),
    step(0.6, style),
  );
  const streak = step(0.62, hash(floor(along.div(0.8)).add(style.mul(77)))).mul(smoothstep(size.y.sub(9), size.y, up)).mul(0.22);
  const grime = min(float(1), up.div(8).mul(0.3).add(0.7)).mul(streak.oneMinus());
  const body = mix(mix(tone.mul(grime), color(0x2a2522), slab.mul(0.55)), tone.mul(0.62), sill);
  material.colorNode = mix(mix(mix(mix(body, color(0x161b20), pane), color(0x3b3632), shop), color(0x2c4846), door), color(0x4a4541), roof);
  material.roughnessNode = mix(float(0.88), float(0.25), pane);
  // Night: rooms lit warm, a few with cold tube lights, a few flickering; shops lit; a neon strip under some roofs.
  const room = hash(storey.mul(37).add(bay.mul(11)).add(style.mul(9973)));
  const lamp = mix(color(0xffaf5a), color(0xcfeeff), step(0.88, hash(room.mul(7.31))));
  const flicker = mix(float(1), sin(time.mul(23).add(room.mul(91))).mul(0.4).add(0.6), step(0.97, room));
  const lit = pane.mul(step(0.4, room)).mul(flicker);
  const shopLit = shop.mul(step(0.45, hash(bay.add(style.mul(331)))));
  const neon = wall.mul(step(0.7, style)).mul(step(size.y.sub(1.6), up)).mul(step(up, size.y.sub(1.15)));
  const neonColour = mix(color(0xff2fa0), color(0x2ff0ff), step(0.85, style));
  material.emissiveNode = lamp
    .mul(lit.mul(0.85).add(shopLit.mul(0.6)).add(door.mul(0.5)))
    .mul(night)
    .add(neonColour.mul(neon).mul(night.mul(2).add(0.2)));
}

/** One mesh for a tile's city buildings: records of x, y, z (from the tile centre; y its ground), yaw, w, h, d, style. */
export function blockMesh(records: Float32Array): THREE.Mesh {
  const count = records.length / 8;
  const at = new Float32Array(count * 4);
  const size = new Float32Array(count * 4);
  let reach = 0;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < count; i++) {
    const [x, y, z, yaw, w, h, d, style] = records.subarray(i * 8, i * 8 + 8);
    at.set([x, y, z, yaw], i * 4);
    size.set([w, h, d, style], i * 4);
    reach = Math.max(reach, Math.hypot(x, z) + Math.hypot(w, d) / 2);
    low = Math.min(low, y - SINK);
    high = Math.max(high, y + h);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  for (const name of ATTRIBUTES) geometry.setAttribute(name, SHAPE.getAttribute(name));
  geometry.setAttribute('iAt', new THREE.InstancedBufferAttribute(at, 4));
  geometry.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 4));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (low + high) / 2, 0), Math.hypot(reach, (high - low) / 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Free a mesh from blockMesh: its instance buffers, not the shape it shares. */
export function disposeBlocks(mesh: THREE.Mesh) {
  for (const name of ATTRIBUTES) mesh.geometry.deleteAttribute(name);
  mesh.geometry.dispose();
}

// ---------- the city's props (world/blocks.ts): what stands on its roofs and in its streets, one faceted vertex-coloured
// shape per kind, instanced per tile like the plants; `glow` lights a shape at night (temples from below, aerial tips)

/** A shape's parts merged, with `glow` per vertex from its height y. */
function kit(parts: THREE.BufferGeometry[], glow: (y: number) => number) {
  const g = mergeGeometries(parts);
  const p = g.getAttribute('position');
  g.setAttribute('glow', new THREE.BufferAttribute(Float32Array.from({ length: p.count }, (_, i) => glow(p.getY(i))), 1));
  return g;
}
const SANDSTONE = 0xd8bb8c;
/** A temple spire crowning a tower: a foot of radius 1, the body 3.3 high, an amalaka and a finial, lit from below. */
const crown = (lit: (y: number) => number) =>
  kit(
    [
      piece(shikhara(1, 3.3, 0, 0, 0, 16, 16), SANDSTONE, 0, 0, 0),
      piece(new THREE.SphereGeometry(0.3, 12, 5), 0xc9a978, 0, 3.32, 0, [1, 0.45, 1]),
      piece(new THREE.SphereGeometry(0.12, 8, 4), 0xd8a640, 0, 3.47, 0),
      piece(new THREE.ConeGeometry(0.05, 0.42, 6), 0xd8a640, 0, 3.75, 0),
    ],
    lit,
  );
const KIT: Record<number, THREE.BufferGeometry> = {
  // Black plastic water tanks, as on every roof in India.
  [TANK]: kit([piece(new THREE.CylinderGeometry(0.75, 0.75, 1.4, 8), 0x1e1f21, 0, 0.7, 0), piece(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 6), 0x2c2d30, 0, 1.46, 0)], () => 0),
  // An old wooden water tower on legs, as on the tenements of the concepts.
  [WATER_TOWER]: kit(
    [
      ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => piece(new THREE.CylinderGeometry(0.07, 0.09, 3, 4), 0x3a3029, sx * 1.05, 1.5, sz * 1.05)),
      piece(new THREE.BoxGeometry(3, 0.15, 3), 0x4a3a2c, 0, 3.05, 0),
      piece(new THREE.CylinderGeometry(1.45, 1.45, 3.2, 10), 0x7a5536, 0, 4.75, 0),
      ...[3.9, 5.5].map((y) => piece(new THREE.CylinderGeometry(1.48, 1.48, 0.08, 10, 1, true), 0x2b2522, 0, y, 0)),
      piece(new THREE.ConeGeometry(1.6, 1.1, 10), 0x5b4532, 0, 6.9, 0),
    ],
    () => 0,
  ),
  // A mast with cross bars and a red light on top.
  [AERIAL]: kit(
    [
      piece(new THREE.CylinderGeometry(0.035, 0.05, 6, 4), 0x5d6166, 0, 3, 0),
      ...[4.6, 5.2, 5.7].map((y) => piece(new THREE.BoxGeometry(2, 0.04, 0.04), 0x6d7176, 0, y, 0)),
      piece(new THREE.BoxGeometry(0.14, 0.14, 0.14), 0xff2a1a, 0, 6.07, 0),
    ],
    (y) => (y > 5.99 ? 2 : 0),
  ),
  [DISH]: kit([piece(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 4), 0x5d6166, 0, 0.55, 0), piece(new THREE.SphereGeometry(0.55, 8, 3, 0, Math.PI * 2, 0, 0.75).rotateX(-1.1), 0xd8d8d2, 0, 1.2, 0.1)], () => 0),
  [CROWN]: crown((y) => (1 - Math.min(1, y / 3.3)) ** 1.5 * 0.7 + 0.1),
  // A street temple 1 high: a plinth, a porch in front, a spire with four spirelets, an amalaka, a saffron flag.
  [MANDIR]: kit(
    [
      piece(new THREE.BoxGeometry(2 * MANDIR_FOOT, 0.07, 2 * MANDIR_FOOT), 0xb59a74, 0, 0.035, 0),
      piece(new THREE.BoxGeometry(0.34, 0.2, 0.22), 0xe2d3b4, 0, 0.17, 0.2),
      piece(new THREE.BoxGeometry(0.4, 0.035, 0.28), 0xc9b48e, 0, 0.285, 0.2),
      piece(shikhara(0.19, 0.74, 0, 0, 0, 14, 16), 0xe4cfa6, 0, 0.07, -0.04),
      ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => piece(shikhara(0.065, 0.28, 0, 0, 0, 6, 8), 0xdcc59a, sx * 0.14, 0.07, sz * 0.14 - 0.04)),
      piece(new THREE.SphereGeometry(0.06, 10, 4), 0xc9a978, 0, 0.82, -0.04, [1, 0.45, 1]),
      piece(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), 0x5a4a3a, 0, 0.92, -0.04),
      piece(new THREE.BoxGeometry(0.11, 0.055, 0.004), 0xff7a1a, 0.055, 0.99, -0.04),
    ],
    (y) => (y < 0.3 ? 0.9 : (1 - Math.min(1, y / 0.85)) ** 1.5 * 0.7 + 0.08),
  ),
};
// Placed by per-instance attributes rather than InstancedMesh, as the plants are, so every tile shares one shader.
const kitMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85 });
const neonMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.5 });
{
  const at = attribute('iAt', 'vec4'); // x, y, z, size
  const turn = attribute('iTurn', 'vec3'); // cos and sin of the yaw, shade
  const yaw = (v: THREE.Node<'vec3'>) => vec3(v.x.mul(turn.x).add(v.z.mul(turn.y)), v.y, v.z.mul(turn.x).sub(v.x.mul(turn.y)));
  kitMaterial.positionNode = Fn(() => {
    normalLocal.assign(yaw(normalLocal));
    return yaw(positionLocal).mul(at.w).add(at.xyz);
  })();
  kitMaterial.colorNode = vec4(vec3(turn.z), 1); // the material multiplies by the vertex colour
  kitMaterial.emissiveNode = vertexColor().mul(attribute('glow', 'float')).mul(night.mul(1.4));

  // Neon blade signs, s m tall: letters stacked down the blade, each under a headline as in Devanagari (made-up ones,
  // strokes from a hash), in amber, red, teal or pink, a lit border; faint by day, blazing at night.
  const p = attribute('position', 'vec3');
  neonMaterial.positionNode = Fn(() => {
    normalLocal.assign(yaw(normalLocal));
    return yaw(vec3(p.x, p.y.mul(at.w), p.z)).add(at.xyz);
  })();
  const pick = fract(turn.z.mul(17.3));
  const hue = mix(mix(color(0xffa63a), color(0xff4038), step(0.3, pick)), mix(color(0x34f0d8), color(0xff4fc8), step(0.75, pick)), step(0.5, pick));
  const gy = uv().y.mul(max(float(1), floor(at.w.div(0.8))));
  const [row, cy, cx] = [floor(gy), fract(gy), uv().x];
  const inner = step(0.14, cx).mul(step(cx, 0.86)).mul(step(0.12, cy)).mul(step(cy, 0.9));
  const head = step(0.74, cy).mul(step(cy, 0.82));
  const stem = step(0.55, hash(row.mul(13.1).add(floor(cx.mul(4)).mul(3.7)).add(turn.z.mul(97)))).mul(step(abs(fract(cx.mul(4)).sub(0.5)), 0.18)).mul(step(0.18, cy)).mul(step(cy, 0.78));
  const bar = step(0.6, hash(row.mul(7.9).add(turn.z.mul(31)))).mul(step(abs(cy.sub(0.45)), 0.04));
  const glyph = inner.mul(head.max(stem).max(bar));
  const frame = step(cx, 0.06).max(step(0.94, cx)).max(step(uv().y, 0.015)).max(step(0.985, uv().y));
  neonMaterial.colorNode = mix(color(0x15110f), hue.mul(0.5), glyph.max(frame));
  neonMaterial.emissiveNode = hue.mul(glyph.max(frame.mul(0.6))).mul(night.mul(3).add(0.15));
}
const SIGN_SHAPE = new THREE.BoxGeometry(0.22, 1, 0.95).translate(0, 0.5, 0); // s m tall: the shader stretches it
const KIT_ATTRIBUTES = ['position', 'normal', 'color', 'glow'];
const SIGN_ATTRIBUTES = ['position', 'normal', 'uv'];

/** Instanced meshes for a tile's city props: records of x, y, z (from the tile centre), yaw, size, kind; one per kind. */
export function propMeshes(records: Float32Array): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const kind of [TANK, WATER_TOWER, AERIAL, DISH, SIGN, CROWN, MANDIR]) {
    let count = 0;
    for (let i = 5; i < records.length; i += 6) if (records[i] === kind) count++;
    if (count === 0) continue;
    const at = new Float32Array(count * 4);
    const turn = new Float32Array(count * 3);
    let [n, reach, low, high] = [0, 0, Infinity, -Infinity];
    for (let i = 0; i < records.length; i += 6) {
      if (records[i + 5] !== kind) continue;
      const [x, y, z, yaw, s] = records.subarray(i, i + 5);
      at.set([x, y, z, s], n * 4);
      turn.set([Math.cos(yaw), Math.sin(yaw), 0.85 + ((Math.abs(x * 7.3 + z * 3.1) % 1) * 0.3)], n * 3);
      reach = Math.max(reach, Math.hypot(x, z));
      low = Math.min(low, y);
      high = Math.max(high, y + (kind === SIGN ? s : kind === CROWN ? 4 * s : kind === MANDIR ? s : 8 * s));
      n++;
    }
    const sign = kind === SIGN;
    const shape = sign ? SIGN_SHAPE : KIT[kind];
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(shape.index);
    for (const name of sign ? SIGN_ATTRIBUTES : KIT_ATTRIBUTES) geometry.setAttribute(name, shape.getAttribute(name));
    geometry.setAttribute('iAt', new THREE.InstancedBufferAttribute(at, 4));
    geometry.setAttribute('iTurn', new THREE.InstancedBufferAttribute(turn, 3));
    geometry.instanceCount = count;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (low + high) / 2, 0), Math.hypot(reach + 10, (high - low) / 2));
    const mesh = new THREE.Mesh(geometry, sign ? neonMaterial : kitMaterial);
    mesh.castShadow = kind === WATER_TOWER || kind === CROWN || kind === MANDIR; // tanks, aerials and signs: many and small
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}

/** Free a mesh from propMeshes: its instance buffers, not the shape it shares. */
export function disposeProps(mesh: THREE.Mesh) {
  mesh.geometry.setIndex(null);
  for (const name of [...KIT_ATTRIBUTES, ...SIGN_ATTRIBUTES]) if (mesh.geometry.getAttribute(name)) mesh.geometry.deleteAttribute(name);
  mesh.geometry.dispose();
}

// ---------- the set pieces, built once in the city's own frame (its middle at the origin, so float32 holds them)

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/** Triangles with normals and uv, built up face by face. */
class Faces {
  pos: number[] = [];
  nor: number[] = [];
  uvs: number[] = [];
  /** A flat quad a, b, c, d, counter-clockwise seen from its front; uv per corner. */
  quad(a: number[], b: number[], c: number[], d: number[], uv = [[0, 0], [0, 0], [0, 0], [0, 0]]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const corners = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(...corners[i]);
      this.nor.push(n[0] / l, n[1] / l, n[2] / l);
      this.uvs.push(...uv[i]);
    }
  }
  /** A square beam from a to b, w thick: its four sides. */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number) {
    const d = b.clone().sub(a).normalize();
    const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.95 ? X : Y).normalize().multiplyScalar(w / 2);
    const v = new THREE.Vector3().crossVectors(d, u).normalize().multiplyScalar(w / 2);
    const at = (p: THREE.Vector3, s: number, t: number) => p.clone().addScaledVector(u, s).addScaledVector(v, t).toArray();
    for (const [s0, t0, s1, t1] of [[1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1], [-1, 1, 1, 1]]) this.quad(at(b, s0, t0), at(b, s1, t1), at(a, s1, t1), at(a, s0, t0));
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    return g;
  }
}

/** Position and normal only, as plain triangles, so parts made different ways merge. */
function plain(g: THREE.BufferGeometry) {
  const flat = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
  return flat;
}

/** Merge plain triangle geometries. */
function merge(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of parts.map(plain)) {
    pos.push(...g.getAttribute('position').array);
    nor.push(...g.getAttribute('normal').array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

const WARM = 0xffa64d;

// Sandstone of the ghats: each step and slab its own shade, dark and wet at the waterline, little oil lamps on the steps
// at night.
const ghatStone = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, side: THREE.DoubleSide });
// Spires: sandstone, lit from below at night by floodlights (lift: 0 at the foot, 1 at the top).
const spireStone = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, side: THREE.DoubleSide });
{
  const lift = attribute('lift', 'float');
  spireStone.colorNode = color(0xc8a47a).mul(lift.mul(0.15).add(0.85));
  spireStone.emissiveNode = color(0xffb46a).mul(night.mul(0.55)).mul(lift.oneMinus().pow(1.5).mul(0.8).add(0.12));
}
const scaffold = new THREE.MeshStandardNodeMaterial({ color: 0x3a3029, roughness: 0.8, side: THREE.DoubleSide });
const steel = new THREE.MeshStandardNodeMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
// Concrete of the barrages: sluice gates as dark bands.
const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
concrete.colorNode = mix(color(0x7a756e), color(0x3c3936), step(0.82, fract(uv().x.mul(18))));
// Lamp heads, barrage lights: warm, bright at night.
const lights = new THREE.MeshBasicNodeMaterial();
lights.colorNode = color(WARM).mul(night.mul(4).add(0.5));
// The expressway's sodium lamps.
const sodium = new THREE.MeshBasicNodeMaterial();
sodium.colorNode = color(0xff8a2a).mul(night.mul(5).add(0.4));
// Banners on the lamp posts: maroon cloth with a gold ring and bar, lit at night.
const banner = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide });
{
  const ring = smoothstep(0.035, 0.015, abs(length(uv().sub(vec2(0.5, 0.62)).mul(vec2(1, 0.33))).sub(0.12)));
  const bar = step(abs(uv().x.sub(0.5)), 0.03).mul(step(0.2, uv().y)).mul(step(uv().y, 0.5));
  const gold = ring.max(bar);
  banner.colorNode = mix(color(0x5a1018), color(0xd8a640), gold);
  banner.emissiveNode = mix(color(0x3a0a10), color(0xffc860), gold).mul(night.mul(0.8));
}
// Aviation lights, blinking red.
const beacons = new THREE.MeshBasicNodeMaterial();
beacons.colorNode = color(0xff2a1a).mul(step(0.5, fract(time.mul(0.7))).mul(night.mul(5).add(1)));
// The state broadcast on the towers' screens: rows of glyphs that change, scanlines, and now and then a burst of static
// where someone hijacks it.
const screen = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
{
  const cell = floor(uv().mul(vec2(22, 9)));
  const glyph = step(0.55, hash(cell.x.mul(17).add(cell.y.mul(131)).add(floor(time.mul(1.5)).mul(7))));
  const lines = fract(uv().y.mul(90)).mul(0.35).add(0.65);
  const hijack = step(0.9, fract(time.mul(0.045)));
  const noise = hash(floor(uv().mul(vec2(160, 90))).dot(vec2(1, 157)).add(floor(time.mul(24)).mul(3.1)));
  const state = mix(color(0x2a0d05), color(0xff8a2a), glyph).mul(lines);
  screen.colorNode = mix(state, vec3(noise).mul(color(0xbfeaff)), hijack).mul(night.mul(1.6).add(0.5));
}
// The light-forms: additive lines, cyan white, faint by day and glowing at night, shimmering. They are seen through the
// haze from far off, so no fog.
const lightForm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
lightForm.colorNode = vec3(0.18, 0.66, 1).mul(night.mul(0.55).add(0.08)).mul(sin(time.mul(0.9).add(positionLocal.x.mul(0.02))).mul(0.15).add(0.85));

/** A tower of the Nagara style: a curving body, fluted (eight projections) and banded in tiers, from y to y + h. */
function shikhara(r: number, h: number, x: number, y: number, z: number, rows = 84, around = 48) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const tier = Math.abs(((t * 14) % 1) - 0.5) < 0.12 ? 0.965 : 1;
    pts.push(new THREE.Vector2(r * (1 - 0.72 * t ** 1.7) * tier, t * h));
  }
  pts.push(new THREE.Vector2(0.001, h));
  const g = new THREE.LatheGeometry(pts, around);
  const p = g.getAttribute('position');
  for (let k = 0; k < p.count; k++) {
    const f = 1 + 0.07 * Math.cos(8 * Math.atan2(p.getX(k), p.getZ(k)));
    p.setXYZ(k, p.getX(k) * f + x, p.getY(k) + y, p.getZ(k) * f + z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A temple spire of foot radius r and height h in its own frame (foot at the origin): procedural stone, unless `profile`
 * is given (a generated model stands there instead: its radius in metres at each fraction of its height), then the
 * scaffolding around it and floodlights at the scaffolding's top.
 */
function spireParts(r: number, h: number, profile?: (t: number) => number) {
  const PLINTH = 4.6;
  const body = 0.84 * h - PLINTH;
  let solid: THREE.BufferGeometry | null = null;
  if (!profile) {
    const stone: THREE.BufferGeometry[] = [
      new THREE.BoxGeometry(2.5 * r, 3, 2.5 * r).translate(0, 1.5, 0),
      new THREE.BoxGeometry(2.1 * r, 1.6, 2.1 * r).translate(0, 3.8, 0),
      shikhara(r, body, 0, PLINTH, 0),
    ];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) stone.push(shikhara(r * 0.32, body * 0.36, sx * r * 0.82, PLINTH, sz * r * 0.82, 30, 20));
    // The amalaka (a ribbed, flattened stone disc), the kalasha (a pot) and a finial.
    const top = PLINTH + body;
    const crown = r * 0.28 * 1.3;
    const amalaka = new THREE.SphereGeometry(crown, 32, 10);
    const ap = amalaka.getAttribute('position');
    for (let k = 0; k < ap.count; k++) {
      const f = 1 + 0.1 * Math.cos(24 * Math.atan2(ap.getX(k), ap.getZ(k)));
      ap.setXYZ(k, ap.getX(k) * f, ap.getY(k) * 0.4 + top + crown * 0.3, ap.getZ(k) * f);
    }
    amalaka.computeVertexNormals();
    stone.push(amalaka, new THREE.SphereGeometry(crown * 0.35, 14, 8).translate(0, top + crown * 0.95, 0), new THREE.ConeGeometry(crown * 0.12, crown * 1.4, 8).translate(0, top + crown * 1.9, 0));
    solid = merge(stone);
    const pos = solid.getAttribute('position');
    solid.setAttribute('lift', new THREE.Float32BufferAttribute(Array.from({ length: pos.count }, (_, k) => Math.min(1, Math.max(0, pos.getY(k) / h))), 1));
  }

  // Scaffolding around the body: twelve poles leaning in with it, rings every 3 m, braces in every other bay; floodlights
  // at the top; cables down to the ground.
  const cage = new Faces();
  const radius = profile
    ? (y: number) => profile(y / h) * 1.08 + 0.8
    : (y: number) => r * (1 - 0.72 * Math.min(1, Math.max(0, (y - PLINTH) / body)) ** 1.7) * 1.12 + 0.9;
  const P = (k: number, y: number) => new THREE.Vector3(Math.cos((k * Math.PI) / 6) * radius(y), y, Math.sin((k * Math.PI) / 6) * radius(y));
  const [y0, y1] = profile ? [h * 0.22, h * 0.86] : [PLINTH + body * 0.16, PLINTH + body * 0.92];
  const anchor = (profile ? profile(0.03) : r) * 2.6;
  const rings: number[] = [];
  for (let y = y0; y <= y1; y += 3) rings.push(y);
  for (let k = 0; k < 12; k++) {
    for (let j = 0; j + 1 < rings.length; j++) {
      cage.beam(P(k, rings[j]), P(k, rings[j + 1]), 0.16);
      if ((j + k) % 2 === 0) cage.beam(P(k, rings[j]), P(k + 1, rings[j + 1]), 0.1);
    }
    for (const y of rings) cage.beam(P(k, y), P(k + 1, y), 0.12);
    if (k % 3 === 1) cage.beam(P(k, rings[rings.length - 1]), P(k, 0).setLength(anchor).setY(0), 0.07);
  }
  const lamps = new Faces();
  for (let k = 0; k < 12; k += 3) {
    const p = P(k, rings[rings.length - 1]);
    lamps.beam(p, p.clone().add(new THREE.Vector3(0, 0.7, 0)), 0.7);
  }
  return { solid, cage: cage.geometry(), lamps: lamps.geometry() };
}

/** A broadcast tower of height h, foot at the origin, its loudspeakers and screen facing +z. */
function towerParts(h: number) {
  const frame = new Faces();
  const half = (y: number) => 4 - (3 * y) / h;
  const corner = (sx: number, sz: number, y: number) => new THREE.Vector3(sx * half(y), y, sz * half(y));
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of corners) frame.beam(corner(sx, sz, 0), corner(sx, sz, h), 0.35);
  for (let y = 6; y < h; y += 6) {
    corners.forEach(([sx, sz], k) => {
      const [tx, tz] = corners[(k + 1) % 4];
      frame.beam(corner(sx, sz, y), corner(tx, tz, y), 0.2);
      frame.beam(corner(sx, sz, y - 6), corner(tx, tz, y), 0.12);
      frame.beam(corner(tx, tz, y - 6), corner(sx, sz, y), 0.12);
    });
  }
  frame.beam(new THREE.Vector3(0, h, 0), new THREE.Vector3(0, h + 9, 0), 0.25);
  const horns: THREE.BufferGeometry[] = [new THREE.BoxGeometry(3.2, 0.3, 3.2).translate(0, h, 0)];
  for (const y of [h - 2, h - 4.6]) {
    for (let k = 0; k < 4; k++) horns.push(new THREE.ConeGeometry(0.75, 2.4, 12, 1, true).rotateX(-Math.PI / 2).translate(0, y, 1.6).rotateY((k * Math.PI) / 2));
  }
  const panel = new THREE.PlaneGeometry(8, 4.5).translate(0, h * 0.42, half(h * 0.42) + 0.6);
  return { frame: merge([frame.geometry(), ...horns]), panel, beacon: new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(0, h + 9.3, 0) };
}

/** Line strokes w wide in the xy plane, one quad per segment. */
function strokes(lines: [number, number][][], w: number) {
  const f = new Faces();
  for (const line of lines) {
    for (let k = 0; k + 1 < line.length; k++) {
      const [[ax, ay], [bx, by]] = [line[k], line[k + 1]];
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const [nx, ny] = [(-(by - ay) / l) * (w / 2), ((bx - ax) / l) * (w / 2)];
      f.quad([ax - nx, ay - ny, 0], [bx - nx, by - ny, 0], [bx + nx, by + ny, 0], [ax + nx, ay + ny, 0]);
    }
  }
  return f.geometry();
}
const circle = (r: number, x = 0, y = 0, n = Math.max(24, Math.round(r * 0.6))): [number, number][] =>
  Array.from({ length: n + 1 }, (_, k) => [x + Math.cos((k / n) * Math.PI * 2) * r, y + Math.sin((k / n) * Math.PI * 2) * r]);
/** Petals: pointed arches from radius r0 to a tip at r1, n of them. */
const petals = (n: number, r0: number, r1: number): [number, number][][] =>
  Array.from({ length: n }, (_, k) => {
    const [a, w] = [(k / n) * Math.PI * 2, Math.PI / n];
    return Array.from({ length: 13 }, (_, i) => {
      const t = i / 12; // across the petal, one side to the other
      const s = Math.sin(t * Math.PI); // out toward the tip in the middle
      const ang = a - w + 2 * w * t;
      const rr = r0 + (r1 - r0) * s ** 0.7;
      return [Math.cos(ang) * rr, Math.sin(ang) * rr] as [number, number];
    });
  });
/** An equilateral triangle of circumradius r, pointing up (or down), its middle lifted by dy. */
const triangle = (r: number, up: boolean, dy: number): [number, number][] =>
  [0, 1, 2, 3].map((k) => {
    const a = (up ? Math.PI / 2 : -Math.PI / 2) + (k * Math.PI * 2) / 3;
    return [Math.cos(a) * r, Math.sin(a) * r + dy];
  });

/** A light-form of radius r: layers of strokes, each turning at its own rate in its plane. */
function lightFormLayers(kind: number, r: number): { geometry: THREE.BufferGeometry; spin: number }[] {
  const w = Math.max(1.2, r * 0.008);
  if (kind === 0) {
    // After the Sri Yantra: circles with spokes ending in small circles, a lotus of eight, nested triangles, a point.
    const spokes = Array.from({ length: 8 }, (_, k) => {
      const a = (k * Math.PI) / 4;
      return [[Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93], [Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25]] as [number, number][];
    });
    const ends = Array.from({ length: 8 }, (_, k) => circle(r * 0.05, Math.cos((k * Math.PI) / 4) * r * 1.3, Math.sin((k * Math.PI) / 4) * r * 1.3, 20));
    const tri = [0.55, 0.43, 0.31].map((s, k) => triangle(r * s, true, r * [-0.03, 0.05, 0.1][k])).concat([0.55, 0.45, 0.35, 0.22].map((s, k) => triangle(r * s, false, r * [0.03, -0.04, -0.09, 0][k])));
    return [
      { geometry: strokes([circle(r), circle(r * 0.93), ...spokes, ...ends], w * 1.2), spin: 0 },
      { geometry: strokes([circle(r * 0.6), ...petals(8, r * 0.6, r * 0.88)], w), spin: 0.05 },
      { geometry: strokes([...tri, circle(r * 0.03, 0, 0, 12)], w), spin: -0.03 },
    ];
  }
  if (kind === 1) {
    // A lotus: sixteen petals round eight.
    return [
      { geometry: strokes([circle(r), circle(r * 0.96), circle(r * 0.55)], w * 1.2), spin: 0 },
      { geometry: strokes(petals(16, r * 0.55, r * 0.94), w), spin: 0.04 },
      { geometry: strokes([circle(r * 0.3), ...petals(8, r * 0.3, r * 0.53), circle(r * 0.08, 0, 0, 16)], w), spin: -0.07 },
    ];
  }
  // A wheel: rings, twenty-four spokes, small circles round the rim.
  const spokes = Array.from({ length: 24 }, (_, k) => {
    const a = (k * Math.PI) / 12;
    return [[Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22], [Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9]] as [number, number][];
  });
  const beads = Array.from({ length: 24 }, (_, k) => circle(r * 0.03, Math.cos((k * Math.PI) / 12 + 0.13) * r * 0.95, Math.sin((k * Math.PI) / 12 + 0.13) * r * 0.95, 12));
  return [
    { geometry: strokes([circle(r), circle(r * 0.9), ...beads], w * 1.2), spin: -0.02 },
    { geometry: strokes([...spokes, circle(r * 0.22), circle(r * 0.1)], w), spin: 0.09 },
  ];
}

/** A generated model's own material as a node material that glows warm at night, more toward its foot (`lift` 0–1 up it). */
function nightLit(source: THREE.MeshStandardMaterial, under: number, over: number) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: source.roughness, metalness: source.metalness });
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) m[key] = source[key];
  const lift = attribute('position', 'vec3').y; // the model stands 1 unit tall
  if (source.map) m.emissiveNode = texture(source.map).rgb.mul(color(0xffb070)).mul(night).mul(lift.oneMinus().pow(1.5).mul(under).add(over));
  return m;
}

/** The radius of a model 1 unit tall at each fraction of its height (its widest vertex in each of 50 bands). */
function outline(g: THREE.BufferGeometry): (t: number) => number {
  const bands = new Float32Array(50);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const b = Math.min(49, Math.max(0, Math.floor(p.getY(i) * 50)));
    bands[b] = Math.max(bands[b], Math.hypot(p.getX(i), p.getZ(i)));
  }
  return (t) => bands[Math.min(49, Math.max(0, Math.floor(t * 50)))];
}

/**
 * The city's generated models (image-to-3D, art-src/prakashi/): the spire and the palace, each centred, standing on
 * y = 0 and 1 unit tall, in their own materials lit warm at night.
 */
export async function loadCityModels() {
  const [spire, palace] = await Promise.all(
    ['/prakashi/shikhara.glb', '/prakashi/palace.glb'].map(async (url) => {
      const { geometry, material } = await loadModel(url);
      const [min, max] = [geometry.boundingBox!.min.clone(), geometry.boundingBox!.max.clone()]; // translate remeasures the box in place
      const h = max.y - min.y;
      geometry.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2).scale(1 / h, 1 / h, 1 / h);
      geometry.computeBoundingSphere();
      return { geometry, material };
    }),
  );
  return {
    spire: { geometry: spire.geometry, material: nightLit(spire.material, 0.9, 0.12), outline: outline(spire.geometry) },
    palace: { geometry: palace.geometry, far: await coarse(palace.geometry, 0.08), material: nightLit(palace.material, 0.45, 0.12) },
  };
}

/** A coarse copy of a model for far off: the same vertices, about `ratio` of its triangles (meshoptimizer's sloppy
 * simplifier, which ignores the seams of its texture). */
async function coarse(g: THREE.BufferGeometry, ratio: number): Promise<THREE.BufferGeometry> {
  await MeshoptSimplifier.ready;
  const index = Uint32Array.from(g.getIndex()!.array);
  const [kept] = MeshoptSimplifier.simplifySloppy(index, g.getAttribute('position').array as Float32Array, 3, null, Math.floor((index.length * ratio) / 3) * 3, 0.05);
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, a);
  out.setIndex(new THREE.BufferAttribute(kept, 1));
  out.boundingSphere = g.boundingSphere;
  return out;
}
export type CityModels = Awaited<ReturnType<typeof loadCityModels>>;

/**
 * The city's set pieces, in a group in the city's frame that follows the floating origin (`origin`), with their
 * colliders (the ghats' parapet, the barrages, the spires' plinths, the towers' feet) on one fixed body.
 */
export function createCityView(scene: THREE.Scene, physics: RAPIER.World, c: City, buildings: Blocks, origin: { x: number; z: number }, models: CityModels | null) {
  const group = new THREE.Group();
  scene.add(group);
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const solid = (desc: RAPIER.ColliderDesc) => addFixed(physics, desc, body);
  const box = (hx: number, hy: number, hz: number, x: number, y: number, z: number, yaw: number) =>
    solid(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
  const [ox, oz] = [c.ox - c.x, c.oz - c.z];
  /** City-frame point at angle a (from beta) and radius rho about the river's centre, at height y. */
  const P = (a: number, rho: number, y: number) => [ox + Math.cos(c.beta + a) * rho, y, oz + Math.sin(c.beta + a) * rho];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, shadows = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = m.receiveShadow = shadows;
    group.add(m);
    return m;
  };

  // The river: black, glassy, a ripple in its gloss.
  {
    const f = new Faces();
    const [r0, r1] = [c.arc - c.half - 14, c.arc + c.half - GHAT + 6];
    const n = 280;
    for (let k = 0; k < n; k++) {
      const [a0, a1] = [-c.span - 0.004 + ((2 * c.span + 0.008) * k) / n, -c.span - 0.004 + ((2 * c.span + 0.008) * (k + 1)) / n];
      for (let i = 0; i < 4; i++) {
        const [ra, rb] = [r0 + ((r1 - r0) * i) / 4, r0 + ((r1 - r0) * (i + 1)) / 4];
        f.quad(P(a0, ra, c.water), P(a1, ra, c.water), P(a1, rb, c.water), P(a0, rb, c.water));
      }
    }
    const water = new THREE.MeshStandardNodeMaterial({ roughness: 0.22, metalness: 0 });
    water.colorNode = mix(color(0x18241f), color(0x030407), night); // murky by day, black at night
    const p = positionLocal.xz;
    const near = smoothstep(240, 40, positionView.z.negate()); // ripples would alias into stripes further off
    let nx: THREE.Node<'float'> = float(0);
    let nz: THREE.Node<'float'> = float(0);
    for (const [dx, dz, len, amp] of [[0.6, 0.8, 7, 0.02], [-0.9, 0.4, 3.3, 0.014], [0.2, -1, 1.7, 0.008]]) {
      const k = (2 * Math.PI) / len;
      const wave = cos(p.x.mul(dx * k).add(p.y.mul(dz * k)).sub(time.mul(Math.sqrt(9.81 * k) * 0.5))).mul(near);
      nx = nx.sub(wave.mul(dx * k * amp));
      nz = nz.sub(wave.mul(dz * k * amp));
    }
    water.normalNode = transformNormalToView(normalize(vec3(nx, 1, nz)));
    add(f.geometry(), water, false).receiveShadow = true;
  }

  // The ghats: fourteen broad steps from below the water up to the city, and a parapet along their top.
  const STEPS = 14;
  const run = GHAT / STEPS;
  const rise = (c.level - c.water + 1) / STEPS;
  const foot = c.arc + c.half - GHAT;
  {
    const f = new Faces();
    const n = Math.ceil((2 * c.span * (c.arc + c.half)) / 4);
    const along = (a: number) => (a + c.span) * (c.arc + c.half);
    for (let k = 0; k < n; k++) {
      const [a0, a1] = [-c.span + (2 * c.span * k) / n, -c.span + (2 * c.span * (k + 1)) / n];
      const [u0, u1] = [along(a0), along(a1)];
      for (let i = 0; i < STEPS; i++) {
        const [r0, r1] = [foot + i * run, foot + (i + 1) * run];
        const [y0, y1] = [c.water - 1 + i * rise, c.water - 1 + (i + 1) * rise];
        const [v0, v1] = [i * run, (i + 1) * run];
        f.quad(P(a0, r0, y0), P(a1, r0, y0), P(a1, r0, y1), P(a0, r0, y1), [[u0, v0], [u1, v0], [u1, v0], [u0, v0]]);
        f.quad(P(a0, r0, y1), P(a1, r0, y1), P(a1, r1, y1), P(a0, r1, y1), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      }
    }
    const u = uv().x;
    const v = uv().y;
    const tread = step(0.5, attribute('normal', 'vec3').y);
    const stair = floor(v.div(run));
    const tone = hash(stair.mul(13).add(floor(u.div(3.1)))).mul(0.14).add(0.86);
    const wet = smoothstep(c.water + 0.6, c.water - 0.2, positionLocal.y);
    ghatStone.colorNode = mix(color(0xb99c76).mul(tone), color(0x3f362c), wet.mul(0.75)).mul(mix(float(0.74), float(1), tread));
    // At night the palaces' windows and the lamps light the steps warm, more toward the top; oil lamps, one in about
    // eight 2 m cells of a step, above the water.
    const cell = floor(u.div(2));
    const here = step(0.88, hash(cell.mul(7.7).add(stair.mul(131.3)))).mul(tread).mul(step(c.water + 0.3, positionLocal.y));
    const spot = smoothstep(0.32, 0.1, length(vec2(fract(u.div(2)).sub(0.5).mul(2), fract(v.div(run)).sub(0.5).mul(run))));
    const glow = smoothstep(c.water, c.level, positionLocal.y).mul(0.1).add(0.03);
    ghatStone.emissiveNode = color(WARM).mul(spot.mul(here).mul(6).add(glow)).mul(night);
    add(f.geometry(), ghatStone);

    // The parapet along the ghats' top, solid, so no car goes down them into the river.
    const wall = new Faces();
    const m = Math.ceil((2 * c.span * (c.arc + c.half)) / 6);
    const [ra, rb] = [c.arc + c.half + 0.15, c.arc + c.half + 0.55];
    const [lo, hi] = [c.level - 0.3, c.level + 0.9];
    for (let k = 0; k < m; k++) {
      const [a0, a1] = [-c.span + (2 * c.span * k) / m, -c.span + (2 * c.span * (k + 1)) / m];
      wall.quad(P(a1, ra, lo), P(a0, ra, lo), P(a0, ra, hi), P(a1, ra, hi));
      wall.quad(P(a0, rb, lo), P(a1, rb, lo), P(a1, rb, hi), P(a0, rb, hi));
      wall.quad(P(a0, ra, hi), P(a1, ra, hi), P(a1, rb, hi), P(a0, rb, hi));
      const mid = (a0 + a1) / 2;
      const [x, , z] = P(mid, (ra + rb) / 2, 0);
      box(0.3, 0.75, ((a1 - a0) * (ra + rb)) / 4 + 0.05, x, c.level + 0.3, z, -(c.beta + mid));
    }
    add(wall.geometry(), ghatStone);
  }

  // Chhatris on the ghats: small domed pavilions on four pillars, one every ~90 m, halfway down.
  {
    const parts: THREE.BufferGeometry[] = [];
    const n = Math.floor((2 * c.span * (c.arc + c.half)) / 90);
    const i = Math.floor(STEPS * 0.55);
    const y = c.water - 1 + (i + 1) * rise;
    for (let k = 0; k < n; k++) {
      const a = -c.span + (2 * c.span * (k + 0.5)) / n;
      const [x, , z] = P(a, foot + (i + 0.5) * run, 0);
      const yaw = -(c.beta + a);
      const piece = (g: THREE.BufferGeometry) => parts.push(g.rotateY(yaw).translate(x, y, z));
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) piece(new THREE.BoxGeometry(0.35, 2.8, 0.35).translate(sx * 1.4, 1.4, sz * 1.4));
      piece(new THREE.BoxGeometry(3.6, 0.35, 3.6).translate(0, 2.95, 0));
      piece(new THREE.SphereGeometry(1.75, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 3.1, 0));
      piece(new THREE.ConeGeometry(0.18, 0.9, 8).translate(0, 5.2, 0));
    }
    const g = merge(parts);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count * 2)).fill(0.4), 2));
    add(g, ghatStone);
  }

  // The barrages that hold the river at both ends: concrete walls with lights along their crest, none under the
  // expressway's ramps, which pass over them.
  const deck = buildings.deck();
  const underDeck = (x: number, z: number) => !!deck && deck.x.some((dx, k) => Math.hypot(dx - c.x - x, deck.z[k] - c.z - z) < deck.half + 6);
  for (const end of [-1, 1]) {
    const a = end * (c.span + DAM.past / c.arc);
    const [r0, r1] = [c.arc - c.half - 20, c.arc + c.half + 5];
    const [bottom, crest] = [c.water - 5, c.level + DAM.crest];
    const [x, , z] = P(a, (r0 + r1) / 2, 0);
    const yaw = -(c.beta + a);
    add(new THREE.BoxGeometry(r1 - r0, crest - bottom, DAM.thick).rotateY(yaw).translate(x, (bottom + crest) / 2, z), concrete);
    box((r1 - r0) / 2, (crest - bottom) / 2, DAM.thick / 2, x, (bottom + crest) / 2, z, yaw);
    const heads: THREE.BufferGeometry[] = [];
    for (let rho = r0 + 6; rho < r1; rho += 12) {
      const [lx, , lz] = P(a, rho, 0);
      if (underDeck(lx, lz)) continue;
      heads.push(new THREE.BoxGeometry(0.6, 0.4, 0.6).translate(lx, crest + 2.2, lz), new THREE.BoxGeometry(0.15, 2, 0.15).translate(lx, crest + 1, lz));
    }
    add(merge(heads), lights, false);
  }

  // The spires: the generated model scaled to each one's height (or procedural stone), in scaffolding.
  for (const s of buildings.spires()) {
    const model = models?.spire;
    const wide = model ? s.r / model.outline(0.02) : 1; // the model's foot to the spire's radius; its height stretched to s.h
    const parts = spireParts(s.r, s.h, model && ((t) => model.outline(t) * wide));
    const place = (m: THREE.Mesh) => {
      m.position.set(s.x - c.x, c.level, s.z - c.z);
      m.rotation.y = s.yaw;
      return m;
    };
    if (model) place(add(model.geometry, model.material)).scale.set(wide, s.h, wide);
    else if (parts.solid) place(add(parts.solid, spireStone));
    place(add(parts.cage, scaffold));
    place(add(parts.lamps, lights, false));
    box(s.r * 0.8, 2.4, s.r * 0.8, s.x - c.x, c.level + 2.4, s.z - c.z, s.yaw);
  }

  // The palaces on the ghats: the generated model, instanced (or boxes in the buildings' shader), solid.
  const runs: { near: THREE.InstancedMesh; far: THREE.InstancedMesh; middle: THREE.Vector3 }[] = [];
  {
    const palaces = buildings.palaces();
    if (models) {
      // In runs of twelve along the river, each its own mesh, so only the near ones draw (and cast shadows); far off,
      // a coarse copy of the model.
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < palaces.length; i += 12) {
        const run = palaces.slice(i, i + 12);
        const [near, far] = [models.palace.geometry, models.palace.far].map((g) => new THREE.InstancedMesh(g, models.palace.material, run.length));
        for (const mesh of [near, far]) {
          run.forEach((p, k) => mesh.setMatrixAt(k, m.compose(new THREE.Vector3(p.x - c.x, c.level, p.z - c.z), q.setFromAxisAngle(Y, p.yaw), new THREE.Vector3(p.h, p.h, p.h))));
          mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          group.add(mesh);
        }
        near.castShadow = true;
        runs.push({ near, far, middle: near.boundingSphere!.center.clone() });
      }
    } else if (palaces.length) {
      group.add(blockMesh(Float32Array.from(palaces.flatMap((p) => [p.x - c.x, c.level, p.z - c.z, p.yaw, PALACE.w * p.h, p.h, PALACE.d * p.h, 0.3]))));
    }
    for (const p of palaces) box((PALACE.w * p.h) / 2, p.h / 2, (PALACE.d * p.h) / 2, p.x - c.x, c.level + p.h / 2, p.z - c.z, p.yaw);
  }

  // The broadcast towers.
  for (const t of buildings.towers()) {
    const parts = towerParts(t.h);
    for (const [geometry, material, shadows] of [[parts.frame, steel, true], [parts.panel, screen, false], [parts.beacon, beacons, false]] as const) {
      const m = add(geometry, material, shadows);
      m.position.set(t.x - c.x, c.level, t.z - c.z);
      m.rotation.y = t.yaw;
    }
    box(4.2, 3, 4.2, t.x - c.x, c.level + 3, t.z - c.z, t.yaw);
  }

  // The expressway on stilts (its asphalt comes with the tiles, and the tiles' guardrails keep cars on it): its surface
  // is solid here; a concrete slab, piers down to the riverbed or the ground every ~32 m, and sodium lamps with banners
  // on the river side every ~36 m.
  if (deck) {
    const n = deck.x.length;
    const L = (k: number, side: number, d: number, y: number) => [deck.x[k] - c.x + deck.nx[k] * side * d, y, deck.z[k] - c.z + deck.nz[k] * side * d];
    const verts = new Float32Array(n * 6);
    const idx: number[] = [];
    for (let k = 0; k < n; k++) {
      verts.set(L(k, -1, deck.half + 0.6, deck.h[k]), k * 6);
      verts.set(L(k, 1, deck.half + 0.6, deck.h[k]), k * 6 + 3);
      if (k + 1 < n) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
    }
    solid(RAPIER.ColliderDesc.trimesh(verts, Uint32Array.from(idx)));
    const slab = new Faces();
    const posts = new Faces();
    const heads = new Faces();
    const flags = new Faces();
    const pier: THREE.BufferGeometry[] = [];
    // The river side: where the across direction points toward the river's centre.
    const riverSide = (k: number) => Math.sign(deck.nx[k] * (c.ox - deck.x[k]) + deck.nz[k] * (c.oz - deck.z[k])) || 1;
    let along = 0;
    let [nextPier, nextLamp] = [16, 18];
    for (let k = 0; k + 1 < n; k++) {
      const [h0, h1] = [deck.h[k], deck.h[k + 1]];
      for (const side of [-1, 1]) {
        const d = deck.half + 0.6;
        slab.quad(L(k, side, d, h0 - 1.4), L(k + 1, side, d, h1 - 1.4), L(k + 1, side, d, h1 + 0.02), L(k, side, d, h0 + 0.02));
        slab.quad(L(k, side, deck.half, h0 + 0.02), L(k + 1, side, deck.half, h1 + 0.02), L(k + 1, side, d, h1 + 0.02), L(k, side, d, h0 + 0.02));
      }
      slab.quad(L(k, -1, deck.half + 0.6, h0 - 1.4), L(k, 1, deck.half + 0.6, h0 - 1.4), L(k + 1, 1, deck.half + 0.6, h1 - 1.4), L(k + 1, -1, deck.half + 0.6, h1 - 1.4));
      along += Math.hypot(deck.x[k + 1] - deck.x[k], deck.z[k + 1] - deck.z[k]);
      const [wx, wz] = [deck.x[k], deck.z[k]];
      const ground = cityGround(c, wx, wz, c.level);
      if (along >= nextPier) {
        nextPier += 32;
        const top = h0 - 1.4;
        if (top - ground > 1.5) {
          const yaw = Math.atan2(deck.x[k + 1] - wx, deck.z[k + 1] - wz);
          pier.push(new THREE.BoxGeometry(3.4, top - ground, 2.2).rotateY(yaw).translate(wx - c.x, (top + ground) / 2, wz - c.z));
        }
      }
      if (along >= nextLamp) {
        nextLamp += 36;
        const side = riverSide(k);
        const foot = new THREE.Vector3(...L(k, side, deck.half + 0.35, h0));
        const top = foot.clone().setY(h0 + 9);
        const arm = new THREE.Vector3(...L(k, side, deck.half - 1.6, h0 + 9));
        posts.beam(foot, top, 0.2);
        posts.beam(top, arm, 0.12);
        heads.beam(arm.clone().setY(h0 + 8.95), arm.clone().setY(h0 + 8.6), 0.5);
        // A banner on the pole, facing along the road, a glyph on it.
        const [bx, bz] = [foot.x - deck.nx[k] * side * 0.45, foot.z - deck.nz[k] * side * 0.45];
        const corner = (u: number, y: number) => [bx - deck.nx[k] * side * u, y, bz - deck.nz[k] * side * u];
        flags.quad(corner(0, h0 + 4.4), corner(0.8, h0 + 4.4), corner(0.8, h0 + 6.8), corner(0, h0 + 6.8), [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    add(slab.geometry(), concrete);
    if (pier.length) add(merge(pier), concrete);
    add(posts.geometry(), steel);
    add(heads.geometry(), sodium, false);
    add(flags.geometry(), banner, false);
  }

  // Floating lamps: thousands of little flames drifting on the river, more near the ghats they were set down from, each
  // with its reflection: a streak on the water reaching toward the eye.
  const right = uniform(new THREE.Vector3(1, 0, 0));
  const up = uniform(new THREE.Vector3(0, 1, 0));
  const eye = uniform(new THREE.Vector3());
  {
    const COUNT = Math.round(1.7 * 2 * c.span * c.arc); // ~1,700 per km of river
    const random = mulberry32(31);
    const data = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      const near = random() ** 2;
      data.set([-c.span + random() * 2 * c.span, c.half - GHAT + 3 - near * (2 * c.half - GHAT - 16), random(), 0.55 + random() * 0.35], i * 4);
    }
    const lamp = attribute('iLamp', 'vec4'); // angle, across, phase, size
    const a = mod(lamp.x.add(time.mul(0.00009)).add(c.span), 2 * c.span).sub(c.span);
    const rho = lamp.y.add(c.arc).add(sin(time.mul(0.07).add(lamp.z.mul(6.28))).mul(1.5));
    const [cx, cz] = [cos(a.add(c.beta)).mul(rho).add(ox), sin(a.add(c.beta)).mul(rho).add(oz)];
    const corner = attribute('position', 'vec3').xy; // a 1 × 1 quad's corners (positionLocal is the moved position once positionNode is set)
    const flicker = sin(time.mul(11).add(lamp.z.mul(50))).mul(0.15).add(0.85);
    const flame = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    flame.positionNode = vec3(cx, c.water + 0.05, cz).add(right.mul(corner.x.mul(lamp.w))).add(up.mul(corner.y.add(0.5).mul(lamp.w)));
    flame.colorNode = color(0xffa040).mul(smoothstep(0.5, 0.12, length(corner))).mul(flicker).mul(night.mul(3).add(0.4));
    const streak = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const toEye = normalize(vec2(eye.x.sub(cx), eye.z.sub(cz)));
    const out = corner.y.add(0.5); // 0 at the lamp, 1 toward the eye
    streak.positionNode = vec3(cx.add(toEye.x.mul(out.mul(7))).sub(toEye.y.mul(corner.x.mul(0.6))), c.water + 0.02, cz.add(toEye.y.mul(out.mul(7))).add(toEye.x.mul(corner.x.mul(0.6))));
    streak.colorNode = color(0xff9a3a).mul(out.oneMinus().pow(1.5)).mul(smoothstep(0.5, 0.1, abs(corner.x))).mul(flicker).mul(night.mul(1.4));
    for (const material of [streak, flame]) {
      const g = new THREE.InstancedBufferGeometry();
      const quad = new THREE.PlaneGeometry(1, 1);
      g.setIndex(quad.index);
      g.setAttribute('position', quad.getAttribute('position'));
      g.setAttribute('iLamp', new THREE.InstancedBufferAttribute(data, 4));
      g.instanceCount = COUNT;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(...P(0, c.arc, c.water)), c.arc * c.span + c.half + 10);
      add(g, material, false);
    }
  }

  // Light-forms in the sky: a yantra over the river, a lotus and a wheel either side, each turning slowly about its
  // upright and its layers turning in their plane.
  // The yantra over the river always faces you (turn 0), as in the concepts; the lotus and the wheel turn about.
  const forms: { group: THREE.Group; layers: { mesh: THREE.Mesh; spin: number }[]; turn: number }[] = [];
  for (const [kind, a, rho, height, r, turn] of [[0, 0.18, c.arc, 260, 200, 0], [1, -0.3, c.arc + c.half + 520, 260, 140, -0.05], [2, 0.34, c.arc - c.half - 330, 420, 115, 0.06]]) {
    const g = new THREE.Group();
    const [x, , z] = P(a, rho, 0);
    g.position.set(x, c.level + height, z);
    g.rotation.y = Math.atan2(-(x - ox), -(z - oz)); // facing the city to begin with
    const layers = lightFormLayers(kind, r).map(({ geometry, spin }) => {
      const mesh = new THREE.Mesh(geometry, lightForm);
      mesh.renderOrder = 1; // after the sky
      g.add(mesh);
      return { mesh, spin };
    });
    group.add(g);
    forms.push({ group: g, layers, turn });
  }

  const at = new THREE.Vector3();
  const placed = { x: NaN, z: NaN }; // the origin the body was last moved for: moving it touches every collider
  return {
    /** Follow the floating origin, face the lamps to `camera`, turn the light-forms by `dt`. */
    update(camera: THREE.Camera, dt: number) {
      group.position.set(c.x - origin.x, 0, c.z - origin.z);
      if (placed.x !== origin.x || placed.z !== origin.z) {
        [placed.x, placed.z] = [origin.x, origin.z];
        body.setTranslation({ x: group.position.x, y: 0, z: group.position.z }, false);
      }
      group.visible = Math.hypot(camera.position.x - group.position.x, camera.position.z - group.position.z) < c.ring + 6500;
      if (!group.visible) return;
      camera.updateMatrixWorld();
      right.value.setFromMatrixColumn(camera.matrixWorld, 0);
      up.value.setFromMatrixColumn(camera.matrixWorld, 1);
      eye.value.copy(camera.getWorldPosition(at)).sub(group.position);
      for (const r of runs) r.far.visible = !(r.near.visible = r.middle.distanceTo(eye.value) < 450);
      for (const f of forms) {
        f.group.rotation.y = f.turn ? f.group.rotation.y + dt * f.turn : Math.atan2(eye.value.x - f.group.position.x, eye.value.z - f.group.position.z);
        for (const l of f.layers) l.mesh.rotation.z += dt * l.spin;
      }
    },
    /** Draw everything wherever it is (true), for compiling the shaders behind the landing page; or cull again (false). */
    warm(on: boolean) {
      group.visible = true;
      group.traverse((o) => (o.frustumCulled = !on));
    },
  };
}
