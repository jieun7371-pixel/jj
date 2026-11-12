import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from './audio/sfx.ts';
import { CITY_CONFIG, FLIGHT_CONFIG } from './config.ts';
import {
  getAllLeaderboardsMap,
  getLeaderboardTopScoresMap,
  localLeaderboardStore,
} from './game/leaderboard/leaderboardStore.ts';
import type { LeaderboardEntry } from './game/leaderboard/rank.ts';
import {
  startGameLoop,
  type FloatingScorePopup,
  type GameLoopController,
  type TelemetrySnapshot,
} from './game/loop.ts';
import {
  getDifficultyPreset,
  loadSelectedDifficulty,
  saveSelectedDifficulty,
  type DifficultyPresetId,
} from './game/rules/difficulty.ts';
import { GAME_CONFIG } from './game/rules/gameConfig.ts';
import {
  clampSpeedMultiplier,
  createInitialGameRoundState,
} from './game/rules/gameState.ts';
import { CalibrationScreen } from './ui/CalibrationScreen.tsx';
import { Countdown } from './ui/Countdown.tsx';
import { DebugPanel } from './ui/DebugPanel.tsx';
import { FloatingScore } from './ui/FloatingScore.tsx';
import { GameHud } from './ui/GameHud.tsx';
import { Hud } from './ui/Hud.tsx';
import { LeaderboardScreen } from './ui/LeaderboardScreen.tsx';
import { PauseMenu } from './ui/PauseMenu.tsx';
import { ReadyScreen } from './ui/ReadyScreen.tsx';
import { ResultScreen } from './ui/ResultScreen.tsx';
import { SnackArrow } from './ui/SnackArrow.tsx';
import { WebcamOverlay } from './ui/WebcamOverlay.tsx';
import { CalibrationAccumulator } from './vision/calibration.ts';
import {
  createInitialControlState,
  mapFaceAndHandsToControl,
} from './vision/controlMapper.ts';
import {
  DEFAULT_TUNABLE_VISION_SETTINGS,
  type TunableVisionSettings,
} from './vision/gestureConfig.ts';
import type {
  CalibrationData,
  ControlMapperState,
  VisionOverlaySnapshot,
  VisionTrackerStatus,
} from './vision/types.ts';
import { VisionRunner } from './vision/visionRunner.ts';

