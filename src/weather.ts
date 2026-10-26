// Weather and seasons. Weather: clear, cloudy, fog, rain or snow, changing every few minutes to suit the place (N skips
// ahead). Seasons: spring, summer, autumn and winter, one a game day (G skips ahead). Their state is a handful of
// uniforms the sky, the ground, the plants, the road and the sound read; rain and snow fall around the camera.
import * as THREE from 'three/webgpu';
import { Fn, attribute, cameraPosition, color, float, mod, normalize, positionLocal, sin, smoothstep, time, uniform, uv, vec3 } from 'three/tsl';
import type { Biome } from './world/places.ts';

/** 0–1 each, fading toward the current weather's values. */
export const cover = uniform(0.1); // cloud cover: greyer sky, softer light
export const wet = uniform(0); // rain: falling, and the road shining
export const snow = uniform(0); // snowfall
export const mist = uniform(0); // thick haze
export const snowCover = uniform(0); // snow lying on the ground, building while it snows and melting after
export const grassTint = uniform(new THREE.Color(1, 1, 1)); // the season's colour on the ground
export const autumn = uniform(0); // broadleaf trees, bushes and grass turning orange and red
export const winter = uniform(0); // snow lying inland

const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
const SEASON_LOOK = [
  { tint: [0.8, 1.08, 0.72], autumn: 0, winter: 0 }, // spring: fresh green
  { tint: [1, 1, 1], autumn: 0, winter: 0 }, // summer: the golden coast as it is
  { tint: [1.12, 0.93, 0.72], autumn: 1, winter: 0 },
  { tint: [0.9, 0.92, 0.95], autumn: 0.35, winter: 1 },
];

type Kind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow';
const KINDS: Kind[] = ['clear', 'cloudy', 'fog', 'rain', 'snow'];
const LOOK: Record<Kind, { cover: number; wet: number; snow: number; mist: number }> = {
  clear: { cover: 0.1, wet: 0, snow: 0, mist: 0 },
  cloudy: { cover: 0.7, wet: 0, snow: 0, mist: 0.1 },
  fog: { cover: 0.55, wet: 0, snow: 0, mist: 1 },
  rain: { cover: 0.95, wet: 1, snow: 0, mist: 0.35 },
  snow: { cover: 0.9, wet: 0, snow: 1, mist: 0.45 },
};
// How likely each kind is, by place (snow only falls in the mountains; elsewhere it would be rain).
const ODDS: Record<Exclude<Biome, 'sea'>, [Kind, number][]> = {
  coast: [['clear', 0.5], ['cloudy', 0.25], ['fog', 0.1], ['rain', 0.15]],
  country: [['clear', 0.4], ['cloudy', 0.3], ['fog', 0.1], ['rain', 0.2]],
  mountains: [['clear', 0.35], ['cloudy', 0.25], ['fog', 0.1], ['snow', 0.3]],
  desert: [['clear', 0.75], ['cloudy', 0.25]],
};
const SPELL = 420; // s a weather lasts before the next is drawn
const FADE = 30; // s to fade from one to the next

const BOX = 50; // m a side of the box of falling drops around the camera
const DROPS = 7000;

