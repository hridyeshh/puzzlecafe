// The car you drive: one from the garage (models made in Figma Weave from the art-bible cars), or, if that cannot load,
// a small classic roadster built from an extruded side profile. Sized to the physics body (physics.ts): wheels of
// 0.34 m at x ±0.8, z +1.35 and -1.3; the body origin rides about 0.8 m above the road. +z is forward.
import * as THREE from 'three/webgpu';
import { color, max, mix, smoothstep, texture, uv, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { night } from './daylight.ts';
import { type Car, HARDPOINTS } from './physics.ts';

/** Paints from the concept art: champagne (golden hour), racing green (midday), silver (blue hour), and red. */
export const PAINTS = { champagne: 0xcdbf9f, green: 0x1f4a3a, silver: 0xb9bcc0, red: 0xa8342a };

// The side silhouette (z forward, y up), wheel arches included; the extrusion's bevel adds 0.1 m all round.
const PROFILE: [number, number][] = [
  [-1.92, -0.48], // rear bumper, bottom
  [-1.72, -0.48],
  ...arch(-1.3),
  [0.93, -0.48],
  ...arch(1.35),
  [1.95, -0.48], // front, bottom
  [2.0, -0.36],
  [1.93, -0.22], // the nose
  [1.6, -0.12],
  [1.0, -0.06], // the bonnet
  [0.45, -0.02],
  [-0.8, -0.02], // the doors' top edge; the cockpit sits in here
  [-1.55, 0.02], // the boot
  [-1.85, -0.04],
  [-1.96, -0.2],
];

/** A wheel arch over the wheel at z: a half circle a little above the wheel's centre. */
function arch(z: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i / 8) * Math.PI;
    out.push([z + Math.cos(a) * 0.36, -0.42 + Math.sin(a) * 0.36]);
  }
  return out;
}

/** The roadster's body: its side profile extruded across the car, with rounded edges. */
export function bodyGeometry(width = 1.48) {
  const shape = new THREE.Shape(PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 6 });
  body.rotateY(-Math.PI / 2).translate(width / 2, 0, 0); // profile z → car z, extrusion → across the car
  body.computeVertexNormals();
  return body;
}

/** Each wheel model to its physics wheel: up and down on the springs, steering, rolling. */
export function turnWheels(wheels: THREE.Object3D[], vehicle: Car['vehicle']) {
  for (let i = 0; i < wheels.length; i++) {
    const hardpoint = vehicle.wheelChassisConnectionPointCs(i);
    if (!hardpoint) continue;
    wheels[i].position.y = hardpoint.y - (vehicle.wheelSuspensionLength(i) ?? 0) + (wheels[i].userData.drop ?? 0); // across and along: the model's own axles
    wheels[i].rotation.y = vehicle.wheelSteering(i) ?? 0;
    wheels[i].rotation.x = vehicle.wheelRotation(i) ?? 0;
  }
}