function createInitialTelemetry(): TelemetrySnapshot {
  const initialControl = createInitialControlState().lastOutput;
  const difficulty = loadSelectedDifficulty();
  const preset = getDifficultyPreset(difficulty);
  const highScores = getLeaderboardTopScoresMap(localLeaderboardStore);

  return {
    altitudeM: CITY_CONFIG.startAltitudeM,
    altitudeAglM: CITY_CONFIG.startAltitudeM,
    climbRateMps: FLIGHT_CONFIG.glideSinkMps,
    speedKmh: Math.round(FLIGHT_CONFIG.glideSpeedMps * preset.speedMultiplier * 3.6),
    speedMultiplier: preset.speedMultiplier,
    difficulty,
    collectRadiusM: preset.collectRadiusM,
    comboWindowSec: preset.comboWindowSec,
    mode: '활공',
    timeOfDay: '낮',
    impactAlert: false,
    collisionFlash: false,
    invulnerable: false,
    comboBreakAlert: false,
    control: initialControl,
    gameState: createInitialGameRoundState({
      difficulty,
      highScores,
      phase: 'READY',
    }),
    snackOverlay: { nearest: null, visibleMarkers: [] },
    fps: 60,
  };
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const gameLoopRef = useRef<GameLoopController | null>(null);

  const calAccRef = useRef(new CalibrationAccumulator());
  const calibrationRef = useRef<CalibrationData | null>(null);
  const controlStateRef = useRef<ControlMapperState>(createInitialControlState());
  const configRef = useRef<TunableVisionSettings>(DEFAULT_TUNABLE_VISION_SETTINGS);
  const popupTimerIdsRef = useRef<Set<number>>(new Set());

  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(createInitialTelemetry);
  const [difficulty, setDifficulty] = useState<DifficultyPresetId>(loadSelectedDifficulty);

  const [trackerStatus, setTrackerStatus] = useState<VisionTrackerStatus>('initializing');
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | undefined>(undefined);
  const [trackerError, setTrackerError] = useState<string | null>(null);

  const [isCalibrating, setIsCalibrating] = useState(true);
  const [calState, setCalState] = useState({
    progress: 0,
    remainingSec: 3,
    faceVisible: false,
    handVisible: false,
  });

  const [visionOverlay, setVisionOverlay] = useState<VisionOverlaySnapshot>(
    () => createInitialControlState().lastOutput.overlay
  );
  const [fistStartProgress, setFistStartProgress] = useState(0);
  const [popups, setPopups] = useState<FloatingScorePopup[]>([]);
  const [muted, setMuted] = useState(false);

  const [entriesByDifficulty, setEntriesByDifficulty] = useState<
    Record<DifficultyPresetId, LeaderboardEntry[]>
  >(() => getAllLeaderboardsMap(localLeaderboardStore));
  const [isStoragePersistent, setIsStoragePersistent] = useState(() =>
    localLeaderboardStore.isPersistent()
  );
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardInitialTab, setLeaderboardInitialTab] =
    useState<DifficultyPresetId>(loadSelectedDifficulty);
  const [submittedEntryId, setSubmittedEntryId] = useState<string | null>(null);
  const [submittedRank, setSubmittedRank] = useState<number | null>(null);

  const [debugOpen, setDebugOpen] = useState(false);
  const [visionConfig, setVisionConfig] = useState<TunableVisionSettings>(
    DEFAULT_TUNABLE_VISION_SETTINGS
  );
  const [desktopLayout, setDesktopLayout] = useState<'pip' | 'split'>('pip');

  const calibratingRef = useRef(isCalibrating);
  calibratingRef.current = isCalibrating;

  const gamePhaseRef = useRef(telemetry.gameState.phase);
  gamePhaseRef.current = telemetry.gameState.phase;

  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;

  const leaderboardOpenRef = useRef(leaderboardOpen);
  leaderboardOpenRef.current = leaderboardOpen;

  const trackerStatusRef = useRef(trackerStatus);
  const readyFistHoldSecRef = useRef(0);
  const readyLastFrameMsRef = useRef(0);

  const refreshLeaderboardSnapshot = useCallback(() => {
    setEntriesByDifficulty(getAllLeaderboardsMap(localLeaderboardStore));
    setIsStoragePersistent(localLeaderboardStore.isPersistent());
    gameLoopRef.current?.syncHighScores(getLeaderboardTopScoresMap(localLeaderboardStore));
  }, []);

  const clearPopups = useCallback(() => {
    for (const timerId of popupTimerIdsRef.current) {
      window.clearTimeout(timerId);
    }
    popupTimerIdsRef.current.clear();
    setPopups([]);
  }, []);

  const startRecalibration = useCallback(() => {
    if (trackerStatus === 'camera-denied' || trackerStatus === 'model-error') return;
    calAccRef.current.reset();
    controlStateRef.current = createInitialControlState();
    readyFistHoldSecRef.current = 0;
    readyLastFrameMsRef.current = 0;
    setFistStartProgress(0);
    setCalState({ progress: 0, remainingSec: 3, faceVisible: false, handVisible: false });
    setIsCalibrating(true);
    gameLoopRef.current?.setPoseControlActive(false);
  }, [trackerStatus]);

  const handleSelectDifficulty = useCallback((nextDiff: DifficultyPresetId) => {
    setDifficulty(nextDiff);
    saveSelectedDifficulty(nextDiff);
    gameLoopRef.current?.setDifficulty(nextDiff);
  }, []);

  const handleStartGame = useCallback(() => {
    readyFistHoldSecRef.current = 0;
    readyLastFrameMsRef.current = 0;
    setFistStartProgress(0);
    setSubmittedEntryId(null);
    setSubmittedRank(null);
    setLeaderboardOpen(false);
    gameLoopRef.current?.startGame(difficultyRef.current);
  }, []);

  const handlePause = useCallback(() => {
    gameLoopRef.current?.pauseGame('manual');
  }, []);

  const handleResume = useCallback(() => {
    gameLoopRef.current?.resumeGame();
  }, []);

  const handleExitToReady = useCallback(() => {
    readyFistHoldSecRef.current = 0;
    readyLastFrameMsRef.current = 0;
    setFistStartProgress(0);
    setSubmittedEntryId(null);
    setSubmittedRank(null);
    setLeaderboardOpen(false);
    gameLoopRef.current?.resetGame();
    refreshLeaderboardSnapshot();
  }, [refreshLeaderboardSnapshot]);

  const handleSubmitLeaderboard = useCallback(
    (nickname: string) => {
      const gs = telemetry.gameState;
      if (gs.phase !== 'RESULT') return;
      const res = localLeaderboardStore.submit({
        difficulty: gs.difficulty,
        nickname,
        score: gs.score,
        eatenCount: gs.eatenCount,
        maxCombo: gs.maxCombo,
        crashCount: gs.crashCount,
      });
      if (res.saved && res.entry) {
        setSubmittedEntryId(res.entry.id);
        setSubmittedRank(res.rank);
      }
      refreshLeaderboardSnapshot();
    },
    [telemetry.gameState, refreshLeaderboardSnapshot]
  );

  const handleSkipLeaderboard = useCallback(() => {
    handleSubmitLeaderboard('');
  }, [handleSubmitLeaderboard]);

  const handleOpenLeaderboard = useCallback((tab?: DifficultyPresetId) => {
    setLeaderboardInitialTab(tab ?? difficultyRef.current);
    setEntriesByDifficulty(getAllLeaderboardsMap(localLeaderboardStore));
    setIsStoragePersistent(localLeaderboardStore.isPersistent());
    setLeaderboardOpen(true);
  }, []);

  const handleClearLeaderboardDifficulty = useCallback(
    (diffToClear: DifficultyPresetId) => {
      localLeaderboardStore.clear(diffToClear);
      if (telemetry.gameState.difficulty === diffToClear) {
        setSubmittedEntryId(null);
        setSubmittedRank(null);
      }
      refreshLeaderboardSnapshot();
    },
    [telemetry.gameState.difficulty, refreshLeaderboardSnapshot]
  );

  const handleAdjustSpeed = useCallback(
    (delta: number) => {
      const next = clampSpeedMultiplier(telemetry.speedMultiplier + delta);
      gameLoopRef.current?.setSpeedMultiplier(next);
    },
    [telemetry.speedMultiplier]
  );

  // Auto-pause when browser tab becomes inactive
  useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.hidden &&
        (gamePhaseRef.current === 'PLAYING' || gamePhaseRef.current === 'COUNTDOWN')
      ) {
        gameLoopRef.current?.pauseGame('tab-hidden');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Mount Three.js Game Loop + ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvasContainerRef.current;
    if (!canvas || !container) return;

    const controller = startGameLoop({
      canvas,
      onTelemetry: (snap) => {
        if (gamePhaseRef.current !== 'RESULT' && snap.gameState.phase === 'RESULT') {
          setSubmittedEntryId(null);
          setSubmittedRank(null);
          setEntriesByDifficulty(getAllLeaderboardsMap(localLeaderboardStore));
          setIsStoragePersistent(localLeaderboardStore.isPersistent());
        }
        setTelemetry(snap);
      },
      onClearPopups: clearPopups,
      onFloatingScore: (popup) => {
        setPopups((prev) => [...prev.slice(-6), popup]);
        const tid = window.setTimeout(() => {
          popupTimerIdsRef.current.delete(tid);
          setPopups((prev) => prev.filter((item) => item.id !== popup.id));
        }, 950);
        popupTimerIdsRef.current.add(tid);
      },
      onPauseToggleShortcut: () => {
        if (gamePhaseRef.current === 'PLAYING') {
          controller.pauseGame('manual');
        } else if (gamePhaseRef.current === 'PAUSED') {
          controller.resumeGame();
        }
      },
      onRecalibrateShortcut: () => {
        calAccRef.current.reset();
        controlStateRef.current = createInitialControlState();
        readyFistHoldSecRef.current = 0;
        readyLastFrameMsRef.current = 0;
        setFistStartProgress(0);
        setCalState({ progress: 0, remainingSec: 3, faceVisible: false, handVisible: false });
        setIsCalibrating(true);
        controller.setPoseControlActive(false);
      },
    });
    gameLoopRef.current = controller;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          controller.resize(width, height);
        }
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      controller.dispose();
      clearPopups();
      gameLoopRef.current = null;
    };
  }, [clearPopups]);

  // Mount Dual MediaPipe FaceLandmarker + HandLandmarker VisionRunner
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const runner = new VisionRunner({
      onStatusChange: (status, del, errMsg) => {
        const prevStatus = trackerStatusRef.current;
        trackerStatusRef.current = status;
        setTrackerStatus(status);
        if (del) setDelegate(del);
        setTrackerError(errMsg ?? null);

        if (status === 'camera-denied' || status === 'model-error') {
          setIsCalibrating(false);
          readyFistHoldSecRef.current = 0;
          readyLastFrameMsRef.current = 0;
          setFistStartProgress(0);
          gameLoopRef.current?.setPoseControlActive(false);

          if (
            prevStatus === 'ready' &&
            (gamePhaseRef.current === 'PLAYING' || gamePhaseRef.current === 'COUNTDOWN')
          ) {
            gameLoopRef.current?.pauseGame('webcam-lost');
          }
        }
      },
      onFrame: (rawFace, rawHands, nowMs) => {
        const mapped = mapFaceAndHandsToControl(
          rawFace,
          rawHands,
          calibrationRef.current,
          controlStateRef.current,
          nowMs / 1000,
          configRef.current
        );
        controlStateRef.current = mapped.nextState;
        setVisionOverlay(mapped.output.overlay);

        if (calibratingRef.current) {
          readyFistHoldSecRef.current = 0;
          readyLastFrameMsRef.current = 0;
          const res = calAccRef.current.addSample(rawFace, rawHands, nowMs);
          setCalState({
            progress: res.progress,
            remainingSec: res.remainingSec,
            faceVisible: res.faceVisible,
            handVisible: res.handVisible,
          });

          if (res.completed && res.calibration) {
            calibrationRef.current = res.calibration;
            controlStateRef.current = createInitialControlState();
            setIsCalibrating(false);
            gameLoopRef.current?.setPoseControlActive(true);
          }
          return;
        }

        // Forward live hand metrics for HUD/Debug tuning; flight physics still only execute in PLAYING
        gameLoopRef.current?.setPoseControl(mapped.output);

        if (gamePhaseRef.current === 'READY' && !leaderboardOpenRef.current) {
          const dt =
            readyLastFrameMsRef.current > 0
              ? Math.min(0.1, Math.max(0.005, (nowMs - readyLastFrameMsRef.current) / 1000))
              : 0.033;
          readyLastFrameMsRef.current = nowMs;

          const holdingFist =
            mapped.output.handCount > 0 &&
            (mapped.output.leftHandFist || mapped.output.rightHandFist || mapped.output.isDiving);

          if (holdingFist) {
            readyFistHoldSecRef.current += dt;
          } else {
            readyFistHoldSecRef.current = 0;
          }

          const progress = Math.min(1, readyFistHoldSecRef.current / GAME_CONFIG.fistStartHoldSec);
          setFistStartProgress(progress);

          if (readyFistHoldSecRef.current >= GAME_CONFIG.fistStartHoldSec) {
            readyFistHoldSecRef.current = 0;
            readyLastFrameMsRef.current = 0;
            setFistStartProgress(0);
            gameLoopRef.current?.startGame(difficultyRef.current);
          }
          return;
        }

        readyFistHoldSecRef.current = 0;
        readyLastFrameMsRef.current = 0;
      },
    });

    void runner.start(videoEl);

    return () => {
      runner.dispose();
    };
  }, []);

  const handleChangeConfig = (next: TunableVisionSettings) => {
    configRef.current = next;
    setVisionConfig(next);
    gameLoopRef.current?.setTunableConfig(next);
  };

  const handleSkipCalibration = () => {
    setIsCalibrating(false);
    gameLoopRef.current?.setPoseControlActive(trackerStatus === 'ready');
  };

  const handleManualInput = (turn: number, dive: number) => {
    gameLoopRef.current?.setManualInput({ pointerTurn: turn, pointerDive: dive });
  };

  const handleManualFlap = () => {
    gameLoopRef.current?.triggerManualFlapPulse();
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    sfx.setMuted(next);
  };

  // Preserve stable React tree so <video> and <canvas> never unmount across layout switches
  const webcamPaneClass =
    desktopLayout === 'pip'
      ? 'relative h-[45dvh] w-full shrink-0 border-b border-white/20 md:absolute md:bottom-4 md:left-3 md:z-20 md:h-48 md:w-72 md:rounded-xl md:border md:border-white/25 md:shadow-2xl'
      : 'relative h-[45dvh] w-full shrink-0 border-b border-white/20 md:h-full md:w-[40%] md:border-b-0 md:border-r';

  const scenePaneClass =
    desktopLayout === 'pip'
      ? 'relative h-[55dvh] w-full md:h-full md:w-full'
      : 'relative h-[55dvh] w-full md:h-full md:w-[60%]';

  const phase = telemetry.gameState.phase;
  const showReadyModal = !isCalibrating && phase === 'READY';
  const showCountdown = !isCalibrating && phase === 'COUNTDOWN';
  const showPauseMenu = !isCalibrating && phase === 'PAUSED';
  const showResultModal = !isCalibrating && phase === 'RESULT';
  const showSnackNav = !isCalibrating && phase === 'PLAYING';

  return (
    <main className="relative w-full h-[100dvh] bg-[#09111e] overflow-hidden flex flex-col md:flex-row">
      {/* Top (Mobile 45%) / PIP or Left Split (Desktop): Mirrored Webcam + Face & Hand Overlay */}
      <section className={webcamPaneClass} aria-label="웹캠 얼굴·손 인식 화면">
        <WebcamOverlay
          videoRef={videoRef}
          trackerStatus={trackerStatus}
          delegate={delegate}
          statusError={trackerError}
          overlay={visionOverlay}
          onManualInput={handleManualInput}
          onManualFlap={handleManualFlap}
          compact={desktopLayout === 'pip'}
        />
      </section>

      {/* Bottom (Mobile 55%) / Full or Right Split (Desktop): 3D Flight & Shrimp Snack Hunt */}
      <section
        ref={canvasContainerRef}
        className={`${scenePaneClass} touch-none`}
        aria-label="3D 도시 비행 화면"
        onPointerDown={(e) => {
          if (
            isCalibrating ||
            phase !== 'PLAYING' ||
            visionOverlay.faceDetected ||
            visionOverlay.handCount > 0
          ) {
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.dataset.dragging = '1';
          e.currentTarget.dataset.lastY = String(e.clientY);
          e.currentTarget.dataset.dir = '0';
          const rect = e.currentTarget.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
          const ny = (e.clientY - rect.top) / Math.max(1, rect.height);
          handleManualInput(
            Math.max(-1, Math.min(1, nx * 1.15)),
            ny > 0.65 ? Math.min(1, (ny - 0.65) / 0.3) : 0
          );
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.dataset.dragging !== '1') return;
          const rect = e.currentTarget.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
          const ny = (e.clientY - rect.top) / Math.max(1, rect.height);
          handleManualInput(
            Math.max(-1, Math.min(1, nx * 1.15)),
            ny > 0.65 ? Math.min(1, (ny - 0.65) / 0.3) : 0
          );
          const lastY = Number(e.currentTarget.dataset.lastY || e.clientY);
          const dy = e.clientY - lastY;
          if (Math.abs(dy) > 10) {
            const dir = Math.sign(dy);
            const prevDir = Number(e.currentTarget.dataset.dir || 0);
            if (prevDir !== 0 && dir !== prevDir) {
              handleManualFlap();
            }
            e.currentTarget.dataset.dir = String(dir);
            e.currentTarget.dataset.lastY = String(e.clientY);
          }
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.dataset.dragging !== '1') return;
          e.currentTarget.dataset.dragging = '0';
          handleManualInput(0, 0);
        }}
        onPointerCancel={(e) => {
          if (e.currentTarget.dataset.dragging !== '1') return;
          e.currentTarget.dataset.dragging = '0';
          handleManualInput(0, 0);
        }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />

        {/* Nearest Snack Compass Arrow & Visible Snack Target Reticles */}
        <SnackArrow snackOverlay={telemetry.snackOverlay} visible={showSnackNav} />

        {/* World-Projected Floating Score Popups */}
        <FloatingScore popups={popups} />

        {/* Round Score, 60s Timer, Combo, Energy Bar & Top-Right Pause Button */}
        <GameHud
          gameState={telemetry.gameState}
          comboWindowSec={telemetry.comboWindowSec}
          collisionFlash={telemetry.collisionFlash}
          comboBreakAlert={telemetry.comboBreakAlert}
          muted={muted}
          onToggleMute={handleToggleMute}
          onPause={handlePause}
        />

        {/* 3-2-1 Countdown Overlay (Start / Resume) */}
        <Countdown
          visible={showCountdown}
          countdownSec={telemetry.gameState.countdownSec}
          reason={telemetry.gameState.countdownReason}
        />

        {/* Pause Menu Overlay */}
        {showPauseMenu && (
          <PauseMenu
            gameState={telemetry.gameState}
            onResume={handleResume}
            onRestart={handleStartGame}
            onExitToReady={handleExitToReady}
          />
        )}

        {/* Simplified 3s Calibration Screen */}
        {isCalibrating && trackerStatus === 'ready' && (
          <CalibrationScreen
            remainingSec={calState.remainingSec}
            progress={calState.progress}
            faceVisible={calState.faceVisible}
            handVisible={calState.handVisible}
            onSkipToManual={handleSkipCalibration}
          />
        )}

        {/* READY Screen (Difficulty Presets, Records, Start CTA & 1s Fist Hold Gauge) */}
        {showReadyModal && (
          <ReadyScreen
            difficulty={difficulty}
            highScoresByDifficulty={telemetry.gameState.highScoresByDifficulty}
            webcamActive={trackerStatus === 'ready'}
            fistStartProgress={fistStartProgress}
            isStoragePersistent={isStoragePersistent}
            onSelectDifficulty={handleSelectDifficulty}
            onOpenLeaderboard={() => handleOpenLeaderboard(difficulty)}
            onStart={handleStartGame}
            onRecalibrate={startRecalibration}
          />
        )}

        {/* RESULT Screen (after 60s round ends) */}
        {showResultModal && (
          <ResultScreen
            gameState={telemetry.gameState}
            rankStatus={localLeaderboardStore.getRankFor(
              telemetry.gameState.score,
              telemetry.gameState.difficulty
            )}
            topEntries={entriesByDifficulty[telemetry.gameState.difficulty] ?? []}
            submittedEntryId={submittedEntryId}
            submittedRank={submittedRank}
            isStoragePersistent={isStoragePersistent}
            onSubmitLeaderboard={handleSubmitLeaderboard}
            onSkipLeaderboard={handleSkipLeaderboard}
            onOpenLeaderboard={() => handleOpenLeaderboard(telemetry.gameState.difficulty)}
            onPlayAgain={handleStartGame}
            onChangeDifficulty={handleExitToReady}
          />
        )}
      </section>

      {/* Top Korean Telemetry HUD + Speed Stepper + Time-of-Day Cycle */}
      <Hud
        telemetry={telemetry}
        debugOpen={debugOpen}
        desktopLayout={desktopLayout}
        isCalibrating={isCalibrating}
        onRecalibrate={startRecalibration}
        onToggleDebug={() => setDebugOpen((v) => !v)}
        onToggleDesktopLayout={() =>
          setDesktopLayout((prev) => (prev === 'pip' ? 'split' : 'pip'))
        }
        onCycleTimeOfDay={() => {
          gameLoopRef.current?.cycleTimeOfDay();
        }}
        onResetPosition={() => gameLoopRef.current?.resetFlightPosition()}
        onAdjustSpeed={handleAdjustSpeed}
      />

      {/* Toggleable Live Gesture & Threshold Debug Panel */}
      {debugOpen && (
        <DebugPanel
          telemetry={telemetry}
          config={visionConfig}
          onChangeConfig={handleChangeConfig}
          onClose={() => setDebugOpen(false)}
        />
      )}

      {/* TOP 10 Leaderboard Modal */}
      <LeaderboardScreen
        isOpen={leaderboardOpen}
        initialDifficulty={leaderboardInitialTab}
        entriesByDifficulty={entriesByDifficulty}
        highlightEntryId={submittedEntryId}
        isPersistent={isStoragePersistent}
        onClearDifficulty={handleClearLeaderboardDifficulty}
        onClose={() => setLeaderboardOpen(false)}
      />
    </main>
  );
}
