import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { GESTURE_CONFIG } from './gestureConfig.ts';
import type { NormalizedPoint } from './types.ts';

type VisionFileset = Awaited<
  ReturnType<(typeof import('@mediapipe/tasks-vision'))['FilesetResolver']['forVisionTasks']>
>;

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private lastTimestampMs = 0;
  private latestFace: readonly NormalizedPoint[] | null = null;
  delegate: 'GPU' | 'CPU' = 'GPU';

  async init(vision: VisionFileset): Promise<'GPU' | 'CPU'> {
    for (const del of ['GPU', 'CPU'] as const) {
      try {
        this.landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: GESTURE_CONFIG.faceModelAssetPath,
            delegate: del,
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.45,
          minFacePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
        this.delegate = del;
        return del;
      } catch {
        // Fallback to CPU if GPU fails
      }
    }
    throw new Error('FaceLandmarker initialization failed on GPU and CPU.');
  }

  detect(video: HTMLVideoElement, nowMs: number): readonly NormalizedPoint[] | null {
    if (!this.landmarker || video.readyState < 2 || video.videoWidth <= 0) {
      return this.latestFace;
    }

    const safeNow = Math.max(nowMs, this.lastTimestampMs + 1);
    this.lastTimestampMs = safeNow;

    const result = this.landmarker.detectForVideo(video, safeNow);
    const face = result.faceLandmarks?.[0] ?? null;
    this.latestFace = face;
    return face;
  }

  getLatest(): readonly NormalizedPoint[] | null {
    return this.latestFace;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.latestFace = null;
  }
}
