// Trees, pines, bushes and rocks: one merged, vertex-coloured shape per kind, instanced per chunk.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUSH, PINE, ROCK, TREE } from './world/chunk.ts';

/** A primitive moved into place and painted one colour, ready to merge. */
function piece(g: THREE.BufferGeometry, hex: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const out = (g.index ? g.toNonIndexed() : g).scale(sx, sy, sz).translate(x, y, z);
  const c = new THREE.Color(hex);
  const colours = new Float32Array(out.attributes.position.count * 3);
  for (let i = 0; i < colours.length; i += 3) colours.set([c.r, c.g, c.b], i);
  out.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return out;
}

const BARK = 0x5a4030;
const shapes: Record<number, THREE.BufferGeometry> = {
  [TREE]: mergeGeometries([
    piece(new THREE.CylinderGeometry(0.18, 0.28, 3.2, 7), BARK, 0, 1.6, 0),
    piece(new THREE.IcosahedronGeometry(2.4, 1), 0x3f6b2a, 0, 4.2, 0, 1, 0.85, 1),
    piece(new THREE.IcosahedronGeometry(1.6, 1), 0x4a7a31, 0.9, 5.1, 0.4),
  ]),
  [PINE]: mergeGeometries([
    piece(new THREE.CylinderGeometry(0.15, 0.25, 2.2, 6), BARK, 0, 1.1, 0),
    piece(new THREE.ConeGeometry(2, 4, 8), 0x2e4f2b, 0, 3.6, 0),
    piece(new THREE.ConeGeometry(1.5, 3.2, 8), 0x335a2f, 0, 5.6, 0),
    piece(new THREE.ConeGeometry(0.9, 2.2, 8), 0x3a6334, 0, 7.2, 0),
  ]),
  [BUSH]: piece(new THREE.IcosahedronGeometry(1.1, 1), 0x4d6b30, 0, 0.5, 0, 1.2, 0.7, 1.2),
  [ROCK]: piece(new THREE.DodecahedronGeometry(1, 0), 0x8a857c, 0, 0.3, 0, 1.3, 0.8, 1),
};
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

/** Collider for a plant of `kind` at scale s: trunks are cylinders, rocks balls; bushes have none. */
export function plantCollider(kind: number, s: number): { shape: 'cylinder' | 'ball'; size: number; lift: number } | null {
  if (kind === TREE || kind === PINE) return { shape: 'cylinder', size: 0.3 * s, lift: 2 * s };
  if (kind === ROCK) return { shape: 'ball', size: 0.9 * s, lift: 0.3 * s };
  return null;
}

/** Instanced meshes for a chunk's plant records (x, y, z, scale, yaw, kind). */
export function plantMeshes(records: Float32Array): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tint = new THREE.Color();
  for (const kind of [TREE, PINE, BUSH, ROCK]) {
    let count = 0;
    for (let i = 5; i < records.length; i += 6) if (records[i] === kind) count++;
    if (count === 0) continue;
    const mesh = new THREE.InstancedMesh(shapes[kind], material, count);
    let n = 0;
    for (let i = 0; i < records.length; i += 6) {
      if (records[i + 5] !== kind) continue;
      const scale = records[i + 3];
      m.compose(p.set(records[i], records[i + 1], records[i + 2]), q.setFromAxisAngle(up, records[i + 4]), s.setScalar(scale));
      mesh.setMatrixAt(n, m);
      // a little variety: lighter and darker, a touch warmer or cooler
      const shade = 0.85 + ((records[i + 4] * 7) % 1) * 0.3;
      mesh.setColorAt(n++, tint.setRGB(shade * 1.03, shade, shade * 0.95));
    }
    mesh.castShadow = kind !== BUSH;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return meshes;
}
