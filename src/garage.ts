// The garage (B): every car in the garage parked side by side in a lit concrete hall. ← → (or A D) walk along them,
// Enter drives the one in front of you, Esc or B goes back. Its own scene, drawn instead of the world while it is open;
// main.ts pauses the drive meanwhile. The cars load the first time it opens.
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { type CarName, GARAGE, loadCar } from './car.ts';

const BAY = 5; // m between parked cars
const ANGLE = -0.55; // each parked at an angle, nose toward the aisle, for a three-quarter view

export function createGarage(renderer: THREE.WebGPURenderer, choose: (name: CarName) => Promise<void>) {
  const names = Object.keys(GARAGE) as CarName[];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121418);
  scene.fog = new THREE.Fog(0x121418, 14, 40);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  // The hall: a polished concrete floor with painted bays, a back wall, and strip lights over each bay.
  const width = names.length * BAY + 20;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.55 }));
  floor.position.x = ((names.length - 1) * BAY) / 2;
  floor.receiveShadow = true;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, 8), new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.9 }));
  wall.position.set(floor.position.x, 4, -4.5);
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.7 });
  const strip = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e2, emissiveIntensity: 3 });
  scene.add(floor, wall);
  for (let i = 0; i <= names.length; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 6), paint);
    line.position.set((i - 0.5) * BAY, 0.005, -0.5);
    line.rotation.y = ANGLE / 2;
    scene.add(line);
    if (i === names.length) break;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 3.2), strip);
    lamp.position.set(i * BAY, 4.2, -0.4);
    scene.add(lamp);
  }
  const key = new THREE.DirectionalLight(0xfff1de, 2.2);
  key.position.set(floor.position.x + 4, 9, 6);
  key.target.position.set(floor.position.x, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -width / 2, right: width / 2, top: 8, bottom: -8 });
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key, key.target, new THREE.HemisphereLight(0xdfe6f0, 0x2a2622, 0.6));

  const label = document.body.appendChild(document.createElement('div'));
  label.id = 'garage';
  label.hidden = true;
  let open = false;
  let at = 0;
  let current: CarName = names[0];
  let loading: Promise<void> | null = null;
  let x = 0; // the camera's place along the aisle

  function caption() {
    label.innerHTML =
      `<div><span class="dim">‹</span> ${GARAGE[names[at]].name} <span class="dim">›</span></div>` +
      `<span class="dim">${names[at] === current ? 'Driving now' : 'Enter to drive'} · Esc to go back</span>`;
  }

  /** Park every car in its bay, once. */
  async function park() {
    label.textContent = 'Opening the garage…';
    const cars = await Promise.all(names.map((n) => loadCar(n).catch(() => null)));
    cars.forEach((car, i) => {
      if (!car) return;
      car.group.remove(car.beam, car.beam.target); // no headlights in here
      car.group.traverse((o) => (o.castShadow = true));
      car.group.rotation.y = ANGLE;
      car.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(car.group);
      car.group.position.set(i * BAY, -box.min.y, 0); // tyres on the floor
      scene.add(car.group);
    });
    await renderer.compileAsync(scene, camera);
  }

  function close() {
    open = false;
    label.hidden = true;
    document.body.classList.remove('in-garage');
  }

  addEventListener('keydown', (e) => {
    if (!open || e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') at = Math.max(0, at - 1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') at = Math.min(names.length - 1, at + 1);
    else if (e.code === 'Escape') return close();
    else if (e.code === 'Enter') {
      if (names[at] !== current) void choose((current = names[at]));
      return close();
    } else return;
    caption();
  });

  return {
    get open() {
      return open;
    },
    /** Open on the car being driven. */
    async show(driving: string) {
      current = driving as CarName;
      at = Math.max(0, names.indexOf(current));
      x = at * BAY;
      open = true;
      label.hidden = false;
      document.body.classList.add('in-garage');
      await (loading ??= park());
      if (open) caption();
    },
    close,
    render(dt: number) {
      x += (at * BAY - x) * (1 - Math.exp(-6 * dt));
      camera.position.set(x + 2.2, 1.55, 6.8);
      camera.lookAt(x, 0.55, 0);
      renderer.render(scene, camera);
    },
  };
}
