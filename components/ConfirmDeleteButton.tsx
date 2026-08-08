'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n-context';

// Three places (Khata entries, Supplier entries, Expenses) let a single
// tap on a small "✕" permanently delete a real ledger entry — easy to
// mis-tap on a phone, no undo. A full modal (like ContactEditModal's
// delete flow) is the right amount of ceremony for deleting a customer
// along with their whole history, but it's too heavy for the routine
// "oops, wrong entry" case here. This is the lighter middle ground: tap
// once to arm a "Pakka?" state, tap again within a few seconds to
// actually delete, or it quietly disarms itself — no popup, no
// navigation, matches the "fewer screens" philosophy the whole app
// already leans on.
export default function ConfirmDeleteButton({ onConfirm, className }: { onConfirm: () => void; className?: string }) {
  const { t } = useLang();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 2500);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (confirming) {
    return (
      <button
        onClick={e => { e.stopPropagation(); setConfirming(false); onConfirm(); }}
        className="text-mirch text-xs font-700 shrink-0 whitespace-nowrap"
      >
        {t('common.confirmDelete')}
      </button>
    );
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); setConfirming(true); }}
      className={className || 'text-chalkdim text-xs hover:text-mirch shrink-0'}
    >
      ✕
    </button>
  );
}
