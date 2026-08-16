'use client';

import { useEffect } from 'react';

// Global convenience: pressing Enter while typing in any modal's text
// input clicks that modal's own primary action button — no per-modal
// wiring needed, since every modal in this app already shares one class
// (`btn-primary`) for its Save/Confirm button. Skips real <form>
// elements (Login/Signup already submit natively on Enter — acting here
// too would double-fire) and textareas (Enter there means a new line,
// not "save").
export default function EnterToSave() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;
      if (!target || target.tagName !== 'INPUT') return;
      if (target.closest('form')) return;
      const modal = target.closest('.card');
      if (!modal) return;
      const btn = modal.querySelector<HTMLButtonElement>('button.btn-primary:not(:disabled)');
      if (btn) {
        e.preventDefault();
        // Immediate visual acknowledgment that Enter was registered —
        // the actual save is async (a network round trip), so without
        // this the button looks unresponsive for that gap and someone
        // presses Enter again, unsure if the first one did anything.
        // Each button's own loading/disabled state (already built into
        // every one of these) takes over right after for the real
        // in-progress feedback; this just covers the instant before that.
        btn.style.transition = 'transform 0.1s ease, filter 0.1s ease';
        btn.style.transform = 'scale(0.95)';
        btn.style.filter = 'brightness(0.9)';
        setTimeout(() => {
          btn.style.transform = '';
          btn.style.filter = '';
        }, 150);
        btn.click();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
