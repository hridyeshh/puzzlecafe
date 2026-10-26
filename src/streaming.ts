// Streams tiles around the car: workers build them nearest first, here they become meshes, props, plants and colliders.
import * as THREE from 'three/webgpu';
import { attribute, color, float, fract, fwidth, max, mix, smoothstep, uv } from 'three/tsl';
import { RAPIER, addTerrain } from './physics.ts';
import { plantCollider, plantMeshes } from './plants.ts';
import { makeProp } from './props.ts';
import { terrainIndex } from './terrain.ts';
import { LODS, type Tile } from './tile.ts';
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
  owned: THREE.BufferGeometry[]; // geometries only this tile uses
  flora: THREE.InstancedMesh[];
  colliders: RAPIER.Collider[];
  stations: Station[];
}

const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

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
  // Asphalt about 7% reflective like the real thing; darker reads as a black hole in low sun.
  road.colorNode = mix(color(0x4a4c50), color(0xe9e6dc), max(edges, centre).mul(attribute('mark', 'float')));
}

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
    // Terrain receives shadows but casts none: with a low sun, hill shadows would end at the shadow map's edge.
    // Slopes facing away from the sun already darken through lighting.
    const terrain = new THREE.Mesh(geometry, ground);
    terrain.receiveShadow = true;
    const group = new THREE.Group().add(terrain);
    group.position.set(x, 0, z);
    const owned = [geometry];
    const colliders: RAPIER.Collider[] = [];
    if (t.collider) colliders.push(addTerrain(physics, t.collider, x, z));
    if (t.ribbon && t.ribbon.index.length > 0) {
      const ribbon = new THREE.Mesh(roadGeometry(t.ribbon), road);
      ribbon.receiveShadow = true;
      group.add(ribbon);
      owned.push(ribbon.geometry);
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
          .setTranslation(px + b.x * cos + b.z * sin, poi.base + b.y, pz - b.x * sin + b.z * cos)
          .setRotation({ x: 0, y: Math.sin(poi.yaw / 2), z: 0, w: Math.cos(poi.yaw / 2) });
        colliders.push(physics.createCollider(desc));
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
      colliders.push(physics.createCollider(desc.setTranslation(x + p[i], p[i + 1] + shape.lift, z + p[i + 2])));
    }

    scene.add(group);
    const stations = t.pois.filter((s) => s.kind === 'station').map(({ x: sx, z: sz, yaw }) => ({ x: sx, z: sz, yaw }));
    return { lod: t.lod, group, owned, flora, colliders, stations };
  }

  function remove(t: Loaded) {
    scene.remove(t.group);
    for (const g of t.owned) {
      if (g.index && indices.get(LODS[t.lod].res) === g.index) g.setIndex(null); // shared; keep it
      g.dispose();
    }
    for (const mesh of t.flora) mesh.dispose(); // its instance buffers; the shapes are shared
    for (const c of t.colliders) physics.removeCollider(c, false);
  }

  return {
    /** Keep tiles around world (px, pz) at the right detail; finished tiles go in for up to `budget` ms per call. */
    update(px: number, pz: number, budget = 6) {
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
        for (const c of t.colliders) {
          const p = c.translation();
          c.setTranslation({ x: p.x - sx, y: p.y, z: p.z - sz });
        }
      }
    },
    stations: () => [...loaded.values()].flatMap((t) => t.stations),
    get count() {
      return loaded.size;
    },
  };
}
