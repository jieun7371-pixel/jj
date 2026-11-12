import assert from 'node:assert/strict';
import test from 'node:test';
import { CalibrationAccumulator, DEFAULT_CALIBRATION } from './calibration.ts';
import { createInitialControlState, mapFaceAndHandsToControl } from './controlMapper.ts';
import { analyzeHandFlapping } from './flapDetector.ts';
import { DEFAULT_TUNABLE_VISION_SETTINGS } from './gestureConfig.ts';
import { createInitialHandGestureState, evaluateHandGestures } from './handGestures.ts';
import { createInitialHeadTiltState, evaluateHeadTilt } from './headTilt.ts';
import type { NormalizedPoint } from './types.ts';

function makeFaceLandmarks(tiltClockwiseDeg = 0): NormalizedPoint[] {
  const face: NormalizedPoint[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const rad = (tiltClockwiseDeg * Math.PI) / 180;
  const cx = 0.5;
  const cy = 0.5;
  const rotateAround = (mx: number, my: number): NormalizedPoint => {
    const dx = mx - cx;
    const dy = my - cy;
    const rmx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    const rmy = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x: 1 - rmx, y: rmy, z: 0 };
  };

  face[33] = rotateAround(0.4, 0.5);
  face[263] = rotateAround(0.6, 0.5);
  face[10] = rotateAround(0.5, 0.3);
  face[152] = rotateAround(0.5, 0.7);
  return face;
}

