import { DEFAULT_CALIBRATION } from './calibration.ts';
import { analyzeHandFlapping } from './flapDetector.ts';
import {
  DEFAULT_TUNABLE_VISION_SETTINGS,
  GESTURE_CONFIG,
  type TunableVisionSettings,
} from './gestureConfig.ts';
import { createInitialHandGestureState, evaluateHandGestures } from './handGestures.ts';
import { createInitialHeadTiltState, evaluateHeadTilt } from './headTilt.ts';
import { clamp, ema } from './smoothing.ts';
import type {
  CalibrationData,
  ControlMapperState,
  FlightControlOutput,
  FlightMode,
  GesturePriorityLabel,
  NormalizedPoint,
} from './types.ts';

function buildGestureBadge(
  priority: GesturePriorityLabel,
  turn: number,
  handCount: number
): string {
  if (handCount === 0) {
    if (turn < -0.22) return '↖ 좌회전';
    if (turn > 0.22) return '↗ 우회전';
    return '✋ 손을 보여주세요';
  }
  if (priority === '하강') return '✊ 하강';
  if (priority === '날갯짓') return '🪽 날갯짓';
  if (turn < -0.24) return '↖ 좌회전';
  if (turn > 0.24) return '↗ 우회전';
  return '🤚 활강';
}

export function createInitialControlState(): ControlMapperState {
  const headState = createInitialHeadTiltState();
  const handState = createInitialHandGestureState();
  const initialOutput: FlightControlOutput = {
    turn: 0,
    diveStrength: 0,
    dive: false,
    isDiving: false,
    glide: true,
    flapPower: 0,
    flapImpulse: 0,
    leftFlapPower: 0,
    rightFlapPower: 0,
    leftWingElevation: 0,
    rightWingElevation: 0,
    wingYawAssist: 0,
    mode: '활공',
    priorityGesture: '기본',
    gestureBlockReason: null,
    tiltDeg: 0,
    leftHandDAvg: null,
    rightHandDAvg: null,
    leftHandFist: false,
    rightHandFist: false,
    leftHandMoveS: null,
    rightHandMoveS: null,
    leftHandSpeedS: null,
    rightHandSpeedS: null,
    leftAmp: 0,
    rightAmp: 0,
    leftFreqHz: 0,
    rightFreqHz: 0,
    flapFreqHz: 0,
    faceDetected: false,
    handCount: 0,
    validPose: false,
    poseDetected: false,
    handsRaisedForStart: false,
    overlay: {
      face: null,
      hands: [],
      headTiltDeg: 0,
      turn: 0,
      gestureLabel: '기본',
      gestureBadgeText: '✋ 손을 보여주세요',
      faceDetected: false,
      handCount: 0,
      needHandsPrompt: true,
    },
  };

  return {
    headState,
    handState,
    smoothedTurn: 0,
    smoothedDive: 0,
    smoothedLeftFlap: 0,
    smoothedRightFlap: 0,
    smoothedFlapPower: 0,
    smoothedLeftElev: 0,
    smoothedRightElev: 0,
    readyHoldSec: 0,
    lastStepTimeSec: 0,
    lastOutput: initialOutput,
  };
}

/**
 * Pure control mapper combining FaceLandmarker head tilt steering + HandLandmarker fist/open/flap gestures.
 * Priority:
 *  - Active flap (flapPower > 0.25 or downstroke impulse) beats partial non-strict fist.
 *  - Strict stationary fist (>= 0.2s hold, all 4 fingers < 1.1) triggers 하강.
 */
