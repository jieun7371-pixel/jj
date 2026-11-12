export type FlightMode = '활공' | '날갯짓' | '하강';
export type GesturePriorityLabel = '하강' | '날갯짓' | '활강' | '기본';

export interface NormalizedPoint {
  x: number;
  y: number;
  z?: number;
}

export interface MirroredFaceOverlay {
  leftEye: NormalizedPoint;
  rightEye: NormalizedPoint;
  forehead: NormalizedPoint;
  chin: NormalizedPoint;
  rawHeadAngleRad: number;
  relativeHeadDeg: number;
}

export interface HeadTiltState {
  smoothedTurn: number;
  lastRelativeDeg: number;
  lastFaceTimeSec: number;
  hasFace: boolean;
}

export interface HeadTiltResult {
  nextState: HeadTiltState;
  turn: number;
  relativeHeadDeg: number;
  faceDetected: boolean;
  overlay: MirroredFaceOverlay | null;
}

export interface HandMotionSample {
  timeSec: number;
  cxRaw: number; // mirrored palmCenter.x (0..1)
  cyRaw: number; // mirrored palmCenter.y (0..1)
  scaleS: number; // palm size S
  cxNorm: number; // palmCenter.x / S
  cyNorm: number; // palmCenter.y / S
  yUpNorm: number; // -palmCenter.y / S (positive upward)
}

export interface SingleHandEval {
  screenSide: 'left' | 'right';
  mirroredLandmarks: NormalizedPoint[]; // 21 landmarks with x mirrored (1 - x)
  palmCenter: NormalizedPoint;
  palmScaleS: number;
  fingerRatios: [number, number, number, number]; // tips 8,12,16,20 dist / S
  dAvg: number; // mean of 4 finger ratios
  isFist: boolean; // All 4 fingers < 1.1 && dAvg < 1.1 (strict fist posture)
  fistSuppressedBySpeed: boolean; // True when palmSpeedSPerSec >= 2.0 * S/s
  palmSpeedSPerSec: number; // Instantaneous palm center speed in S/sec
  isOpen: boolean; // dAvg >= 1.6
  isStill: boolean; // travel over 0.4s <= 0.25 * S
  motionSpanS: number;
  isGlideCandidate: boolean;
  isReadyRaised: boolean;
}

export interface HandSlotState {
  motionSamples: HandMotionSample[];
  strokePeakYUp: number | null;
  strokeMinYUp: number | null;
  impulseLatched: boolean;
}

export interface HandGestureTrackerState {
  leftSlot: HandSlotState;
  rightSlot: HandSlotState;
  fistHoldSec: number;
  handLostSec: number;
  isDiving: boolean;
  flapImpulse: number; // 0..1 decaying over 0.35s on each crisp downstroke
  lastStepTimeSec: number;
}

export interface HandGestureEvalResult {
  nextState: HandGestureTrackerState;
  hands: SingleHandEval[];
  handCount: number;
  isDiving: boolean;
  diveStrength: number;
  isGliding: boolean;
  handsRaisedReady: boolean;
  flapImpulse: number;
  downstrokeFired: boolean;
  motionYSamplesLeft: Array<{ timeSec: number; yUpNorm: number }>;
  motionYSamplesRight: Array<{ timeSec: number; yUpNorm: number }>;
}

export interface FlapAnalysis {
  flapPower: number;
  leftFlapPower: number;
  rightFlapPower: number;
  leftAmp: number;
  rightAmp: number;
  leftFreqHz: number;
  rightFreqHz: number;
  flapFreqHz: number;
  leftWingElevation: number; // -1 (downstroke) .. +1 (upstroke)
  rightWingElevation: number;
  wingYawAssist: number;
}

export interface CalibrationData {
  neutralHeadAngleRad: number;
  handScaleS: number;
  sampleCount: number;
  calibratedAt: number;
}

export interface VisionOverlaySnapshot {
  face: MirroredFaceOverlay | null;
  hands: SingleHandEval[];
  headTiltDeg: number;
  turn: number;
  gestureLabel: GesturePriorityLabel;
  gestureBadgeText: string;
  faceDetected: boolean;
  handCount: number;
  needHandsPrompt: boolean;
}

export interface ControlMapperState {
  headState: HeadTiltState;
  handState: HandGestureTrackerState;
  smoothedTurn: number;
  smoothedDive: number;
  smoothedLeftFlap: number;
  smoothedRightFlap: number;
  smoothedFlapPower: number;
  smoothedLeftElev: number;
  smoothedRightElev: number;
  readyHoldSec: number;
  lastStepTimeSec: number;
  lastOutput: FlightControlOutput;
}

export interface FlightControlOutput {
  turn: number; // -1 (left) .. +1 (right)
  diveStrength: number; // 0 .. 1
  dive: boolean; // alias for isDiving
  isDiving: boolean;
  glide: boolean;
  flapPower: number; // 0 .. 1
  flapImpulse: number; // 0 .. 1 decaying over 0.35s per crisp downstroke
  leftFlapPower: number; // 0 .. 1
  rightFlapPower: number; // 0 .. 1
  leftWingElevation: number; // -1 .. +1
  rightWingElevation: number; // -1 .. +1
  wingYawAssist: number;
  mode: FlightMode;
  priorityGesture: GesturePriorityLabel;
  gestureBlockReason: string | null;
  tiltDeg: number;
  leftHandDAvg: number | null;
  rightHandDAvg: number | null;
  leftHandFist: boolean;
  rightHandFist: boolean;
  leftHandMoveS: number | null;
  rightHandMoveS: number | null;
  leftHandSpeedS: number | null;
  rightHandSpeedS: number | null;
  leftAmp: number;
  rightAmp: number;
  leftFreqHz: number;
  rightFreqHz: number;
  flapFreqHz: number;
  faceDetected: boolean;
  handCount: number;
  validPose: boolean;
  poseDetected: boolean;
  handsRaisedForStart: boolean;
  overlay: VisionOverlaySnapshot;
}

export type VisionTrackerStatus = 'initializing' | 'ready' | 'camera-denied' | 'model-error';
