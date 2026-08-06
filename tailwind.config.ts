import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        board: '#1F2B24',
        board2: '#28362D',
        board3: '#31423A',
        chalk: '#EDE8DD',
        chalkdim: '#A9B3A6',
        haldi: '#E0A32E',
        mirch: '#C1502E',
        dhania: '#6B9B5E'
      }
    }
  },
  plugins: []
};

export default config;
