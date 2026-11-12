import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialControlState } from '../../vision/controlMapper.ts';
import { getSurfaceHeightAt, isInsideCityBuilding } from '../city.ts';
import { FlightController } from '../flight.ts';
import { DIFFICULTY_PRESETS, getDifficultyPreset } from './difficulty.ts';
import { GAME_CONFIG } from './gameConfig.ts';
import {
  applyBuildingCollision,
  applySnackCollected,
  clampSpeedMultiplier,
  createInitialGameRoundState,
  pauseGame,
  resetGame,
  resumeGame,
  selectDifficultyInReady,
  startGame,
  startRoundState,
  stepGameRoundState,
} from './gameState.ts';
import {
  applyCollisionPenalty,
  calculateSnackPoints,
  getComboMultiplier,
  getRankGrade,
  isInvulnerable,
} from './scoring.ts';
import { pickAirborneSnackAltitude } from './snackManager.ts';

test('FlightController matches target speeds (43/79/115 km/h at 1.0x) and scales proportionally with speedMultiplier', () => {
  const fc = new FlightController(1.0);
  const baseCtrl = createInitialControlState().lastOutput;

  // Glide default 12 m/s -> 43 km/h
  assert.equal(Math.round(fc.state.speedMps * 3.6), 43);

  // Full flapping accelerates smoothly toward 22 m/s (79 km/h)
  const flapCtrl = { ...baseCtrl, glide: false, flapPower: 1.0, mode: '날갯짓' as const };
  for (let i = 0; i < 160; i++) {
    fc.step(flapCtrl, 0.05, { speedMultiplier: 1.0 });
  }
  assert.equal(Math.round(fc.state.speedMps * 3.6), 79);

  // Full diving accelerates smoothly in unobstructed air toward 32 m/s (115 km/h)
  const diveCtrl = {
    ...baseCtrl,
    glide: false,
    flapPower: 0,
    dive: true,
    isDiving: true,
    diveStrength: 1.0,
    mode: '하강' as const,
  };
  for (let i = 0; i < 160; i++) {
    fc.state.position.y = 320;
    fc.step(diveCtrl, 0.05, { speedMultiplier: 1.0 });
  }
  assert.equal(Math.round(fc.state.speedMps * 3.6), 115);

  // At 0.5x and 1.5x speedMultiplier, glide/flap/dive speeds scale cleanly
  fc.reset(0.5);
  assert.ok(Math.abs(fc.state.speedMps - 6) < 0.01);
  for (let i = 0; i < 160; i++) {
    fc.step(flapCtrl, 0.05, { speedMultiplier: 0.5 });
  }
  assert.equal(Math.round(fc.state.speedMps * 3.6), Math.round(22 * 0.5 * 3.6));

  fc.reset(1.5);
  assert.ok(Math.abs(fc.state.speedMps - 18) < 0.01);
  for (let i = 0; i < 160; i++) {
    fc.state.position.y = 320;
    fc.step(diveCtrl, 0.05, { speedMultiplier: 1.5 });
  }
  assert.equal(Math.round(fc.state.speedMps * 3.6), Math.round(32 * 1.5 * 3.6));

  // Verify climb formula (flapPower*7 + flapImpulse*6, min +2 m/s), +25 deg pitch, and speedMultiplier scaling
  fc.reset(1.0);
  const climbTurnCtrl = { ...flapCtrl, turn: 1.0 };
  for (let i = 0; i < 60; i++) {
    fc.step(climbTurnCtrl, 0.05, { speedMultiplier: 1.0 });
  }
  const headingAt1x = fc.state.headingRad;
  assert.ok(
    fc.state.verticalVelMps >= 6.8 && fc.state.verticalVelMps <= 7.05,
    `Expected ~7.0 m/s climb, got ${fc.state.verticalVelMps}`
  );
  assert.ok(
    fc.state.pitchRad > (22 * Math.PI) / 180,
    `Expected nose-up pitch toward +25 deg (~0.436 rad), got ${fc.state.pitchRad}`
  );

  // Downstroke impulse adds +6 m/s lift on top of flapPower * 7
  fc.reset(1.0);
  const pulseClimbCtrl = { ...flapCtrl, flapPower: 0.5, flapImpulse: 1.0 };
  for (let i = 0; i < 20; i++) {
    fc.step(pulseClimbCtrl, 0.05, { speedMultiplier: 1.0 });
  }
  assert.ok(fc.state.verticalVelMps >= 8.5, `Expected combined impulse climb >= 8.5 m/s, got ${fc.state.verticalVelMps}`);

  // Even a weak flap guarantees >= +2.0 m/s climb with zero glide sink subtracted
  fc.reset(1.0);
  const weakFlapCtrl = { ...baseCtrl, glide: false, flapPower: 0.2, mode: '날갯짓' as const };
  for (let i = 0; i < 40; i++) {
    fc.step(weakFlapCtrl, 0.05, { speedMultiplier: 1.0 });
  }
  assert.ok(fc.state.verticalVelMps >= 1.95, `Expected min +2 m/s climb floor, got ${fc.state.verticalVelMps}`);

  // Exhausted state retains 30% climb power when flapping and softens glide sink to -3.0 m/s
  fc.reset(1.0);
  for (let i = 0; i < 40; i++) {
    fc.step(flapCtrl, 0.05, { speedMultiplier: 1.0, isExhausted: true });
  }
  assert.ok(
    fc.state.verticalVelMps >= 1.9 && fc.state.verticalVelMps <= 2.3,
    `Expected 30% exhausted climb (~2.1 m/s), got ${fc.state.verticalVelMps}`
  );

  fc.reset(1.0);
  for (let i = 0; i < 60; i++) {
    fc.state.position.y = 200;
    fc.step(baseCtrl, 0.05, { speedMultiplier: 1.0, isExhausted: true });
  }
  assert.ok(
    Math.abs(fc.state.verticalVelMps - -3.0) < 0.15,
    `Expected exhausted glide sink -3.0 m/s, got ${fc.state.verticalVelMps}`
  );

  fc.reset(0.5);
  for (let i = 0; i < 60; i++) {
    fc.step(climbTurnCtrl, 0.05, { speedMultiplier: 0.5 });
  }
  const headingDelta1x = headingAt1x - (-115 * Math.PI) / 180;
  const headingDelta05x = fc.state.headingRad - (-115 * Math.PI) / 180;
  assert.ok(Math.abs(headingDelta05x - headingDelta1x * 0.5) < 0.05);
  assert.ok(fc.state.verticalVelMps <= 3.6);
});