export function createCarModel(paintName: keyof typeof PAINTS = 'champagne') {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: PAINTS[paintName], roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a201b, roughness: 0.75 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.18, metalness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, tilt = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.x = tilt;
    m.castShadow = true;
    group.add(m);
    return m;
  };

  add(bodyGeometry(), paint, 0, 0, 0);

  // The cockpit: a dark tub between the doors, two seats with headrests, a windscreen in its frame, mirrors.
  add(new THREE.BoxGeometry(1.4, 0.06, 1.15), black, 0, 0.1, -0.2);
  for (const x of [-0.36, 0.36]) {
    add(new THREE.BoxGeometry(0.5, 0.42, 0.14), leather, x, 0.3, -0.62, -0.18);
    add(new THREE.BoxGeometry(0.3, 0.2, 0.12), leather, x, 0.56, -0.68, -0.18);
  }
  add(new THREE.TorusGeometry(0.17, 0.02, 6, 16), black, 0.36, 0.32, 0.18, -1.1); // steering wheel
  add(new THREE.PlaneGeometry(1.36, 0.5), glass, 0, 0.3, 0.36, -1.0);
  add(new THREE.BoxGeometry(1.42, 0.04, 0.04), black, 0, 0.53, 0.25);
  for (const x of [-0.7, 0.7]) {
    add(new THREE.BoxGeometry(0.04, 0.52, 0.04), black, x, 0.3, 0.36, -1.0);
    add(new THREE.BoxGeometry(0.14, 0.09, 0.05), paint, x * 1.22, 0.14, 0.42);
  }

  // Lamps (they glow with the night), bumpers, the number plate, the exhaust.
  const tail = new THREE.MeshStandardNodeMaterial({ color: 0x3a0c08, roughness: 0.3 });
  tail.emissiveNode = color(0xff2a14).mul(night.mul(3).add(0.15));
  const head = new THREE.MeshStandardNodeMaterial({ color: 0x2a2a2a, roughness: 0.3 });
  head.emissiveNode = color(0xfff3dd).mul(night.mul(6).add(0.05));
  const amber = new THREE.MeshStandardNodeMaterial({ color: 0x5a3208, roughness: 0.3 });
  amber.emissiveNode = color(0xff9a2a).mul(0.25);
  for (const x of [-0.56, 0.56]) {
    add(new THREE.BoxGeometry(0.36, 0.11, 0.05), tail, x, -0.17, -2.07);
    add(new THREE.BoxGeometry(0.3, 0.07, 0.05), head, x, -0.27, 2.06);
    add(new THREE.BoxGeometry(0.12, 0.06, 0.05), amber, x * 1.25, -0.37, 2.05);
  }
  add(new THREE.BoxGeometry(1.6, 0.1, 0.1), black, 0, -0.5, -2.02);
  add(new THREE.BoxGeometry(1.5, 0.1, 0.1), black, 0, -0.5, 2.03);
  add(new THREE.BoxGeometry(0.42, 0.13, 0.02), new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.5 }), 0, -0.33, -2.1);
  const pipe = add(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10), chrome, -0.45, -0.55, -2.04, Math.PI / 2);
  pipe.castShadow = false;

  // Wheels: tyre, rim and hub, each a group the game turns (steer about y, roll about x).
  const tyre = new THREE.CylinderGeometry(0.34, 0.34, 0.21, 24).rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.22, 0.22, 0.215, 16).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.23, 8).rotateZ(Math.PI / 2);
  const wheels = HARDPOINTS.map((p) => {
    const w = new THREE.Group();
    w.position.set(p.x, 0, p.z);
    w.rotation.order = 'YXZ'; // spin about the axle, then steer
    for (const [g, m] of [[tyre, black], [rim, chrome], [hub, black]] as const) {
      const part = new THREE.Mesh(g, m);
      part.castShadow = true;
      w.add(part);
    }
    group.add(w);
    return w;
  });

  // The headlight beam: one spotlight between the lamps.
  const beam = new THREE.SpotLight(0xfff1d6, 0, 90, 0.55, 0.5, 1.3);
  beam.position.set(0, 0.0, 2.2);
  beam.target.position.set(0, -0.6, 20);
  group.add(beam, beam.target);
  return { group, wheels, beam };
}

/**
 * The garage: cars made by image to 3D (Tripo in Figma Weave, or TRELLIS.2) from studio shots, shown at their real
 * length. Their own wheels, measured once in each file's frame (up +y; the nose +x from Tripo, +z from TRELLIS, `nose`):
 * the axles along the car, the radius (front and rear, if they differ), the ground's y and the tyres' span across.
 * Masters and the processing script are in art-src/cars/.
 */
interface Spec {
  name: string;
  length: number;
  nose?: 'x' | 'z';
  front: number;
  rear: number;
  radius: number | readonly [number, number];
  ground: number;
  tyre: readonly [number, number];
}
export const GARAGE = {
  coupe: { name: 'Coupé', length: 4.16, front: 1.056, rear: -0.881, radius: 0.305, ground: -0.651, tyre: [0.56, 0.82] },
  roadster: { name: 'Roadster', length: 3.97, front: 0.986, rear: -0.944, radius: 0.279, ground: -0.6, tyre: [0.6, 0.81] },
  interceptor: { name: 'Interceptor', length: 5.4, nose: 'z', front: 0.279, rear: -0.336, radius: [0.076, 0.087], ground: -0.141, tyre: [0.17, 0.22] },
  armoured: { name: 'Armoured', length: 4.6, nose: 'z', front: 0.333, rear: -0.288, radius: 0.105, ground: -0.19, tyre: [0.12, 0.27] },
} as const satisfies Record<string, Spec>;
export type CarName = keyof typeof GARAGE;

const WHEEL_Y = -0.46; // m: wheel centres below the body origin with the car at rest on its springs

