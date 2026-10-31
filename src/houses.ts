// Village houses: plastered walls on a stone plinth under a low terracotta gable roof, windows with shutters that light
// up at night. One shape and one shader for every house; each tile's houses are instances of it (see plants.ts for why
// not InstancedMesh). Each instance stretches the shape to its own size.
import * as THREE from 'three/webgpu';
import { Fn, abs, attribute, color, cos, float, fract, hash, mix, normalLocal, sin, step, vec3, vec4 } from 'three/tsl';
import { night } from './daylight.ts';

const ROOF = 0.27; // ridge height per metre of depth: a low Mediterranean pitch
const EAVE = 0.4; // m the roof overhangs the walls
const PLINTH = 6; // m of stone under the walls, for houses on a slope

/**
 * The shape, as corners: position p and offset k place each one at (p.x·w + k.x, p.y·h + k.y·d + k.w, p.z·d + k.z) for
 * a house w wide, h to the eaves and d deep. `part` is 0 for the plinth, 1 for walls, 2 for the roof. Normals are those
 * of a house of any size: the roof's pitch is the same for all.
 */
function shape() {
  const pos: number[] = [];
  const off: number[] = [];
  const part: number[] = [];
  const nor: number[] = [];
  type Corner = [number[], number[]];
  const corner = ([p, k]: Corner) => [p[0] + k[0], p[1] + k[1] + k[3], p[2] + k[2]]; // on a house 1 × 1 × 1
  const tri = (which: number, ...v: Corner[]) => {
    const [a, b, c] = v.map(corner);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const [p, k] of v) {
      pos.push(...p);
      off.push(...k);
      part.push(which);
      nor.push(n[0] / l, n[1] / l, n[2] / l);
    }
  };
  const quad = (which: number, a: Corner, b: Corner, c: Corner, d: Corner) => {
    tri(which, a, b, c);
    tri(which, a, c, d);
  };
  const none = [0, 0, 0, 0];
  // The four sides of the plinth and the walls, counter-clockwise seen from outside.
  const sides = [[-0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, -0.5], [0.5, -0.5, -0.5, -0.5], [-0.5, -0.5, -0.5, 0.5]];
  for (const [x0, z0, x1, z1] of sides) {
    quad(0, [[x0, 0, z0], [0, 0, 0, -PLINTH]], [[x1, 0, z1], [0, 0, 0, -PLINTH]], [[x1, 0, z1], none], [[x0, 0, z0], none]);
    quad(1, [[x0, 0, z0], none], [[x1, 0, z1], none], [[x1, 1, z1], none], [[x0, 1, z0], none]);
  }
  // Gables at either end, up to the ridge.
  for (const x of [-0.5, 0.5]) tri(1, [[x, 1, 0.5 * Math.sign(x)], none], [[x, 1, -0.5 * Math.sign(x)], none], [[x, 1, 0], [0, ROOF, 0, 0]]);
  // The roof: two slopes from the eaves (overhanging, and lower by the pitch) to the ridge.
  for (const s of [-1, 1]) {
    const eave = (x: number): Corner => [[x, 1, 0.5 * s], [x * 2 * EAVE, 0, s * EAVE, -EAVE * 2 * ROOF]];
    const ridge = (x: number): Corner => [[x, 1, 0], [x * 2 * EAVE, ROOF, 0, 0]];
    if (s > 0) quad(2, eave(-0.5), eave(0.5), ridge(0.5), ridge(-0.5));
    else quad(2, eave(0.5), eave(-0.5), ridge(-0.5), ridge(0.5));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('k', new THREE.Float32BufferAttribute(off, 4));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
const SHAPE = shape();
const ATTRIBUTES = ['position', 'k', 'part', 'normal'];

const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide });
{
  const at = attribute('iAt', 'vec4'); // x, y, z, yaw
  const size = attribute('iSize', 'vec4'); // w, h, d, tint
  const p = attribute('position', 'vec3');
  const k = attribute('k', 'vec4');
  const part = attribute('part', 'float');
  const local = vec3(p.x.mul(size.x).add(k.x), p.y.mul(size.y).add(k.y.mul(size.z)).add(k.w), p.z.mul(size.z).add(k.z));
  const yaw = (v: THREE.Node<'vec3'>) => vec3(v.x.mul(cos(at.w)).add(v.z.mul(sin(at.w))), v.y, v.z.mul(cos(at.w)).sub(v.x.mul(sin(at.w))));
  material.positionNode = Fn(() => {
    normalLocal.assign(yaw(normalLocal));
    return yaw(local).add(at.xyz);
  })();

  // Walls in the plaster of the coast: cream, white, ochre, pale pink, pale yellow; each house its own.
  const tint = size.w;
  const plaster = mix(mix(mix(mix(color(0xe8dcc2), color(0xf0ece4), step(0.3, tint)), color(0xd8b27e), step(0.52, tint)), color(0xe6c3ac), step(0.72, tint)), color(0xeedfa8), step(0.88, tint));
  // Windows: one every 2.6 m along each wall, a floor every 3 m, with shutters; none on the gables or the plinth.
  const n = attribute('normal', 'vec3');
  const along = mix(local.x, local.z, step(0.5, abs(n.x)));
  const across = fract(along.div(2.6).add(0.5)).sub(0.5).abs();
  const up = fract(local.y.div(3)).sub(0.55).abs();
  const wall = step(0.5, part).mul(step(part, 1.5)).mul(step(local.y, size.y.sub(0.7))).mul(step(0.6, local.y));
  const pane = wall.mul(step(across, 0.17)).mul(step(up, 0.22));
  const shutter = wall.mul(step(across, 0.3)).mul(step(up, 0.22)).sub(pane);
  const shutters = mix(color(0x4f6b55), color(0x3f5f78), step(0.5, fract(tint.mul(7))));
  const lit = step(0.55, hash(local.y.div(3).floor().mul(31).add(along.div(2.6).floor().mul(7)).add(tint.mul(9973)))); // some rooms are lit
  const roof = color(0xb3603a).mul(fract(tint.mul(13)).mul(0.25).add(0.85));
  const body = mix(mix(color(0xb3a68e), plaster, step(0.5, part)), roof, step(1.5, part));
  material.colorNode = vec4(mix(mix(body, shutters, shutter), color(0x1d1f22), pane), 1);
  material.roughnessNode = mix(float(0.9), float(0.3), pane);
  material.emissiveNode = color(0xffc77a).mul(pane.mul(lit).mul(night.mul(2.2)));
}

/** One mesh for a tile's houses: records of x, y, z (from the tile centre; y the ground at its uphill side), yaw, w, h, d, tint. */
export function houseMesh(records: Float32Array): THREE.Mesh {
  const count = records.length / 8;
  const at = new Float32Array(count * 4);
  const size = new Float32Array(count * 4);
  let reach = 0;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < count; i++) {
    const [x, y, z, yaw, w, h, d, tint] = records.subarray(i * 8, i * 8 + 8);
    at.set([x, y, z, yaw], i * 4);
    size.set([w, h, d, tint], i * 4);
    reach = Math.max(reach, Math.hypot(x, z) + Math.hypot(w, d) / 2 + EAVE);
    low = Math.min(low, y - PLINTH);
    high = Math.max(high, y + h + d * ROOF);
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

/** Free a mesh from houseMesh: its instance buffers, not the shape it shares. */
export function disposeHouses(mesh: THREE.Mesh) {
  for (const name of ATTRIBUTES) mesh.geometry.deleteAttribute(name);
  mesh.geometry.dispose();
}