test('Combo multiplier table follows 0-1=x1, 2-3=x2, 4-6=x3, 7-9=x4, 10+=x5', () => {
  assert.equal(getComboMultiplier(0), 1);
  assert.equal(getComboMultiplier(1), 1);
  assert.equal(getComboMultiplier(2), 2);
  assert.equal(getComboMultiplier(3), 2);
  assert.equal(getComboMultiplier(4), 3);
  assert.equal(getComboMultiplier(6), 3);
  assert.equal(getComboMultiplier(7), 4);
  assert.equal(getComboMultiplier(9), 4);
  assert.equal(getComboMultiplier(10), 5);
  assert.equal(getComboMultiplier(18), 5);
});

test('Scoring computes climb (+50), dive (+50), and high-altitude (>=60m, +30) aerial bonuses multiplied by combo', () => {
  const climbHigh = calculateSnackPoints({
    isGolden: false,
    altitudeAglM: 65,
    flapPower: 0.72,
    diveStrength: 0,
    nextCombo: 4, // x3
  });
  assert.equal(climbHigh.climbBonus, 50);
  assert.equal(climbHigh.diveBonus, 0);
  assert.equal(climbHigh.highAltBonus, 30);
  assert.equal(climbHigh.totalPoints, 540);

  const diveGolden = calculateSnackPoints({
    isGolden: true,
    altitudeAglM: 40,
    flapPower: 0,
    diveStrength: 0.75,
    nextCombo: 2, // x2
  });
  assert.equal(diveGolden.climbBonus, 0);
  assert.equal(diveGolden.diveBonus, 50);
  assert.equal(diveGolden.highAltBonus, 0);
  assert.equal(diveGolden.totalPoints, 1100);
});

