// The chase as drawn: police cars and the helicopter with its searchlight. Each police car is one of the garage's cars
// at random, in its own paint with a red and blue light bar on its roof; until those load (when chase mode first goes
// on) a stand-in: the roadster's body in black and white with a hardtop. Everything is built once and cloned, so a new
// police car compiles nothing. Lamps and light bars glow (and bloom at night); only the searchlight is a real light,
// made at load, because adding a light later would recompile every lit material.
import * as THREE from 'three/webgpu';
import { fract, mix, normalView, smoothstep, step, time, uv, vec3, vertexColor } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type CarName, GARAGE, bodyGeometry, loadCar, turnWheels } from './car.ts';
import { type Chase, MAX_UNITS, type Unit } from './chase.ts';
import { night } from './daylight.ts';
import { HARDPOINTS } from './physics.ts';
import { canvasTexture } from './props.ts';

const livery = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 });
// Lamps: their vertex colour, glowing more at night. Light bars: red and blue taking turns, ~2.4 times a second.
const lamps = new THREE.MeshStandardNodeMaterial({ color: 0x222222, roughness: 0.3 });
lamps.emissiveNode = vertexColor().mul(night.mul(4).add(0.1));
const bars = new THREE.MeshStandardNodeMaterial({ color: 0x222222, roughness: 0.3 });
{
  const red = step(0.5, fract(time.mul(2.4)));
  const blue = step(vertexColor().r, vertexColor().b); // a blue lens
  bars.emissiveNode = vertexColor().mul(mix(red, red.oneMinus(), blue)).mul(night.mul(1.5).add(1.5));
}
const decal = new THREE.MeshStandardMaterial({
  roughness: 0.35,
  map: canvasTexture(512, 104, (g) => {
    g.fillStyle = '#f2f2ee';
    g.fillRect(0, 0, 512, 104);
    g.fillStyle = '#111317';
    g.font = '800 76px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('POLICE', 256, 56);
  }),
});

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Parts merged into one geometry, each in its colour (sRGB hex) as vertex colours. */
function painted(parts: [THREE.BufferGeometry, number][]) {
  return mergeGeometries(
    parts.map(([g, hex]) => {
      const flat = g.index ? g.toNonIndexed() : g;
      const c = new THREE.Color(hex);
      const n = flat.getAttribute('position').count;
      const rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
      flat.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      return flat;
    }),
  )!;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, shadow = true) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  return m;
}

const BLACK = 0x111317;
const WHITE = 0xf2f2ee;
const GLASS = 0x0d1218;
const TRIM = 0x18191c;

/** A police car, +z forward, sized like the player's (its wheels at the physics hardpoints). */
function policeCar() {
  const group = new THREE.Group();
  // A hardtop over the cockpit: the glass house, its roof, and the light bar on it.
  const house = new THREE.Shape([[-1.0, 0.06], [0.5, 0.06], [0.1, 0.5], [-0.85, 0.5]].map(([z, y]) => new THREE.Vector2(z, y)));
  const glass = new THREE.ExtrudeGeometry(house, { depth: 1.32, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.66, 0, 0);
  group.add(
    mesh(
      painted([
        [bodyGeometry(), BLACK],
        [glass, GLASS],
        [box(1.36, 0.05, 0.98, 0, 0.525, -0.375), WHITE],
        [box(1.12, 0.06, 0.26, 0, 0.58, -0.35), TRIM],
        [box(1.6, 0.1, 0.1, 0, -0.5, -2.02), TRIM], // bumpers
        [box(1.5, 0.1, 0.1, 0, -0.5, 2.03), TRIM],
        [box(1.2, 0.26, 0.07, 0, -0.33, 2.17), TRIM], // push bar
      ]),
      livery,
    ),
  );
  // White doors lettered POLICE on both sides.
  const left = new THREE.PlaneGeometry(1.7, 0.34).rotateY(Math.PI / 2).translate(0.87, -0.25, -0.05);
  const right = new THREE.PlaneGeometry(1.7, 0.34).rotateY(-Math.PI / 2).translate(-0.87, -0.25, -0.05);
  group.add(mesh(mergeGeometries([left, right])!, decal, false));
  const lamp: [THREE.BufferGeometry, number][] = [];
  for (const x of [-0.56, 0.56]) lamp.push([box(0.36, 0.11, 0.05, x, -0.17, -2.07), 0xff2a14], [box(0.3, 0.07, 0.05, x, -0.27, 2.06), 0xfff3dd]);
  group.add(mesh(painted(lamp), lamps, false));
  group.add(mesh(painted([[box(0.5, 0.09, 0.22, 0.28, 0.635, -0.35), 0xff1a14], [box(0.5, 0.09, 0.22, -0.28, 0.635, -0.35), 0x2a5cff]]), bars, false));
  // Wheels: tyre, rim and hub as one mesh each, on pivots the physics turns.
  const wheel = painted([
    [new THREE.CylinderGeometry(0.34, 0.34, 0.21, 24).rotateZ(Math.PI / 2), BLACK],
    [new THREE.CylinderGeometry(0.22, 0.22, 0.215, 16).rotateZ(Math.PI / 2), 0xb8bcc2],
    [new THREE.CylinderGeometry(0.06, 0.06, 0.23, 8).rotateZ(Math.PI / 2), BLACK],
  ]);
  for (const p of HARDPOINTS) {
    const pivot = new THREE.Group();
    pivot.position.set(p.x, 0, p.z);
    pivot.rotation.order = 'YXZ'; // spin about the axle, then steer
    pivot.add(mesh(wheel, livery));
    group.add(pivot);
  }
  return group;
}

/** A red and blue light bar, 1 m wide, centred at (0, y, z). */
function lightBar(y: number, z: number) {
  const bar = new THREE.Group();
  bar.add(mesh(painted([[box(1, 0.06, 0.24, 0, y + 0.03, z), TRIM]]), livery));
  bar.add(mesh(painted([[box(0.45, 0.09, 0.2, 0.25, y + 0.1, z), 0xff1a14], [box(0.45, 0.09, 0.2, -0.25, y + 0.1, z), 0x2a5cff]]), bars, false));
  return bar;
}

/** A garage car as a police car: its own paint, no headlight, a light bar on the highest point over its middle. */
async function garagePolice(name: CarName) {
  const car = await loadCar(name);
  car.group.remove(car.beam, car.beam.target);
  const body = car.group.children[0] as THREE.Mesh;
  body.geometry.computeBoundingBox();
  const { min, max } = body.geometry.boundingBox!;
  const [mid, span] = [(min.z + max.z) / 2, max.z - min.z];
  const pos = body.geometry.getAttribute('position');
  let [top, at] = [-Infinity, mid];
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) < 0.35 && Math.abs(pos.getZ(i) - mid) < span * 0.2 && pos.getY(i) > top) [top, at] = [pos.getY(i), pos.getZ(i)];
  }
  body.add(lightBar(top, at)); // on the body, so the wheel pivots stay the group's last four children
  return car.group;
}

