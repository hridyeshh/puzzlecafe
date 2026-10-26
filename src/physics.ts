// Rapier world, terrain colliders and the car. No three.js here, so node --test can drive the car.
import RAPIER from '@dimforge/rapier3d-compat';
import { CHUNK, RES } from './world.ts';

export { RAPIER };

/** Steer +1 is full left. Throttle and brake run 0..1; holding brake when stopped reverses. */
export interface Intent { steer: number; throttle: number; brake: number }

const MASS = 1200; // kg
const ENGINE = 6000; // N, peak tractive force
const POWER = 60_000; // W, caps force at speed; top speed lands near 170 km/h
const REVERSE = 2500; // N
const REVERSE_MAX = 8; // m/s
const BRAKE = 30; // Rapier brake: max braking impulse per wheel per step
const COAST = 0.75; // a little brake off-throttle stands in for rolling resistance
const DRAG = 0.45; // ½·ρ·Cd·A, N per (m/s)²
const REST = 0.35; // suspension rest length, m
const RADIUS = 0.34; // wheel radius, m

// Chassis space: +z forward, +x left, +y up. Front wheels first; they steer.
const HARDPOINTS = [
  { x: 0.8, y: -0.15, z: 1.35 },
  { x: -0.8, y: -0.15, z: 1.35 },
  { x: 0.8, y: -0.15, z: -1.3 },
  { x: -0.8, y: -0.15, z: -1.3 },
];

export async function createWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  return new RAPIER.World({ x: 0, y: -9.81, z: 0 });
}

/** A static heightfield for one chunk. Rapier centres heightfields on the collider, so pass the chunk's centre. */
export function addTerrain(world: RAPIER.World, heights: Float32Array, centreX: number, centreZ: number): RAPIER.Collider {
  const desc = RAPIER.ColliderDesc.heightfield(RES, RES, heights, { x: CHUNK, y: 1, z: CHUNK }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
  return world.createCollider(desc.setTranslation(centreX, 0, centreZ));
}

export type Car = ReturnType<typeof createCar>;

export function createCar(world: RAPIER.World, x: number, y: number, z: number) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(false));
  // A box over the wheels, with the centre of mass pulled low so the car corners without tipping.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.9, 0.3, 2.1)
      .setTranslation(0, 0.05, 0)
      .setMassProperties(MASS, { x: 0, y: -0.3, z: 0 }, { x: 1900, y: 2100, z: 450 }, { x: 0, y: 0, z: 0, w: 1 }),
    body,
  );
  const vehicle = world.createVehicleController(body);
  vehicle.indexUpAxis = 1;
  vehicle.setIndexForwardAxis = 2; // Rapier's setter for indexForwardAxis really is named this
  for (const p of HARDPOINTS) vehicle.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, REST, RADIUS);
  for (let i = 0; i < 4; i++) {
    vehicle.setWheelSuspensionStiffness(i, 30);
    vehicle.setWheelSuspensionCompression(i, 4.4);
    vehicle.setWheelSuspensionRelaxation(i, 2.3);
    vehicle.setWheelMaxSuspensionTravel(i, 0.3);
    vehicle.setWheelMaxSuspensionForce(i, 50_000);
    vehicle.setWheelFrictionSlip(i, 1.5);
  }
  let steer = 0;

  return {
    body,
    vehicle,
    /** Signed speed along the car's forward axis, m/s. */
    speed: () => vehicle.currentVehicleSpeed(),
    /** Apply one fixed step of driver input. Call before world.step(). */
    update(intent: Intent, dt: number) {
      const v = vehicle.currentVehicleSpeed();
      // Less lock at speed, and the wheel turns at a finite rate so keys feel analogue.
      const lock = 0.55 - 0.4 * Math.min(Math.abs(v) / 30, 1);
      steer += Math.max(-2 * dt, Math.min(2 * dt, intent.steer * lock - steer));
      vehicle.setWheelSteering(0, steer);
      vehicle.setWheelSteering(1, steer);

      let force = 0;
      let brake = COAST;
      if (intent.throttle > 0) force = intent.throttle * Math.min(ENGINE, POWER / Math.max(v, 1));
      else if (intent.brake > 0 && v < 1) force = v > -REVERSE_MAX ? -intent.brake * REVERSE : 0;
      else if (Math.abs(v) < 1.5) brake = BRAKE; // no input and nearly stopped: hold the car, even on a slope
      if (intent.brake > 0 && v >= 1) brake = intent.brake * BRAKE;
      for (let i = 0; i < 4; i++) {
        vehicle.setWheelEngineForce(i, force / 4);
        vehicle.setWheelBrake(i, brake);
      }

      const lv = body.linvel();
      const k = -DRAG * Math.hypot(lv.x, lv.y, lv.z) * dt; // drag impulse = -DRAG·|v|·v·dt
      body.applyImpulse({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, true);

      vehicle.updateVehicle(dt);
    },
  };
}
