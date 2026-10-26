// The car you drive: a small classic roadster after the art-bible cars, built from an extruded side profile.
// Sized to the physics body (physics.ts): 4.2 m long, wheels of 0.34 m at x ±0.8, z +1.35 and -1.3; the body origin
// rides about 0.8 m above the road. +z is forward.
import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { night } from './daylight.ts';

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

  // The body: the profile extruded across the car, with rounded edges.
  const shape = new THREE.Shape(PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
  const width = 1.48;
  const body = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 6 });
  body.rotateY(-Math.PI / 2).translate(width / 2, 0, 0); // profile z → car z, extrusion → across the car
  body.computeVertexNormals();
  add(body, paint, 0, 0, 0);

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
  const wheels = Array.from({ length: 4 }, () => {
    const w = new THREE.Group();
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
