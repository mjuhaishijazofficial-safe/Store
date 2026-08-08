'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { useLang } from '@/lib/i18n-context';

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
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let cancelled = false;
    let done = false;

    // Laptop webcams are wide-angle and low-res by default, which is a
    // bad combination for reading a small, dense barcode from close up —
    // asking for a higher resolution measurably helps. facingMode is a
    // soft preference ({ ideal }, not a hard constraint), so it degrades
    // gracefully on a laptop with only one front camera instead of
    // failing to find a matching device.
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    };

    reader
      .decodeFromConstraints(constraints, videoRef.current!, (result, err, ctrls) => {
        controls = ctrls;
        if (cancelled || done) return;
        if (result) {
          done = true;
          onDetected(result.getText());
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('inventory.scanCameraError'));
      });

    return () => {
      cancelled = true;
      controls?.stop();
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
            {/* Guide box — helps position the barcode, camera hardware
                does the rest. Purely visual, doesn't affect detection. */}
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