/** `start`: the weather to begin in; `season`: the season to begin in (else summer). */
export function createWeather(scene: THREE.Scene, start: string | null, season: string | null) {
  let year = Math.max(0, SEASONS.indexOf(season as (typeof SEASONS)[number])); // 0–4: spring, summer, autumn, winter, spring
  if (year === 0 && season !== 'spring') year = 1;
  let kind: Kind = (KINDS as string[]).includes(start ?? '') ? (start as Kind) : 'clear';
  let left = SPELL;
  // Start already in it, rather than fading in.
  [cover.value, wet.value, snow.value, mist.value] = [LOOK[kind].cover, LOOK[kind].wet, LOOK[kind].snow, LOOK[kind].mist];
  snowCover.value = kind === 'snow' ? 0.8 : 0;
  const set = (k: Kind) => {
    kind = k;
    left = SPELL;
  };

  // Rain and snow: thin quads that face the camera, each falling through a box that wraps around it, so they stay
  // put in the world as the car drives through them. Rain is long, fast streaks; snow small, slow, drifting flakes.
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  const seeds = new Float32Array(DROPS * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random() * BOX;
  quad.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 3));
  quad.instanceCount = DROPS;
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  {
    const flakes = snow.greaterThan(wet); // snow when it is snowing more than raining
    const fall = flakes.select(float(1.3), float(11)); // m/s
    const length = flakes.select(float(0.07), float(0.55));
    const width = flakes.select(float(0.035), float(0.008));
    const seed = attribute('seed', 'vec3');
    const drift = flakes.select(sin(time.mul(0.8).add(seed.x)).mul(0.6), float(0));
    const at = vec3(seed.x.add(drift), seed.y.sub(time.mul(fall)), seed.z);
    const local = mod(at.sub(cameraPosition), BOX).sub(BOX / 2); // around the camera, wrapping
    material.positionNode = Fn(() => {
      const centre = cameraPosition.add(local);
      const view = normalize(centre.sub(cameraPosition));
      const right = normalize(vec3(view.z, 0, view.x.negate()));
      return centre.add(right.mul(positionLocal.x).mul(width)).add(vec3(0, positionLocal.y.mul(length), 0));
    })();
    material.colorNode = flakes.select(color(0xffffff), color(0xc4ccd8));
    // Flakes are soft dots, streaks thin toward their tails; none right at the camera, where they would be bars.
    const round = smoothstep(0.5, 0.25, uv().sub(0.5).length());
    const near = smoothstep(1.5, 5, local.length());
    material.opacityNode = flakes.select(snow.mul(0.9).mul(round), wet.mul(0.45).mul(uv().y)).mul(near);
  }
  const fallers = new THREE.Mesh(quad, material);
  fallers.frustumCulled = false; // placed in the shader, around the camera
  fallers.renderOrder = 1;
  scene.add(fallers);

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyN') set(KINDS[(KINDS.indexOf(kind) + 1) % KINDS.length]);
    if (e.code === 'KeyG') year = (Math.floor(year) + 1) % 4;
  });

  return {
    get kind() {
      return kind;
    },
    get season() {
      return SEASONS[Math.floor(year) % 4];
    },
    /**
     * Advance by dt seconds (`hours` of game time) where the car is (`biome`, `height` m): fade toward the weather,
     * draw the next in time, and move the year on a season a game day; each season blends into the next over its last third.
     */
    update(dt: number, hours: number, biome: Biome, height: number) {
      year = (year + hours / 24) % 4;
      const now = Math.floor(year);
      const blend = THREE.MathUtils.smoothstep(year - now, 0.67, 1);
      const [a, b] = [SEASON_LOOK[now], SEASON_LOOK[(now + 1) % 4]];
      grassTint.value.setRGB(...(a.tint.map((v, i) => v + (b.tint[i] - v) * blend) as [number, number, number]));
      autumn.value = a.autumn + (b.autumn - a.autumn) * blend;
      winter.value = a.winter + (b.winter - a.winter) * blend;
      left -= dt;
      if (left <= 0) {
        const odds = ODDS[biome === 'sea' ? 'coast' : biome];
        let roll = Math.random();
        const pick = odds.find(([, p]) => (roll -= p) < 0)?.[0] ?? 'clear';
        set(pick === 'snow' && height < 300 ? 'rain' : pick);
      }
      const target = LOOK[kind];
      const k = Math.min(1, (dt / FADE) * 3);
      cover.value += (target.cover - cover.value) * k;
      wet.value += (target.wet - wet.value) * k;
      snow.value += (target.snow - snow.value) * k;
      mist.value += (target.mist - mist.value) * k;
      snowCover.value = Math.min(1, Math.max(0, snowCover.value + dt * (snow.value > 0.5 ? 0.02 : -0.006)));
      fallers.visible = wet.value > 0.01 || snow.value > 0.01;
    },
  };
}
