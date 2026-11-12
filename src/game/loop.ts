import * as THREE from 'three';
import { sfx } from '../audio/sfx.ts';
import { FLIGHT_CONFIG } from '../config.ts';
import { createInitialControlState } from '../vision/controlMapper.ts';
import {
  DEFAULT_TUNABLE_VISION_SETTINGS,
  type TunableVisionSettings,
} from '../vision/gestureConfig.ts';
import type { FlightControlOutput, FlightMode } from '../vision/types.ts';
import { createSeagull } from './bird.ts';
import { createCity } from './city.ts';
import { FlightController } from './flight.ts';
import {
  getLeaderboardTopScoresMap,
  localLeaderboardStore,
} from './leaderboard/leaderboardStore.ts';
import {
  getDifficultyPreset,
  loadSelectedDifficulty,
  saveSelectedDifficulty,
  type DifficultyPresetId,
  type HighScoreMap,
} from './rules/difficulty.ts';
import { GAME_CONFIG } from './rules/gameConfig.ts';
import {
  applyBuildingCollision,
  applySnackCollected,
  clampSpeedMultiplier,
  createInitialGameRoundState,
  pauseGame as transitionPauseGame,
  resetGame as transitionResetGame,
  resumeGame as transitionResumeGame,
  selectDifficultyInReady,
  startGame as transitionStartGame,
  stepGameRoundState,
  type GameRoundState,
  type PauseReason,
} from './rules/gameState.ts';
import { isInvulnerable } from './rules/scoring.ts';
import { SnackManager, type SnackHudOverlayData } from './rules/snackManager.ts';
import { createSceneEnvironment, type TimeOfDay } from './scene.ts';

export interface FloatingScorePopup {
  id: number;
  points: number;
  isGolden: boolean;
  isPenalty?: boolean;
  tags: string[];
  screenX: number; // 0..1 within 3D viewport
  screenY: number; // 0..1 within 3D viewport
}

export interface TelemetrySnapshot {
  altitudeM: number;
  altitudeAglM: number;
  climbRateMps: number;
  speedKmh: number;
  speedMultiplier: number;
  difficulty: DifficultyPresetId;
  collectRadiusM: number;
  comboWindowSec: number;
  mode: FlightMode;
  timeOfDay: TimeOfDay;
  impactAlert: boolean;
  collisionFlash: boolean;
  invulnerable: boolean;
  comboBreakAlert: boolean;
  control: FlightControlOutput;
  gameState: GameRoundState;
  snackOverlay: SnackHudOverlayData;
  fps: number;
}

export interface ManualInputState {
  pointerTurn: number;
  pointerDive: number;
  pointerFlapBoost: number;
}

