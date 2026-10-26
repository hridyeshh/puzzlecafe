// Trees, pines, cypresses, olives, bushes and rocks: one merged, faceted, vertex-coloured shape per kind, instanced per
// chunk, swaying a little in the wind.
import * as THREE from 'three/webgpu';
import { Fn, attribute, fract, mix, normalLocal, positionLocal, sin, time, vec3, vec4 } from 'three/tsl';
import { autumn, winter } from './weather.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BROOM, BUSH, CACTUS, CYPRESS, GRASS, LAVENDER, OLIVE, PINE, ROCK, TREE } from './world/chunk.ts';

/**
 * A primitive turned (`tilt`, about z), scaled and moved into place, then painted, ready to merge. `lumpy` pushes its
 * vertices in and out for an organic outline; it darkens toward its base, a cheap ambient occlusion. Faces stay flat.
 * `leafy` parts turn with the seasons.
 */
function piece(g: THREE.BufferGeometry, hex: number, x: number, y: number, z: number, scale = [1, 1, 1], lumpy = 0, tilt = 0, leafy = 0) {
  const out = (g.index ? g.toNonIndexed() : g).scale(scale[0], scale[1], scale[2]).rotateZ(tilt).translate(x, y, z);
  const p = out.getAttribute('position');
  out.computeBoundingBox();
  const { min, max } = out.boundingBox!;
  const c = new THREE.Color(hex);
  const colours = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const [px, py, pz] = [p.getX(i), p.getY(i), p.getZ(i)];
    const k = 1 + lumpy * Math.sin(px * 2.9 + py * 1.7) * Math.cos(pz * 2.3 - py * 2.1); // same point, same push: no cracks
    p.setXYZ(i, x + (px - x) * k, y + (py - y) * k, z + (pz - z) * k);
    const shade = 0.6 + (0.4 * (py - min.y)) / (max.y - min.y || 1);
    colours.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
  }
  out.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  out.setAttribute('leafy', new THREE.BufferAttribute(new Float32Array(p.count).fill(leafy), 1));
  out.computeVertexNormals();
  return out;
}
const blob = (r: number) => new THREE.IcosahedronGeometry(r, 1);

