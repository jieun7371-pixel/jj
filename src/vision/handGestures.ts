import {
  DEFAULT_TUNABLE_VISION_SETTINGS,
  GESTURE_CONFIG,
  type TunableVisionSettings,
} from './gestureConfig.ts';
import { clamp } from './smoothing.ts';
import type {
  HandGestureEvalResult,
  HandGestureTrackerState,
  HandMotionSample,
  HandSlotState,
  NormalizedPoint,
  SingleHandEval,
} from './types.ts';

const WRIST_IDX = 0;
const INDEX_MCP_IDX = 5;
const MIDDLE_MCP_IDX = 9;
const RING_MCP_IDX = 13;
const PINKY_MCP_IDX = 17;
const FINGER_TIP_INDICES = [8, 12, 16, 20] as const;

function createEmptySlotState(): HandSlotState {
  return {
    motionSamples: [],
    strokePeakYUp: null,
    strokeMinYUp: null,
    impulseLatched: false,
  };
}

export function createInitialHandGestureState(): HandGestureTrackerState {
  return {
    leftSlot: createEmptySlotState(),
    rightSlot: createEmptySlotState(),
    fistHoldSec: 0,
    handLostSec: 0,
    isDiving: false,
    flapImpulse: 0,
    lastStepTimeSec: 0,
  };
}

function mirrorHand(rawHand: readonly NormalizedPoint[]): NormalizedPoint[] {
  return rawHand.map((pt) => ({
    x: 1 - pt.x,
    y: pt.y,
    z: pt.z ?? 0,
  }));
}

function pushMotionSample(
  samples: HandMotionSample[],
  sample: HandMotionSample,
  windowSec: number
): HandMotionSample[] {
  const next = [...samples, sample];
  const cutoff = sample.timeSec - windowSec;
  while (next.length > 0 && next[0].timeSec < cutoff) {
    next.shift();
  }
  while (next.length > 90) {
    next.shift();
  }
  return next;
}

function computeStillness(
  samples: readonly HandMotionSample[],
  stillnessMaxMoveS: number
): { isStill: boolean; spanS: number } {
  const cutoff =
    samples.length > 0 ? samples[samples.length - 1].timeSec - GESTURE_CONFIG.stillnessWindowSec : 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumS = 0;
  let count = 0;

  for (const s of samples) {
    if (s.timeSec < cutoff) continue;
    if (s.cxRaw < minX) minX = s.cxRaw;
    if (s.cxRaw > maxX) maxX = s.cxRaw;
    if (s.cyRaw < minY) minY = s.cyRaw;
    if (s.cyRaw > maxY) maxY = s.cyRaw;
    sumS += s.scaleS;
    count++;
  }

  if (count <= 1) {
    return { isStill: true, spanS: 0 };
  }

  const avgS = Math.max(GESTURE_CONFIG.minPalmScaleS, sumS / count);
  const spanS = Math.hypot(maxX - minX, maxY - minY) / avgS;
  return {
    isStill: spanS <= stillnessMaxMoveS,
    spanS,
  };
}

/**
 * Computes timestamp-based palm center speed (in S/sec) over the most recent ~0.08s window.
 */
function computePalmSpeedSPerSec(samples: readonly HandMotionSample[]): {
  speedSPerSec: number;
  downSpeedSPerSec: number;
} {
  if (samples.length < 2) {
    return { speedSPerSec: 0, downSpeedSPerSec: 0 };
  }
  const latest = samples[samples.length - 1];
  let ref = samples[samples.length - 2];

  // Prefer a reference ~0.06..0.12s earlier to reduce single-frame jitter while tracking real arm speed
  for (let i = samples.length - 2; i >= 0; i--) {
    const dt = latest.timeSec - samples[i].timeSec;
    if (dt >= 0.055) {
      ref = samples[i];
      if (dt <= 0.14) break;
    }
  }

  const dtSec = latest.timeSec - ref.timeSec;
  if (dtSec < 0.005) {
    return { speedSPerSec: 0, downSpeedSPerSec: 0 };
  }

  const avgS = Math.max(GESTURE_CONFIG.minPalmScaleS, (latest.scaleS + ref.scaleS) * 0.5);
  const distS = Math.hypot(latest.cxRaw - ref.cxRaw, latest.cyRaw - ref.cyRaw) / avgS;
  const downS = (latest.cyRaw - ref.cyRaw) / avgS; // positive when palm moves downward on screen

  return {
    speedSPerSec: distS / dtSec,
    downSpeedSPerSec: Math.max(0, downS / dtSec),
  };
}

