// Chase mode: police cars, then a helicopter, chase the player while it is on. GTA's rules, kept small: heat rises the
// longer they see you; stay out of everyone's sight long enough to escape; stop beside a police car to be busted.
// Pure of three.js and the DOM, so node --test can run a chase; main.ts draws it (police.ts) and plays it.
import { createAutodrive } from './autodrive.ts';
import { RAPIER, type Car, type Intent, createCar } from './physics.ts';
import { CHUNK } from './world/chunk.ts';
import { laneOf } from './world/roads.ts';
import type { World } from './world/world.ts';

/**
 * Per difficulty: police cars on the road at each heat level (1–5); their engines (`power`) and tyres (`grip`); how much
 * faster than the player they drive when close (`push`, m/s) and when touching it (`ram`: below its speed backs off,
 * above shoves), and where they aim (`aim`, m ahead of the player: behind tails, ahead noses in); the heat at which the helicopter comes and its speed; how far they see; seconds out of sight
 * to escape (half as long again with the helicopter up) and stopped beside a police car to be busted.
 */
export const LEVELS = {
  easy: { units: [1, 1, 2, 2, 3], power: 0.9, grip: 1.5, push: 1, ram: -2, aim: -8, heli: 4, heliSpeed: 28, sight: 110, escape: 7, bust: 4 },
  normal: { units: [1, 2, 3, 3, 4], power: 1.05, grip: 1.7, push: 4, ram: 0, aim: 0, heli: 3, heliSpeed: 36, sight: 140, escape: 10, bust: 3 },
  hard: { units: [2, 3, 4, 5, 6], power: 1.2, grip: 1.9, push: 7, ram: 3, aim: 2.5, heli: 2, heliSpeed: 44, sight: 170, escape: 14, bust: 2 },
};
export type Level = keyof typeof LEVELS;
export const MAX_UNITS = 6;

const HEAT_STEP = 30; // s seen per heat level
const FIRST = 5; // s from switching the mode on to the first chase
const CALM = 40; // s between chases
const PAUSE = 3; // s a busted car is held before it goes back on the road
const EVERY = 3; // s between police cars joining
const SPAWN = [110, 170]; // m from the player: on a road, out of sight round the bends
const BEHIND = 60; // m beyond which a police car closing in along the roads uses its nitro, so it catches a fast player
const UNSEEN = 45; // s a chase lasts if the police never see the player at all
const CLOSE = 70; // m within which a police car drives straight at the player rather than along the roads
const LOST = 450; // m beyond which a police car drops out (another comes if wanted)
const CRUISE = 45; // m/s along the roads
const SET_DOWN = 0.9; // m above the road a car is put down
const WHEELBASE = 2.65;
// Where police cars stop around a slow player, in the player's frame (m to its left, m ahead): front, sides, back.
const SLOTS = [[0, 6.5], [3.6, 0], [-3.6, 0], [0, -6.5]];

/** A drawn pose: x, y, z, then the rotation quaternion x, y, z, w. */
export type Pose = Float64Array;

export interface Unit {
  car: Car;
  slot: number; // which of the drawn police cars it is
  intent: Intent;
  prev: Pose; // before and after the last physics step, for drawing between them
  curr: Pose;
  stuck: number; // s with the throttle down and no speed
  back: number; // s left reversing out of trouble
  flipped: number; // s on its side or roof
  sees: boolean;
}

export interface Heli {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  orbit: number; // angle round the player
  leaving: boolean;
  sees: boolean;
}

export type Chase = ReturnType<typeof createChase>;
type Player = { x: number; y: number; z: number; vx: number; vz: number; yaw: number; speed: number };

/**
 * Police for `player` in the Rapier `physics` world, at positions relative to the floating `origin`. `reset` puts the
 * player back on the road after a bust. Off until `set` picks a level.
 */
