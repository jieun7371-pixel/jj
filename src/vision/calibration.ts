import { GESTURE_CONFIG } from './gestureConfig.ts';
import { computeRawHeadAngle } from './headTilt.ts';
import type { CalibrationData, NormalizedPoint } from './types.ts';

export const DEFAULT_CALIBRATION: CalibrationData = {
  neutralHeadAngleRad: 0,
  handScaleS: 0.12,
  sampleCount: 0,
  calibratedAt: 0,
};

export interface CalibrationStepResult {
  completed: boolean;
  progress: number; // 0..1
  remainingSec: number;
  faceVisible: boolean;
  handVisible: boolean;
  bothReady: boolean;
  calibration: CalibrationData | null;
}

/**
 * 3-second simplified calibration accumulator:
 * Captures neutral upright head tilt angle from FaceLandmarker and nominal palm scale S from HandLandmarker.
 */
export class CalibrationAccumulator {
  private readonly durationMs: number;
  private startMs: number | null = null;
  private sinSum = 0;
  private cosSum = 0;
  private faceSamples = 0;
  private handScaleSum = 0;
  private handSamples = 0;

  constructor(durationSec = GESTURE_CONFIG.calibrationDurationSec) {
    this.durationMs = durationSec * 1000;
  }

  reset(): void {
    this.startMs = null;
    this.sinSum = 0;
    this.cosSum = 0;
    this.faceSamples = 0;
    this.handScaleSum = 0;
    this.handSamples = 0;
  }

  addSample(
    rawFace: readonly NormalizedPoint[] | null | undefined,
    rawHands: readonly (readonly NormalizedPoint[])[],
    nowMs: number
  ): CalibrationStepResult {
    const faceOverlay = computeRawHeadAngle(rawFace);
    const faceVisible = Boolean(faceOverlay);

    let bestScaleS = 0;
    for (const hand of rawHands) {
      if (hand.length >= 10) {
        const s = Math.hypot(hand[9].x - hand[0].x, hand[9].y - hand[0].y);
        if (s > bestScaleS) bestScaleS = s;
      }
    }
    const handVisible = bestScaleS >= GESTURE_CONFIG.minPalmScaleS;
    const bothReady = faceVisible && handVisible;

    if (!faceVisible) {
      return {
        completed: false,
        progress: this.startMs === null ? 0 : Math.min(0.99, (nowMs - this.startMs) / this.durationMs),
        remainingSec:
          this.startMs === null
            ? this.durationMs / 1000
            : Math.max(0, (this.durationMs - (nowMs - this.startMs)) / 1000),
        faceVisible,
        handVisible,
        bothReady,
        calibration: null,
      };
    }

    if (this.startMs === null) {
      this.startMs = nowMs;
    }

    if (faceOverlay) {
      this.sinSum += Math.sin(faceOverlay.rawHeadAngleRad);
      this.cosSum += Math.cos(faceOverlay.rawHeadAngleRad);
      this.faceSamples++;
    }
    if (handVisible) {
      this.handScaleSum += bestScaleS;
      this.handSamples++;
    }

    const elapsedMs = Math.max(0, nowMs - this.startMs);
    const progress = Math.min(1, elapsedMs / this.durationMs);
    const remainingSec = Math.max(0, (this.durationMs - elapsedMs) / 1000);

    if (elapsedMs >= this.durationMs && this.faceSamples >= 3) {
      const neutralHeadAngleRad = Math.atan2(
        this.sinSum / this.faceSamples,
        this.cosSum / this.faceSamples
      );
      const handScaleS =
        this.handSamples > 0 ? this.handScaleSum / this.handSamples : DEFAULT_CALIBRATION.handScaleS;

      return {
        completed: true,
        progress: 1,
        remainingSec: 0,
        faceVisible,
        handVisible,
        bothReady,
        calibration: {
          neutralHeadAngleRad,
          handScaleS,
          sampleCount: this.faceSamples,
          calibratedAt: nowMs,
        },
      };
    }

    return {
      completed: false,
      progress,
      remainingSec,
      faceVisible,
      handVisible,
      bothReady,
      calibration: null,
    };
  }
}