test('Korean rank thresholds assign accurate gull ranks', () => {
  assert.equal(getRankGrade(0), '아기 갈매기');
  assert.equal(getRankGrade(999), '아기 갈매기');
  assert.equal(getRankGrade(1000), '항구 갈매기');
  assert.equal(getRankGrade(3500), '부산 갈매기');
  assert.equal(getRankGrade(6000), '전설의 새우깡 마스터');
});

test('Difficulty presets (0.7/1.0/1.4 speed, 9/7/5m radius, 6/4/3s combo, 0.7/1.0/1.2x energy drain) apply accurately', () => {
  assert.equal(DIFFICULTY_PRESETS.easy.speedMultiplier, 0.7);
  assert.equal(DIFFICULTY_PRESETS.easy.collectRadiusM, 9);
  assert.equal(DIFFICULTY_PRESETS.easy.comboWindowSec, 6);
  assert.equal(DIFFICULTY_PRESETS.easy.energyDrainMultiplier, 0.7);

  assert.equal(DIFFICULTY_PRESETS.normal.speedMultiplier, 1.0);
  assert.equal(DIFFICULTY_PRESETS.normal.collectRadiusM, 7);
  assert.equal(DIFFICULTY_PRESETS.normal.comboWindowSec, 4);
  assert.equal(DIFFICULTY_PRESETS.normal.energyDrainMultiplier, 1.0);

  assert.equal(DIFFICULTY_PRESETS.hard.speedMultiplier, 1.4);
  assert.equal(DIFFICULTY_PRESETS.hard.collectRadiusM, 5);
  assert.equal(DIFFICULTY_PRESETS.hard.comboWindowSec, 3);
  assert.equal(DIFFICULTY_PRESETS.hard.energyDrainMultiplier, 1.2);

  assert.equal(clampSpeedMultiplier(0.2), GAME_CONFIG.speedMultiplierMin);
  assert.equal(clampSpeedMultiplier(1.9), GAME_CONFIG.speedMultiplierMax);
  assert.equal(clampSpeedMultiplier(1.14), 1.1);

  assert.equal(GAME_CONFIG.energyDrainFlapPerSec, 6.0);
  assert.equal(GAME_CONFIG.exhaustedSinkSpeedMps, -3.0);

  const easyPlay = startRoundState(createInitialGameRoundState({ difficulty: 'easy', phase: 'READY' }));
  const steppedEasy = stepGameRoundState(easyPlay, {
    dtSec: 0.1,
    flapPower: 1.0,
    isDiving: false,
  }).nextState;
  const expectedEasyEnergy = 100 - 1.0 * GAME_CONFIG.energyDrainFlapPerSec * 0.7 * 0.1;
  assert.ok(Math.abs(steppedEasy.energy - expectedEasyEnergy) < 1e-6);

  const hardPlay = startRoundState(createInitialGameRoundState({ difficulty: 'hard', phase: 'READY' }));
  const steppedHard = stepGameRoundState(hardPlay, {
    dtSec: 0.1,
    flapPower: 1.0,
    isDiving: false,
  }).nextState;
  const expectedHardEnergy = 100 - 1.0 * GAME_CONFIG.energyDrainFlapPerSec * 1.2 * 0.1;
  assert.ok(Math.abs(steppedHard.energy - expectedHardEnergy) < 1e-6);
});

