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
        btn.click();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
