import {
  DEFAULT_TUNABLE_VISION_SETTINGS,
  GESTURE_CONFIG,
  type TunableVisionSettings,
} from './gestureConfig.ts';
import { clamp } from './smoothing.ts';
import type { FlapAnalysis } from './types.ts';

interface SingleHandFlapMetrics {
  power: number;
  amp: number;
  freqHz: number;
  elevation: number;
}

function analyzeSingleHandY(
  samples: readonly { timeSec: number; yUpNorm: number }[],
  settings: TunableVisionSettings
): SingleHandFlapMetrics {
  if (samples.length < 3) {
    return { power: 0, amp: 0, freqHz: 0, elevation: 0 };
  }

  const latestTime = samples[samples.length - 1].timeSec;
  const cutoff = latestTime - GESTURE_CONFIG.flapBufferSec;
  const recent = samples.filter((s) => s.timeSec >= cutoff);
  if (recent.length < 3) {
    return { power: 0, amp: 0, freqHz: 0, elevation: 0 };
  }

  // Strictly measure actual elapsed timestamps (never assume constant frame count)
  const spanSec = recent[recent.length - 1].timeSec - recent[0].timeSec;
  if (spanSec < 0.14) {
    return { power: 0, amp: 0, freqHz: 0, elevation: 0 };
  }

  let sum = 0;
  for (const s of recent) sum += s.yUpNorm;
  const mean = sum / recent.length;

  let minVal = Infinity;
  let maxVal = -Infinity;
  let minTime = recent[0].timeSec;
  let maxTime = recent[0].timeSec;
  const highPassed: Array<{ t: number; v: number }> = [];

  for (const s of recent) {
    const hp = s.yUpNorm - mean;
    highPassed.push({ t: s.timeSec, v: hp });
    if (hp < minVal) {
      minVal = hp;
      minTime = s.timeSec;
    }
    if (hp > maxVal) {
      maxVal = hp;
      maxTime = s.timeSec;
    }
  }

  const amp = (maxVal - minVal) * 0.5;

  // Record exact timestamp of every hysteresis-qualified zero crossing
  const hyst = GESTURE_CONFIG.flapZeroCrossHysteresisS;
  let sign = 0;
  const crossingTimes: number[] = [];

  for (let i = 0; i < highPassed.length; i++) {
    const { t, v } = highPassed[i];
    if (v > hyst) {
      if (sign === -1) crossingTimes.push(t);
      sign = 1;
    } else if (v < -hyst) {
      if (sign === 1) crossingTimes.push(t);
      sign = -1;
    }
  }

  // Compute frequency purely from timestamps (zero-crossings or interior crest-to-trough half cycle)
  const firstT = recent[0].timeSec;
  const lastT = recent[recent.length - 1].timeSec;
  let freqHz = 0;
  if (crossingTimes.length >= 2) {
    const dtCross = crossingTimes[crossingTimes.length - 1] - crossingTimes[0];
    const halfCycles = crossingTimes.length - 1;
    freqHz = (halfCycles * 0.5) / Math.max(0.15, dtCross);
  } else if (crossingTimes.length === 1) {
    const hasInteriorTurn =
      (minTime > firstT + 0.03 && minTime < lastT - 0.03) ||
      (maxTime > firstT + 0.03 && maxTime < lastT - 0.03);
    const dtExtrema = Math.abs(maxTime - minTime);
    if (hasInteriorTurn && dtExtrema >= 0.14) {
      freqHz = 0.5 / Math.max(0.16, dtExtrema);
    } else {
      freqHz = 0.5 / Math.max(0.45, spanSec);
    }
  }

  // Weighted sum: 0.6 * clamp(A / 0.35) + 0.4 * clamp(f / 2.0), gated at >= 1.0 Hz
  const ampFactor = clamp(amp / Math.max(0.08, settings.flapAmpRef), 0, 1);
  const freqFactor =
    freqHz >= GESTURE_CONFIG.flapMinFreqHz
      ? clamp(freqHz / Math.max(0.5, settings.flapFreqRef), 0, 1)
      : 0;

  const power =
    freqHz >= GESTURE_CONFIG.flapMinFreqHz && amp > 0.06
      ? clamp(
          GESTURE_CONFIG.flapAmpWeight * ampFactor +
            GESTURE_CONFIG.flapFreqWeight * freqFactor,
          0,
          1
        )
      : 0;

  const latestHp = highPassed[highPassed.length - 1].v;
  const elevation = amp > 0.06 ? clamp(latestHp / Math.max(0.22, amp), -1, 1) : 0;

  return { power, amp, freqHz, elevation };
}

/**
 * Timestamp-based hand flapping detector using 0.6s palm Y history:
 * - Weighted sum: 0.6 * clamp(A / 0.35) + 0.4 * clamp(f / 2.0) when f >= 1.0 Hz
 * - Works identically with 1 visible hand (mirrored to both wings) or 2 hands (max)
 */
export function analyzeHandFlapping(
  leftSamples: readonly { timeSec: number; yUpNorm: number }[],
  rightSamples: readonly { timeSec: number; yUpNorm: number }[],
  hasLeftHand: boolean,
  hasRightHand: boolean,
  settings: TunableVisionSettings = DEFAULT_TUNABLE_VISION_SETTINGS
): FlapAnalysis {
  const left = hasLeftHand
    ? analyzeSingleHandY(leftSamples, settings)
    : { power: 0, amp: 0, freqHz: 0, elevation: 0 };
  const right = hasRightHand
    ? analyzeSingleHandY(rightSamples, settings)
    : { power: 0, amp: 0, freqHz: 0, elevation: 0 };

  let leftFlapPower = left.power;
  let rightFlapPower = right.power;
  let leftElev = left.elevation;
  let rightElev = right.elevation;
  let leftAmp = left.amp;
  let rightAmp = right.amp;
  let leftFreq = left.freqHz;
  let rightFreq = right.freqHz;

  if (hasLeftHand && !hasRightHand) {
    rightFlapPower = left.power;
    rightElev = left.elevation;
    rightAmp = left.amp;
    rightFreq = left.freqHz;
  } else if (hasRightHand && !hasLeftHand) {
    leftFlapPower = right.power;
    leftElev = right.elevation;
    leftAmp = right.amp;
    leftFreq = right.freqHz;
  }

  const flapPower = Math.max(leftFlapPower, rightFlapPower);
  const flapFreqHz = Math.max(leftFreq, rightFreq);

  return {
    flapPower,
    leftFlapPower,
    rightFlapPower,
    leftAmp,
    rightAmp,
    leftFreqHz: leftFreq,
    rightFreqHz: rightFreq,
    flapFreqHz,
    leftWingElevation: leftElev,
    rightWingElevation: rightElev,
    wingYawAssist: 0,
  };
}
