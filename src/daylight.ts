// Time of day: sun and moon, sky and clouds, fog that takes its colour from the sky behind it, ambient light, stars,
// and the `night` value glowing materials read.
import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  color,
  densityFogFactor,
  dot,
  float,
  fog,
  luminance,
  max,
  mix,
  mx_fractal_noise_float,
  pmremTexture,
  positionLocal,
  positionWorld,
  rangeFogFactor,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { cover, mist, wet } from './weather.ts';
import { mulberry32 } from './world/hash.ts';

/** 0 by day, 1 at night. Windows, posters and headlights glow with it. */
export const night = uniform(0);

const NOON = new THREE.Color(0xfff4e6);
const WARM = new THREE.Color(0xffa860);
const MOON = new THREE.Color(0x9fb6ff);
const DOME = 0x16294a; // the night dome's colour at the horizon
const ss = THREE.MathUtils.smoothstep;

/** `shadowSize`: shadow map resolution; `fogFar`: where the fog is total, about the far edge of the tiles. */
export function createDaylight(renderer: THREE.WebGPURenderer, scene: THREE.Scene, opts: { shadowSize: number; fogFar: number }) {
  // The visible sky, and a twin rendered into the environment map that water and paint reflect and fog takes after.
  const skies = [new SkyMesh(), new SkyMesh()];
  // This sky gets far brighter than the land as the sun climbs, so exposure that suits the land whites it out;
  // its own gain comes down instead, keeping a deep blue at noon.
  // Its horizon also stays whitish at noon, so by day its hue is repainted (its brightness kept) from a gradient like the
  // concept art's: pale blue low, deep blue high. The repaint fades out toward sunset, which it does well on its own.
  const skyGain = uniform(1);
  const blueness = uniform(0);
  for (const [i, s] of skies.entries()) {
    s.scale.setScalar(4000);
    s.turbidity.value = 2; // clear Mediterranean air
    s.rayleigh.value = 2.5;
    s.mieCoefficient.value = 0.003;
    const m = s.material as THREE.NodeMaterial;
    m.fog = false; // the box sits beyond the fog's far distance
    const base = (m.colorNode as THREE.Node<'vec4'>).rgb;
    const grad = mix(color(0xb4cfe8), color(0x2a63b0), smoothstep(0, 0.55, positionLocal.normalize().y.max(0)).pow(0.8));
    const painted = grad.div(luminance(grad)).mul(luminance(base));
    // Only the visible sky is repainted, and dimmed further by day so tone mapping keeps its blue: lit by the deep blue,
    // the land and road would turn blue.
    const lit = i === 0 ? mix(base, painted, blueness).mul(blueness.mul(-0.75).add(1)) : base;
    // Under a full cover of cloud the sky is a soft grey.
    m.colorNode = vec4(mix(lit, vec3(luminance(lit)).mul(vec3(0.9, 0.94, 1)), cover.mul(0.85)).mul(skyGain), 1);
  }
  const [sky, envSky] = skies;
  const envScene = new THREE.Scene().add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0, 0.1, 5000); // later bakes go into the same target (see update)
  scene.environment = env.texture;

  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const sun = uniform(sunDir); // toward the sun
  const sunTint = uniform(new THREE.Color()); // the sunlight's colour times its strength, for clouds

  // Night: a dome over the dark sky, and stars. In twilight (blue hour) it is violet, warm low toward the set sun;
  // later a deep blue.
  const twilight = uniform(0); // 1 just after sunset and before sunrise, 0 by day and deep in the night
  const domeMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
  {
    const dir = positionLocal.normalize();
    const up = dir.y.clamp(0, 1).sqrt();
    const toward = vec2(dir.x, dir.z).normalize().dot(vec2(sun.x, sun.z).normalize()).max(0);
    const deep = mix(color(DOME), color(0x03070f), up);
    const violet = mix(color(0x5f6aa6), color(0x1c2a5e), up).add(color(0xff7a3a).mul(toward.pow(4)).mul(up.oneMinus().pow(4)));
    domeMaterial.colorNode = mix(deep, violet, twilight);
  }
  domeMaterial.opacityNode = night.mul(0.95);
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

  // Clouds: fractal noise on a plane overhead, seen through a dome; drifting, thinning to the horizon, lit by the sun
  // (warm when it is low) and shaded with the colour of the sky around them.
  const cloudMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
  {
    const dir = positionLocal.normalize();
    const plane = dir.xz.div(dir.y.max(0.04)).mul(0.6).add(vec2(time.mul(0.004), time.mul(0.0015)));
    const n = mx_fractal_noise_float(vec3(plane, time.mul(0.002)), 4, 2, 0.5);
    // Fair-weather clouds with blue sky between, thinning out low down where they would crowd into a haze.
    const density = smoothstep(float(0.3).sub(cover.mul(0.55)), float(0.6).sub(cover.mul(0.35)), n).mul(smoothstep(0.06, 0.32, dir.y)); // thicker as the weather turns
    const around = pmremTexture(env.texture, dir, float(0.7));
    const lit = dot(dir, sun).max(0).pow(4).mul(0.9).add(0.35).mul(cover.mul(-0.6).add(1)); // grey under a full cover
    cloudMaterial.colorNode = around.mul(0.75).add(sunTint.mul(lit).mul(density.oneMinus().mul(0.5).add(0.5)));
    cloudMaterial.opacityNode = density.mul(0.92);
  }
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), cloudMaterial);
  dome.renderOrder = stars.renderOrder = clouds.renderOrder = -1; // first among the transparent things, behind the sea

  // Fog is the sky just above the horizon behind whatever it covers, so far hills fade into the sky; a haze that
  // thickens at dawn and dusk, and total at the tiles' edge.
  const haze = uniform(0.0006); // per metre
  {
    const view = positionWorld.sub(cameraPosition).normalize();
    const behind = vec3(view.x, view.y.max(0.03), view.z).normalize();
    // Blurred and capped, so the sun's own glow cannot white out what lies toward it.
    const sky = pmremTexture(env.texture, behind, float(0.5)).min(vec3(1.4));
    const tint = mix(sky, mix(color(DOME), color(0x6a5f96), twilight), night.mul(0.95));
    scene.fogNode = fog(tint, max(densityFogFactor(haze), rangeFogFactor(opts.fogFar * 0.8, opts.fogFar)));
  }

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5b4b36, 0.25);
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  light.shadow.mapSize.set(opts.shadowSize, opts.shadowSize);
  light.shadow.normalBias = 0.05;
  Object.assign(light.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  light.shadow.camera.updateProjectionMatrix();
  scene.add(sky, dome, stars, clouds, hemi, light, light.target);

  let baked = -10; // sun height at the last environment bake
  let pace = 1;
  return {
    /** How fast the clock should run now: slower around sunrise and sunset, so golden and blue hour last. */
    get pace() {
      return pace;
    },
    /** Set the scene for `hours` (0–24), centred on the camera at `eye`, shadows around `focus`. */
    update(hours: number, eye: THREE.Vector3, focus: THREE.Vector3) {
      const elevation = THREE.MathUtils.degToRad(62) * Math.sin(((hours - 6) / 24) * Math.PI * 2);
      const azimuth = Math.PI + ((hours - 12) / 24) * Math.PI * 2;
      sunDir.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
      const day = ss(sunDir.y, -0.06, 0.1);
      const low = 1 - ss(sunDir.y, 0.04, 0.4); // warmer light near the horizon
      night.value = 1 - ss(sunDir.y, -0.16, 0.02);
      twilight.value = ss(sunDir.y, -0.3, -0.08) * (1 - ss(sunDir.y, -0.02, 0.06));
      skyGain.value = (1 - 0.55 * ss(sunDir.y, 0.25, 0.85)) * (1 - 0.35 * cover.value);
      blueness.value = 0.85 * ss(sunDir.y, 0.12, 0.45) * (1 - cover.value);
      pace = 0.45 + 0.55 * ss(Math.abs(sunDir.y), 0.06, 0.3);
      for (const s of skies) s.sunPosition.value.copy(sunDir);

      // The sun by day, the moon (opposite it) by night.
      const lightDir = sunDir.y > -0.05 ? sunDir : moonDir.copy(sunDir).negate();
      light.position.copy(focus).addScaledVector(lightDir, 200);
      light.target.position.copy(focus);
      light.color.copy(NOON).lerp(WARM, low * day).lerp(MOON, night.value);
      light.intensity = (3 * day + 0.35 * night.value) * (1 - 0.7 * cover.value); // overcast: the sun goes soft
      light.shadow.intensity = 1 - 0.8 * cover.value;
      // Clouds take the sunlight by day and a pink afterglow in twilight.
      sunTint.value.copy(light.color).multiplyScalar(day * 1.6 + 0.04).add(WARM.clone().multiplyScalar(twilight.value * 0.5));
      hemi.intensity = 0.25 * day + 0.12 * night.value + 0.25 * twilight.value + 0.3 * day * cover.value; // blue hour, and grey days, are lit by the sky
      haze.value = 0.0003 + 0.00045 * low * day + 0.0012 * mist.value + 0.0004 * wet.value;
      scene.environmentIntensity = 0.25 * day + 0.08;
      // A high sun makes the sky far brighter, so exposure comes down as it climbs.
      renderer.toneMappingExposure = 0.9 - 0.4 * ss(sunDir.y, 0.15, 0.85) + night.value * 0.5;

      sky.position.copy(eye);
      dome.position.copy(eye);
      stars.position.copy(eye);
      clouds.position.copy(eye);
      if (Math.abs(sunDir.y - baked) > 0.015) {
        baked = sunDir.y;
        // Into the same target: a new environment texture recompiles every lit material, a ~300 ms stall.
        pmrem.fromScene(envScene, 0, 0.1, 5000, { renderTarget: env });
      }
    },
  };
}
