import {
  DEFAULT_TUNABLE_VISION_SETTINGS,
  type TunableVisionSettings,
} from './gestureConfig.ts';
import { clamp, ema, wrapAngleRad } from './smoothing.ts';
import type {
  HeadTiltResult,
  HeadTiltState,
  MirroredFaceOverlay,
  NormalizedPoint,
} from './types.ts';

// FaceLandmarker key indices
export const FACE_RIGHT_EYE_OUTER_IDX = 33;
export const FACE_LEFT_EYE_OUTER_IDX = 263;
export const FACE_FOREHEAD_IDX = 10;
export const FACE_CHIN_IDX = 152;

export function createInitialHeadTiltState(): HeadTiltState {
  return {
    smoothedTurn: 0,
    lastRelativeDeg: 0,
    lastFaceTimeSec: 0,
    hasFace: false,
  };
}

/**
 * Extracts raw head tilt angle (rad) from unmirrored FaceLandmarker points.
 * Upright = 0 rad. Clockwise tilt on mirrored screen (right ear down) > 0 rad.
 */
export function computeRawHeadAngle(
  rawFaceLandmarks: readonly NormalizedPoint[] | null | undefined,
  eyeWeight = 0.7,
  axisWeight = 0.3
): MirroredFaceOverlay | null {
  if (!rawFaceLandmarks || rawFaceLandmarks.length <= FACE_LEFT_EYE_OUTER_IDX) {
    return null;
  }

  const mirror = (pt: NormalizedPoint): NormalizedPoint => ({
    x: 1 - pt.x,
    y: pt.y,
    z: pt.z ?? 0,
  });

  const eyeA = mirror(rawFaceLandmarks[FACE_RIGHT_EYE_OUTER_IDX]);
  const eyeB = mirror(rawFaceLandmarks[FACE_LEFT_EYE_OUTER_IDX]);
  const forehead = mirror(rawFaceLandmarks[FACE_FOREHEAD_IDX]);
  const chin = mirror(rawFaceLandmarks[FACE_CHIN_IDX]);

  // Sort eyes left-to-right on mirrored screen so thetaEye is centered near 0 rad
  const [leftEye, rightEye] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];

  const eyeDx = rightEye.x - leftEye.x;
  const eyeDy = rightEye.y - leftEye.y;
  if (Math.hypot(eyeDx, eyeDy) < 0.015) {
    return null;
  }

  // Screen Y increases downward: right eye lower => eyeDy > 0 => thetaEye > 0
  const thetaEye = Math.atan2(eyeDy, eyeDx);

  // Forehead -> Chin vertical axis in screen coordinates:
  // Upright: chin.y > forehead.y and forehead.x == chin.x => atan2(0, +H) = 0
  // Tilted clockwise (right ear down): forehead moves right (+x) relative to chin => thetaAxis > 0
  const axisDx = forehead.x - chin.x;
  const axisDy = chin.y - forehead.y;
  const thetaAxis = Math.hypot(axisDx, axisDy) > 0.02 ? Math.atan2(axisDx, axisDy) : thetaEye;

  const rawHeadAngleRad = eyeWeight * thetaEye + axisWeight * thetaAxis;

  return {
    leftEye,
    rightEye,
    forehead,
    chin,
    rawHeadAngleRad,
    relativeHeadDeg: (rawHeadAngleRad * 180) / Math.PI,
  };
}

/**
 * Computes head tilt turn (-1..+1) with calibration offset, deadzone, max clamp, EMA,
 * and smooth decay to 0 over 0.5s if face detection is lost.
 */
export function evaluateHeadTilt(
  rawFaceLandmarks: readonly NormalizedPoint[] | null | undefined,
  neutralHeadAngleRad: number,
  prevState: HeadTiltState,
  nowSec: number,
  dtSec: number,
  settings: TunableVisionSettings = DEFAULT_TUNABLE_VISION_SETTINGS
): HeadTiltResult {
  const overlayBase = computeRawHeadAngle(rawFaceLandmarks);

  if (!overlayBase) {
    // Smoothly return turn toward 0 over 0.5s when face disappears
    const decayStep = dtSec / 0.5;
    let nextTurn = prevState.smoothedTurn;
    if (Math.abs(nextTurn) <= decayStep) {
      nextTurn = 0;
    } else {
      nextTurn -= Math.sign(nextTurn) * decayStep;
    }
    const decayedDeg = prevState.lastRelativeDeg * Math.max(0, 1 - decayStep * 2);

    return {
      nextState: {
        smoothedTurn: nextTurn,
        lastRelativeDeg: decayedDeg,
        lastFaceTimeSec: prevState.lastFaceTimeSec,
        hasFace: false,
      },
      turn: nextTurn,
      relativeHeadDeg: decayedDeg,
      faceDetected: false,
      overlay: null,
    };
  }

  const deltaRad = wrapAngleRad(overlayBase.rawHeadAngleRad - neutralHeadAngleRad);
  const deltaDeg = (deltaRad * 180) / Math.PI;
  const absDeg = Math.abs(deltaDeg);

  const deadzone = settings.headDeadzoneDeg;
  const maxDeg = Math.max(deadzone + 2, settings.headMaxDeg);
  const rawTurn =
    absDeg <= deadzone
      ? 0
      : Math.sign(deltaDeg) * clamp((absDeg - deadzone) / (maxDeg - deadzone), 0, 1);

  const smoothedTurn = ema(prevState.smoothedTurn, rawTurn, settings.headSmoothAlpha);

  return {
    nextState: {
      smoothedTurn,
      lastRelativeDeg: deltaDeg,
      lastFaceTimeSec: nowSec,
      hasFace: true,
    },
    turn: smoothedTurn,
    relativeHeadDeg: deltaDeg,
    faceDetected: true,
    overlay: {
      ...overlayBase,
      relativeHeadDeg: deltaDeg,
    },
  };
}
