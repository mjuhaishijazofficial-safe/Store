'use client';

import { useEffect, useRef, useState } from 'react';

// The one-time fade+rise on the stat cards was easy to miss — it's over
// in half a second, before most people have even focused on the screen.
// Counting the number up from 0 every time the page loads is the effect
// that actually reads as "alive" on a numbers-heavy dashboard, and it's
// impossible to miss since it's the exact thing the eye is drawn to.
export default function AnimatedNumber({ value, prefix = '', duration = 900 }: { value: number; prefix?: string; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const from = 0;

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // ease-out-cubic — fast start, settles gently into the real number
      // rather than a linear count that feels mechanical.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    }

    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{prefix}{display.toLocaleString('en-IN')}</>;
}
