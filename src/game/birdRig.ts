import * as THREE from 'three';

export interface SeagullAnimationState {
  timeSec: number;
  leftFlapPower: number; // 0..1
  rightFlapPower: number; // 0..1
  leftWingElevation: number; // -1 (downstroke) .. +1 (upstroke)
  rightWingElevation: number; // -1 .. +1
  diveStrength: number; // 0..1
  turn: number; // -1 (left) .. +1 (right)
  speedRatio: number; // 0..1
  climbRateRatio: number; // -1..+1
  exhausted?: boolean;
}

export interface WingJointGroup {
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  wrist: THREE.Object3D;
  /** Feather groups fanned slightly on downstroke / tucked on upstroke & dive */
  primaryFanPivot?: THREE.Object3D;
}

export interface SeagullRigHandles {
  bodyRoot: THREE.Object3D;
  headPivot: THREE.Object3D;
  tailPivot: THREE.Object3D;
  tailFeathers: THREE.Object3D[];
  leftWing: WingJointGroup;
  rightWing: WingJointGroup;
  /** Optional external GLTF AnimationMixer / bones when seagull.glb is supplied */
  mixer?: THREE.AnimationMixer;
  externalBones?: {
    spine?: THREE.Object3D;
    head?: THREE.Object3D;
    tail?: THREE.Object3D;
    leftUpperArm?: THREE.Object3D;
    leftForearm?: THREE.Object3D;
    leftHand?: THREE.Object3D;
    rightUpperArm?: THREE.Object3D;
    rightForearm?: THREE.Object3D;
    rightHand?: THREE.Object3D;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Computes individual wing joint angles with realistic gull "M"-glide dihedral,
 * delayed whip phase during flapping, and swept delta triangle folding on dive.
 */
function updateWingJoints(
  joints: WingJointGroup,
  sideSign: -1 | 1, // -1 = left wing (-X), +1 = right wing (+X)
  flapPower: number,
  userElevation: number,
  dive: number,
  turn: number,
  timeSec: number,
  exhausted = false
): void {
  // Subtle banking compensation so inner wing dips slightly and outer wing braces during turns
  const bankingBias = -sideSign * turn * 0.14 * (1 - dive * 0.7);

  // 1. Base Gull "M"-Shape Glide Pose (droops gently when exhausted)
  const glideShoulderLift = (exhausted ? 0.08 : 0.21) + bankingBias;
  const glideElbowDip = exhausted ? -0.22 : -0.17;
  const glideWristDroop = exhausted ? -0.25 : -0.19;
  const glideShoulderSweep = 0.12;
  const glideElbowSweep = -0.16;
  const glideWristSweep = 0.24;

  // 2. Dynamic Flapping Wavefront with Phase Delay (0.10 - 0.15s whip lag)
  const effFlap = exhausted ? flapPower * 0.28 : flapPower;
  const baseOmega = 2 * Math.PI * ((exhausted ? 1.4 : 2.3) + effFlap * 1.1);
  const sidePhaseOffset = sideSign === -1 ? 0 : 0.08;
  const waveShoulder = Math.sin(timeSec * baseOmega + sidePhaseOffset);
  const waveElbow = Math.sin((timeSec - 0.065) * baseOmega + sidePhaseOffset);
  const waveWrist = Math.sin((timeSec - 0.13) * baseOmega + sidePhaseOffset);

  const driveShoulder = lerp(waveShoulder, userElevation, 0.58);
  const driveElbow = lerp(waveElbow, userElevation * 0.92, 0.42);
  const driveWrist = lerp(waveWrist, userElevation * 0.85, 0.3);

  const flapAmp = clamp(effFlap, 0, 1);
  const flapShoulderLift = driveShoulder * 0.52 * flapAmp;

  const upstrokeS = clamp(driveShoulder, 0, 1);
  const upstrokeW = clamp(driveWrist, 0, 1);
  const flapElbowLift = (driveElbow * 0.28 + upstrokeS * 0.16) * flapAmp;
  const flapWristLift = (driveWrist * 0.46 - upstrokeW * 0.34) * flapAmp;

  const strokeTwist = -driveShoulder * 0.24 * flapAmp;
  const wristFoldSweep = upstrokeW * 0.36 * flapAmp;
  const elbowFoldSweep = upstrokeS * 0.14 * flapAmp;

  // 3. Swept-Back Triangle Dive Pose
  const diveShoulderLift = -0.08;
  const diveShoulderSweep = 0.98;
  const diveElbowLift = 0.06;
  const diveElbowSweep = -0.25;
  const diveWristLift = -0.16;
  const diveWristSweep = 0.42;

  const activeWeight = 1 - dive;

  const shoulderLift =
    (glideShoulderLift + flapShoulderLift) * activeWeight + diveShoulderLift * dive;
  const shoulderSweep =
    (glideShoulderSweep + flapAmp * 0.06) * activeWeight + diveShoulderSweep * dive;

  const elbowLift = (glideElbowDip + flapElbowLift) * activeWeight + diveElbowLift * dive;
  const elbowSweep = (glideElbowSweep + elbowFoldSweep) * activeWeight + diveElbowSweep * dive;

  const wristLift = (glideWristDroop + flapWristLift) * activeWeight + diveWristLift * dive;
  const wristSweep = (glideWristSweep + wristFoldSweep) * activeWeight + diveWristSweep * dive;

  joints.shoulder.rotation.set(
    strokeTwist * activeWeight - dive * 0.12,
    -sideSign * shoulderSweep,
    sideSign * shoulderLift
  );

  joints.elbow.rotation.set(
    strokeTwist * 0.5 * activeWeight,
    -sideSign * elbowSweep,
    sideSign * elbowLift
  );

  joints.wrist.rotation.set(
    -driveWrist * 0.18 * flapAmp * activeWeight,
    -sideSign * wristSweep,
    sideSign * wristLift
  );

  if (joints.primaryFanPivot) {
    const fanSpread = lerp(0.06 - upstrokeW * 0.14 * flapAmp, -0.32, dive);
    joints.primaryFanPivot.rotation.y = -sideSign * fanSpread;
  }
}

export function updateSeagullRig(handles: SeagullRigHandles, state: SeagullAnimationState): void {
  const avgFlap = (state.leftFlapPower + state.rightFlapPower) * 0.5;
  const avgElev = (state.leftWingElevation + state.rightWingElevation) * 0.5;
  const dive = clamp(state.diveStrength, 0, 1);
  const exhausted = Boolean(state.exhausted);

  const heave =
    -avgElev * 0.11 * (exhausted ? avgFlap * 0.25 : avgFlap) * (1 - dive) +
    Math.sin(state.timeSec * 1.9) * 0.025 * (1 - avgFlap);
  handles.bodyRoot.position.y = heave;
  handles.bodyRoot.rotation.x = avgElev * 0.045 * avgFlap * (1 - dive);

  handles.headPivot.rotation.set(
    clamp(-state.climbRateRatio * 0.16 + dive * 0.14 + (exhausted ? 0.12 : 0), -0.32, 0.34),
    clamp(-state.turn * 0.2, -0.25, 0.25),
    clamp(state.turn * 0.18 * (1 - dive * 0.5), -0.22, 0.22)
  );

  updateWingJoints(
    handles.leftWing,
    -1,
    state.leftFlapPower,
    state.leftWingElevation,
    dive,
    state.turn,
    state.timeSec,
    exhausted
  );
  updateWingJoints(
    handles.rightWing,
    1,
    state.rightFlapPower,
    state.rightWingElevation,
    dive,
    state.turn,
    state.timeSec,
    exhausted
  );

  // Tail fans wider during slow flight, banking turns, or braking; narrows cleanly in dive
  const turnSpread = Math.abs(state.turn) * 0.45;
  const brakeSpread = (1 - state.speedRatio) * 0.35;
  const spreadFactor = clamp((0.28 + turnSpread + brakeSpread) * (1 - dive * 0.85), 0.08, 1);

  const count = handles.tailFeathers.length;
  const mid = (count - 1) * 0.5;
  for (let i = 0; i < count; i++) {
    const norm = mid > 0 ? (i - mid) / mid : 0; // -1..+1
    handles.tailFeathers[i].rotation.y = norm * (0.08 + spreadFactor * 0.44);
  }

  // Tail tilts gently into turn and pitches down when braking/turning
  handles.tailPivot.rotation.set(
    lerp(-0.08 - brakeSpread * 0.22 - turnSpread * 0.15, 0.05, dive),
    0,
    clamp(-state.turn * 0.25, -0.3, 0.3)
  );

  // External GLTF bone binding fallback (when seagull.glb provides named armature)
  if (handles.externalBones) {
    const eb = handles.externalBones;
    if (eb.leftUpperArm && eb.leftForearm && eb.leftHand) {
      eb.leftUpperArm.rotation.copy(handles.leftWing.shoulder.rotation);
      eb.leftForearm.rotation.copy(handles.leftWing.elbow.rotation);
      eb.leftHand.rotation.copy(handles.leftWing.wrist.rotation);
    }
    if (eb.rightUpperArm && eb.rightForearm && eb.rightHand) {
      eb.rightUpperArm.rotation.copy(handles.rightWing.shoulder.rotation);
      eb.rightForearm.rotation.copy(handles.rightWing.elbow.rotation);
      eb.rightHand.rotation.copy(handles.rightWing.wrist.rotation);
    }
    if (eb.head) eb.head.rotation.copy(handles.headPivot.rotation);
    if (eb.tail) eb.tail.rotation.copy(handles.tailPivot.rotation);
  }
}

export function bindExternalBones(root: THREE.Object3D): SeagullRigHandles['externalBones'] {
  const found: NonNullable<SeagullRigHandles['externalBones']> = {};
  root.traverse((obj) => {
    const name = obj.name.toLowerCase();
    if (!found.head && name.includes('head')) found.head = obj;
    else if (!found.tail && name.includes('tail')) found.tail = obj;
    else if (!found.leftUpperArm && /upper.*arm.*l|shoulder.*l|wing_l_1|left_upper/i.test(obj.name)) {
      found.leftUpperArm = obj;
    } else if (!found.leftForearm && /fore.*arm.*l|elbow.*l|wing_l_2|left_fore/i.test(obj.name)) {
      found.leftForearm = obj;
    } else if (!found.leftHand && /hand.*l|wrist.*l|wing_l_3|left_hand/i.test(obj.name)) {
      found.leftHand = obj;
    } else if (!found.rightUpperArm && /upper.*arm.*r|shoulder.*r|wing_r_1|right_upper/i.test(obj.name)) {
      found.rightUpperArm = obj;
    } else if (!found.rightForearm && /fore.*arm.*r|elbow.*r|wing_r_2|right_fore/i.test(obj.name)) {
      found.rightForearm = obj;
    } else if (!found.rightHand && /hand.*r|wrist.*r|wing_r_3|right_hand/i.test(obj.name)) {
      found.rightHand = obj;
    }
  });
  return found;
}
