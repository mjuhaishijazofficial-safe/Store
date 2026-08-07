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

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let cancelled = false;
    let done = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result, err, ctrls) => {
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

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="font-display text-lg text-haldi font-700 mb-3">{t('inventory.scanTitle')}</div>
        {error ? (
          <div className="text-mirch text-sm bg-mirch/10 p-3 rounded-lg">{error}</div>
        ) : (
          <video ref={videoRef} className="w-full rounded-lg bg-board3" muted playsInline />
        )}
        <p className="text-chalkdim text-xs mt-3">{t('inventory.scanHint')}</p>
        <button onClick={onClose} className="btn-secondary w-full mt-4">{t('inventory.cancel')}</button>
      </div>
    </div>
  );
}
