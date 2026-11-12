import * as THREE from 'three';
import { CAMERA_CONFIG, CITY_CONFIG, FLIGHT_CONFIG } from '../config.ts';
import type { FlightControlOutput, FlightMode } from '../vision/types.ts';
import { getBuildingBoxAt, getSurfaceHeightAt } from './city.ts';
import { GAME_CONFIG } from './rules/gameConfig.ts';

export interface FlightPhysicsState {
  position: THREE.Vector3;
  headingRad: number; // 0 = North (-Z), +PI/2 = East (+X)
  pitchRad: number;
  rollRad: number;
  speedMps: number;
  verticalVelMps: number;
  groundHeightM: number;
  altitudeAglM: number;
  mode: FlightMode;
  impactShake: number; // 0..1 decaying collision feedback
  lastImpactSpeedMps: number;
  forwardVec: THREE.Vector3;
  frameCounter: number;
  timeSec: number;
}

const TEMP_CAM_POS = new THREE.Vector3();
const TEMP_LOOK_AT = new THREE.Vector3();
const TEMP_CAM_FWD = new THREE.Vector3();

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function createInitialFlightState(speedMultiplier = 1.0): FlightPhysicsState {
  const startHeading = CITY_CONFIG.startHeadingRad;
  return {
    position: new THREE.Vector3(0, CITY_CONFIG.startAltitudeM, 0),
    headingRad: startHeading,
    pitchRad: -0.02,
    rollRad: 0,
    speedMps: FLIGHT_CONFIG.glideSpeedMps * speedMultiplier,
    verticalVelMps: FLIGHT_CONFIG.glideSinkMps,
    groundHeightM: 0,
    altitudeAglM: CITY_CONFIG.startAltitudeM,
    mode: '활공',
    impactShake: 0,
    lastImpactSpeedMps: 0,
    forwardVec: new THREE.Vector3(Math.sin(startHeading), 0, -Math.cos(startHeading)),
    frameCounter: 0,
    timeSec: 0,
  };
}

export class FlightController {
  readonly state: FlightPhysicsState;
  private cameraPosInitialized = false;

  constructor(speedMultiplier = 1.0) {
    this.state = createInitialFlightState(speedMultiplier);
  }

  reset(speedMultiplier = 1.0): void {
    const fresh = createInitialFlightState(speedMultiplier);
    this.state.position.copy(fresh.position);
    this.state.headingRad = fresh.headingRad;
    this.state.pitchRad = fresh.pitchRad;
    this.state.rollRad = fresh.rollRad;
    this.state.speedMps = fresh.speedMps;
    this.state.verticalVelMps = fresh.verticalVelMps;
    this.state.groundHeightM = fresh.groundHeightM;
    this.state.altitudeAglM = fresh.altitudeAglM;
    this.state.mode = fresh.mode;
    this.state.impactShake = 0;
    this.state.lastImpactSpeedMps = 0;
    this.state.forwardVec.copy(fresh.forwardVec);
    this.state.frameCounter = 0;
    this.cameraPosInitialized = false;
  }

