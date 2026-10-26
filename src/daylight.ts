// Time of day: sun and moon, sky, fog, ambient light, stars, and the `night` value glowing materials read.
import * as THREE from 'three/webgpu';
import { color, mix, positionLocal, uniform } from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { mulberry32 } from './world/hash.ts';

/** 0 by day, 1 at night. Windows, posters and headlights glow with it. */
export const night = uniform(0);

const DAY_FOG = new THREE.Color(0xbfcfdc);
const DUSK_FOG = new THREE.Color(0xe0b48c);
const NIGHT_FOG = new THREE.Color(0x0c1424);
const NOON = new THREE.Color(0xfff4e6);
const WARM = new THREE.Color(0xffa860);
const MOON = new THREE.Color(0x9fb6ff);
const ss = THREE.MathUtils.smoothstep;

/** `shadowSize`: shadow map resolution; `fogFar`: where the fog is total, about the far edge of the tiles. */
export function createDaylight(renderer: THREE.WebGPURenderer, scene: THREE.Scene, opts: { shadowSize: number; fogFar: number }) {
  // The visible sky, and a twin rendered into the environment map that water and paint reflect.
  const skies = [new SkyMesh(), new SkyMesh()];
  for (const s of skies) {
    s.scale.setScalar(4000);
    s.turbidity.value = 3;
    s.rayleigh.value = 1.2;
    (s.material as THREE.NodeMaterial).fog = false; // the box sits beyond the fog's far distance
  }
  const [sky, envSky] = skies;
  const envScene = new THREE.Scene().add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let env: THREE.RenderTarget | null = null;

  // Night: a deep blue dome over the dark sky, and stars.
  const domeMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
  domeMaterial.colorNode = mix(color(0x16294a), color(0x03070f), positionLocal.normalize().y.clamp(0, 1).sqrt());
  domeMaterial.opacityNode = night.mul(0.92);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 16), domeMaterial);
  const random = mulberry32(7);
  const points = new Float32Array(3000 * 3);
  for (let i = 0; i < 3000; i++) {
    const y = 0.05 + random() * 0.95;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    points.set([Math.cos(a) * r * 3400, y * 3400, Math.sin(a) * r * 3400], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const starMaterial = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  starMaterial.opacityNode = night;
  const stars = new THREE.Points(starGeometry, starMaterial);
  dome.renderOrder = stars.renderOrder = -1; // first among the transparent things, behind the sea

  scene.fog = new THREE.Fog(DAY_FOG.clone(), opts.fogFar * 0.15, opts.fogFar);
  const fog = scene.fog;
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5b4b36, 0.25);
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  light.shadow.mapSize.set(opts.shadowSize, opts.shadowSize);
  light.shadow.normalBias = 0.05;
  Object.assign(light.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  light.shadow.camera.updateProjectionMatrix();
  scene.add(sky, dome, stars, hemi, light, light.target);

  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  let baked = -10; // sun height at the last environment bake
  return {
    /** Set the scene for `hours` (0–24), centred on the camera at `eye`, shadows around `focus`. */
    update(hours: number, eye: THREE.Vector3, focus: THREE.Vector3) {
      const elevation = THREE.MathUtils.degToRad(62) * Math.sin(((hours - 6) / 24) * Math.PI * 2);
      const azimuth = Math.PI + ((hours - 12) / 24) * Math.PI * 2;
      sunDir.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
      const day = ss(sunDir.y, -0.06, 0.1);
      const low = 1 - ss(sunDir.y, 0.04, 0.4); // warmer light near the horizon
      night.value = 1 - ss(sunDir.y, -0.16, 0.02);
      for (const s of skies) s.sunPosition.value.copy(sunDir);

      // The sun by day, the moon (opposite it) by night.
      const lightDir = sunDir.y > -0.05 ? sunDir : moonDir.copy(sunDir).negate();
      light.position.copy(focus).addScaledVector(lightDir, 200);
      light.target.position.copy(focus);
      light.color.copy(NOON).lerp(WARM, low * day).lerp(MOON, night.value);
      light.intensity = 3 * day + 0.35 * night.value;
      hemi.intensity = 0.25 * day + 0.12 * night.value;
      fog.color.copy(DAY_FOG).lerp(DUSK_FOG, low * day).lerp(NIGHT_FOG, night.value);
      scene.environmentIntensity = 0.35 * day + 0.08;
      // A high sun makes the sky far brighter, so exposure comes down as it climbs.
      renderer.toneMappingExposure = 0.9 - 0.4 * ss(sunDir.y, 0.15, 0.85) + night.value * 0.5;

      sky.position.copy(eye);
      dome.position.copy(eye);
      stars.position.copy(eye);
      if (Math.abs(sunDir.y - baked) > 0.015) {
        baked = sunDir.y;
        env?.dispose();
        env = pmrem.fromScene(envScene, 0, 0.1, 5000);
        scene.environment = env.texture;
      }
    },
  };
}