/** A copy sharing geometry and materials, with its four wheel pivots (the last four children). */
function copy(car: THREE.Group) {
  const group = car.clone();
  return { group, wheels: group.children.slice(-4) };
}

/** The helicopter, +z forward, its origin in the middle of the cabin. */
function helicopter() {
  const NAVY = 0x1c2a44;
  const group = new THREE.Group();
  const egg = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new THREE.SphereGeometry(1, 20, 14).scale(sx, sy, sz).translate(x, y, z);
  const parts: [THREE.BufferGeometry, number][] = [
    [egg(0.95, 0.85, 2.0, 0, 0, 0), NAVY],
    [egg(0.8, 0.62, 1.15, 0, 0.15, 1.05), GLASS],
    [new THREE.CylinderGeometry(0.14, 0.3, 4.6, 10).rotateX(Math.PI / 2).translate(0, 0.3, -3.6), WHITE], // tail boom
    [box(0.08, 1.1, 0.7, 0, 0.85, -5.75), NAVY], // fin
    [box(1.6, 0.06, 0.4, 0, 0.35, -4.9), NAVY],
    [new THREE.CylinderGeometry(0.1, 0.12, 0.45, 8).translate(0, 0.95, 0.1), TRIM], // mast
    [new THREE.CylinderGeometry(0.14, 0.14, 0.3, 10).rotateX(Math.PI / 2).translate(0, -0.78, 1.5), TRIM], // searchlight
  ];
  for (const x of [-0.8, 0.8]) {
    parts.push([new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6).rotateX(Math.PI / 2).translate(x, -1.15, 0.1), TRIM]); // skids
    for (const z of [-0.6, 0.8]) parts.push([box(0.06, 0.5, 0.06, x * 0.9, -0.88, z), TRIM]);
  }
  group.add(mesh(painted(parts), livery));
  group.add(mesh(painted([[box(0.25, 0.08, 0.16, 0.35, -0.82, 0.3), 0xff1a14], [box(0.25, 0.08, 0.16, -0.35, -0.82, 0.3), 0x2a5cff]]), bars, false));
  group.add(mesh(painted([[new THREE.CircleGeometry(0.12, 12).rotateX(Math.PI / 2).translate(0, -0.94, 1.5), 0xfff3dd]]), lamps, false));
  const blades: [THREE.BufferGeometry, number][] = [];
  for (let i = 0; i < 4; i++) blades.push([box(0.3, 0.04, 5, 0, 0, 2.5).rotateY((i * Math.PI) / 2), TRIM]);
  const rotor = mesh(painted(blades), livery);
  rotor.position.set(0, 1.18, 0.1);
  const tail = mesh(painted([[box(0.04, 1.3, 0.14, 0, 0, 0), TRIM], [box(0.04, 0.14, 1.3, 0, 0, 0), TRIM]]), livery);
  tail.position.set(0.12, 0.85, -5.85);
  group.add(rotor, tail);
  return { group, rotor, tail };
}