/** A tuft of grass: thin blades leaning out, each drawn from both sides, dark at the root and golden at the tip. */
function tuft(blades: number, height: number, root: number, tip: number) {
  const pos: number[] = [];
  const col: number[] = [];
  const [cr, ct] = [new THREE.Color(root), new THREE.Color(tip)];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + (b % 3) * 0.7;
    const [ox, oz] = [Math.cos(a) * 0.06, Math.sin(a) * 0.06];
    const [wx, wz] = [-Math.sin(a) * 0.035, Math.cos(a) * 0.035]; // half the blade's width
    const tall = height * (0.75 + ((b * 37) % 10) / 40);
    const tri = [[ox - wx, 0, oz - wz], [ox + wx, 0, oz + wz], [ox + Math.cos(a) * 0.35 * tall, tall, oz + Math.sin(a) * 0.35 * tall]];
    for (const order of [[0, 1, 2], [1, 0, 2]]) {
      for (const i of order) {
        pos.push(...tri[i]);
        const c = i === 2 ? ct : cr;
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('leafy', new THREE.BufferAttribute(new Float32Array(pos.length / 3).fill(1), 1));
  g.computeVertexNormals();
  return g;
}

/** `count` small pieces scattered over a dome of radius r at height y, for flower heads. */
const dotted = (count: number, r: number, y: number, make: () => THREE.BufferGeometry, hex: number) =>
  Array.from({ length: count }, (_, i) => {
    const a = i * 2.39996; // golden angle
    const d = r * Math.sqrt((i + 0.5) / count);
    return piece(make(), hex, Math.cos(a) * d, y + (1 - d / r) * 0.12, Math.sin(a) * d);
  });

const BARK = 0x5a4030;
const OLIVE_BARK = 0x6b5a48;
const CYPRESS_PROFILE = [[0, 0], [0.5, 0.25], [0.8, 1.5], [0.9, 3.2], [0.8, 5.5], [0.55, 8], [0.25, 10], [0, 11]];
const shapes: Record<number, THREE.BufferGeometry> = {
  [TREE]: mergeGeometries([
    piece(new THREE.CylinderGeometry(0.18, 0.3, 3.4, 6), BARK, 0, 1.7, 0),
    piece(blob(2.3), 0x3f6b2a, 0, 4.4, 0, [1, 0.85, 1], 0.12, 0, 1),
    piece(blob(1.6), 0x4a7a31, 1.1, 5.2, 0.5, [1, 1, 1], 0.14, 0, 1),
    piece(blob(1.4), 0x456f2c, -1, 5, -0.6, [1, 1, 1], 0.14, 0, 1),
  ]),
  [PINE]: mergeGeometries([
    piece(new THREE.CylinderGeometry(0.15, 0.25, 2.2, 6), BARK, 0, 1.1, 0),
    piece(new THREE.ConeGeometry(2, 4, 8), 0x2e4f2b, 0, 3.6, 0, [1, 1, 1], 0.06),
    piece(new THREE.ConeGeometry(1.5, 3.2, 8), 0x335a2f, 0, 5.6, 0, [1, 1, 1], 0.06),
    piece(new THREE.ConeGeometry(0.9, 2.2, 8), 0x3a6334, 0, 7.2, 0, [1, 1, 1], 0.06),
  ]),
  // Tall dark flames, the coast's signature.
  [CYPRESS]: mergeGeometries([
    piece(new THREE.CylinderGeometry(0.12, 0.2, 1.2, 5), BARK, 0, 0.6, 0),
    piece(new THREE.LatheGeometry(CYPRESS_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)), 8), 0x2c4526, 0, 0.5, 0, [1, 1, 1], 0.08),
  ]),
  // A short forked trunk under a loose, silvery canopy.
  [OLIVE]: mergeGeometries([
    piece(new THREE.CylinderGeometry(0.14, 0.28, 2.2, 6), OLIVE_BARK, 0.15, 1.1, 0, [1, 1, 1], 0, 0.22),
    piece(new THREE.CylinderGeometry(0.08, 0.15, 1.7, 5), OLIVE_BARK, -0.25, 2.3, 0.1, [1, 1, 1], 0, -0.5),
    piece(blob(1.3), 0x7d8c5c, 0.6, 3.2, 0.2, [1, 0.75, 1], 0.16),
    piece(blob(1.1), 0x6f7f52, -0.8, 3, -0.4, [1, 0.75, 1], 0.16),
    piece(blob(1.2), 0x86935f, 0.1, 3.7, -0.7, [1, 0.75, 1], 0.16),
    piece(blob(1), 0x7d8c5c, -0.3, 3.5, 0.9, [1, 0.75, 1], 0.16),
    piece(blob(0.9), 0x6f7f52, 1.2, 2.8, -0.6, [1, 0.75, 1], 0.16),
  ]),
  // Scrub: a few olive and yellow-green clumps.
  [BUSH]: mergeGeometries([
    piece(blob(0.95), 0x56693a, 0, 0.45, 0, [1.2, 0.7, 1.2], 0.15, 0, 1),
    piece(blob(0.7), 0x6b7a3a, 0.8, 0.35, 0.3, [1, 0.75, 1], 0.15, 0, 1),
    piece(blob(0.6), 0x7c7f41, -0.6, 0.3, -0.5, [1, 0.8, 1], 0.15, 0, 1),
  ]),
  // Ground cover by the road: dry grass, yellow broom, lavender.
  [GRASS]: tuft(9, 0.6, 0x5d6b2c, 0xc2ad5c),
  [BROOM]: mergeGeometries([
    piece(blob(0.45), 0x5e7034, 0, 0.3, 0, [1.1, 0.75, 1.1], 0.15, 0, 1),
    ...dotted(14, 0.42, 0.5, () => new THREE.IcosahedronGeometry(0.07, 0), 0xe8c22a),
  ]),
  [LAVENDER]: mergeGeometries([
    piece(blob(0.32), 0x7d8a6a, 0, 0.2, 0, [1.1, 0.7, 1.1], 0.12),
    ...dotted(11, 0.3, 0.42, () => new THREE.ConeGeometry(0.035, 0.3, 4), 0x8a6bc4),
  ]),
  // A saguaro: a ribbed column with two arms.
  [CACTUS]: mergeGeometries([
    piece(new THREE.CylinderGeometry(0.28, 0.32, 4.2, 8), 0x4f7a3a, 0, 2.1, 0),
    piece(new THREE.SphereGeometry(0.28, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x5b8744, 0, 4.2, 0),
    piece(new THREE.CylinderGeometry(0.18, 0.2, 0.9, 7), 0x4f7a3a, 0.55, 2.2, 0, [1, 1, 1], 0, Math.PI / 2),
    piece(new THREE.CylinderGeometry(0.18, 0.2, 1.4, 7), 0x5b8744, 0.95, 2.85, 0),
    piece(new THREE.CylinderGeometry(0.16, 0.18, 0.7, 7), 0x4f7a3a, -0.45, 2.9, 0, [1, 1, 1], 0, Math.PI / 2),
    piece(new THREE.CylinderGeometry(0.16, 0.18, 1.1, 7), 0x5b8744, -0.75, 3.4, 0),
  ]),
  // Pale limestone.
  [ROCK]: mergeGeometries([
    piece(new THREE.DodecahedronGeometry(1, 0), 0xb3a891, 0, 0.3, 0, [1.3, 0.8, 1], 0.12),
    piece(new THREE.DodecahedronGeometry(0.55, 0), 0xa59a84, 1.1, 0.1, 0.4, [1, 0.8, 1.1], 0.12),
  ]),
};
// Instances are placed by per-instance attributes rather than InstancedMesh: three.js builds shaders once per
// InstancedMesh (its cache key holds the object's uuid), which stalled every new chunk for ~50 ms. These all share one.
const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 });
{
  const at = attribute('iAt', 'vec4'); // x, y, z, scale
  const turn = attribute('iTurn', 'vec3'); // cos and sin of the yaw, shade
  const yaw = (v: THREE.Node<'vec3'>) => vec3(v.x.mul(turn.x).add(v.z.mul(turn.y)), v.y, v.z.mul(turn.x).sub(v.x.mul(turn.y)));
  material.positionNode = Fn(() => {
    normalLocal.assign(yaw(normalLocal));
    // Wind: tops sway more than trunks (with height squared), each plant in its own time.
    const up = positionLocal.y.mul(0.1);
    const sway = sin(time.mul(1.7).add(at.x.mul(0.37)).add(at.z.mul(0.21))).mul(up.mul(up)).mul(0.1);
    return yaw(positionLocal).add(vec3(sway, 0, sway.mul(0.6))).mul(at.w).add(at.xyz);
  })();
  // A little variety (lighter and darker, warmer or cooler), and the seasons on leafy parts: orange to red in autumn,
  // each plant its own, and a dull brown in winter.
  const shade = vec3(turn.z.mul(1.03), turn.z, turn.z.mul(0.95));
  const leafy = attribute('leafy', 'float');
  const fall = mix(vec3(1), vec3(1.9, mix(0.55, 1.05, fract(turn.z.mul(7.3))), 0.3), autumn.mul(leafy));
  const bare = mix(vec3(1), vec3(1.05, 0.85, 0.62), winter.mul(leafy).mul(0.8));
  material.colorNode = vec4(shade.mul(fall).mul(bare), 1);
}
const SHAPE = ['position', 'normal', 'color', 'leafy'];

