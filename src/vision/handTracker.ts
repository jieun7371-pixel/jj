import { HandLandmarker } from '@mediapipe/tasks-vision';
import { GESTURE_CONFIG } from './gestureConfig.ts';
import type { NormalizedPoint } from './types.ts';

type VisionFileset = Awaited<
  ReturnType<(typeof import('@mediapipe/tasks-vision'))['FilesetResolver']['forVisionTasks']>
>;

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastTimestampMs = 0;
  private latestHands: readonly (readonly NormalizedPoint[])[] = [];
  delegate: 'GPU' | 'CPU' = 'GPU';

  async init(vision: VisionFileset): Promise<'GPU' | 'CPU'> {
    for (const del of ['GPU', 'CPU'] as const) {
      try {
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: GESTURE_CONFIG.handModelAssetPath,
            delegate: del,
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
        this.delegate = del;
        return del;
      } catch {
        // Fallback to CPU if GPU fails
      }
    }
    throw new Error('HandLandmarker initialization failed on GPU and CPU.');
  }

  detect(
    video: HTMLVideoElement,
    nowMs: number
  ): readonly (readonly NormalizedPoint[])[] {
    if (!this.landmarker || video.readyState < 2 || video.videoWidth <= 0) {
      return this.latestHands;
    }

    const safeNow = Math.max(nowMs, this.lastTimestampMs + 1);
    this.lastTimestampMs = safeNow;

    const result = this.landmarker.detectForVideo(video, safeNow);
    const hands = result.landmarks ?? [];
    this.latestHands = hands;
    return hands;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.latestHands = [];
  }
}