// The searchlight's beam through the air: a cone from the helicopter, faint and soft-edged, only at night.
const haze = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
haze.colorNode = vec3(1, 0.95, 0.82);
haze.opacityNode = night.mul(0.09).mul(smoothstep(0.2, 0.6, uv().y)).mul(normalView.z.abs()); // gone near the ground, where the camera may be inside it

const DOWN = new THREE.Vector3(0, -1, 0);

export function createPoliceView(scene: THREE.Scene, chase: Chase, renderer: THREE.WebGPURenderer, camera: THREE.Camera) {
  const base = policeCar();
  const cars = Array.from({ length: MAX_UNITS }, () => copy(base));
  // The garage's cars, one copy per police slot each; which one a police car is, picked when it first shows.
  let fleet: ReturnType<typeof copy>[][] = [];
  let loading = false;
  let warming = 0; // frames left showing one of each out of sight, so the real render compiles them before they are needed
  const picks = new WeakMap<Unit, number>();
  const under = new THREE.Vector3(); // out of sight beneath the player's car
  async function load() {
    loading = true;
    const groups = (await Promise.all((Object.keys(GARAGE) as CarName[]).map((n) => garagePolice(n).catch(() => null)))).filter((g) => g !== null);
    const next = groups.map((g) => Array.from({ length: MAX_UNITS }, () => copy(g)));
    for (const set of next) for (const c of set) scene.add(c.group);
    for (const set of next) {
      set[0].group.position.copy(under);
      [set[0].group.visible, set[0].group.frustumCulled] = [true, false];
    }
    await renderer.compileAsync(scene, camera);
    fleet = next;
    warming = 2;
  }
  const heli = helicopter();
  const light = new THREE.SpotLight(0xfff2dc, 0, 300, 0.12, 0.4, 1.2);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0), haze);
  for (const o of [...cars.map((c) => c.group), heli.group, beam]) {
    o.visible = false;
    scene.add(o);
  }
  scene.add(light, light.target);
  const [qa, qb, dir] = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Vector3()];

  return {
    /** Copies of everything drawn, for the warm-up to compile. */
    warmers: () => [copy(base).group, heli.group.clone(), beam.clone().translateY(8)].map((o) => ((o.visible = true), o)),
    /** Place the police between the last two physics steps (`alpha`), the rotors turned by `dt`; `target` is the player. */
    update(alpha: number, dt: number, target: THREE.Vector3) {
      under.copy(target).y -= 20;
      if (chase.level && !loading) void load();
      for (const c of cars) c.group.visible = false;
      for (const set of fleet) for (const c of set) c.group.visible = false;
      if (warming > 0) {
        warming--;
        for (const set of fleet) {
          set[0].group.position.copy(under);
          set[0].group.visible = warming > 0;
          set[0].group.frustumCulled = warming === 0;
        }
      }
      for (const u of chase.units) {
        let pick = picks.get(u);
        if (pick === undefined && fleet.length) picks.set(u, (pick = Math.floor(Math.random() * fleet.length)));
        const c = pick === undefined ? cars[u.slot] : fleet[pick][u.slot];
        c.group.visible = true;
        c.group.position.set(u.prev[0], u.prev[1], u.prev[2]).lerp(dir.set(u.curr[0], u.curr[1], u.curr[2]), alpha);
        qa.set(u.prev[3], u.prev[4], u.prev[5], u.prev[6]);
        qb.set(u.curr[3], u.curr[4], u.curr[5], u.curr[6]);
        c.group.quaternion.slerpQuaternions(qa, qb, alpha);
        turnWheels(c.wheels, u.car.vehicle);
      }
      const h = chase.heli;
      heli.group.visible = !!h;
      const lit = !!h && !h.leaving && night.value > 0.05;
      light.intensity = lit ? night.value * 1500 : 0;
      beam.visible = lit;
      if (!h) return;
      heli.group.position.set(h.x, h.y, h.z);
      // Nose down as it flies, banked into its turns.
      const ahead = h.vx * Math.sin(h.yaw) + h.vz * Math.cos(h.yaw);
      const across = h.vx * Math.cos(h.yaw) - h.vz * Math.sin(h.yaw);
      heli.group.rotation.set(Math.min(0.3, ahead * 0.008), h.yaw, -across * 0.01, 'YXZ');
      heli.rotor.rotation.y += dt * 38;
      heli.tail.rotation.x += dt * 60;
      if (!lit) return;
      light.position.set(h.x, h.y - 1, h.z);
      light.target.position.copy(target);
      dir.subVectors(target, light.position);
      const d = dir.length();
      beam.position.copy(light.position);
      beam.quaternion.setFromUnitVectors(DOWN, dir.divideScalar(d));
      const r = d * Math.tan(light.angle);
      beam.scale.set(r, d, r);
    },
  };
}