  /**
   * Advances flight physics using speedMultiplier across glide, flap, dive, climb, and turn speeds.
   * Returns `true` if the bird collided with a building wall during this step.
   */
  step(
    control: FlightControlOutput,
    dtSec: number,
    options?: { isExhausted?: boolean; speedMultiplier?: number }
  ): boolean {
    const dt = clamp(dtSec, 0.001, 0.05);
    const s = this.state;
    const isExhausted = Boolean(options?.isExhausted);
    const speedMult = options?.speedMultiplier ?? 1.0;

    const glideSpeed = FLIGHT_CONFIG.glideSpeedMps * speedMult;
    const flapMaxSpeed = FLIGHT_CONFIG.flapMaxSpeedMps * speedMult;
    const diveMaxSpeed = FLIGHT_CONFIG.diveMaxSpeedMps * speedMult;
    const flapMaxClimb = FLIGHT_CONFIG.flapMaxClimbMps * speedMult;
    const maxTurnRate = FLIGHT_CONFIG.maxTurnRateRadPerSec * speedMult;

    s.timeSec += dt;
    s.frameCounter += 1;

    // 1. Turning & Banking
    const combinedTurn = clamp(control.turn + control.wingYawAssist, -1, 1);
    const turnRateScale = 1 - control.diveStrength * 0.25;
    s.headingRad += combinedTurn * maxTurnRate * turnRateScale * dt;

    const targetRoll = combinedTurn * THREE.MathUtils.degToRad(FLIGHT_CONFIG.maxBankDeg);
    s.rollRad = lerp(s.rollRad, targetRoll, 1 - Math.exp(-8.5 * dt));

    // 2. Speed, Pitch & Vertical Velocity based on Mode & Exhaustion
    const rawFlap = clamp(control.flapPower, 0, 1);
    const rawImpulse = clamp(control.flapImpulse ?? 0, 0, 1);
    const dive = clamp(control.diveStrength, 0, 1);
    const isFlapping = !control.isDiving && (rawFlap > 0.14 || rawImpulse > 0.25);

    let targetSpeed = glideSpeed;
    let targetVerticalVel: number = FLIGHT_CONFIG.glideSinkMps;
    let targetPitchRad = -0.025;

    if (dive > 0.12 && control.isDiving) {
      s.mode = '하강';
      targetSpeed = lerp(glideSpeed, diveMaxSpeed, dive);
      const maxDiveRad = THREE.MathUtils.degToRad(FLIGHT_CONFIG.diveMaxPitchDeg);
      targetPitchRad = -lerp(0.18, maxDiveRad, dive);
      targetVerticalVel = Math.sin(targetPitchRad) * Math.max(s.speedMps, targetSpeed * 0.7);
    } else if (isFlapping) {
      s.mode = '날갯짓';
      const liftBlend = clamp(rawFlap + rawImpulse * 0.45, 0, 1);
      targetSpeed = lerp(glideSpeed, flapMaxSpeed, isExhausted ? liftBlend * 0.5 : liftBlend);

      // Base climb rate: flapPower * 7 + flapImpulse * 6, scaled by speedMultiplier, guaranteed >= +2 m/s
      let climbMps =
        (rawFlap * flapMaxClimb + rawImpulse * FLIGHT_CONFIG.flapImpulseClimbMps * speedMult);
      climbMps = Math.max(FLIGHT_CONFIG.flapMinClimbMps, climbMps);

      // Exhaustion weakens lift to 30% rather than completely cancelling ascent
      if (isExhausted) {
        climbMps *= 0.3;
      }

      // Natural glide sink is disabled while actively flapping
      targetVerticalVel = climbMps;

      // Visual climb attitude pitches clearly upward up to +25 degrees (0.436 rad)
      const minFlapPitch = THREE.MathUtils.degToRad(8);
      const maxFlapPitch = THREE.MathUtils.degToRad(FLIGHT_CONFIG.flapMaxPitchDeg);
      targetPitchRad = lerp(
        minFlapPitch,
        isExhausted ? maxFlapPitch * 0.55 : maxFlapPitch,
        liftBlend
      );
    } else if (isExhausted) {
      s.mode = '활공';
      targetSpeed = Math.max(FLIGHT_CONFIG.collisionMinSpeedMps * 0.9, glideSpeed * 0.85);
      targetVerticalVel = GAME_CONFIG.exhaustedSinkSpeedMps;
      targetPitchRad = -0.14;
    } else {
      s.mode = '활공';
      targetSpeed = glideSpeed;
      // Do not apply natural sink if gentle flapping is present
      targetVerticalVel = rawFlap > 0.2 ? 0 : FLIGHT_CONFIG.glideSinkMps;
      targetPitchRad = -0.03;
    }

    if (s.position.y > FLIGHT_CONFIG.maxAltitudeM - 25) {
      const ceilingFactor = clamp(
        (s.position.y - (FLIGHT_CONFIG.maxAltitudeM - 25)) / 25,
        0,
        1
      );
      targetVerticalVel = Math.min(targetVerticalVel, lerp(targetVerticalVel, -4.0, ceilingFactor));
      targetPitchRad = Math.min(targetPitchRad, -0.08 * ceilingFactor);
    }

    // Gentle speed smoothing (speedLerpRate = 1.5), brisk climb response so pulses surge cleanly
    const speedBlend = 1 - Math.exp(-FLIGHT_CONFIG.speedLerpRate * dt);
    const vertBlend =
      targetVerticalVel > s.verticalVelMps ? 1 - Math.exp(-10.0 * dt) : 1 - Math.exp(-5.0 * dt);
    s.speedMps = lerp(s.speedMps, targetSpeed, speedBlend);
    s.verticalVelMps = lerp(s.verticalVelMps, targetVerticalVel, vertBlend);
    s.pitchRad = lerp(s.pitchRad, targetPitchRad, 1 - Math.exp(-6.5 * dt));

    // 3. Integrate World Position (vertical velocity applied directly, independent from visual pitch)
    const fwdX = Math.sin(s.headingRad);
    const fwdZ = -Math.cos(s.headingRad);
    const horizFactor = Math.max(0.45, Math.cos(s.pitchRad));
    const horizSpeed = s.speedMps * horizFactor;

    s.position.x += fwdX * horizSpeed * dt;
    s.position.z += fwdZ * horizSpeed * dt;
    s.position.y += s.verticalVelMps * dt;

    s.forwardVec
      .set(fwdX * Math.cos(s.pitchRad), Math.sin(s.pitchRad), fwdZ * Math.cos(s.pitchRad))
      .normalize();

    // 4. Deterministic Surface Height (flat 0m ground or exact building rooftop) + 8m cushion
    s.groundHeightM = getSurfaceHeightAt(s.position.x, s.position.z);
    const minSafeY = s.groundHeightM + FLIGHT_CONFIG.minAltitudeAglM;
    if (s.position.y < minSafeY) {
      const penetration = minSafeY - s.position.y;
      s.position.y = lerp(s.position.y, minSafeY, clamp(0.25 + penetration * 0.08, 0.25, 0.95));
      if (s.verticalVelMps < 1.5) {
        s.verticalVelMps = Math.max(2.0, s.verticalVelMps + penetration * 1.4);
      }
      if (s.pitchRad < 0) {
        s.pitchRad = lerp(s.pitchRad, 0.06, 0.35);
      }
    }

    if (s.position.y > FLIGHT_CONFIG.maxAltitudeM) {
      s.position.y = FLIGHT_CONFIG.maxAltitudeM;
      s.verticalVelMps = Math.min(0, s.verticalVelMps);
    }

    // 5. Deterministic Procedural Building Wall Collision & Bounce (floor speed >= 8 m/s)
    let hitBuilding = false;
    const probeDist = 4.5;
    const box =
      getBuildingBoxAt(s.position.x, s.position.z, 2.5) ??
      getBuildingBoxAt(s.position.x + fwdX * probeDist, s.position.z + fwdZ * probeDist, 2.0);

    if (box && s.position.y < box.height - 1.5) {
      hitBuilding = true;
      const dx = s.position.x - box.cx;
      const dz = s.position.z - box.cz;
      const penX = box.halfW + 3.0 - Math.abs(dx);
      const penZ = box.halfD + 3.0 - Math.abs(dz);

      let nx = 0;
      let nz = 0;
      if (penX < penZ) {
        nx = Math.sign(dx || 1);
        s.position.x = box.cx + nx * (box.halfW + 3.2);
      } else {
        nz = Math.sign(dz || 1);
        s.position.z = box.cz + nz * (box.halfD + 3.2);
      }

      const crossY = fwdX * nz - fwdZ * nx;
      const normalImpactDot = Math.abs(fwdX * nx + fwdZ * nz);
      s.lastImpactSpeedMps = s.speedMps * normalImpactDot;

      s.headingRad += Math.sign(crossY || 1) * 0.36;
      s.position.y += 1.6;
      s.verticalVelMps = Math.max(s.verticalVelMps, 4.2);

      const minBounceSpeed = Math.min(FLIGHT_CONFIG.collisionMinSpeedMps, glideSpeed);
      s.speedMps = Math.max(minBounceSpeed, s.speedMps * FLIGHT_CONFIG.collisionSpeedFactor);
      s.impactShake = 1.0;
    }

    s.impactShake = Math.max(0, s.impactShake - dt * 2.8);
    s.altitudeAglM = Math.max(0, s.position.y - s.groundHeightM);
    return hitBuilding;
  }

