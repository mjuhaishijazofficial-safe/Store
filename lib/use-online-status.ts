'use client';

import { useEffect, useState } from 'react';

// navigator.onLine only reflects "has a network interface" (a phone on
// airplane mode reports false; weak-but-connected wifi still reports
// true) — it's not a proof the connection actually works, but paired
// with the browser's own online/offline events it's the standard,
// zero-cost signal for "tell the user something's off" without polling
// anything ourselves.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
