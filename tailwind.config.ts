import type { Config } from 'tailwindcss';

// Colors resolve through CSS variables (set in globals.css) instead of
// fixed hex, so the same "board"/"chalk"/etc. token names can be
// re-pointed to a light or dark palette at runtime via [data-theme] on
// <html> — no component needs to know or care which theme is active.
const withOpacity = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        board: withOpacity('--color-board'),
        board2: withOpacity('--color-board2'),
        board3: withOpacity('--color-board3'),
        chalk: withOpacity('--color-chalk'),
        chalkdim: withOpacity('--color-chalkdim'),
        haldi: withOpacity('--color-haldi'),
        mirch: withOpacity('--color-mirch'),
        dhania: withOpacity('--color-dhania')
      }
    }
  },
  plugins: []
};

export default config;