/** A garage car, its four wheels cut out of the model so they turn (physics order: front left, front right, rear left, rear right). */
export async function loadCar(name: CarName) {
  const spec: Spec = GARAGE[name];
  const gltf = await new GLTFLoader().loadAsync(`/cars/${name}.glb`);
  const source = gltf.scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
  source.updateWorldMatrix(true, false);
  let geometry = source.geometry.applyMatrix4(source.matrixWorld); // the file's frame, sized by the model's guess
  if (spec.nose !== 'z') geometry.rotateY(-Math.PI / 2); // the nose to +z
  else {
    // TRELLIS models have no normal map and faceted normals: smooth them (UV seams stay split).
    geometry.deleteAttribute('normal');
    geometry = mergeVertices(geometry);
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  // To real size, the bigger wheels' centres at WHEEL_Y, its wheelbase centred on the physics one.
  const k = spec.length / (geometry.boundingBox!.max.z - geometry.boundingBox!.min.z);
  const front = spec.front * k;
  const rear = spec.rear * k;
  const [rf, rr] = typeof spec.radius === 'number' ? [spec.radius, spec.radius] : spec.radius;
  const big = Math.max(rf, rr);
  const shift = (HARDPOINTS[0].z + HARDPOINTS[2].z) / 2 - (front + rear) / 2;
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(0, WHEEL_Y - (spec.ground + big) * k, shift).multiply(new THREE.Matrix4().makeScale(k, k, k)));
  const [inner, outer] = [spec.tyre[0] * k, spec.tyre[1] * k];
  // Each wheel: side (+x is the car's left), place along, radius, and its centre's height (smaller wheels sit lower).
  const axles = [[1, front + shift, rf], [-1, front + shift, rf], [1, rear + shift, rr], [-1, rear + shift, rr]].map(([side, z, r]) => [side, z, r * k, WHEEL_Y - (big - r) * k]);

  // Each triangle goes to the wheel whose tyre it lies in (by its centre), or stays with the body.
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const parts: number[][] = [[], [], [], [], []]; // four wheels, then the body
  for (let t = 0; t < index.count; t += 3) {
    const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const w = Math.abs(x) > inner - 0.03 && Math.abs(x) < outer + 0.03 ? axles.findIndex(([side, az, r, ay]) => Math.sign(x) === side && Math.hypot(y - ay, z - az) < r + 0.03) : -1;
    parts[w < 0 ? 4 : w].push(a, b, c);
  }
  const part = (i: number) => {
    const g = new THREE.BufferGeometry();
    for (const [key, attribute] of Object.entries(geometry.attributes)) g.setAttribute(key, attribute);
    g.setIndex(parts[i]);
    return g;
  };

  // The model's own paint, and its red and amber lamps (red well above green and blue) glow at night.
  // ponytail: lamps found by colour; a red car would glow all over, so give it lamp positions then.
  const loaded = source.material as THREE.MeshStandardMaterial;
  // A TRELLIS model's roughness and metal maps are noisy, which streaks its reflections: an even gloss instead.
  const even = spec.nose === 'z';
  const paint = new THREE.MeshStandardNodeMaterial({
    map: loaded.map,
    normalMap: loaded.normalMap,
    metalnessMap: even ? null : loaded.metalnessMap,
    roughnessMap: even ? null : loaded.roughnessMap,
    metalness: even ? 0.45 : loaded.metalness,
    roughness: even ? 0.32 : loaded.roughness,
  });
  const lamp = texture(loaded.map!);
  paint.emissiveNode = lamp.rgb.mul(smoothstep(0.2, 0.45, lamp.r.sub(max(lamp.g, lamp.b)))).mul(night.mul(4).add(0.05));

  const group = new THREE.Group();
  const body = new THREE.Mesh(part(4), paint);
  body.castShadow = true;
  group.add(body);
  const wheels = axles.map(([side, z, , y], i) => {
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ'; // spin about the axle, then steer
    pivot.position.set((side * (inner + outer)) / 2, y, z);
    pivot.userData.drop = y - WHEEL_Y; // turnWheels keeps a smaller wheel this far below the physics wheel's centre
    const mesh = new THREE.Mesh(part(i), paint);
    mesh.position.copy(pivot.position).negate(); // the triangles stay where they were; the pivot turns them about the axle
    mesh.castShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  });
  const beam = new THREE.SpotLight(0xfff1d6, 0, 90, 0.55, 0.5, 1.3);
  beam.position.set(0, WHEEL_Y + 0.35, geometry.boundingBox!.max.z); // the box was remeasured in metres: the nose
  beam.target.position.set(0, -0.6, 20);
  group.add(beam, beam.target);
  return { group, wheels, beam };
}

// Nitro: two blue flames out of the tail, white-hot at the pipe; bright enough to bloom.
const flame = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
flame.colorNode = mix(vec3(0.75, 0.88, 1), vec3(0.1, 0.3, 1), smoothstep(0, 0.45, uv().y)).mul(3);
flame.opacityNode = uv().y.oneMinus();

/** Nitro flames for a car model whose tail is at z = `back` (its local frame); main.ts shows and flickers them. */
export function createFlames(back: number) {
  const group = new THREE.Group();
  const cone = new THREE.ConeGeometry(0.13, 1.1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.55); // tip toward -z
  for (const x of [-0.38, 0.38]) {
    const m = new THREE.Mesh(cone, flame);
    m.position.set(x, -0.42, back);
    group.add(m);
  }
  group.visible = false;
  return group;
}
