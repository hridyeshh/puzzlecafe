// Streams tiles around the car: workers build them nearest first, here they become meshes, props, plants and colliders.
import * as THREE from 'three/webgpu';
import { attribute, color, cos, float, fract, fwidth, max, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, uniform, uv, vec2, vec3, vertexColor } from 'three/tsl';
import { RAPIER, addTerrain } from './physics.ts';
import { disposePlants, plantCollider, plantMeshes } from './plants.ts';
import { makeProp, makeSign } from './props.ts';
import { terrainIndex } from './terrain.ts';
import { LODS, type Tile } from './tile.ts';
import { grassTint, snowCover, wet, winter } from './weather.ts';
import { CHUNK, type RoadMesh } from './world/chunk.ts';
import { ROAD_HALF } from './world/roads.ts';

/** World position and heading of a petrol station. */
export interface Station {
  x: number;
  z: number;
  yaw: number;
}

interface Loaded {
  lod: number;
  group: THREE.Group; // placed at the tile centre
  body: RAPIER.RigidBody | null; // fixed, at the tile centre, holding its colliders: a rebase moves one body, not thousands of colliders
  owned: THREE.BufferGeometry[]; // geometries only this tile uses
  flora: THREE.Mesh[];
  stations: Station[];
}

// The ground: the tile's vertex colours (grass, dry grass, sand, rock, gravel), with detail drawn per pixel from noise
// anchored to the world (hence the origin): drier and greener patches, grain, strata on steep rock, wet sand at the sea.
const originXZ = uniform(new THREE.Vector2());
const ground = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
{
  const p = positionWorld.xz.add(originXZ);
  const patches = smoothstep(0.05, 0.6, mx_noise_float(p.mul(0.022)));
  const mottle = mx_noise_float(p.mul(0.16)).mul(0.08);
  const grain = mx_noise_float(p.mul(0.6)).add(mx_noise_float(p.mul(2.7))).mul(0.06).add(mottle).add(1);
  const steep = smoothstep(0.85, 0.6, normalWorld.y);
  const strata = mx_noise_float(vec3(positionWorld.y.mul(1.4), p.mul(0.02))).mul(0.06).add(0.97);
  const shore = smoothstep(0.9, 0.25, positionWorld.y); // wet sand at the waterline
  const dry = mix(vec3(1), vec3(1.4, 1.16, 0.68), patches)
    .mul(grain)
    .mul(mix(float(1), strata, steep))
    .mul(mix(float(1), float(0.62), shore))
    .mul(wet.mul(-0.2).add(1)) // rain darkens it
    .mul(grassTint); // the season
  // Snow lies on level enough ground where it is cold (inland, not desert): after snowfall, and all winter.
  const lying = max(snowCover, winter).mul(attribute('cold', 'float')).mul(smoothstep(0.55, 0.9, normalWorld.y));
  ground.colorNode = mix(dry, vec3(0.92, 0.94, 0.97).div(vertexColor()), lying);
  ground.roughnessNode = mix(float(0.95), float(0.4), shore);
}

// Asphalt with a dashed centre line and solid edge lines, painted from uv (x: dash periods, y: metres across).
const road = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
road.polygonOffset = true;
road.polygonOffsetFactor = -2;
road.polygonOffsetUnits = -2;
{
  const across = uv().y.abs();
  const aa = fwidth(across);
  const edges = float(1).sub(smoothstep(aa.negate().add(0.075), aa.add(0.075), across.sub(ROAD_HALF - 0.3).abs()));
  const dashAa = fwidth(uv().x);
  const dash = float(1).sub(smoothstep(dashAa.negate().add(0.15), dashAa.add(0.15), fract(uv().x).sub(0.5).abs()));
  const centre = float(1).sub(smoothstep(aa.negate().add(0.06), aa.add(0.06), across)).mul(dash);
  // Asphalt about 7% reflective like the real thing (darker reads as a black hole in low sun), with grain, darker and
  // smoother wheel tracks in each lane, and paint worn unevenly; the noise is anchored to the world.
  const p = positionWorld.xz.add(originXZ);
  const grain = mx_noise_float(p.mul(3.1)).add(mx_noise_float(p.mul(0.45))).mul(0.035).add(1);
  const track = smoothstep(0.45, 0.1, across.sub(1.2).abs()).max(smoothstep(0.45, 0.1, across.sub(2.8).abs()));
  const asphalt = color(0x4c4a48).mul(grain).mul(track.mul(-0.09).add(1));
  const paint = max(edges, centre).mul(attribute('mark', 'float')).mul(mx_noise_float(p.mul(1.7)).mul(0.3).add(0.85).min(1));
  // In the rain the road darkens and shines; in snow it goes slushy at the edges.
  road.colorNode = mix(mix(asphalt, color(0xe9e6dc), paint).mul(wet.mul(-0.3).add(1)), color(0xd8dde3), snowCover.mul(smoothstep(2.5, 4, across)).mul(0.6));
  road.roughnessNode = mix(float(0.92).sub(track.mul(0.08)), float(0.2), wet);
}