export function createChase(physics: RAPIER.World, world: World, origin: { x: number; z: number }, player: Car, reset: () => void) {
  const units: Unit[] = [];
  let heli: Heli | null = null;
  let level: Level | null = null;
  let phase: 'calm' | 'chase' | 'busted' = 'calm';
  let wait = FIRST; // s left of the calm, or of the bust
  let time = 0; // s into the chase
  let seenFor = 0; // s the police have seen the player in this chase
  let lost = 0; // s since anyone saw the player
  let spotted = false; // seen at all yet (until then the police are sent to the player)
  let bust = 0; // s stopped beside a police car
  let spawnIn = 0;
  const last = { x: 0, z: 0, vx: 0, vz: 0 }; // where the player was last seen
  const roads = createAutodrive(world, 5); // police take bends harder than the calm autodrive

  function playerNow(): Player {
    const t = player.body.translation();
    const v = player.body.linvel();
    return { x: t.x, y: t.y, z: t.z, vx: v.x, vz: v.z, yaw: yawOf(player.body.rotation()), speed: player.speed() };
  }

  const heat = () => (phase === 'chase' && spotted ? Math.min(5, 1 + Math.floor(seenFor / HEAT_STEP)) : 0);
  const escapeAfter = () => (level ? LEVELS[level].escape * (heli && !heli.leaving ? 1.5 : 1) : 0);

  /** Is there a clear line from a to b no longer than `range`? Hills, buildings, walls and trunks block it; cars do not. */
  function sight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, range: number) {
    const [dx, dy, dz] = [bx - ax, by - ay, bz - az];
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return false;
    const ray = new RAPIER.Ray({ x: ax, y: ay, z: az }, { x: dx / d, y: dy / d, z: dz / d });
    const hit = physics.castRay(ray, d, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    return !hit || hit.timeOfImpact > d - 1;
  }

  /** A police car on a road SPAWN m from the player, behind or ahead of it, driving toward it in its right lane. */
  function spawn(p: Player, ahead: boolean): boolean {
    const [wx, wz] = [p.x + origin.x, p.z + origin.z];
    const [fx, fz] = [Math.sin(p.yaw), Math.cos(p.yaw)];
    let best: { x: number[]; z: number[]; h: number[]; k: number; lane: number } | null = null;
    let score = -Infinity;
    for (const r of world.area(Math.floor(wx / CHUNK), Math.floor(wz / CHUNK)).roads) {
      for (let k = 1; k + 1 < r.x.length; k += 2) {
        const [dx, dz] = [r.x[k] - wx, r.z[k] - wz];
        const d = Math.hypot(dx, dz);
        if (d < SPAWN[0] || d > SPAWN[1]) continue;
        if (units.some((u) => Math.hypot(u.curr[0] + origin.x - r.x[k], u.curr[2] + origin.z - r.z[k]) < 20)) continue;
        const s = ((dx * fx + dz * fz) / d) * (ahead ? 1 : -1) + Math.random() * 0.6;
        if (s > score) [score, best] = [s, { x: r.x, z: r.z, h: r.h, k, lane: laneOf(r) }];
      }
    }
    if (!best) return false;
    const { k, lane } = best;
    let [tx, tz] = [best.x[k + 1] - best.x[k - 1], best.z[k + 1] - best.z[k - 1]];
    const l = Math.hypot(tx, tz) || 1;
    [tx, tz] = [tx / l, tz / l];
    if (tx * (wx - best.x[k]) + tz * (wz - best.z[k]) < 0) [tx, tz] = [-tx, -tz]; // toward the player
    const x = best.x[k] - tz * lane - origin.x; // the right of (tx, tz) is (-tz, tx)
    const z = best.z[k] + tx * lane - origin.z;
    const y = best.h[k];
    // Only where the ground is loaded: colliders exist within two chunks of the player.
    if (!physics.castRay(new RAPIER.Ray({ x, y: y + 4, z }, { x: 0, y: -1, z: 0 }), 10, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)) return false;
    const car = createCar(physics, x, y + SET_DOWN, z, Math.atan2(tx, tz), LEVELS[level!]);
    const v0 = Math.min(40, Math.max(8, Math.abs(p.speed))); // they come in already moving, as fast as the player
    car.body.setLinvel({ x: tx * v0, y: 0, z: tz * v0 }, true);
    const slot = [...Array(MAX_UNITS).keys()].find((s) => !units.some((u) => u.slot === s))!;
    const u: Unit = { car, slot, intent: { steer: 0, throttle: 0, brake: 0 }, prev: new Float64Array(7), curr: new Float64Array(7), stuck: 0, back: 0, flipped: 0, sees: false };
    pose(car, u.curr);
    u.prev.set(u.curr);
    units.push(u);
    return true;
  }

  function drop(u: Unit) {
    physics.removeVehicleController(u.car.vehicle);
    physics.removeRigidBody(u.car.body);
    units.splice(units.indexOf(u), 1);
  }

  function clear() {
    while (units.length) drop(units[0]);
    if (heli) heli.leaving = true;
    bust = 0;
  }

  /** Pedals and steering for one police car. */
  function think(u: Unit, dt: number, p: Player, seen: boolean): Intent {
    const t = u.car.body.translation();
    const yaw = yawOf(u.car.body.rotation());
    const v = u.car.speed();
    const L = LEVELS[level!];
    if (phase === 'busted') return { steer: 0, throttle: 0, brake: v > 1 ? 1 : 0 };
    // Where to go: where the player is going while they see it (or before anyone has), else where it was last seen,
    // carried on a little the way it was going.
    let gx: number;
    let gz: number;
    if (seen || !spotted) {
      const lead = Math.min(Math.hypot(p.x - t.x, p.z - t.z) / 30, 1.5);
      [gx, gz] = [p.x + p.vx * lead, p.z + p.vz * lead];
    } else {
      const on = Math.min(lost, 3);
      [gx, gz] = [last.x + last.vx * on, last.z + last.vz * on];
    }
    const d = Math.hypot(gx - t.x, gz - t.z);
    const front = ((gx - t.x) * Math.sin(yaw) + (gz - t.z) * Math.cos(yaw)) / (d || 1);
    const oncoming = Math.sin(yaw) * Math.sin(p.yaw) + Math.cos(yaw) * Math.cos(p.yaw) < -0.3 && Math.abs(p.speed) > 12;
    let intent: Intent;
    if (seen && Math.abs(p.speed) < 5 && d < 30) {
      // Box the player in: make for the nearest side of it no other police car holds, and stop there or close by.
      let ds = Infinity;
      for (const [left, ahead] of SLOTS) {
        const sx = p.x + Math.cos(p.yaw) * left + Math.sin(p.yaw) * ahead;
        const sz = p.z - Math.sin(p.yaw) * left + Math.cos(p.yaw) * ahead;
        const dist = Math.hypot(sx - t.x, sz - t.z);
        if (dist < ds && !units.some((o) => o !== u && Math.hypot(o.curr[0] - sx, o.curr[2] - sz) < 4)) [ds, gx, gz] = [dist, sx, sz];
      }
      const stop = ds < 2.5 || Math.hypot(p.x - t.x, p.z - t.z) < 7;
      intent = { steer: steerAt(t.x, t.z, yaw, v, gx, gz), ...pedals(v, stop ? 0 : Math.min(10, ds * 0.8)) };
    } else if ((d < CLOSE && !(oncoming && front > 0)) || (front < 0 && d < 150)) {
      // Close, or the player is behind: straight at it, cutting across whatever is in the way; turning round first.
      if (seen) [gx, gz] = [gx + Math.sin(p.yaw) * L.aim, gz + Math.cos(p.yaw) * L.aim];
      const touching = Math.hypot(p.x - t.x, p.z - t.z) < 8;
      const speed = front < 0 ? 8 : Math.abs(p.speed) + (touching ? L.ram : L.push + Math.min(12, Math.max(0, (d - 15) * 0.3)));
      intent = { steer: steerAt(t.x, t.z, yaw, v, gx, gz), ...pedals(v, speed) };
    } else {
      // Along the roads, taking the way toward the player at each junction, on nitro while far behind; an oncoming car
      // slows to turn round.
      const cruise = oncoming ? 12 : CRUISE;
      intent = roads.drive(t.x + origin.x, t.z + origin.z, yaw, v, [gx + origin.x, gz + origin.z], cruise) ?? { steer: steerAt(t.x, t.z, yaw, v, gx, gz), ...pedals(v, 25) };
      intent.boost = !oncoming && d > BEHIND ? 1 : 0;
    }
    // Stuck against something: back out, turning the other way.
    if (u.back > 0) {
      u.back -= dt;
      return { steer: -intent.steer, throttle: 0, brake: 1 };
    }
    u.stuck = intent.throttle > 0.3 && Math.abs(v) < 1 ? u.stuck + dt : 0;
    if (u.stuck > 1.5) [u.stuck, u.back] = [0, 1.2];
    return intent;
  }

  /** The helicopter: circles the player (or where it was last seen), slower than a car flat out; or flies away. */
  function fly(h: Heli, dt: number, p: Player) {
    const L = LEVELS[level ?? 'normal'];
    let gx: number;
    let gy: number;
    let gz: number;
    if (h.leaving) {
      const [ax, az] = [h.x - p.x, h.z - p.z];
      const l = Math.hypot(ax, az) || 1;
      [gx, gy, gz] = [h.x + (ax / l) * 200, p.y + 120, h.z + (az / l) * 200];
    } else {
      h.orbit += dt * 0.3;
      const [cx, cz] = lost > 0 ? [last.x, last.z] : [p.x, p.z];
      [gx, gz] = [cx + Math.cos(h.orbit) * 55, cz + Math.sin(h.orbit) * 55]; // low and wide enough to be seen from the car
      gy = Math.max(p.y, world.heightAt(gx + origin.x, gz + origin.z)) + 30;
    }
    const [dx, dy, dz] = [gx - h.x, gy - h.y, gz - h.z];
    const d = Math.hypot(dx, dy, dz) || 1;
    const want = Math.min(L.heliSpeed, d * 0.6);
    const k = 1 - Math.exp(-1.2 * dt);
    h.vx += ((dx / d) * want - h.vx) * k;
    h.vy += ((dy / d) * want - h.vy) * k;
    h.vz += ((dz / d) * want - h.vz) * k;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.z += h.vz * dt;
    // Nose toward the player while it circles, along its way when it flies fast or leaves.
    const turn = Math.hypot(h.vx, h.vz) > 20 || h.leaving ? Math.atan2(h.vx, h.vz) : Math.atan2(p.x - h.x, p.z - h.z);
    h.yaw += Math.atan2(Math.sin(turn - h.yaw), Math.cos(turn - h.yaw)) * Math.min(1, dt * 1.5);
  }

  return {
    units,
    get heli() {
      return heli;
    },
    get level() {
      return level;
    },
    get phase() {
      return phase;
    },
    /** 1–5 during a chase once the player has been seen, else 0. */
    get heat() {
      return heat();
    },
    get time() {
      return time;
    },
    /** Seconds out of everyone's sight, and how many it takes to escape. */
    get lost() {
      return spotted ? lost : 0;
    },
    get escape() {
      return escapeAfter();
    },
    /** 0–1: how near the player is to being busted. */
    get bust() {
      return level ? Math.min(1, bust / LEVELS[level].bust) : 0;
    },
    /** Chase mode at a difficulty, or off (null): either way, any chase on now ends. */
    set(to: Level | null) {
      clear();
      heli = null;
      level = to;
      phase = 'calm';
      wait = FIRST;
    },
    /** Once a frame: who sees whom, heat, escape and bust, police joining and leaving, what each one does. */
    update(dt: number): 'police' | 'busted' | 'escaped' | null {
      const p = playerNow();
      if (heli) {
        fly(heli, dt, p);
        if (heli.leaving && Math.hypot(heli.x - p.x, heli.z - p.z) > 700) heli = null;
      }
      if (!level) return null;
      const L = LEVELS[level];
      if (phase === 'calm') {
        if ((wait -= dt) > 0) return null;
        [phase, time, seenFor, lost, spotted, bust, spawnIn] = ['chase', 0, 0, 0, false, 0, 0];
        return 'police';
      }
      if (phase === 'busted') {
        for (const u of units) u.intent = think(u, dt, p, true);
        if ((wait -= dt) > 0) return null;
        clear();
        reset();
        [phase, wait] = ['calm', CALM];
        return null;
      }
      time += dt;
      let seen = false;
      for (const u of units) {
        const t = u.car.body.translation();
        u.sees = sight(t.x, t.y + 1.2, t.z, p.x, p.y + 1, p.z, L.sight);
        seen ||= u.sees;
      }
      if (heli && !heli.leaving) {
        heli.sees = Math.hypot(heli.x - p.x, heli.z - p.z) < L.sight * 1.2 && sight(heli.x, heli.y - 2, heli.z, p.x, p.y + 1, p.z, 400);
        seen ||= heli.sees;
      }
      if (seen) {
        [spotted, lost] = [true, 0];
        seenFor += dt;
        Object.assign(last, { x: p.x, z: p.z, vx: p.vx, vz: p.vz });
      } else lost += dt;
      if (lost >= (spotted ? escapeAfter() : UNSEEN)) {
        clear();
        [phase, wait] = ['calm', CALM];
        return 'escaped';
      }
      const beside = units.some((u) => Math.hypot(u.curr[0] - p.x, u.curr[2] - p.z) < 8);
      bust = spotted && beside && Math.abs(p.speed) < 2 ? bust + dt : Math.max(0, bust - dt);
      if (bust >= L.bust) {
        [phase, wait] = ['busted', PAUSE];
        if (heli) heli.leaving = true;
        return 'busted';
      }
      // Police come (out of sight, while they know where the player is) and go (far behind, crashed, in the sea).
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        const t = u.car.body.translation();
        const r = u.car.body.rotation();
        u.flipped = 1 - 2 * (r.x * r.x + r.z * r.z) < 0.3 ? u.flipped + dt : 0;
        if (Math.hypot(t.x - p.x, t.z - p.z) > LOST || t.y < -3 || u.flipped > 2.5) drop(u);
      }
      const level5 = heat() || 1;
      if ((spawnIn -= dt) <= 0 && units.length < L.units[level5 - 1] && (!spotted || lost === 0)) spawnIn = spawn(p, units.length % 2 === 1) ? EVERY : 0.5;
      if (!heli && level5 >= L.heli) {
        const [bx, bz] = [-Math.sin(p.yaw) * 350, -Math.cos(p.yaw) * 350];
        heli = { x: p.x + bx, y: p.y + 90, z: p.z + bz, vx: 0, vy: 0, vz: 0, yaw: p.yaw, orbit: Math.atan2(bz, bx), leaving: false, sees: false };
      }
      for (const u of units) u.intent = think(u, dt, p, seen);
      return null;
    },
    /** Each fixed step, before the physics: drive. */
    step(dt: number) {
      for (const u of units) {
        u.prev.set(u.curr);
        u.car.update(u.intent, dt);
      }
    },
    /** Each fixed step, after the physics: where they are now. */
    snapshot() {
      for (const u of units) pose(u.car, u.curr);
    },
    /** Floating origin: move everything back by (sx, sz). */
    shift(sx: number, sz: number) {
      for (const u of units) {
        const t = u.car.body.translation();
        u.car.body.setTranslation({ x: t.x - sx, y: t.y, z: t.z - sz }, true);
        for (const q of [u.prev, u.curr]) [q[0], q[2]] = [q[0] - sx, q[2] - sz];
      }
      if (heli) [heli.x, heli.z] = [heli.x - sx, heli.z - sz];
      [last.x, last.z] = [last.x - sx, last.z - sz];
    },
  };
}

/** Heading of a body: 0 faces +z. */
function yawOf(q: { x: number; y: number; z: number; w: number }) {
  return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
}

function pose(car: Car, out: Pose) {
  const t = car.body.translation();
  const r = car.body.rotation();
  out.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w]);
}

/** Pure pursuit toward (gx, gz); full lock toward it when it is behind. */
function steerAt(x: number, z: number, yaw: number, v: number, gx: number, gz: number) {
  const [dx, dz] = [gx - x, gz - z];
  const d = Math.hypot(dx, dz) || 1;
  const side = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d; // + is left
  if (dx * Math.sin(yaw) + dz * Math.cos(yaw) < 0) return side >= 0 ? 1 : -1;
  const lock = 0.55 - 0.4 * Math.min(Math.abs(v) / 30, 1); // the car's speed-sensitive lock
  return Math.max(-1, Math.min(1, Math.atan((2 * WHEELBASE * side) / d) / lock));
}

function pedals(v: number, target: number) {
  const dv = target - v;
  return { throttle: dv > 0 ? Math.min(1, dv / 4) : 0, brake: dv < -1.5 ? Math.min(1, -dv / 6) : 0 };
}
