export const GESTURE_CONFIG = {
  // MediaPipe Tasks Vision models & local WASM paths
  faceModelAssetPath:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  handModelAssetPath:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  wasmLocalPath: '/mediapipe/wasm',
  wasmCdnPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm',

  // Dual-model inference cadence on shared 640x480 webcam feed
  videoWidth: 640,
  videoHeight: 480,
  targetInferenceFps: 30,
  handFrameInterval: 1, // Every frame (~30fps)
  faceFrameInterval: 2, // Every 2nd frame (~15fps)

  // Head tilt steering thresholds (degrees & weights)
  eyeWeight: 0.7,
  axisWeight: 0.3,
  headDeadzoneDeg: 5,
  headMaxDeg: 25,
  headSmoothAlpha: 0.3,
  faceLostDecaySec: 0.5,

  // Hand landmark normalization S = dist(wrist 0, middle_mcp 9)
  minPalmScaleS: 0.025,

  // Strict Fist (Dive) gesture thresholds: prevent false dive during fast flapping
  fistEnterDistRatio: 1.1, // ALL 4 tips [8,12,16,20] < 1.1 && d_avg < 1.1
  fistMinFingerCount: 4,
  fistHoldEnterSec: 0.2,
  fistExitDistRatio: 1.4, // Exit when d_avg >= 1.4
  fistSuppressSpeedSPerSec: 2.0, // Defer fist entry if palm center speed >= 2.0 * S/s
  handLostDiveGraceSec: 0.2,

  // Open palm + stillness (Glide) thresholds: direction-independent
  openDistRatio: 1.6, // d_avg >= 1.6
  stillnessWindowSec: 0.4,
  stillnessMaxMoveS: 0.25, // palm center travel <= 0.25 * S over 0.4s

  // Responsive timestamp-driven flapping + downstroke impulse detector
  flapBufferSec: 0.6, // Faster 0.6s timestamp ring buffer
  flapAmpRef: 0.35, // Smaller amplitude reference (0.35 * S)
  flapFreqRef: 2.0, // Reference cadence (2.0 Hz)
  flapMinFreqHz: 1.0, // Continuous flapping starts recognizing >= 1.0 Hz
  flapAmpWeight: 0.6,
  flapFreqWeight: 0.4,
  flapSmoothAlpha: 0.45, // Reduced smoothing lag
  flapActivateThreshold: 0.14,
  flapPriorityThreshold: 0.25, // Keep '날갯짓' priority over non-strict fist when > 0.25
  flapZeroCrossHysteresisS: 0.05,
  flapImpulseThreshold: 0.25, // Downward palm stroke >= 0.25 * S triggers impulse = 1
  flapImpulseMinSpeedSPerSec: 0.65, // Must move down briskly (not slow posture drift)
  flapImpulseResetRiseS: 0.08, // Upward rebound >= 0.08 * S resets stroke trigger
  flapImpulseDecaySec: 0.35, // Decays 1 -> 0 over 0.35s

  // Calibration hold parameters
  calibrationDurationSec: 3.0,
  readyHandsUpHoldSec: 0.55,
  readyHandsUpMinY: 0.58,

  guidanceMessage: '카메라 앞 40~60cm에서 얼굴과 두 손이 화면에 보이게 해주세요.',
} as const;

export interface TunableVisionSettings {
  headDeadzoneDeg: number;
  headMaxDeg: number;
  headSmoothAlpha: number;
  fistEnterDistRatio: number;
  fistExitDistRatio: number;
  fistHoldEnterSec: number;
  openDistRatio: number;
  stillnessMaxMoveS: number;
  flapAmpRef: number;
  flapFreqRef: number;
  flapImpulseThreshold: number;
  flapSmoothAlpha: number;
}

export const DEFAULT_TUNABLE_VISION_SETTINGS: TunableVisionSettings = {
  headDeadzoneDeg: GESTURE_CONFIG.headDeadzoneDeg,
  headMaxDeg: GESTURE_CONFIG.headMaxDeg,
  headSmoothAlpha: GESTURE_CONFIG.headSmoothAlpha,
  fistEnterDistRatio: GESTURE_CONFIG.fistEnterDistRatio,
  fistExitDistRatio: GESTURE_CONFIG.fistExitDistRatio,
  fistHoldEnterSec: GESTURE_CONFIG.fistHoldEnterSec,
  openDistRatio: GESTURE_CONFIG.openDistRatio,
  stillnessMaxMoveS: GESTURE_CONFIG.stillnessMaxMoveS,
  flapAmpRef: GESTURE_CONFIG.flapAmpRef,
  flapFreqRef: GESTURE_CONFIG.flapFreqRef,
  flapImpulseThreshold: GESTURE_CONFIG.flapImpulseThreshold,
  flapSmoothAlpha: GESTURE_CONFIG.flapSmoothAlpha,
};
