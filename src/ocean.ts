// The sea: a camera-following plane at y = 0 with Gerstner waves, coloured by depth, with foam at the shore.
import * as THREE from 'three/webgpu';
import {
  cameraFar,
  cameraNear,
  color,
  cos,
  float,
  linearDepth,
  max,
  mix,
  mx_noise_float,
  positionLocal,
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

export function createOcean() {
  const offset = uniform(new THREE.Vector2()); // world x, z of the plane's centre
  const xz = positionLocal.xz.add(offset);
  let lift: THREE.Node<'vec3'> = vec3(0, 0, 0);
  let nx: THREE.Node<'float'> = float(0);
  let ny: THREE.Node<'float'> = float(1);
  let nz: THREE.Node<'float'> = float(0);
  for (const [dx, dz, length, amp] of WAVES) {
    const l = Math.hypot(dx, dz);
    const k = (2 * Math.PI) / length;
    const phase = xz.x.mul((dx / l) * k).add(xz.y.mul((dz / l) * k)).sub(time.mul(Math.sqrt(9.81 * k)));
    const c = cos(phase);
    const s = sin(phase);
    lift = lift.add(vec3(c.mul((STEEP * amp * dx) / l), s.mul(amp), c.mul((STEEP * amp * dz) / l)));
    nx = nx.sub(c.mul((dx / l) * k * amp));
    ny = ny.sub(s.mul(STEEP * k * amp));
    nz = nz.sub(c.mul((dz / l) * k * amp));
  }

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.05, metalness: 0, transparent: true });
  material.positionNode = positionLocal.add(lift);
  material.normalNode = transformNormalToView(vec3(nx, ny, nz).normalize());
  // Metres of water between the surface and whatever is behind it along the view ray.
  const depth = viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear));
  const foam = smoothstep(1.2, 0, depth).mul(mx_noise_float(vec3(xz.mul(0.35), time.mul(0.6))).mul(0.5).add(0.5));
  material.colorNode = mix(color(0x2f8f9a), color(0x0b3a52), smoothstep(0, 10, depth)).add(foam.mul(0.6));
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
