// The sea: a camera-following plane at y = 0 with Gerstner waves, coloured by depth, with foam at the shore.
import * as THREE from 'three/webgpu';
import {
  cameraFar,
  cameraNear,
  cameraPosition,
  color,
  cos,
  float,
  linearDepth,
  max,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
  transformNormalToView,
  uniform,
  vec3,
  viewportLinearDepth,
} from 'three/tsl';

const SIZE = 6000; // m across; fog hides the edge long before
const SEGMENTS = 192;
const CELL = SIZE / SEGMENTS; // the plane moves in whole cells, so the waves never swim
const STEEP = 0.6; // Gerstner steepness
// direction x, direction z, wavelength (m), amplitude (m)
const WAVES = [
  [1, 0.25, 64, 0.32],
  [0.62, -0.78, 33, 0.18],
  [-0.35, 0.94, 17, 0.1],
  [0.45, 0.89, 9, 0.05],
];

/** `environment`: what the sea reflects, instead of the scene's environment. */
export function createOcean(environment?: THREE.Node) {
  const offset = uniform(new THREE.Vector2()); // world x, z of the plane's centre
  const xz = positionLocal.xz.add(offset);
  let lift: THREE.Node<'vec3'> = vec3(0, 0, 0);
  let nx: THREE.Node<'float'> = float(0);
  let ny: THREE.Node<'float'> = float(1);
  let nz: THREE.Node<'float'> = float(0);
  // Far out, the waves still rise and fall but tilt the surface less: their normals, sampled ever more sparsely, would
  // band the sky's reflection into stripes.
  const calm = smoothstep(1400, 300, positionWorld.sub(cameraPosition).length());
  for (const [dx, dz, length, amp] of WAVES) {
    const l = Math.hypot(dx, dz);
    const k = (2 * Math.PI) / length;
    const phase = xz.x.mul((dx / l) * k).add(xz.y.mul((dz / l) * k)).sub(time.mul(Math.sqrt(9.81 * k)));
    const c = cos(phase);
    const s = sin(phase);
    lift = lift.add(vec3(c.mul((STEEP * amp * dx) / l), s.mul(amp), c.mul((STEEP * amp * dz) / l)));
    nx = nx.sub(c.mul((dx / l) * k * amp).mul(calm));
    ny = ny.sub(s.mul(STEEP * k * amp).mul(calm));
    nz = nz.sub(c.mul((dz / l) * k * amp).mul(calm));
  }

  // Ripples too small to move the surface, only to tilt it: they break the sun into glitter near the car. They fade out
  // with distance, where such short waves would alias into a moiré.
  const near = smoothstep(260, 60, positionWorld.sub(cameraPosition).length());
  for (const [dx, dz, length, amp] of [[0.3, 0.95, 4.1, 0.06], [-0.85, 0.5, 2.7, 0.04]]) {
    const k = (2 * Math.PI) / length;
    const c = cos(xz.x.mul(dx * k).add(xz.y.mul(dz * k)).sub(time.mul(Math.sqrt(9.81 * k)))).mul(near);
    nx = nx.sub(c.mul(dx * k * amp));
    nz = nz.sub(c.mul(dz * k * amp));
  }

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.05, metalness: 0, transparent: true });
  if (environment) material.envNode = environment;
  material.positionNode = positionLocal.add(lift);
  material.normalNode = transformNormalToView(vec3(nx, ny, nz).normalize());
  // Metres of water between the surface and whatever is behind it along the view ray.
  const depth = viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear));
  // Foam where the water thins at the shore, and surf lines that roll in toward the beach.
  const surf = smoothstep(0.72, 1, sin(depth.mul(2.2).sub(time.mul(1.3)))).mul(smoothstep(3.5, 0.6, depth));
  const churn = mx_noise_float(vec3(xz.mul(0.35), time.mul(0.6))).mul(0.5).add(0.5);
  const foam = max(smoothstep(1.2, 0, depth), surf.mul(0.8)).mul(churn);
  // Turquoise over sand, deepening to blue offshore, as in the concept art.
  const water = mix(mix(color(0x3cb9ba), color(0x1a7d9e), smoothstep(0, 5, depth)), color(0x0b3f6e), smoothstep(5, 16, depth));
  material.colorNode = water.add(foam.mul(0.6));
  material.opacityNode = max(smoothstep(0, 1.6, depth).mul(0.92), foam);

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2), material);
  mesh.frustumCulled = false;
  return {
    mesh,
    /** Centre the plane under the camera (local x, z), on the grid of its own cells. */
    follow(x: number, z: number, origin: { x: number; z: number }) {
      const wx = Math.round((x + origin.x) / CELL) * CELL;
      const wz = Math.round((z + origin.z) / CELL) * CELL;
      mesh.position.set(wx - origin.x, 0, wz - origin.z);
      offset.value.set(wx, wz);
    },
  };
}