  applyBirdTransform(birdGroup: THREE.Object3D): void {
    const s = this.state;
    birdGroup.position.copy(s.position);
    birdGroup.rotation.order = 'YXZ';
    birdGroup.rotation.set(s.pitchRad, -s.headingRad, -s.rollRad);
  }

  updateChaseCamera(camera: THREE.PerspectiveCamera, control: FlightControlOutput, dtSec: number): void {
    const dt = clamp(dtSec, 0.001, 0.05);
    const s = this.state;

    const fwdX = Math.sin(s.headingRad);
    const fwdZ = -Math.cos(s.headingRad);
    TEMP_CAM_FWD.set(fwdX, clamp(Math.sin(s.pitchRad) * 0.35, -0.35, 0.25), fwdZ).normalize();

    const bob =
      Math.sin(s.timeSec * 12.0) *
      CAMERA_CONFIG.flapBobAmplitudeM *
      Math.max(control.flapPower, (control.flapImpulse ?? 0) * 0.6) *
      (1 - control.diveStrength);
    const shakeScale = s.impactShake * s.impactShake * 0.45;
    const shakeX = Math.sin(s.timeSec * 52.0) * shakeScale;
    const shakeY = Math.cos(s.timeSec * 61.0) * shakeScale;

    TEMP_CAM_POS.set(
      s.position.x - TEMP_CAM_FWD.x * CAMERA_CONFIG.distanceBackM + shakeX,
      s.position.y -
        TEMP_CAM_FWD.y * CAMERA_CONFIG.distanceBackM +
        CAMERA_CONFIG.heightUpM +
        bob +
        shakeY,
      s.position.z - TEMP_CAM_FWD.z * CAMERA_CONFIG.distanceBackM
    );

    if (!this.cameraPosInitialized) {
      camera.position.copy(TEMP_CAM_POS);
      this.cameraPosInitialized = true;
    } else {
      // Scale chase camera lerp proportionally with current flight speed so slow flight feels relaxed
      const speedProportionalLerp = 3.8 + (s.speedMps / FLIGHT_CONFIG.glideSpeedMps) * 2.4;
      camera.position.lerp(TEMP_CAM_POS, 1 - Math.exp(-speedProportionalLerp * dt));
    }

    const minCamY = s.groundHeightM + 2.5;
    if (camera.position.y < minCamY) {
      camera.position.y = minCamY;
    }

    TEMP_LOOK_AT.set(
      s.position.x + s.forwardVec.x * CAMERA_CONFIG.lookAheadM,
      s.position.y + s.forwardVec.y * CAMERA_CONFIG.lookAheadM + 0.6,
      s.position.z + s.forwardVec.z * CAMERA_CONFIG.lookAheadM
    );
    camera.lookAt(TEMP_LOOK_AT);

    const speedNorm = clamp(
      (s.speedMps - FLIGHT_CONFIG.glideSpeedMps) /
        Math.max(1, FLIGHT_CONFIG.diveMaxSpeedMps - FLIGHT_CONFIG.glideSpeedMps),
      0,
      1
    );
    const targetFov = lerp(
      CAMERA_CONFIG.fovBaseDeg,
      CAMERA_CONFIG.fovDiveDeg,
      Math.max(control.diveStrength, speedNorm * 0.75)
    );
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-5.0 * dt));
      camera.updateProjectionMatrix();
    }
  }
}