function makeHandLandmarks(opts: {
  mirroredWristX: number;
  mirroredWristY: number;
  angleDeg?: number;
  fingerRatio?: number;
  fingerRatios?: [number, number, number, number];
  palmScaleS?: number;
}): NormalizedPoint[] {
  const pts: NormalizedPoint[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const s = opts.palmScaleS ?? 0.1;
  const ext = opts.fingerRatio ?? 1.85;
  const perFinger = opts.fingerRatios ?? [ext, ext, ext, ext];
  const rad = ((opts.angleDeg ?? 90) * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = -Math.sin(rad);

  const toRaw = (mx: number, my: number): NormalizedPoint => ({
    x: 1 - mx,
    y: my,
    z: 0,
  });

  pts[0] = toRaw(opts.mirroredWristX, opts.mirroredWristY);
  pts[9] = toRaw(opts.mirroredWristX + ux * s, opts.mirroredWristY + uy * s);
  pts[5] = toRaw(opts.mirroredWristX + ux * s * 0.92 - uy * 0.03, opts.mirroredWristY + uy * s * 0.92 + ux * 0.03);
  pts[13] = toRaw(opts.mirroredWristX + ux * s * 0.92 + uy * 0.03, opts.mirroredWristY + uy * s * 0.92 - ux * 0.03);
  pts[17] = toRaw(opts.mirroredWristX + ux * s * 0.85 + uy * 0.05, opts.mirroredWristY + uy * s * 0.85 - ux * 0.05);

  const tipIndices = [8, 12, 16, 20];
  for (let i = 0; i < tipIndices.length; i++) {
    const r = perFinger[i];
    pts[tipIndices[i]] = toRaw(opts.mirroredWristX + ux * s * r, opts.mirroredWristY + uy * s * r);
  }
  return pts;
}

test('Calibration averages neutral head angle and palm scale S over 3 seconds', () => {
  const acc = new CalibrationAccumulator(3.0);
  const face = makeFaceLandmarks(6);
  const hand = makeHandLandmarks({ mirroredWristX: 0.72, mirroredWristY: 0.6, fingerRatio: 1.85, palmScaleS: 0.14 });

  let completed = false;
  let cal = null;
  for (let i = 0; i <= 32; i++) {
    const res = acc.addSample(face, [hand], 1000 + i * 100);
    if (res.completed) {
      completed = true;
      cal = res.calibration;
      break;
    }
  }

  assert.equal(completed, true);
  assert.ok(cal);
  assert.ok(Math.abs((cal.neutralHeadAngleRad * 180) / Math.PI - 6) < 0.5);
  assert.ok(Math.abs(cal.handScaleS - 0.14) < 0.01);
});

test('Head tilt deadzone (±5 deg), max (±25 deg), and 0.5s face-lost decay work accurately', () => {
  let state = createInitialHeadTiltState();
  const deadRes = evaluateHeadTilt(makeFaceLandmarks(4), 0, state, 1.0, 0.033);
  assert.equal(deadRes.turn, 0);

  state = deadRes.nextState;
  let outTurn = 0;
  for (let i = 1; i <= 18; i++) {
    const r = evaluateHeadTilt(makeFaceLandmarks(25), 0, state, 1 + i * 0.033, 0.033);
    state = r.nextState;
    outTurn = r.turn;
  }
  assert.ok(outTurn > 0.9, `Expected positive turn > 0.9, got ${outTurn}`);

  for (let i = 1; i <= 16; i++) {
    const r = evaluateHeadTilt(null, 0, state, 2 + i * 0.033, 0.033);
    state = r.nextState;
    outTurn = r.turn;
  }
  assert.ok(Math.abs(outTurn) < 0.05, `Expected turn decayed near 0, got ${outTurn}`);
});

test('Strict Fist requires all 4 fingers < 1.1 & d_avg < 1.1 for 0.2s, suppresses rapid motion >= 2.0 S/s, and exits at d_avg >= 1.4', () => {
  let hState = createInitialHandGestureState();

  // Partial curl: only 3 fingers < 1.1, 4th finger = 1.25 -> must NOT count as strict fist!
  const partialCurl = makeHandLandmarks({
    mirroredWristX: 0.3,
    mirroredWristY: 0.5,
    fingerRatios: [0.9, 0.9, 0.9, 1.25],
  });
  for (let i = 0; i < 8; i++) {
    const step = evaluateHandGestures([partialCurl], hState, 1.0 + i * 0.04, 0.04);
    hState = step.nextState;
    assert.equal(step.hands[0].isFist, false);
    assert.equal(step.isDiving, false);
  }

  // Stationary strict fist (ALL 4 fingers = 0.88 < 1.1): must NOT enter before 0.2s, enters >= 0.2s
  hState = createInitialHandGestureState();
  const fistHand = makeHandLandmarks({
    mirroredWristX: 0.3,
    mirroredWristY: 0.5,
    angleDeg: 25,
    fingerRatio: 0.88,
  });

  const t0 = evaluateHandGestures([fistHand], hState, 1.0, 0.04);
  assert.equal(t0.isDiving, false);
  hState = t0.nextState;

  // At 0.16s (still < 0.2s), dive must NOT be entered yet
  for (let i = 1; i <= 3; i++) {
    const step = evaluateHandGestures([fistHand], hState, 1.0 + i * 0.04, 0.04);
    hState = step.nextState;
    assert.equal(step.isDiving, false);
  }
  // Step across 0.2s hold threshold
  let entered = evaluateHandGestures([fistHand], hState, 1.16, 0.04);
  entered = evaluateHandGestures([fistHand], entered.nextState, 1.2, 0.04);
  assert.equal(entered.isDiving, true);
  assert.ok(entered.diveStrength > 0.8);

  // Two fists boost diveStrength 1.2x capped at 1.0
  const twoFist = makeHandLandmarks({ mirroredWristX: 0.72, mirroredWristY: 0.5, angleDeg: -90, fingerRatio: 1.0 });
  const twoRes = evaluateHandGestures([fistHand, twoFist], entered.nextState, 1.24, 0.04);
  assert.equal(twoRes.isDiving, true);
  assert.equal(twoRes.diveStrength, 1.0);

  // Partial opening (d_avg = 1.25 < 1.4 hysteresis band) stays diving when stationary
  const halfOpen = makeHandLandmarks({ mirroredWristX: 0.3, mirroredWristY: 0.5, angleDeg: 25, fingerRatio: 1.25 });
  const hold = evaluateHandGestures([halfOpen], twoRes.nextState, 1.28, 0.04);
  assert.equal(hold.isDiving, true);

  // Fully open hand (d_avg = 1.65 >= 1.4) exits dive
  const openHand = makeHandLandmarks({ mirroredWristX: 0.3, mirroredWristY: 0.5, angleDeg: 25, fingerRatio: 1.65 });
  const exit = evaluateHandGestures([openHand], hold.nextState, 1.32, 0.04);
  assert.equal(exit.isDiving, false);

  // Fast moving clenched hand (>= 2.0 S/s) must suppress fist entry so rapid waving never mis-triggers dive!
  let fastState = createInitialHandGestureState();
  for (let i = 0; i < 8; i++) {
    const fastY = 0.25 + i * 0.06; // 0.6 S per 0.04s = 15 S/s >> 2.0 S/s
    const fastFist = makeHandLandmarks({ mirroredWristX: 0.3, mirroredWristY: fastY, fingerRatio: 0.85 });
    const res = evaluateHandGestures([fastFist], fastState, 2.0 + i * 0.04, 0.04);
    fastState = res.nextState;
    if (i > 0) {
      assert.equal(res.hands[0].fistSuppressedBySpeed, true);
      assert.equal(res.hands[0].isFist, false);
      assert.equal(res.isDiving, false);
    }
  }
});

test('Open hand + stillness over 0.4s triggers glide at any hand angle', () => {
  const state = createInitialHandGestureState();
  const openSideways = makeHandLandmarks({
    mirroredWristX: 0.7,
    mirroredWristY: 0.5,
    angleDeg: -10,
    fingerRatio: 1.75,
  });

  const res = evaluateHandGestures([openSideways], state, 1.0, 0.033);
  assert.equal(res.isGliding, true);
  assert.equal(res.hands[0].isOpen, true);
  assert.equal(res.hands[0].isStill, true);
});

test('Weighted flap detector uses 0.6*amp + 0.4*freq with real timestamps (>= 1.0 Hz) and downstroke pulse impulse (0.35s decay)', () => {
  // Small brisk 1.5 Hz wave with A = 0.30 S works with 1 hand (~0.6 * 0.30/0.35 + 0.4 * 1.5/2.0 = 0.814)
  const samples = Array.from({ length: 19 }, (_, i) => {
    const t = i / 30; // 0.6s window
    return {
      timeSec: t,
      yUpNorm: 0.3 * Math.sin(2 * Math.PI * 1.5 * t),
    };
  });
  const flap = analyzeHandFlapping(samples, [], true, false, DEFAULT_TUNABLE_VISION_SETTINGS);
  assert.ok(flap.flapPower > 0.7, `Expected weighted flapPower > 0.7, got ${flap.flapPower}`);
  assert.ok(flap.leftFreqHz >= 1.2 && flap.leftFreqHz <= 1.8, `Expected ~1.5 Hz, got ${flap.leftFreqHz}`);
  assert.equal(flap.leftFlapPower, flap.rightFlapPower);

  // Irregular frame intervals at 2.0 Hz must measure true timestamp frequency, NOT frame count
  const irregularSamples: Array<{ timeSec: number; yUpNorm: number }> = [];
  let accumT = 0;
  for (let i = 0; i < 12; i++) {
    accumT += i % 2 === 0 ? 0.03 : 0.07; // alternating 33fps / 14fps jitter (~20Hz avg)
    irregularSamples.push({
      timeSec: accumT,
      yUpNorm: 0.35 * Math.sin(2 * Math.PI * 2.0 * accumT),
    });
  }
  const irregularFlap = analyzeHandFlapping(
    irregularSamples,
    [],
    true,
    false,
    DEFAULT_TUNABLE_VISION_SETTINGS
  );
  assert.ok(irregularFlap.flapFreqHz >= 1.5, `Expected true timestamp freq >= 1.5Hz, got ${irregularFlap.flapFreqHz}`);
  assert.ok(irregularFlap.flapPower > 0.8);

  // Brisk downward stroke (>= 0.25 S) fires flapImpulse = 1 and decays linearly over 0.35s
  let hState = createInitialHandGestureState();
  const topOpen = makeHandLandmarks({ mirroredWristX: 0.72, mirroredWristY: 0.42, fingerRatio: 1.7 });
  hState = evaluateHandGestures([topOpen], hState, 1.0, 0.033).nextState;

  const downOpen = makeHandLandmarks({ mirroredWristX: 0.72, mirroredWristY: 0.46, fingerRatio: 1.7 }); // drop = 0.4 S in 0.04s
  const pulseRes = evaluateHandGestures([downOpen], hState, 1.04, 0.04);
  assert.equal(pulseRes.downstrokeFired, true);
  assert.equal(pulseRes.flapImpulse, 1.0);

  // Hold stationary after pulse -> decays proportionally across 0.35s (~0.175s later ~= 0.5)
  let decayState = pulseRes.nextState;
  const midDecay = evaluateHandGestures([downOpen], decayState, 1.215, 0.175);
  assert.ok(midDecay.flapImpulse >= 0.45 && midDecay.flapImpulse <= 0.55, `Expected ~0.5 mid-decay, got ${midDecay.flapImpulse}`);
  const endDecay = evaluateHandGestures([downOpen], midDecay.nextState, 1.4, 0.185);
  assert.equal(endDecay.flapImpulse, 0);

  // Active flap (> 0.25) with non-strict fist stays 날갯짓 while stationary strict fist enters 하강
  let ctrl = createInitialControlState();
  const face = makeFaceLandmarks(-20);
  for (let i = 0; i < 16; i++) {
    const t = 1.0 + i * 0.04;
    const oscY = 0.5 + 0.045 * Math.sin(2 * Math.PI * 2.0 * (t - 1.0));
    // Partial curl (not strict fist) while briskly flapping
    const openL = makeHandLandmarks({
      mirroredWristX: 0.25,
      mirroredWristY: oscY,
      fingerRatios: [0.95, 0.95, 0.95, 1.35],
    });
    const mapped = mapFaceAndHandsToControl(face, [openL], DEFAULT_CALIBRATION, ctrl, t);
    ctrl = mapped.nextState;
  }
  assert.equal(ctrl.lastOutput.priorityGesture, '날갯짓');
  assert.ok(ctrl.lastOutput.flapPower > 0.25);
  assert.equal(ctrl.lastOutput.dive, false);
  assert.ok(ctrl.lastOutput.turn < -0.5);

  // Stationary strict fist enters 하강 cleanly after 0.2s
  let diveCtrl = createInitialControlState();
  for (let i = 0; i < 8; i++) {
    const fistL = makeHandLandmarks({ mirroredWristX: 0.25, mirroredWristY: 0.5, fingerRatio: 0.88 });
    const mapped = mapFaceAndHandsToControl(
      face,
      [fistL],
      DEFAULT_CALIBRATION,
      diveCtrl,
      2.0 + i * 0.04
    );
    diveCtrl = mapped.nextState;
  }
  assert.equal(diveCtrl.lastOutput.priorityGesture, '하강');
  assert.equal(diveCtrl.lastOutput.dive, true);
  assert.equal(diveCtrl.lastOutput.flapPower, 0);
});

test('Open stationary palm remains gliding even with palmScaleS noise, and 0 hands falls back to coasting', () => {
  let ctrl = createInitialControlState();
  const face = makeFaceLandmarks(0);

  // Stationary hand near edge with ±5% S jitter over 0.4s
  for (let i = 0; i < 12; i++) {
    const jitterS = 0.1 + (i % 2 === 0 ? 0.005 : -0.005);
    const open = makeHandLandmarks({
      mirroredWristX: 0.78,
      mirroredWristY: 0.58,
      fingerRatio: 1.75,
      palmScaleS: jitterS,
    });
    const mapped = mapFaceAndHandsToControl(face, [open], DEFAULT_CALIBRATION, ctrl, 1.0 + i * 0.04);
    ctrl = mapped.nextState;
  }
  assert.equal(ctrl.lastOutput.priorityGesture, '활강');
  assert.equal(ctrl.lastOutput.glide, true);

  // When hands vanish cleanly, falls back to 기본 / glide with needHandsPrompt=true
  const noHands = mapFaceAndHandsToControl(face, [], DEFAULT_CALIBRATION, ctrl, 2.0);
  assert.equal(noHands.output.priorityGesture, '기본');
  assert.equal(noHands.output.glide, true);
  assert.equal(noHands.output.overlay.needHandsPrompt, true);
});