export function mapFaceAndHandsToControl(
  rawFaceLandmarks: readonly NormalizedPoint[] | null | undefined,
  rawHandsLandmarks: readonly (readonly NormalizedPoint[])[],
  calibration: CalibrationData | null,
  prevState: ControlMapperState,
  nowSec: number,
  settings: TunableVisionSettings = DEFAULT_TUNABLE_VISION_SETTINGS
): { output: FlightControlOutput; nextState: ControlMapperState } {
  const cal = calibration ?? DEFAULT_CALIBRATION;
  const dtSec =
    prevState.lastStepTimeSec > 0
      ? clamp(nowSec - prevState.lastStepTimeSec, 0.005, 0.1)
      : 0.033;

  // 1. Head tilt steering
  const headRes = evaluateHeadTilt(
    rawFaceLandmarks,
    cal.neutralHeadAngleRad,
    prevState.headState,
    nowSec,
    dtSec,
    settings
  );

  // 2. Hand fist / open / stillness + downstroke impulse evaluation
  const handRes = evaluateHandGestures(
    rawHandsLandmarks,
    prevState.handState,
    nowSec,
    dtSec,
    settings
  );

  // 3. Flapping oscillation analysis (timestamped 0.6s window, EMA alpha 0.45)
  const leftHand = handRes.hands.find((h) => h.screenSide === 'left') ?? null;
  const rightHand = handRes.hands.find((h) => h.screenSide === 'right') ?? null;
  const flapRaw = analyzeHandFlapping(
    handRes.motionYSamplesLeft,
    handRes.motionYSamplesRight,
    Boolean(leftHand),
    Boolean(rightHand),
    settings
  );

  const anyStrictFist = handRes.hands.some((h) => h.isFist);
  const flapAlpha = settings.flapSmoothAlpha;

  const suppressFlapForStrictFist = handRes.isDiving && anyStrictFist;
  const smoothedLeftFlap = ema(
    prevState.smoothedLeftFlap,
    suppressFlapForStrictFist ? 0 : flapRaw.leftFlapPower,
    flapAlpha
  );
  const smoothedRightFlap = ema(
    prevState.smoothedRightFlap,
    suppressFlapForStrictFist ? 0 : flapRaw.rightFlapPower,
    flapAlpha
  );
  const smoothedFlapPower = Math.max(smoothedLeftFlap, smoothedRightFlap);
  const flapImpulse = suppressFlapForStrictFist ? 0 : handRes.flapImpulse;

  const smoothedDive = ema(prevState.smoothedDive, handRes.diveStrength, 0.35);
  const smoothedLeftElev = ema(prevState.smoothedLeftElev, flapRaw.leftWingElevation, 0.45);
  const smoothedRightElev = ema(prevState.smoothedRightElev, flapRaw.rightWingElevation, 0.45);

  // 4. Priority arbitration:
  // If flap is active (flapPower > 0.25 or impulse > 0.25) and hand is NOT a strict fist, flap wins!
  const strongFlapNoStrictFist =
    handRes.handCount > 0 &&
    !anyStrictFist &&
    (smoothedFlapPower > GESTURE_CONFIG.flapPriorityThreshold || flapImpulse > 0.25);

  const activeFlapDetected =
    handRes.handCount > 0 &&
    (smoothedFlapPower >= GESTURE_CONFIG.flapActivateThreshold || flapImpulse > 0.25);

  let priorityGesture: GesturePriorityLabel = '기본';
  let mode: FlightMode = '활공';

  if (strongFlapNoStrictFist) {
    priorityGesture = '날갯짓';
    mode = '날갯짓';
  } else if (handRes.isDiving) {
    priorityGesture = '하강';
    mode = '하강';
  } else if (activeFlapDetected) {
    priorityGesture = '날갯짓';
    mode = '날갯짓';
  } else if (handRes.isGliding) {
    priorityGesture = '활강';
    mode = '활공';
  }

  const finalLeftFlap =
    priorityGesture === '하강' || handRes.handCount === 0 ? 0 : smoothedLeftFlap;
  const finalRightFlap =
    priorityGesture === '하강' || handRes.handCount === 0 ? 0 : smoothedRightFlap;
  const finalFlapPower =
    priorityGesture === '하강' || handRes.handCount === 0 ? 0 : smoothedFlapPower;
  const finalImpulse = priorityGesture === '하강' || handRes.handCount === 0 ? 0 : flapImpulse;

  const isDivingOut = priorityGesture === '하강';
  const isGlide = !isDivingOut && priorityGesture !== '날갯짓';

  // Diagnostic hint when user is moving hand(s) briskly but resolved to 주먹 or 활강/기본
  let gestureBlockReason: string | null = null;
  if (handRes.handCount > 0 && priorityGesture !== '날갯짓') {
    const maxSpeed = Math.max(
      leftHand?.palmSpeedSPerSec ?? 0,
      rightHand?.palmSpeedSPerSec ?? 0
    );
    const maxAmp = Math.max(flapRaw.leftAmp, flapRaw.rightAmp);
    const minDAvg = Math.min(leftHand?.dAvg ?? 9, rightHand?.dAvg ?? 9);
    const moving = maxSpeed >= 1.1 || maxAmp >= 0.1;

    if (priorityGesture === '하강' && moving) {
      gestureBlockReason = `하강 오인: 손가락 접힘 d_avg=${minDAvg.toFixed(2)} (< ${settings.fistEnterDistRatio.toFixed(2)}), 속도 ${maxSpeed.toFixed(1)} S/s`;
    } else if (priorityGesture !== '하강' && moving) {
      if (handRes.hands.some((h) => h.fistSuppressedBySpeed)) {
        gestureBlockReason = `주먹 보류됨(속도 ${maxSpeed.toFixed(1)} S/s >= 2.0) · f=${flapRaw.flapFreqHz.toFixed(2)}Hz, A=${maxAmp.toFixed(2)}`;
      } else if (flapRaw.flapFreqHz < GESTURE_CONFIG.flapMinFreqHz) {
        gestureBlockReason = `활강 유지: 주파수 f=${flapRaw.flapFreqHz.toFixed(2)}Hz (< 1.0Hz), A=${maxAmp.toFixed(2)}, 속도 ${maxSpeed.toFixed(1)} S/s`;
      } else {
        gestureBlockReason = `날갯짓 부족: P=${smoothedFlapPower.toFixed(2)}, A=${maxAmp.toFixed(2)}, f=${flapRaw.flapFreqHz.toFixed(2)}Hz`;
      }
    }
  }

  const nextReadyHold = handRes.handsRaisedReady ? prevState.readyHoldSec + dtSec : 0;
  const handsRaisedForStart = nextReadyHold >= GESTURE_CONFIG.readyHandsUpHoldSec;

  const poseDetected = headRes.faceDetected || handRes.handCount > 0;
  const validPose = headRes.faceDetected && handRes.handCount > 0;
  const gestureBadgeText = buildGestureBadge(priorityGesture, headRes.turn, handRes.handCount);

  const output: FlightControlOutput = {
    turn: headRes.turn,
    diveStrength: isDivingOut ? clamp(smoothedDive, 0.15, 1) : 0,
    dive: isDivingOut,
    isDiving: isDivingOut,
    glide: isGlide,
    flapPower: finalFlapPower,
    flapImpulse: finalImpulse,
    leftFlapPower: finalLeftFlap,
    rightFlapPower: finalRightFlap,
    leftWingElevation: smoothedLeftElev,
    rightWingElevation: smoothedRightElev,
    wingYawAssist: 0,
    mode,
    priorityGesture,
    gestureBlockReason,
    tiltDeg: headRes.relativeHeadDeg,
    leftHandDAvg: leftHand ? leftHand.dAvg : null,
    rightHandDAvg: rightHand ? rightHand.dAvg : null,
    leftHandFist: leftHand ? leftHand.isFist : false,
    rightHandFist: rightHand ? rightHand.isFist : false,
    leftHandMoveS: leftHand ? leftHand.motionSpanS : null,
    rightHandMoveS: rightHand ? rightHand.motionSpanS : null,
    leftHandSpeedS: leftHand ? leftHand.palmSpeedSPerSec : null,
    rightHandSpeedS: rightHand ? rightHand.palmSpeedSPerSec : null,
    leftAmp: flapRaw.leftAmp,
    rightAmp: flapRaw.rightAmp,
    leftFreqHz: flapRaw.leftFreqHz,
    rightFreqHz: flapRaw.rightFreqHz,
    flapFreqHz: flapRaw.flapFreqHz,
    faceDetected: headRes.faceDetected,
    handCount: handRes.handCount,
    validPose,
    poseDetected,
    handsRaisedForStart,
    overlay: {
      face: headRes.overlay,
      hands: handRes.hands,
      headTiltDeg: headRes.relativeHeadDeg,
      turn: headRes.turn,
      gestureLabel: priorityGesture,
      gestureBadgeText,
      faceDetected: headRes.faceDetected,
      handCount: handRes.handCount,
      needHandsPrompt: handRes.handCount === 0,
    },
  };

  return {
    output,
    nextState: {
      headState: headRes.nextState,
      handState: handRes.nextState,
      smoothedTurn: headRes.turn,
      smoothedDive,
      smoothedLeftFlap: finalLeftFlap,
      smoothedRightFlap: finalRightFlap,
      smoothedFlapPower: finalFlapPower,
      smoothedLeftElev,
      smoothedRightElev,
      readyHoldSec: nextReadyHold,
      lastStepTimeSec: nowSec,
      lastOutput: output,
    },
  };
}