// Dry-stone walls: blocks in a running bond from uv (metres along, up), each its own shade, with darker joints.
const stone = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.92 });
{
  const row = uv().y.div(0.45);
  const course = uv().x.div(1.05).add(row.floor().mul(0.5));
  const inside = vec2(fract(course), fract(row));
  const edge = inside.x.min(inside.y).min(inside.x.oneMinus()).min(inside.y.oneMinus());
  const block = vec2(course.floor(), row.floor()).mul(3.7);
  const tone = mx_noise_float(block).mul(0.2).add(0.9).mul(mx_noise_float(uv().mul(6)).mul(0.08).add(1));
  stone.colorNode = mix(color(0x5f574c), color(0xc9bba0).mul(tone), smoothstep(0.03, 0.12, edge));
}
// Galvanised steel guardrails: the W-beam's two grooves shaded from uv.y (metres up its face; posts are all 0).
const steel = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, metalness: 0.45, roughness: 0.45 });
steel.colorNode = color(0xa9afb5).mul(cos(uv().y.mul((Math.PI * 2) / 0.175)).mul(0.14).add(0.88));
/** Small meshes in the wall and guardrail materials, for compiling their shaders before any stream in. */
export const barrierSamples = () => [stone, steel].map((m) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));

function roadGeometry(m: RoadMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setAttribute('mark', new THREE.BufferAttribute(m.mark, 1));
  const up = new Float32Array(m.position.length);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  return g;
}

