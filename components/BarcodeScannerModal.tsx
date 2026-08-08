'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { useLang } from '@/lib/i18n-context';

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 }
  }
};

export default function BarcodeScannerModal({
  onDetected,
  onClose
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    let rafId: number | undefined;
    let stream: MediaStream | null = null;
    let zxingControls: IScannerControls | undefined;

    // Chrome/Edge ship a native BarcodeDetector — it's the browser's own
    // ML-based scanner (on Chrome this is backed by the same detection
    // model as Google Lens), and it is dramatically better than a
    // pure-JS library at handling a mediocre webcam: blur, low light,
    // a barcode held slightly off-angle. Pure JS (ZXing) only kicks in
    // as a fallback where BarcodeDetector doesn't exist (Firefox,
    // Safari) — it's not gone, just no longer the primary path.
    async function startNative(Detector: any) {
      stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (cancelled || !videoRef.current) { stream?.getTracks().forEach(tr => tr.stop()); return; }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const detector = new Detector();
      const tick = async () => {
        if (cancelled || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length > 0) {
            onDetected(codes[0].rawValue);
            return;
          }
        } catch {
          // Transient — e.g. a frame grabbed before the video has enough
          // data yet. Just try again next frame.
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    async function startZXing() {
      const reader = new BrowserMultiFormatReader();
      await reader.decodeFromConstraints(CAMERA_CONSTRAINTS, videoRef.current!, (result, err, ctrls) => {
        zxingControls = ctrls;
        if (cancelled) return;
        if (result) onDetected(result.getText());
      });
    }

    (async () => {
      try {
        const Detector = typeof window !== 'undefined' ? (window as any).BarcodeDetector : undefined;
        if (Detector) {
          await startNative(Detector);
        } else {
          await startZXing();
        }
      } catch {
        if (!cancelled) setError(t('inventory.scanCameraError'));
      }
    })();

    return () => {
      cancelled = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      zxingControls?.stop();
      stream?.getTracks().forEach(tr => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitManual() {
    if (!manualCode.trim()) return;
    onDetected(manualCode.trim());
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="font-display text-lg text-haldi font-700 mb-3">{t('inventory.scanTitle')}</div>
        {error ? (
          <div className="text-mirch text-sm bg-mirch/10 p-3 rounded-lg">{error}</div>
        ) : (
          <div className="relative">
            <video ref={videoRef} className="w-full rounded-lg bg-board3" muted playsInline />
            {/* Guide box — helps positioning, camera/detector do the rest. */}
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-16 border-2 border-haldi/70 rounded pointer-events-none" />
          </div>
        )}
        <p className="text-chalkdim text-xs mt-3">{t('inventory.scanHint')}</p>

        <div className="mt-4 pt-4 border-t border-chalk/10">
          <label className="block text-xs text-chalkdim mb-1">{t('inventory.scanManualLabel')}</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitManual()}
              placeholder={t('inventory.scanManualPlaceholder')}
            />
            <button onClick={submitManual} className="btn-primary whitespace-nowrap">{t('inventory.scanManualBtn')}</button>
          </div>
        </div>

        <button onClick={onClose} className="btn-secondary w-full mt-4">{t('inventory.cancel')}</button>
      </div>
    </div>
  );
}
