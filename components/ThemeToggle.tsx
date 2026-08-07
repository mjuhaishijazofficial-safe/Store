'use client';

import { useTheme } from '@/lib/theme-context';

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex text-xs rounded-full border border-chalk/10 overflow-hidden shrink-0">
      <button
        onClick={() => setTheme('light')}
        aria-label="Light theme"
        className={`px-2.5 py-1 ${theme === 'light' ? 'bg-haldi text-board font-700' : 'text-chalkdim'}`}
      >
        ☀️
      </button>
      <button
        onClick={() => setTheme('dark')}
        aria-label="Dark theme"
        className={`px-2.5 py-1 ${theme === 'dark' ? 'bg-haldi text-board font-700' : 'text-chalkdim'}`}
      >
        🌙
      </button>
    </div>
  );
}