/** `far`: how many chunks out from the car tiles reach (at most the coarsest LOD's reach). */
export function createStreaming(scene: THREE.Scene, physics: RAPIER.World, origin: { x: number; z: number }, seed: number, far: number) {
  const pool = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const workers = Array.from({ length: pool }, () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  const idle = [...workers];
  const done: Tile[] = [];
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<Tile>) => {
      done.push(e.data);
      idle.push(w);
    };
  }
  const loaded = new Map<string, Loaded>();
  const asked = new Map<string, number>(); // tiles being built, by the detail asked for
  const indices = new Map<number, THREE.BufferAttribute>(); // one shared index per resolution
  const last = Math.min(far, LODS[LODS.length - 1].reach);
  let ccx = 0;
  let ccz = 0;
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  const ring = (cx: number, cz: number) => Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz));
  const lodAt = (cx: number, cz: number) => (ring(cx, cz) > last ? -1 : LODS.findIndex((l) => ring(cx, cz) <= l.reach));

  function place(t: Tile): Loaded {
    const x = t.cx * CHUNK + CHUNK / 2 - origin.x;
    const z = t.cz * CHUNK + CHUNK / 2 - origin.z;
    const res = LODS[t.lod].res;
    let index = indices.get(res);
    if (!index) indices.set(res, (index = new THREE.BufferAttribute(terrainIndex(res, t.lod > 0), 1))); // one LOD per res
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.BufferAttribute(t.mesh.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(t.mesh.normal, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(t.mesh.color, 3));
    geometry.setAttribute('cold', new THREE.BufferAttribute(t.mesh.cold, 1));
    // Terrain receives shadows but casts none: with a low sun, hill shadows would end at the shadow map's edge.
    // Slopes facing away from the sun already darken through lighting.
    const terrain = new THREE.Mesh(geometry, ground);
    terrain.receiveShadow = true;
    const group = new THREE.Group().add(terrain);
    group.position.set(x, 0, z);
    const owned = [geometry];
    const body = t.collider ? physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z)) : null;
    if (t.collider && body) addTerrain(physics, t.collider, 0, 0, body);
    if (t.ribbon && t.ribbon.index.length > 0) {
      const ribbon = new THREE.Mesh(roadGeometry(t.ribbon), road);
      ribbon.receiveShadow = true;
      group.add(ribbon);
      owned.push(ribbon.geometry);
    }

    for (const [b, material] of [[t.wall, stone], [t.rail, steel]] as const) {
      if (!b || b.position.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2));
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      owned.push(g);
      const w = b.boxes;
      for (let i = 0; i < w.length; i += 6) {
        const desc = RAPIER.ColliderDesc.cuboid(0.3, w[i + 5], w[i + 4]) // half a stone wall's 0.6 m thickness
          .setTranslation(w[i], w[i + 1], w[i + 2])
          .setRotation({ x: 0, y: Math.sin(w[i + 3] / 2), z: 0, w: Math.cos(w[i + 3] / 2) });
        physics.createCollider(desc, body ?? undefined);
      }
    }

    // Road signs, each with its pole's collider.
    const s = t.signs ?? new Float32Array();
    for (let i = 0; i < s.length; i += 5) {
      const sign = makeSign(s[i + 4]);
      sign.object.position.set(s[i], s[i + 1], s[i + 2]);
      sign.object.rotation.y = s[i + 3];
      group.add(sign.object);
      const b = sign.boxes[0];
      physics.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(s[i], s[i + 1] + b.y, s[i + 2]), body ?? undefined);
    }

    // Hoardings stand on the ground, buildings on their flattened pads.
    for (const poi of t.pois) {
      const prop = makeProp(poi);
      const px = poi.x - origin.x;
      const pz = poi.z - origin.z;
      prop.object.position.set(px - x, poi.base, pz - z);
      prop.object.rotation.y = poi.yaw;
      group.add(prop.object);
      const cos = Math.cos(poi.yaw);
      const sin = Math.sin(poi.yaw);
      for (const b of prop.boxes) {
        const desc = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
          .setTranslation(px - x + b.x * cos + b.z * sin, poi.base + b.y, pz - z - b.x * sin + b.z * cos)
          .setRotation({ x: 0, y: Math.sin(poi.yaw / 2), z: 0, w: Math.cos(poi.yaw / 2) });
        physics.createCollider(desc, body ?? undefined);
      }
    }

    // Plants: instanced per kind; trunks and rocks get colliders.
    const flora = t.plants ? plantMeshes(t.plants) : [];
    for (const mesh of flora) group.add(mesh);
    const p = t.plants ?? new Float32Array();
    for (let i = 0; i < p.length; i += 6) {
      const shape = plantCollider(p[i + 5], p[i + 3]);
      if (!shape) continue;
      const desc = shape.shape === 'ball' ? RAPIER.ColliderDesc.ball(shape.size) : RAPIER.ColliderDesc.cylinder(shape.lift, shape.size);
      physics.createCollider(desc.setTranslation(p[i], p[i + 1] + shape.lift, p[i + 2]), body ?? undefined);
    }

    scene.add(group);
    const stations = t.pois.filter((s) => s.kind === 'station').map(({ x: sx, z: sz, yaw }) => ({ x: sx, z: sz, yaw }));
    return { lod: t.lod, group, body, owned, flora, stations };
  }

  function remove(t: Loaded) {
    scene.remove(t.group);
    for (const g of t.owned) {
      if (g.index && indices.get(LODS[t.lod].res) === g.index) g.setIndex(null); // shared; keep it
      g.dispose();
    }
    for (const mesh of t.flora) disposePlants(mesh);
    if (t.body) physics.removeRigidBody(t.body); // and its colliders
  }

  return {
    /** Keep tiles around world (px, pz) at the right detail; finished tiles go in for up to `budget` ms per call. */
    update(px: number, pz: number, budget = 6) {
      originXZ.value.set(origin.x, origin.z);
      ccx = Math.floor(px / CHUNK);
      ccz = Math.floor(pz / CHUNK);
      for (const [k, t] of loaded) {
        const [cx, cz] = k.split(',').map(Number);
        if (ring(cx, cz) <= last + 1) continue;
        remove(t);
        loaded.delete(k);
      }
      const until = performance.now() + budget;
      while (done.length > 0 && performance.now() < until) {
        const t = done.shift()!;
        const k = key(t.cx, t.cz);
        if (asked.get(k) === t.lod) asked.delete(k);
        if (lodAt(t.cx, t.cz) !== t.lod) continue; // the car moved on; it is wanted at another detail now
        const old = loaded.get(k);
        loaded.set(k, place(t));
        if (old) remove(old);
      }
      if (idle.length === 0) return;
      // Ask for what is missing or at the wrong detail, nearest first.
      const wanted: [number, number, number, number][] = [];
      for (let dx = -last; dx <= last; dx++) {
        for (let dz = -last; dz <= last; dz++) {
          const cx = ccx + dx;
          const cz = ccz + dz;
          const lod = lodAt(cx, cz);
          const k = key(cx, cz);
          if (loaded.get(k)?.lod === lod || asked.get(k) === lod) continue;
          wanted.push([ring(cx, cz), cx, cz, lod]);
        }
      }
      wanted.sort((a, b) => a[0] - b[0]);
      for (const [, cx, cz, lod] of wanted) {
        const w = idle.pop();
        if (!w) break;
        asked.set(key(cx, cz), lod);
        w.postMessage({ seed, cx, cz, lod });
      }
    },
    /** Are the full-detail tiles under and around world (x, z) in? */
    ready(x: number, z: number) {
      const cx = Math.floor(x / CHUNK);
      const cz = Math.floor(z / CHUNK);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (loaded.get(key(cx + dx, cz + dz))?.lod !== 0) return false;
      return true;
    },
    /** Floating origin: move everything back by (sx, sz). */
    shift(sx: number, sz: number) {
      for (const t of loaded.values()) {
        t.group.position.x -= sx;
        t.group.position.z -= sz;
        if (!t.body) continue;
        const p = t.body.translation();
        t.body.setTranslation({ x: p.x - sx, y: p.y, z: p.z - sz }, false);
      }
    },
    stations: () => [...loaded.values()].flatMap((t) => t.stations),
    get count() {
      return loaded.size;
    },
  };
}