export interface GameLoopController {
  setPoseControl: (output: FlightControlOutput) => void;
  setPoseControlActive: (active: boolean) => void;
  setTunableConfig: (cfg: TunableVisionSettings) => void;
  setSpeedMultiplier: (val: number) => void;
  setDifficulty: (diff: DifficultyPresetId) => void;
  setTimeOfDay: (mode: TimeOfDay) => void;
  cycleTimeOfDay: () => TimeOfDay;
  startGame: (diff?: DifficultyPresetId) => void;
  pauseGame: (reason?: PauseReason) => void;
  resumeGame: () => void;
  resetGame: () => void;
  syncHighScores: (scores: HighScoreMap) => void;
  setManualInput: (partial: Partial<ManualInputState>) => void;
  triggerManualFlapPulse: () => void;
  resetFlightPosition: () => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

export interface GameLoopOptions {
  canvas: HTMLCanvasElement;
  onTelemetry: (snapshot: TelemetrySnapshot) => void;
  onFloatingScore?: (popup: FloatingScorePopup) => void;
  onClearPopups?: () => void;
  onRecalibrateShortcut?: () => void;
  onPauseToggleShortcut?: () => void;
  onCycleTimeShortcut?: (next: TimeOfDay) => void;
  onSpeedChanged?: (nextSpeedMultiplier: number) => void;
}

const TIME_ORDER: readonly TimeOfDay[] = ['낮', '노을', '밤'];

export function startGameLoop(options: GameLoopOptions): GameLoopController {
  const {
    canvas,
    onTelemetry,
    onFloatingScore,
    onClearPopups,
    onRecalibrateShortcut,
    onPauseToggleShortcut,
    onCycleTimeShortcut,
    onSpeedChanged,
  } = options;

  let difficulty: DifficultyPresetId = loadSelectedDifficulty();
  let speedMultiplier = getDifficultyPreset(difficulty).speedMultiplier;

  const sceneEnv = createSceneEnvironment(canvas);
  const seagull = createSeagull();
  sceneEnv.scene.add(seagull.group);

  const maxAniso = sceneEnv.renderer.capabilities.getMaxAnisotropy();
  const city = createCity(maxAniso);
  sceneEnv.scene.add(city.group);

  const snackManager = new SnackManager();
  sceneEnv.scene.add(snackManager.group);

  const flight = new FlightController(speedMultiplier);

  let timeOfDay: TimeOfDay = '낮';
  let disposed = false;

  snackManager.resetAll(flight.state.position, flight.state.headingRad);

  let gameRoundState: GameRoundState = createInitialGameRoundState({
    difficulty,
    highScores: getLeaderboardTopScoresMap(localLeaderboardStore),
    phase: 'READY',
  });
  let popupCounter = 1;
  let collisionFlashLeftSec = 0;
  let comboBreakLeftSec = 0;

  let poseControlActive = false;
  let latestPoseControl: FlightControlOutput | null = null;
  let controlConfig: TunableVisionSettings = { ...DEFAULT_TUNABLE_VISION_SETTINGS };

  const manualInput: ManualInputState = {
    pointerTurn: 0,
    pointerDive: 0,
    pointerFlapBoost: 0,
  };
  const pressedKeys = new Set<string>();
  const baseDefaultOutput = createInitialControlState().lastOutput;

  let smoothedManualTurn = 0;
  let smoothedManualDive = 0;
  let smoothedManualFlap = 0;
  let pointerFlapImpulse = 0;

  const clearInputs = () => {
    pressedKeys.clear();
    manualInput.pointerTurn = 0;
    manualInput.pointerDive = 0;
    manualInput.pointerFlapBoost = 0;
    pointerFlapImpulse = 0;
  };

  const applyTime = (next: TimeOfDay) => {
    timeOfDay = next;
    sceneEnv.setTimeOfDay(next);
    city.setTimeOfDay(next);
  };

  const cycleTime = (): TimeOfDay => {
    const idx = TIME_ORDER.indexOf(timeOfDay);
    const next = TIME_ORDER[(idx + 1) % TIME_ORDER.length];
    applyTime(next);
    return next;
  };

  const updateSpeedMultiplier = (val: number) => {
    speedMultiplier = clampSpeedMultiplier(val);
    onSpeedChanged?.(speedMultiplier);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (
        gameRoundState.phase === 'PLAYING' ||
        gameRoundState.phase === 'PAUSED'
      ) {
        e.preventDefault();
        onPauseToggleShortcut?.();
        return;
      }
    }
    if (e.code === 'KeyR' && onRecalibrateShortcut) {
      onRecalibrateShortcut();
      return;
    }
    if (e.code === 'KeyT') {
      const next = cycleTime();
      onCycleTimeShortcut?.(next);
      return;
    }
    if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') {
      updateSpeedMultiplier(speedMultiplier + GAME_CONFIG.speedMultiplierStep);
      return;
    }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') {
      updateSpeedMultiplier(speedMultiplier - GAME_CONFIG.speedMultiplierStep);
      return;
    }

    if (gameRoundState.phase !== 'PLAYING') return;

    pressedKeys.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      sfx.unlock();
      manualInput.pointerFlapBoost = 0.95;
      if (!e.repeat) {
        pointerFlapImpulse = 1.0;
      }
    } else if (e.code === 'Home' || e.code === 'KeyB') {
      flight.reset(speedMultiplier);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    pressedKeys.delete(e.code);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const buildCombinedControl = (dt: number, nowSec: number): FlightControlOutput => {
    const keyTurn =
      (pressedKeys.has('ArrowRight') || pressedKeys.has('KeyD') ? 1 : 0) -
      (pressedKeys.has('ArrowLeft') || pressedKeys.has('KeyA') ? 1 : 0);
    const keyDive = pressedKeys.has('ArrowDown') || pressedKeys.has('KeyS') ? 0.9 : 0;
    const keyFlap =
      pressedKeys.has('Space') || pressedKeys.has('ArrowUp') || pressedKeys.has('KeyW') ? 0.9 : 0;

    manualInput.pointerFlapBoost = Math.max(0, manualInput.pointerFlapBoost - dt * 1.45);
    pointerFlapImpulse = Math.max(0, pointerFlapImpulse - dt / 0.35);

    const targetTurn = Math.max(-1, Math.min(1, keyTurn + manualInput.pointerTurn));
    const targetDive = Math.max(keyDive, manualInput.pointerDive);
    const targetFlap = Math.max(keyFlap, manualInput.pointerFlapBoost);

    const k = 1 - Math.exp(-9 * dt);
    smoothedManualTurn += (targetTurn - smoothedManualTurn) * k;
    smoothedManualDive += (targetDive - smoothedManualDive) * k;
    smoothedManualFlap += (targetFlap - smoothedManualFlap) * k;

    const hasManualOverride =
      Math.abs(targetTurn) > 0.04 ||
      targetDive > 0.05 ||
      targetFlap > 0.05 ||
      pointerFlapImpulse > 0.05;

    if (poseControlActive && latestPoseControl && !hasManualOverride) {
      return latestPoseControl;
    }

    const base = latestPoseControl ?? baseDefaultOutput;
    const turn = hasManualOverride ? smoothedManualTurn : base.turn;
    const diveStrength = hasManualOverride ? smoothedManualDive : base.diveStrength;
    const isDiving = diveStrength > 0.2;
    const flapPower = hasManualOverride ? smoothedManualFlap : base.flapPower;
    const flapImpulse = hasManualOverride
      ? Math.max(base.flapImpulse, pointerFlapImpulse)
      : base.flapImpulse;

    const flapWave = Math.sin(nowSec * 2 * Math.PI * 2.5);
    const elev = flapPower > 0.08 || flapImpulse > 0.2 ? flapWave : 0;
    const isFlappingMode = !isDiving && (flapPower > 0.14 || flapImpulse > 0.25);
    const mode: FlightMode = isDiving ? '하강' : isFlappingMode ? '날갯짓' : '활공';

    return {
      ...base,
      turn,
      diveStrength,
      dive: isDiving,
      isDiving,
      glide: !isDiving && !isFlappingMode,
      flapPower,
      flapImpulse,
      leftFlapPower: flapPower,
      rightFlapPower: flapPower,
      leftWingElevation: elev,
      rightWingElevation: elev,
      mode,
      priorityGesture: isDiving ? '하강' : isFlappingMode ? '날갯짓' : hasManualOverride ? '활강' : base.priorityGesture,
      gestureBlockReason: hasManualOverride ? null : base.gestureBlockReason,
      tiltDeg: hasManualOverride ? turn * controlConfig.headMaxDeg : base.tiltDeg,
    };
  };

  let rafId: number | null = null;
  let softTimerId: number | null = null;
  let lastFrameMs = performance.now();
  let lastHudEmitMs = 0;
  let fpsCounter = 0;
  let fpsTimerMs = performance.now();
  let currentFps = 60;

  const beakLocal = new THREE.Vector3(0, 0.04, -1.9);
  const beakWorldPos = new THREE.Vector3();
  const tempPopupProj = new THREE.Vector3();

  const emitTelemetryNow = (controlSnapshot: FlightControlOutput) => {
    const preset = getDifficultyPreset(difficulty);
    const snackOverlay = snackManager.computeScreenProjections(
      sceneEnv.camera,
      flight.state.position
    );

    onTelemetry({
      altitudeM: Math.round(flight.state.position.y),
      altitudeAglM: Math.round(flight.state.altitudeAglM),
      climbRateMps: Math.round(flight.state.verticalVelMps * 10) / 10,
      speedKmh: Math.round(flight.state.speedMps * 3.6),
      speedMultiplier,
      difficulty,
      collectRadiusM: preset.collectRadiusM,
      comboWindowSec: preset.comboWindowSec,
      mode: flight.state.mode,
      timeOfDay,
      impactAlert: flight.state.impactShake > 0.25,
      collisionFlash: collisionFlashLeftSec > 0,
      invulnerable:
        gameRoundState.phase === 'PLAYING' &&
        isInvulnerable(gameRoundState.playElapsedSec, gameRoundState.lastHitTime),
      comboBreakAlert: comboBreakLeftSec > 0,
      control: controlSnapshot,
      gameState: gameRoundState,
      snackOverlay,
      fps: currentFps,
    });
  };

  const scheduleNextFrame = (cb: () => void) => {
    if (disposed) return;
    if (sceneEnv.isSoftwareGl) {
      softTimerId = window.setTimeout(() => {
        if (!disposed) rafId = requestAnimationFrame(cb);
      }, 65);
    } else {
      rafId = requestAnimationFrame(cb);
    }
  };

  const tick = () => {
    if (disposed) return;

    const nowMs = performance.now();
    const dtSec = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;

    fpsCounter++;
    if (nowMs - fpsTimerMs >= 500) {
      currentFps = Math.round((fpsCounter * 1000) / (nowMs - fpsTimerMs));
      fpsCounter = 0;
      fpsTimerMs = nowMs;
    }

    const preset = getDifficultyPreset(difficulty);
    const prevPhase = gameRoundState.phase;
    const prevCountdownCeil = Math.ceil(gameRoundState.countdownSec);
    let telemetryControl = baseDefaultOutput;
    let forceHudEmit = false;

    if (gameRoundState.phase === 'COUNTDOWN') {
      seagull.setInvulnerableBlink(false, flight.state.timeSec);
      collisionFlashLeftSec = 0;
      comboBreakLeftSec = 0;
      // Ignore gestures and keep flight/snacks frozen cleanly during 3-2-1 countdown
      const roundStep = stepGameRoundState(gameRoundState, {
        dtSec,
        flapPower: 0,
        isDiving: false,
      });
      gameRoundState = roundStep.nextState;

      if (roundStep.countdownTickDigit === 2 || roundStep.countdownTickDigit === 1) {
        sfx.playCountdownBeep(roundStep.countdownTickDigit);
      }
      if (roundStep.countdownFinished) {
        sfx.playCountdownBeep('go');
      }

      flight.applyBirdTransform(seagull.group);
      flight.updateChaseCamera(sceneEnv.camera, baseDefaultOutput, dtSec);
      sceneEnv.updateAtmosphere(
        flight.state.position,
        flight.state.forwardVec,
        0,
        dtSec
      );
      city.updateCenter(flight.state.position);
      sceneEnv.renderer.render(sceneEnv.scene, sceneEnv.camera);
    } else if (gameRoundState.phase === 'PLAYING') {
      const control = buildCombinedControl(dtSec, nowMs / 1000);
      telemetryControl = control;

      const prevCollisionFlash = collisionFlashLeftSec > 0;
      const prevComboBreak = comboBreakLeftSec > 0;
      collisionFlashLeftSec = Math.max(0, collisionFlashLeftSec - dtSec);
      comboBreakLeftSec = Math.max(0, comboBreakLeftSec - dtSec);
      if (
        (prevCollisionFlash && collisionFlashLeftSec <= 0) ||
        (prevComboBreak && comboBreakLeftSec <= 0)
      ) {
        forceHudEmit = true;
      }

      // 1. Flight physics & building collision recovery
      const didCollide = flight.step(control, dtSec, {
        isExhausted: gameRoundState.isExhausted,
        speedMultiplier,
      });
      flight.applyBirdTransform(seagull.group);
      flight.updateChaseCamera(sceneEnv.camera, control, dtSec);

      seagull.group.updateMatrixWorld();
      beakWorldPos.copy(beakLocal).applyMatrix4(seagull.group.matrixWorld);

      // 2. Building collision penalty + 1.5s invulnerability + SFX + red floating penalty
      if (didCollide) {
        const hitRes = applyBuildingCollision(gameRoundState, {
          nowSec: gameRoundState.playElapsedSec,
          impactSpeedMps: flight.state.lastImpactSpeedMps,
          minGlideSpeedMps: FLIGHT_CONFIG.glideSpeedMps * speedMultiplier,
        });
        gameRoundState = hitRes.nextState;
        if (hitRes.applied) {
          sfx.playBuildingHit();
          collisionFlashLeftSec = GAME_CONFIG.collisionFlashSec;
          if (hitRes.comboBroken) {
            comboBreakLeftSec = GAME_CONFIG.comboBreakBannerSec;
          }
          forceHudEmit = true;

          if (onFloatingScore) {
            tempPopupProj.copy(flight.state.position).project(sceneEnv.camera);
            onFloatingScore({
              id: popupCounter++,
              points: -hitRes.penalty,
              isGolden: false,
              isPenalty: true,
              tags: [hitRes.isLightTouch ? '가벼운 접촉' : '건물 충돌'],
              screenX: Math.max(0.14, Math.min(0.86, (tempPopupProj.x + 1) * 0.5)),
              screenY: Math.max(0.22, Math.min(0.78, (1 - tempPopupProj.y) * 0.5)),
            });
          }
        }
      }

      const effectiveFlapPower = Math.max(control.flapPower, (control.flapImpulse ?? 0) * 0.45);
      const roundStep = stepGameRoundState(gameRoundState, {
        dtSec,
        flapPower: effectiveFlapPower,
        isDiving: control.isDiving,
        energyDrainMultiplier: preset.energyDrainMultiplier,
      });
      gameRoundState = roundStep.nextState;

      if (roundStep.timeWarningBeepSec !== null) {
        sfx.playTimerTickBeep(roundStep.timeWarningBeepSec);
      } else if (roundStep.lowEnergyAlert) {
        sfx.playLowEnergyBeep();
      }
      if (roundStep.justEnded) {
        seagull.setInvulnerableBlink(false, flight.state.timeSec);
        collisionFlashLeftSec = 0;
        comboBreakLeftSec = 0;
        if (gameRoundState.isNewRecord && gameRoundState.score > 0) {
          sfx.playNewRecordFanfare();
        } else {
          sfx.playTimeUpJingle();
        }
      }

      // 3. Airborne snacks update & 3D radius pickup
      if (gameRoundState.phase === 'PLAYING') {
        const collectedEvents = snackManager.update({
          dtSec,
          birdPos: flight.state.position,
          beakWorldPos,
          headingRad: flight.state.headingRad,
          collectRadiusM: preset.collectRadiusM,
          canCollect: true,
        });

        for (const evt of collectedEvents) {
          const res = applySnackCollected(gameRoundState, {
            isGolden: evt.isGolden,
            altitudeAglM: flight.state.altitudeAglM,
            flapPower: Math.max(control.flapPower, (control.flapImpulse ?? 0) * 0.6),
            diveStrength: control.diveStrength,
            comboWindowSec: preset.comboWindowSec,
          });
          gameRoundState = res.nextState;
          sfx.playSnackCollect(gameRoundState.combo, evt.isGolden);

          if (onFloatingScore) {
            tempPopupProj.copy(evt.worldPos).project(sceneEnv.camera);
            onFloatingScore({
              id: popupCounter++,
              points: res.breakdown.totalPoints,
              isGolden: evt.isGolden,
              tags: res.breakdown.tags,
              screenX: Math.max(0.12, Math.min(0.88, (tempPopupProj.x + 1) * 0.5)),
              screenY: Math.max(0.18, Math.min(0.82, (1 - tempPopupProj.y) * 0.5)),
            });
          }
        }
      }

      // 4. Seagull wing/tail animation
      const maxRefSpeed = FLIGHT_CONFIG.diveMaxSpeedMps * speedMultiplier;
      const minRefSpeed = FLIGHT_CONFIG.glideSpeedMps * speedMultiplier * 0.85;
      const speedRatio = THREE.MathUtils.clamp(
        (flight.state.speedMps - minRefSpeed) / Math.max(1, maxRefSpeed - minRefSpeed),
        0,
        1
      );
      const climbRateRatio = THREE.MathUtils.clamp(
        flight.state.verticalVelMps / Math.max(1, FLIGHT_CONFIG.flapMaxClimbMps * speedMultiplier),
        -1,
        1
      );
      seagull.setInvulnerableBlink(
        gameRoundState.phase === 'PLAYING' &&
          isInvulnerable(gameRoundState.playElapsedSec, gameRoundState.lastHitTime),
        flight.state.timeSec
      );
      seagull.update(
        {
          timeSec: flight.state.timeSec,
          leftFlapPower: control.leftFlapPower,
          rightFlapPower: control.rightFlapPower,
          leftWingElevation: control.leftWingElevation,
          rightWingElevation: control.rightWingElevation,
          diveStrength: control.diveStrength,
          turn: control.turn,
          speedRatio,
          climbRateRatio,
          exhausted: gameRoundState.isExhausted,
        },
        dtSec
      );

      sceneEnv.updateAtmosphere(
        flight.state.position,
        flight.state.forwardVec,
        flight.state.speedMps,
        dtSec
      );
      city.updateCenter(flight.state.position);
      sceneEnv.renderer.render(sceneEnv.scene, sceneEnv.camera);
    } else {
      // READY, PAUSED, or RESULT: keep flight physics, timers, and snacks frozen; still show live gesture telemetry
      seagull.setInvulnerableBlink(false, flight.state.timeSec);
      collisionFlashLeftSec = 0;
      comboBreakLeftSec = 0;
      telemetryControl = poseControlActive && latestPoseControl ? latestPoseControl : baseDefaultOutput;
      flight.applyBirdTransform(seagull.group);
      flight.updateChaseCamera(sceneEnv.camera, baseDefaultOutput, dtSec);
      sceneEnv.updateAtmosphere(
        flight.state.position,
        flight.state.forwardVec,
        0,
        dtSec
      );
      city.updateCenter(flight.state.position);
      sceneEnv.renderer.render(sceneEnv.scene, sceneEnv.camera);
    }

    const phaseChanged = prevPhase !== gameRoundState.phase;
    const countdownDigitChanged =
      gameRoundState.phase === 'COUNTDOWN' &&
      Math.ceil(gameRoundState.countdownSec) !== prevCountdownCeil;

    if (forceHudEmit || phaseChanged || countdownDigitChanged || nowMs - lastHudEmitMs >= 42) {
      lastHudEmitMs = nowMs;
      emitTelemetryNow(telemetryControl);
    }

    scheduleNextFrame(tick);
  };

  sceneEnv.resize(canvas.clientWidth || 640, canvas.clientHeight || 480);
  emitTelemetryNow(baseDefaultOutput);
  scheduleNextFrame(tick);

  return {
    setPoseControl(output: FlightControlOutput) {
      latestPoseControl = output;
    },
    setPoseControlActive(active: boolean) {
      poseControlActive = active;
    },
    setTunableConfig(cfg: TunableVisionSettings) {
      controlConfig = cfg;
    },
    setSpeedMultiplier(val: number) {
      updateSpeedMultiplier(val);
    },
    setDifficulty(diff: DifficultyPresetId) {
      difficulty = diff;
      saveSelectedDifficulty(diff);
      const nextMult = getDifficultyPreset(diff).speedMultiplier;
      updateSpeedMultiplier(nextMult);
      gameRoundState = selectDifficultyInReady(gameRoundState, diff);
      emitTelemetryNow(baseDefaultOutput);
    },
    setTimeOfDay(mode: TimeOfDay) {
      applyTime(mode);
    },
    cycleTimeOfDay() {
      return cycleTime();
    },
    startGame(diff?: DifficultyPresetId) {
      sfx.unlock();
      const targetDiff = diff ?? difficulty;
      difficulty = targetDiff;
      saveSelectedDifficulty(targetDiff);
      const targetSpeed = getDifficultyPreset(targetDiff).speedMultiplier;
      updateSpeedMultiplier(targetSpeed);

      clearInputs();
      collisionFlashLeftSec = 0;
      comboBreakLeftSec = 0;
      seagull.setInvulnerableBlink(false, 0);
      onClearPopups?.();
      flight.reset(targetSpeed);
      flight.applyBirdTransform(seagull.group);
      snackManager.resetAll(flight.state.position, flight.state.headingRad);
      const lbScores = getLeaderboardTopScoresMap(localLeaderboardStore);
      gameRoundState = transitionStartGame(
        {
          ...gameRoundState,
          highScoresByDifficulty: lbScores,
          highScore: lbScores[targetDiff],
        },
        targetDiff
      );
      sfx.playCountdownBeep(3);
      emitTelemetryNow(baseDefaultOutput);
    },
    pauseGame(reason: PauseReason = 'manual') {
      clearInputs();
      const next = transitionPauseGame(gameRoundState, reason);
      if (next !== gameRoundState) {
        gameRoundState = next;
        emitTelemetryNow(baseDefaultOutput);
      }
    },
    resumeGame() {
      sfx.unlock();
      clearInputs();
      const next = transitionResumeGame(gameRoundState);
      if (next !== gameRoundState) {
        gameRoundState = next;
        sfx.playCountdownBeep(3);
        emitTelemetryNow(baseDefaultOutput);
      }
    },
    resetGame() {
      clearInputs();
      collisionFlashLeftSec = 0;
      comboBreakLeftSec = 0;
      seagull.setInvulnerableBlink(false, 0);
      onClearPopups?.();
      flight.reset(speedMultiplier);
      flight.applyBirdTransform(seagull.group);
      snackManager.resetAll(flight.state.position, flight.state.headingRad);
      const lbScores = getLeaderboardTopScoresMap(localLeaderboardStore);
      gameRoundState = transitionResetGame(
        {
          ...gameRoundState,
          highScoresByDifficulty: lbScores,
          highScore: lbScores[difficulty],
        },
        difficulty
      );
      emitTelemetryNow(baseDefaultOutput);
    },
    syncHighScores(scores: HighScoreMap) {
      gameRoundState = {
        ...gameRoundState,
        highScoresByDifficulty: { ...scores },
        highScore: scores[gameRoundState.difficulty] ?? 0,
      };
      emitTelemetryNow(baseDefaultOutput);
    },
    setManualInput(partial: Partial<ManualInputState>) {
      if (gameRoundState.phase !== 'PLAYING') return;
      if (partial.pointerTurn !== undefined) manualInput.pointerTurn = partial.pointerTurn;
      if (partial.pointerDive !== undefined) manualInput.pointerDive = partial.pointerDive;
      if (partial.pointerFlapBoost !== undefined) {
        manualInput.pointerFlapBoost = partial.pointerFlapBoost;
      }
    },
    triggerManualFlapPulse() {
      if (gameRoundState.phase !== 'PLAYING') return;
      sfx.unlock();
      manualInput.pointerFlapBoost = 0.95;
      pointerFlapImpulse = 1.0;
    },
    resetFlightPosition() {
      if (gameRoundState.phase !== 'PLAYING') return;
      flight.reset(speedMultiplier);
    },
    resize(width: number, height: number) {
      sceneEnv.resize(width, height);
    },
    dispose() {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (softTimerId !== null) clearTimeout(softTimerId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      snackManager.dispose();
      city.dispose();
      seagull.dispose();
      sceneEnv.dispose();
    },
  };
}
