'use client';

import { usePalette } from '@/lib/palette-context';

export default function PaletteToggle() {
  const { palette, setPalette } = usePalette();

  return (
    <div className="flex text-xs rounded-full border border-chalk/10 overflow-hidden shrink-0">
      <button
        onClick={() => setPalette('spice')}
        aria-label="Spice palette (gold/red/green)"
        className={`px-2.5 py-1 ${palette === 'spice' ? 'bg-haldi text-board font-700' : 'text-chalkdim'}`}
      >
        🟠
      </button>
      <button
        onClick={() => setPalette('navy')}
        aria-label="Navy palette (blue/ledger)"
        className={`px-2.5 py-1 ${palette === 'navy' ? 'bg-haldi text-board font-700' : 'text-chalkdim'}`}
      >
        🔵
      </button>
    </div>
  );
}