/**
 * Tracks a single hand's downstroke impulse state using palm Y (upward = positive) in S units.
 * Fires a pulse once when the palm moves rapidly downward >= flapImpulseThreshold * S,
 * then re-arms after an upward rebound >= 0.08 * S.
 */
function updateHandStrokeImpulse(
  prevSlot: HandSlotState,
  nextSamples: HandMotionSample[],
  hasHand: boolean,
  thresholdS: number
): { slotState: HandSlotState; firedImpulse: boolean } {
  if (!hasHand || nextSamples.length === 0) {
    return {
      slotState: {
        motionSamples: nextSamples,
        strokePeakYUp: null,
        strokeMinYUp: null,
        impulseLatched: false,
      },
      firedImpulse: false,
    };
  }

  const latest = nextSamples[nextSamples.length - 1];
  const currY = latest.yUpNorm;
  const { downSpeedSPerSec } = computePalmSpeedSPerSec(nextSamples);

  let peakY = prevSlot.strokePeakYUp ?? currY;
  let minY = prevSlot.strokeMinYUp ?? currY;
  let latched = prevSlot.impulseLatched;
  let fired = false;

  if (!latched) {
    if (currY > peakY) {
      peakY = currY;
    }
    const dropFromPeak = peakY - currY;
    if (
      dropFromPeak >= thresholdS &&
      downSpeedSPerSec >= GESTURE_CONFIG.flapImpulseMinSpeedSPerSec
    ) {
      fired = true;
      latched = true;
      minY = currY;
    }
  } else {
    if (currY < minY) {
      minY = currY;
    }
    if (currY - minY >= GESTURE_CONFIG.flapImpulseResetRiseS) {
      latched = false;
      peakY = currY;
      minY = currY;
    }
  }

  return {
    slotState: {
      motionSamples: nextSamples,
      strokePeakYUp: peakY,
      strokeMinYUp: minY,
      impulseLatched: latched,
    },
    firedImpulse: fired,
  };
}

function toMotionYSamples(
  samples: readonly HandMotionSample[]
): Array<{ timeSec: number; yUpNorm: number }> {
  if (samples.length === 0) return [];
  let sumS = 0;
  for (const s of samples) sumS += s.scaleS;
  const avgS = Math.max(GESTURE_CONFIG.minPalmScaleS, sumS / samples.length);
  return samples.map((s) => ({
    timeSec: s.timeSec,
    yUpNorm: -s.cyRaw / avgS,
  }));
}

/**
 * Pure HandLandmarker evaluator:
 * - Splits up to 2 hands strictly by mirrored screen X.
 * - Normalizes distances by palm scale S = dist(wrist 0, middle_mcp 9).
 * - Strict Fist (Dive): ALL 4 fingers d_i < 1.1 && d_avg < 1.1, held >= 0.2s,
 *   and suppressed when palm center is moving fast (>= 2.0 * S/s).
 * - Open + Still (Glide): d_avg >= 1.6 and palm travel over 0.4s <= 0.25*S.
 * - Downstroke Impulse: brisk downward drop >= 0.25 * S fires flapImpulse = 1 (0.35s decay).
 */
