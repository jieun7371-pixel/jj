import { useEffect, useRef } from 'react';
import { HandLandmarker } from '@mediapipe/tasks-vision';
import { CameraOff, Hand } from 'lucide-react';
import { GESTURE_CONFIG } from '../vision/gestureConfig.ts';
import type { VisionOverlaySnapshot, VisionTrackerStatus } from '../vision/types.ts';

interface WebcamOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  trackerStatus: VisionTrackerStatus;
  delegate?: 'GPU' | 'CPU';
  statusError?: string | null;
  overlay: VisionOverlaySnapshot;
  onManualInput: (turn: number, dive: number) => void;
  onManualFlap: () => void;
  compact?: boolean;
}

/**
 * Draws Face eye-tilt line + degree label and 21-point HandLandmarker skeletons
 * aligned to the mirrored webcam feed.
 */
export function WebcamOverlay({
  videoRef,
  trackerStatus,
  delegate,
  statusError,
  overlay,
  onManualInput,
  onManualFlap,
  compact = false,
}: WebcamOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragActiveRef = useRef(false);
  const lastDragYRef = useRef(0);
  const lastOscDirRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, container.clientWidth);
    const ch = Math.max(1, container.clientHeight);
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    if (!overlay.face && overlay.hands.length === 0) return;

    const video = videoRef.current;
    const vw = video && video.videoWidth > 0 ? video.videoWidth : 640;
    const vh = video && video.videoHeight > 0 ? video.videoHeight : 480;
    const scale = Math.max(cw / vw, ch / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;
    const offsetX = (cw - drawW) * 0.5;
    const offsetY = (ch - drawH) * 0.5;

    const toPx = (pt: { x: number; y: number }) => ({
      x: offsetX + pt.x * drawW,
      y: offsetY + pt.y * drawH,
    });

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.78)';
    ctx.shadowBlur = 4;

    // 1. Face outer eye line + head tilt angle readout
    if (overlay.face) {
      const le = toPx(overlay.face.leftEye);
      const re = toPx(overlay.face.rightEye);
      const fh = toPx(overlay.face.forehead);
      const chPt = toPx(overlay.face.chin);

      ctx.strokeStyle = 'rgba(74, 222, 128, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fh.x, fh.y);
      ctx.lineTo(chPt.x, chPt.y);
      ctx.stroke();

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = compact ? 2.5 : 3;
      ctx.beginPath();
      ctx.moveTo(le.x, le.y);
      ctx.lineTo(re.x, re.y);
      ctx.stroke();

      for (const eyePt of [le, re]) {
        ctx.beginPath();
        ctx.arc(eyePt.x, eyePt.y, compact ? 3.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#4ade80';
        ctx.fill();
      }

      if (!compact) {
        const degText = `${overlay.headTiltDeg >= 0 ? '+' : ''}${overlay.headTiltDeg.toFixed(0)}°`;
        ctx.font = '700 13px "JetBrains Mono", monospace';
        ctx.fillStyle = Math.abs(overlay.turn) > 0.05 ? '#38bdf8' : '#86efac';
        ctx.textAlign = 'center';
        ctx.fillText(degText, fh.x, Math.max(16, fh.y - 8));
      }
    }

    // 2. 21-point HandLandmarker skeletons (fist=amber, open=emerald, half=yellow)
    for (const hand of overlay.hands) {
      const pts = hand.mirroredLandmarks.map(toPx);
      const boneColor = hand.isFist
        ? '#fbbf24'
        : hand.isOpen
        ? '#22c55e'
        : '#eab308';
      const dotColor = hand.isFist
        ? '#fde68a'
        : hand.isOpen
        ? '#4ade80'
        : '#fef08a';

      ctx.strokeStyle = boneColor;
      ctx.lineWidth = compact ? 2.5 : 3;
      ctx.beginPath();
      for (const conn of HandLandmarker.HAND_CONNECTIONS) {
        const a = pts[conn.start];
        const b = pts[conn.end];
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const isTipOrWrist = i === 0 || i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
        ctx.beginPath();
        ctx.arc(p.x, p.y, compact ? 2.5 : isTipOrWrist ? 4.2 : 3.2, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#052e16';
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [overlay, videoRef, compact]);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = (clientY - rect.top) / Math.max(1, rect.height);

    const turn = Math.max(-1, Math.min(1, nx * 1.15));
    const dive = ny > 0.62 ? Math.min(1, (ny - 0.62) / 0.32) : 0;
    onManualInput(turn, dive);

    const dy = clientY - lastDragYRef.current;
    if (Math.abs(dy) > 8) {
      const dir = Math.sign(dy);
      if (lastOscDirRef.current !== 0 && dir !== lastOscDirRef.current) {
        onManualFlap();
      }
      lastOscDirRef.current = dir;
      lastDragYRef.current = clientY;
    }
  };

  const showManualFallback = trackerStatus === 'camera-denied' || trackerStatus === 'model-error';

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-slate-950 overflow-hidden select-none touch-none"
      onPointerDown={(e) => {
        if (!showManualFallback) return;
        dragActiveRef.current = true;
        lastDragYRef.current = e.clientY;
        lastOscDirRef.current = 0;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateFromPointer(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!showManualFallback || !dragActiveRef.current) return;
        updateFromPointer(e.clientX, e.clientY);
      }}
      onPointerUp={() => {
        if (!showManualFallback) return;
        dragActiveRef.current = false;
        onManualInput(0, 0);
      }}
      onPointerCancel={() => {
        if (!showManualFallback) return;
        dragActiveRef.current = false;
        onManualInput(0, 0);
      }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`w-full h-full object-cover scale-x-[-1] ${
          showManualFallback ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {trackerStatus === 'initializing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 px-4 text-center">
          <div className="text-base md:text-lg font-bold text-white hud-shadow">
            카메라 및 얼굴·손 인식 준비 중...
          </div>
          <div className="mt-1.5 text-xs md:text-sm text-sky-200/80">
            {GESTURE_CONFIG.guidanceMessage}
          </div>
        </div>
      )}

      {trackerStatus === 'ready' && !overlay.faceDetected && overlay.handCount === 0 && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
          <div className="rounded-lg bg-slate-950/85 border border-amber-400/50 px-3.5 py-2 text-center">
            <p className="text-xs md:text-sm font-bold text-amber-200 hud-shadow">
              {GESTURE_CONFIG.guidanceMessage}
            </p>
          </div>
        </div>
      )}

      {trackerStatus === 'ready' && overlay.faceDetected && overlay.needHandsPrompt && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
          <div className="rounded-lg bg-slate-950/85 border border-sky-400/50 px-3 py-1.5 text-center">
            <p className="text-xs md:text-sm font-bold text-sky-200 hud-shadow">
              손을 보여주세요
            </p>
          </div>
        </div>
      )}

      {trackerStatus === 'ready' && (overlay.faceDetected || overlay.handCount > 0) && (
        <div className="pointer-events-none absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between gap-2">
          <span className="rounded bg-slate-950/80 border border-white/15 px-2.5 py-1 text-xs md:text-sm font-extrabold text-white hud-shadow">
            {overlay.gestureBadgeText}
          </span>

          {!compact && delegate && (
            <span className="text-[11px] font-mono-num text-white/75 hud-shadow">
              얼굴·손 ({delegate})
            </span>
          )}
        </div>
      )}

      {showManualFallback && (
        <div className="absolute inset-0 flex flex-col items-center justify-between pt-24 pb-3 px-4 md:pt-20 bg-slate-900/95 text-center overflow-y-auto">
          <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
            <CameraOff className="w-4 h-4 shrink-0" />
            <span>
              {trackerStatus === 'camera-denied'
                ? '웹캠을 사용할 수 없어 수동 조종으로 전환했습니다'
                : statusError || '동작 인식을 시작할 수 없어 수동 조종을 사용합니다'}
            </span>
          </div>

          <div className="flex flex-col items-center gap-2 my-auto">
            <Hand className="w-7 h-7 text-sky-300" />
            <p className="text-sm md:text-base font-bold text-white">
              화면 좌우 드래그: 선회 · 아래로 드래그: 하강
            </p>
            <p className="text-xs text-slate-300">
              키보드: A/D(선회) · S(하강) · Space(날갯짓)
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onManualFlap();
              }}
              className="mt-1 min-h-11 px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-bold text-sm shadow transition-colors cursor-pointer"
            >
              날갯짓 추진 (Space)
            </button>
          </div>

          <div className="text-[11px] text-slate-400">
            {GESTURE_CONFIG.guidanceMessage}
          </div>
        </div>
      )}
    </div>
  );
}
