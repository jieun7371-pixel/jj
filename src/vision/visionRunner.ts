import { FilesetResolver } from '@mediapipe/tasks-vision';
import { FaceTracker } from './faceTracker.ts';
import { GESTURE_CONFIG } from './gestureConfig.ts';
import { HandTracker } from './handTracker.ts';
import type { NormalizedPoint, VisionTrackerStatus } from './types.ts';

export interface VisionRunnerCallbacks {
  onStatusChange: (
    status: VisionTrackerStatus,
    delegate?: 'GPU' | 'CPU',
    errorMsg?: string
  ) => void;
  onFrame: (
    rawFace: readonly NormalizedPoint[] | null,
    rawHands: readonly (readonly NormalizedPoint[])[],
    nowMs: number
  ) => void;
}

/**
 * Coordinates a single mirrored 640x480 webcam stream feeding HandLandmarker every frame (~30fps)
 * and FaceLandmarker every 2nd frame (~15fps).
 */
export class VisionRunner {
  private readonly callbacks: VisionRunnerCallbacks;
  private faceTracker = new FaceTracker();
  private handTracker = new HandTracker();
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private timeoutId: number | null = null;
  private lastInferMs = 0;
  private frameIndex = 0;
  private disposed = false;

  constructor(callbacks: VisionRunnerCallbacks) {
    this.callbacks = callbacks;
  }

  async start(videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl;
    this.callbacks.onStatusChange('initializing');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.callbacks.onStatusChange('camera-denied', undefined, '브라우저가 카메라 API를 지원하지 않습니다.');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: GESTURE_CONFIG.videoWidth },
          height: { ideal: GESTURE_CONFIG.videoHeight },
        },
        audio: false,
      });

      if (this.disposed) {
        this.stopStream();
        return;
      }

      videoEl.srcObject = this.stream;
      for (const track of this.stream.getVideoTracks()) {
        track.addEventListener('ended', this.handleTrackEnded);
      }
      await videoEl.play();
    } catch {
      this.callbacks.onStatusChange(
        'camera-denied',
        undefined,
        '웹캠 접근 권한이 거부되었거나 장치를 찾을 수 없습니다.'
      );
      return;
    }

    try {
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks(GESTURE_CONFIG.wasmLocalPath);
      } catch {
        vision = await FilesetResolver.forVisionTasks(GESTURE_CONFIG.wasmCdnPath);
      }

      if (this.disposed) return;

      const [handDel, faceDel] = await Promise.all([
        this.handTracker.init(vision),
        this.faceTracker.init(vision),
      ]);

      if (this.disposed) return;

      const delegate: 'GPU' | 'CPU' = handDel === 'GPU' && faceDel === 'GPU' ? 'GPU' : 'CPU';
      this.callbacks.onStatusChange('ready', delegate);
      this.scheduleLoop();
    } catch {
      if (!this.disposed) {
        this.callbacks.onStatusChange(
          'model-error',
          undefined,
          '얼굴·손 인식 모델을 초기화하지 못했습니다. 마우스/터치 조종을 사용합니다.'
        );
      }
    }
  }

  private handleTrackEnded = (): void => {
    if (this.disposed) return;
    this.stopStream();
    this.callbacks.onStatusChange(
      'camera-denied',
      undefined,
      '웹캠 연결이 끊어졌습니다. 수동 조종으로 전환했습니다.'
    );
  };

  private scheduleLoop(): void {
    const minIntervalMs = 1000 / GESTURE_CONFIG.targetInferenceFps;

    const tick = () => {
      if (this.disposed || !this.videoEl) return;

      if (this.stream) {
        const tracks = this.stream.getVideoTracks();
        if (tracks.length > 0 && tracks.every((t) => t.readyState === 'ended')) {
          this.handleTrackEnded();
          return;
        }
      }

      const nowMs = performance.now();
      if (
        nowMs - this.lastInferMs >= minIntervalMs &&
        this.videoEl.readyState >= 2 &&
        this.videoEl.videoWidth > 0
      ) {
        this.lastInferMs = nowMs;
        this.frameIndex += 1;

        try {
          const hands = this.handTracker.detect(this.videoEl, nowMs);
          const face =
            this.frameIndex % GESTURE_CONFIG.faceFrameInterval === 1
              ? this.faceTracker.detect(this.videoEl, nowMs)
              : this.faceTracker.getLatest();

          this.callbacks.onFrame(face, hands, nowMs);
        } catch {
          // Skip transient frame errors cleanly without crashing RAF
        }
      }

      this.timeoutId = window.setTimeout(() => {
        if (!this.disposed) {
          this.rafId = requestAnimationFrame(tick);
        }
      }, 12);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private stopStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this.handleTrackEnded);
        track.stop();
      }
      this.stream = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.faceTracker.dispose();
    this.handTracker.dispose();
    this.stopStream();
  }
}