test('State machine handles READY -> COUNTDOWN(3-2-1) -> PLAYING -> PAUSED -> COUNTDOWN -> PLAYING -> RESULT and resets cleanly', () => {
  let state = createInitialGameRoundState({
    difficulty: 'normal',
    highScores: { easy: 300, normal: 800, hard: 1200 },
    phase: 'READY',
  });
  assert.equal(state.highScore, 800);

  // Switch difficulty on READY updates active high score
  state = selectDifficultyInReady(state, 'hard');
  assert.equal(state.difficulty, 'hard');
  assert.equal(state.highScore, 1200);

  // startGame enters COUNTDOWN (3.0s) with clean initial stats
  state = startGame(state, 'hard');
  assert.equal(state.phase, 'COUNTDOWN');
  assert.equal(state.countdownReason, 'start');
  assert.equal(state.countdownSec, 3);
  assert.equal(state.timeLeftSec, 60);
  assert.equal(state.score, 0);

  // Step through countdown and observe 2, 1 ticks then PLAYING transition
  const seenDigits: number[] = [];
  let enteredPlaying = false;
  for (let i = 0; i < 40; i++) {
    const res = stepGameRoundState(state, { dtSec: 0.1, flapPower: 1, isDiving: false });
    state = res.nextState;
    if (res.countdownTickDigit !== null) seenDigits.push(res.countdownTickDigit);
    if (res.countdownFinished) enteredPlaying = true;
    // Timer and energy do NOT decay during countdown
    if (state.phase === 'COUNTDOWN') {
      assert.equal(state.timeLeftSec, 60);
      assert.equal(state.energy, 100);
    }
    if (state.phase === 'PLAYING') break;
  }
  assert.deepEqual(seenDigits, [2, 1]);
  assert.equal(enteredPlaying, true);
  assert.equal(state.phase, 'PLAYING');

  // Collect snack and accumulate combo/score
  state = applySnackCollected(state, {
    isGolden: false,
    altitudeAglM: 40,
    flapPower: 0.1,
    diveStrength: 0,
  }).nextState;
  assert.equal(state.score, 100);
  assert.equal(state.combo, 1);

  // Pause freezes timeLeftSec, energy, and comboTimerSec
  state = pauseGame(state, 'manual');
  assert.equal(state.phase, 'PAUSED');
  const frozenSnapshot = { ...state };
  const steppedPaused = stepGameRoundState(state, { dtSec: 0.1, flapPower: 1, isDiving: false });
  assert.equal(steppedPaused.nextState.timeLeftSec, frozenSnapshot.timeLeftSec);
  assert.equal(steppedPaused.nextState.comboTimerSec, frozenSnapshot.comboTimerSec);
  assert.equal(steppedPaused.nextState.energy, frozenSnapshot.energy);

  // Resume goes through COUNTDOWN ('resume') then restores PLAYING with preserved progress
  state = resumeGame(state);
  assert.equal(state.phase, 'COUNTDOWN');
  assert.equal(state.countdownReason, 'resume');
  for (let i = 0; i < 35; i++) {
    state = stepGameRoundState(state, { dtSec: 0.1, flapPower: 0, isDiving: false }).nextState;
    if (state.phase === 'PLAYING') break;
  }
  assert.equal(state.phase, 'PLAYING');
  assert.equal(state.score, 100);

  // Exceed existing high score then abort via resetGame -> original 1200 must stay untouched
  for (let i = 0; i < 6; i++) {
    state = applySnackCollected(state, {
      isGolden: true,
      altitudeAglM: 70,
      flapPower: 0,
      diveStrength: 0,
    }).nextState;
  }
  assert.ok(state.score > 1200);
  const resetToReady = resetGame(state);
  assert.equal(resetToReady.phase, 'READY');
  assert.equal(resetToReady.score, 0);
  assert.equal(resetToReady.combo, 0);
  assert.equal(resetToReady.timeLeftSec, 60);
  assert.equal(resetToReady.isNewRecord, false);
  assert.equal(resetToReady.highScore, 1200);
  assert.equal(resetToReady.highScoresByDifficulty.hard, 1200);
});