export function evaluateHandGestures(
  rawHands: readonly (readonly NormalizedPoint[])[],
  prevState: HandGestureTrackerState,
  nowSec: number,
  dtSec: number,
  settings: TunableVisionSettings = DEFAULT_TUNABLE_VISION_SETTINGS
): HandGestureEvalResult {
  const prepared = rawHands
    .filter((hand) => hand.length >= 21)
    .map((hand) => {
      const lm = mirrorHand(hand);
      const wrist = lm[WRIST_IDX];
      const mcp5 = lm[INDEX_MCP_IDX];
      const mcp9 = lm[MIDDLE_MCP_IDX];
      const mcp13 = lm[RING_MCP_IDX];
      const mcp17 = lm[PINKY_MCP_IDX];

      const palmScaleS = Math.hypot(mcp9.x - wrist.x, mcp9.y - wrist.y);
      const palmCenter: NormalizedPoint = {
        x: (wrist.x + mcp5.x + mcp9.x + mcp13.x + mcp17.x) * 0.2,
        y: (wrist.y + mcp5.y + mcp9.y + mcp13.y + mcp17.y) * 0.2,
        z: ((wrist.z ?? 0) + (mcp5.z ?? 0) + (mcp9.z ?? 0) + (mcp13.z ?? 0) + (mcp17.z ?? 0)) * 0.2,
      };

      const ratios: [number, number, number, number] = [0, 0, 0, 0];
      let sum = 0;
      if (palmScaleS >= GESTURE_CONFIG.minPalmScaleS) {
        for (let i = 0; i < FINGER_TIP_INDICES.length; i++) {
          const tip = lm[FINGER_TIP_INDICES[i]];
          const d = Math.hypot(tip.x - wrist.x, tip.y - wrist.y) / palmScaleS;
          ratios[i] = d;
          sum += d;
        }
      }
      const dAvg = sum / 4;

      return {
        lm,
        palmCenter,
        palmScaleS,
        ratios,
        dAvg,
      };
    })
    .filter((h) => h.palmScaleS >= GESTURE_CONFIG.minPalmScaleS)
    .sort((a, b) => a.palmCenter.x - b.palmCenter.x)
    .slice(0, 2);

  let leftPrepared: (typeof prepared)[number] | null = null;
  let rightPrepared: (typeof prepared)[number] | null = null;

  if (prepared.length === 2) {
    leftPrepared = prepared[0];
    rightPrepared = prepared[1];
  } else if (prepared.length === 1) {
    if (prepared[0].palmCenter.x < 0.5) {
      leftPrepared = prepared[0];
    } else {
      rightPrepared = prepared[0];
    }
  }

  const bufferWindow = Math.max(GESTURE_CONFIG.flapBufferSec, GESTURE_CONFIG.stillnessWindowSec);

  const nextLeftSamples = leftPrepared
    ? pushMotionSample(
        prevState.leftSlot.motionSamples,
        {
          timeSec: nowSec,
          cxRaw: leftPrepared.palmCenter.x,
          cyRaw: leftPrepared.palmCenter.y,
          scaleS: leftPrepared.palmScaleS,
          cxNorm: leftPrepared.palmCenter.x / leftPrepared.palmScaleS,
          cyNorm: leftPrepared.palmCenter.y / leftPrepared.palmScaleS,
          yUpNorm: -leftPrepared.palmCenter.y / leftPrepared.palmScaleS,
        },
        bufferWindow
      )
    : prevState.leftSlot.motionSamples.filter((s) => s.timeSec >= nowSec - bufferWindow);

  const nextRightSamples = rightPrepared
    ? pushMotionSample(
        prevState.rightSlot.motionSamples,
        {
          timeSec: nowSec,
          cxRaw: rightPrepared.palmCenter.x,
          cyRaw: rightPrepared.palmCenter.y,
          scaleS: rightPrepared.palmScaleS,
          cxNorm: rightPrepared.palmCenter.x / rightPrepared.palmScaleS,
          cyNorm: rightPrepared.palmCenter.y / rightPrepared.palmScaleS,
          yUpNorm: -rightPrepared.palmCenter.y / rightPrepared.palmScaleS,
        },
        bufferWindow
      )
    : prevState.rightSlot.motionSamples.filter((s) => s.timeSec >= nowSec - bufferWindow);

  const leftImpulseRes = updateHandStrokeImpulse(
    prevState.leftSlot,
    nextLeftSamples,
    Boolean(leftPrepared),
    settings.flapImpulseThreshold
  );
  const rightImpulseRes = updateHandStrokeImpulse(
    prevState.rightSlot,
    nextRightSamples,
    Boolean(rightPrepared),
    settings.flapImpulseThreshold
  );

  const downstrokeFired = leftImpulseRes.firedImpulse || rightImpulseRes.firedImpulse;
  let flapImpulse = Math.max(
    0,
    prevState.flapImpulse - dtSec / GESTURE_CONFIG.flapImpulseDecaySec
  );
  if (downstrokeFired) {
    flapImpulse = 1.0;
  }

  const evalSingle = (
    p: (typeof prepared)[number],
    screenSide: 'left' | 'right',
    samples: readonly HandMotionSample[]
  ): SingleHandEval => {
    const { speedSPerSec } = computePalmSpeedSPerSec(samples);
    const belowCount = p.ratios.filter((r) => r < settings.fistEnterDistRatio).length;
    // Strict fist: ALL 4 fingers < 1.1 and d_avg < 1.1
    const isStrictCurled =
      belowCount >= GESTURE_CONFIG.fistMinFingerCount && p.dAvg < settings.fistEnterDistRatio;
    const fistSuppressedBySpeed = speedSPerSec >= GESTURE_CONFIG.fistSuppressSpeedSPerSec;
    const isFist = isStrictCurled && !fistSuppressedBySpeed;
    const isOpen = p.dAvg >= settings.openDistRatio;
    const { isStill, spanS } = computeStillness(samples, settings.stillnessMaxMoveS);
    const isGlideCandidate = isOpen && isStill;
    const isReadyRaised = isOpen && p.palmCenter.y <= GESTURE_CONFIG.readyHandsUpMinY;

    return {
      screenSide,
      mirroredLandmarks: p.lm,
      palmCenter: p.palmCenter,
      palmScaleS: p.palmScaleS,
      fingerRatios: p.ratios,
      dAvg: p.dAvg,
      isFist,
      fistSuppressedBySpeed,
      palmSpeedSPerSec: speedSPerSec,
      isOpen,
      isStill,
      motionSpanS: spanS,
      isGlideCandidate,
      isReadyRaised,
    };
  };

  const evaluatedHands: SingleHandEval[] = [];
  if (leftPrepared) evaluatedHands.push(evalSingle(leftPrepared, 'left', nextLeftSamples));
  if (rightPrepared) evaluatedHands.push(evalSingle(rightPrepared, 'right', nextRightSamples));

  // Strict Fist (Dive) entry (>= 0.2s, suppressed during rapid palm movement >= 2.0 S/s) & hysteresis exit
  const anyFistEnter = evaluatedHands.some((h) => h.isFist);
  const anyStayingInFistZone = evaluatedHands.some(
    (h) => h.dAvg < settings.fistExitDistRatio && !h.fistSuppressedBySpeed
  );

  let fistHoldSec = anyFistEnter ? prevState.fistHoldSec + dtSec : 0;
  const handLostSec = evaluatedHands.length === 0 ? prevState.handLostSec + dtSec : 0;
  let isDiving = prevState.isDiving;

  if (!isDiving) {
    if (fistHoldSec >= settings.fistHoldEnterSec) {
      isDiving = true;
    }
  } else {
    if (evaluatedHands.length === 0) {
      if (handLostSec >= GESTURE_CONFIG.handLostDiveGraceSec) {
        isDiving = false;
        fistHoldSec = 0;
      }
    } else if (!anyStayingInFistZone) {
      isDiving = false;
      fistHoldSec = 0;
    }
  }

  let diveStrength = 0;
  if (isDiving) {
    const fistHands = evaluatedHands.filter((h) => h.dAvg < settings.fistExitDistRatio);
    if (fistHands.length > 0) {
      let maxStrength = 0;
      for (const fh of fistHands) {
        const s = clamp((settings.fistExitDistRatio - fh.dAvg) / 0.5, 0, 1);
        if (s > maxStrength) maxStrength = s;
      }
      diveStrength =
        fistHands.length >= 2 ? clamp(maxStrength * 1.2, 0.2, 1.0) : clamp(maxStrength, 0.2, 1.0);
    } else {
      diveStrength = 0.5;
    }
  }

  const isGliding = !isDiving && evaluatedHands.some((h) => h.isGlideCandidate);
  const handsRaisedReady = evaluatedHands.some((h) => h.isReadyRaised);

  return {
    nextState: {
      leftSlot: leftImpulseRes.slotState,
      rightSlot: rightImpulseRes.slotState,
      fistHoldSec,
      handLostSec,
      isDiving,
      flapImpulse,
      lastStepTimeSec: nowSec,
    },
    hands: evaluatedHands,
    handCount: evaluatedHands.length,
    isDiving,
    diveStrength,
    isGliding,
    handsRaisedReady,
    flapImpulse,
    downstrokeFired,
    motionYSamplesLeft: toMotionYSamples(nextLeftSamples),
    motionYSamplesRight: toMotionYSamples(nextRightSamples),
  };
}