/** Collider for a plant of `kind` at scale s: trunks are cylinders, rocks balls; bushes have none. */
export function plantCollider(kind: number, s: number): { shape: 'cylinder' | 'ball'; size: number; lift: number } | null {
  if (kind === TREE || kind === PINE || kind === CYPRESS || kind === OLIVE || kind === CACTUS) return { shape: 'cylinder', size: 0.3 * s, lift: 2 * s };
  if (kind === ROCK) return { shape: 'ball', size: 0.9 * s, lift: 0.3 * s };
  return null;
}

/** Instanced meshes for a chunk's plant records (x, y, z, scale, yaw, kind), one per kind present. */
export function plantMeshes(records: Float32Array): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const kind of [TREE, PINE, CYPRESS, OLIVE, BUSH, ROCK, CACTUS, GRASS, BROOM, LAVENDER]) {
    let count = 0;
    for (let i = 5; i < records.length; i += 6) if (records[i] === kind) count++;
    if (count === 0) continue;
    const at = new Float32Array(count * 4);
    const turn = new Float32Array(count * 3);
    let n = 0;
    let reach = 0;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < records.length; i += 6) {
      if (records[i + 5] !== kind) continue;
      const [x, y, z, scale, yaw] = records.subarray(i, i + 5);
      at.set([x, y, z, scale], n * 4);
      turn.set([Math.cos(yaw), Math.sin(yaw), 0.85 + ((yaw * 7) % 1) * 0.3], n * 3);
      reach = Math.max(reach, Math.hypot(x, z));
      low = Math.min(low, y);
      high = Math.max(high, y);
      n++;
    }
    const geometry = new THREE.InstancedBufferGeometry();
    for (const name of SHAPE) geometry.setAttribute(name, shapes[kind].getAttribute(name));
    geometry.setAttribute('iAt', new THREE.InstancedBufferAttribute(at, 4));
    geometry.setAttribute('iTurn', new THREE.InstancedBufferAttribute(turn, 3));
    geometry.instanceCount = count;
    // The shape sits at the origin, so the bounds come from the instances: within `reach` of the chunk centre, up to
    // 16 m tall (a big cypress).
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (low + high + 16) / 2, 0), Math.hypot(reach + 4, (high - low + 16) / 2));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = kind !== BUSH && kind !== GRASS && kind !== BROOM && kind !== LAVENDER; // scrub and ground cover: many, small, costly
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}

/** Free a mesh from plantMeshes: its instance buffers, not the shape it shares. */
export function disposePlants(mesh: THREE.Mesh) {
  for (const name of SHAPE) mesh.geometry.deleteAttribute(name);
  mesh.geometry.dispose();
}