test('60s timer warns once per second under 10s, caps golden +3s at 60s, transitions to RESULT, and resets cleanly on restart', () => {
  let state = startRoundState(
    createInitialGameRoundState({
      difficulty: 'easy',
      highScores: { easy: 200, normal: 0, hard: 0 },
      phase: 'READY',
    })
  );

  // Golden snack +3s at 59s must stay capped at 60s
  state.timeLeftSec = 59;
  state = applySnackCollected(state, {
    isGolden: true,
    altitudeAglM: 70,
    flapPower: 0,
    diveStrength: 0,
  }).nextState;
  assert.equal(state.timeLeftSec, 60);

  // Simulate down from 10.5s to 0s and record <= 10s warning beeps
  state.timeLeftSec = 10.5;
  const warningSecs: number[] = [];
  let finished = false;
  for (let i = 0; i < 150; i++) {
    const res = stepGameRoundState(state, { dtSec: 0.1, flapPower: 0, isDiving: false });
    state = res.nextState;
    if (res.timeWarningBeepSec !== null) warningSecs.push(res.timeWarningBeepSec);
    if (res.justEnded) {
      finished = true;
      break;
    }
  }

  assert.deepEqual(warningSecs, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(finished, true);
  assert.equal(state.phase, 'RESULT');
  assert.equal(state.isNewRecord, true);
  assert.equal(state.highScoresByDifficulty.easy, state.score);
  assert.equal(state.highScoresByDifficulty.normal, 0);

  // Starting again with same difficulty creates brand new zeroed state keeping new high score
  const restarted = startGame(state, 'easy');
  assert.equal(restarted.phase, 'COUNTDOWN');
  assert.equal(restarted.score, 0);
  assert.equal(restarted.combo, 0);
  assert.equal(restarted.eatenCount, 0);
  assert.equal(restarted.energy, 100);
  assert.equal(restarted.timeLeftSec, 60);
  assert.equal(restarted.isNewRecord, false);
  assert.equal(restarted.highScore, state.score);
});

test('Energy drains during flapping, triggers exhaustion at 0, and recovers only once >= 20', () => {
  let state = startRoundState(createInitialGameRoundState({ difficulty: 'normal', phase: 'READY' }));
  assert.equal(state.energy, 100);
  assert.equal(state.isExhausted, false);

  for (let i = 0; i < 220; i++) {
    const r = stepGameRoundState(state, { dtSec: 0.1, flapPower: 1.0, isDiving: false });
    state = r.nextState;
    if (state.isExhausted) break;
  }
  assert.equal(state.energy, 0);
  assert.equal(state.isExhausted, true);

  for (let i = 0; i < 30; i++) {
    state = stepGameRoundState(state, { dtSec: 0.1, flapPower: 0.9, isDiving: false }).nextState;
  }
  assert.ok(state.energy >= 14.9 && state.energy < 20);
  assert.equal(state.isExhausted, true);

  for (let i = 0; i < 10; i++) {
    state = stepGameRoundState(state, { dtSec: 0.1, flapPower: 0, isDiving: false }).nextState;
  }
  assert.ok(state.energy >= 20);
  assert.equal(state.isExhausted, false);
});

test('Snack collection updates combo with preset window, golden full heal/bonus time, and building collision resets combo', () => {
  let state = startRoundState(
    createInitialGameRoundState({
      difficulty: 'easy',
      highScores: { easy: 500, normal: 0, hard: 0 },
      phase: 'READY',
    })
  );
  state.energy = 40;
  state.timeLeftSec = 20;

  const c1 = applySnackCollected(state, {
    isGolden: false,
    altitudeAglM: 35,
    flapPower: 0.1,
    diveStrength: 0,
  });
  state = c1.nextState;
  assert.equal(state.combo, 1);
  assert.equal(state.comboTimerSec, getDifficultyPreset('easy').comboWindowSec);
  assert.equal(state.energy, 55);
  assert.equal(state.score, 100);

  state = stepGameRoundState(state, { dtSec: 1.5, flapPower: 0, isDiving: false }).nextState;
  const c2 = applySnackCollected(state, {
    isGolden: true,
    altitudeAglM: 70,
    flapPower: 0,
    diveStrength: 0.6,
  });
  state = c2.nextState;
  assert.equal(state.combo, 2);
  assert.equal(state.energy, 100);
  assert.ok(state.timeLeftSec > 21);
  assert.equal(state.score, 100 + (500 + 50 + 30) * 2);
  assert.equal(state.isNewRecord, true);

  const hit = applyBuildingCollision(state, { nowSec: 5.0, impactSpeedMps: 15 });
  assert.equal(hit.applied, true);
  assert.equal(hit.penalty, 50);
  assert.equal(hit.isLightTouch, false);
  assert.equal(hit.comboBroken, true);
  assert.equal(hit.nextState.energy, 90);
  assert.equal(hit.nextState.combo, 0);
  assert.equal(hit.nextState.crashCount, 1);
  assert.equal(hit.nextState.totalPenalty, 50);
  assert.equal(hit.nextState.score, 100 + (500 + 50 + 30) * 2 - 50);
});

test('Building collision penalties scale by difficulty, halve on light touches (<60% glide speed), clamp at 0, enforce 1.5s invulnerability, and reset cleanly', () => {
  // Pure applyCollisionPenalty checks (easy -50, normal -100, hard -150; 0 floor)
  assert.deepEqual(applyCollisionPenalty(500, 'easy', 12), {
    newScore: 450,
    penalty: 50,
    isLightTouch: false,
  });
  assert.deepEqual(applyCollisionPenalty(500, 'normal', 15), {
    newScore: 400,
    penalty: 100,
    isLightTouch: false,
  });
  assert.deepEqual(applyCollisionPenalty(500, 'hard', 20), {
    newScore: 350,
    penalty: 150,
    isLightTouch: false,
  });
  assert.deepEqual(applyCollisionPenalty(40, 'normal', 15), {
    newScore: 0,
    penalty: 100,
    isLightTouch: false,
  });

  // Light touch (< 60% of 1.0x 12 m/s glide speed = < 7.2 m/s) halves penalty (-50 on normal)
  assert.deepEqual(applyCollisionPenalty(500, 'normal', 5.0), {
    newScore: 450,
    penalty: 50,
    isLightTouch: true,
  });
  assert.deepEqual(applyCollisionPenalty(500, 'hard', 6.0), {
    newScore: 425,
    penalty: 75,
    isLightTouch: true,
  });

  // Pure isInvulnerable checks (1.5s window)
  assert.equal(isInvulnerable(2.0, null), false);
  assert.equal(isInvulnerable(2.0, 1.0), true); // 1.0s < 1.5s
  assert.equal(isInvulnerable(2.49, 1.0), true);
  assert.equal(isInvulnerable(2.5, 1.0), false); // exactly 1.5s expires

  // State machine integration: no penalty in COUNTDOWN / PAUSED / RESULT
  const countdownState = startGame(createInitialGameRoundState({ difficulty: 'normal' }), 'normal');
  assert.equal(applyBuildingCollision(countdownState).applied, false);

  let playState = startRoundState(createInitialGameRoundState({ difficulty: 'normal', phase: 'READY' }));
  playState = applySnackCollected(playState, {
    isGolden: false,
    altitudeAglM: 40,
    flapPower: 0,
    diveStrength: 0,
  }).nextState;
  const pausedState = pauseGame(playState, 'manual');
  assert.equal(applyBuildingCollision(pausedState).applied, false);

  // During PLAYING: 1st hit deducts -100, breaks combo, records crashCount/totalPenalty/lastHitTime
  playState.playElapsedSec = 4.0;
  const hit1 = applyBuildingCollision(playState, { impactSpeedMps: 15 });
  assert.equal(hit1.applied, true);
  assert.equal(hit1.penalty, 100);
  assert.equal(hit1.nextState.score, 0);
  assert.equal(hit1.nextState.crashCount, 1);
  assert.equal(hit1.nextState.totalPenalty, 100);
  assert.equal(hit1.nextState.lastHitTime, 4.0);

  // Within 1.5s (4.0 + 1.0 = 5.0s), second collision is ignored (no penalty/energy loss)
  const hitDuringInvuln = applyBuildingCollision(hit1.nextState, { nowSec: 5.0, impactSpeedMps: 15 });
  assert.equal(hitDuringInvuln.applied, false);
  assert.equal(hitDuringInvuln.nextState.crashCount, 1);
  assert.equal(hitDuringInvuln.nextState.energy, 90);

  // After 1.5s (4.0 + 1.6 = 5.6s), collision applies again (light touch -> half penalty)
  hit1.nextState.score = 300;
  const hitAfterInvuln = applyBuildingCollision(hit1.nextState, {
    nowSec: 5.6,
    impactSpeedMps: 3.0,
  });
  assert.equal(hitAfterInvuln.applied, true);
  assert.equal(hitAfterInvuln.isLightTouch, true);
  assert.equal(hitAfterInvuln.penalty, 50);
  assert.equal(hitAfterInvuln.nextState.score, 250);
  assert.equal(hitAfterInvuln.nextState.crashCount, 2);
  assert.equal(hitAfterInvuln.nextState.totalPenalty, 150);

  // Finish round with crashCount > 0 -> NO noCrashBonus
  let crashedEndState = { ...hitAfterInvuln.nextState, timeLeftSec: 0.05 };
  crashedEndState = stepGameRoundState(crashedEndState, {
    dtSec: 0.1,
    flapPower: 0,
    isDiving: false,
  }).nextState;
  assert.equal(crashedEndState.phase, 'RESULT');
  assert.equal(crashedEndState.noCrashBonus, 0);
  assert.equal(crashedEndState.score, 250);

  // Restart resets crashCount, totalPenalty, lastHitTime, noCrashBonus cleanly
  const restarted = startGame(crashedEndState, 'normal');
  assert.equal(restarted.crashCount, 0);
  assert.equal(restarted.totalPenalty, 0);
  assert.equal(restarted.lastHitTime, null);
  assert.equal(restarted.noCrashBonus, 0);

  // Zero-crash round awards +200 bonus on RESULT and evaluates new record with bonus included
  let cleanPlay = startRoundState(
    createInitialGameRoundState({
      difficulty: 'normal',
      highScores: { easy: 0, normal: 250, hard: 0 },
      phase: 'READY',
    })
  );
  cleanPlay = applySnackCollected(cleanPlay, {
    isGolden: false,
    altitudeAglM: 40,
    flapPower: 0,
    diveStrength: 0,
  }).nextState; // 100 pts (< 250)
  cleanPlay.timeLeftSec = 0.05;
  const cleanResult = stepGameRoundState(cleanPlay, {
    dtSec: 0.1,
    flapPower: 0,
    isDiving: false,
  }).nextState;
  assert.equal(cleanResult.phase, 'RESULT');
  assert.equal(cleanResult.noCrashBonus, 200);
  assert.equal(cleanResult.score, 300); // 100 + 200 > 250
  assert.equal(cleanResult.isNewRecord, true);
});

test('Airborne snack altitude stays within normal [25,60] / golden [60,90], clears buildings by +15m, and respects +-25m proximity', () => {
  for (let i = 0; i < 20; i++) {
    const h = pickAirborneSnackAltitude({
      isGolden: false,
      birdAltM: 45,
      buildingRoofM: 0,
      random: () => i / 20,
    });
    assert.ok(h >= 25 && h <= 60, `Normal snack ${h} out of [25,60]`);
    assert.ok(Math.abs(h - 45) <= 25.001, `Normal snack ${h} not within +-25m of 45m`);
  }

  const overBuilding = pickAirborneSnackAltitude({
    isGolden: false,
    birdAltM: 32,
    buildingRoofM: 30,
    random: () => 0,
  });
  assert.ok(overBuilding >= 45, `Expected >= 45m above 30m roof, got ${overBuilding}`);

  const goldenOverTower = pickAirborneSnackAltitude({
    isGolden: true,
    birdAltM: 65,
    buildingRoofM: 60,
    random: () => 0,
  });
  assert.ok(goldenOverTower >= 75 && goldenOverTower <= 90, `Expected 75..90m, got ${goldenOverTower}`);
});

test('Procedural city footprint helper returns 0m on park lawn and building height on structure roof', () => {
  assert.equal(isInsideCityBuilding(0, 8, 4), false);
  assert.equal(getSurfaceHeightAt(0, 8), 0);
  assert.equal(isInsideCityBuilding(0, -28, 4), true);
  assert.ok(getSurfaceHeightAt(0, -28) > 10);
});
