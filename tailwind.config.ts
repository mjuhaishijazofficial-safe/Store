import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // "Paper ledger" theme — light, warm, high-contrast. Same token
        // names as before (so no component needed to change), values
        // flipped from dark to light. Rationale: shopkeepers read this
        // on cheap Android screens at a shop counter, often in bright/
        // outdoor-adjacent light — dark UI loses to glare there, and a
        // light "ledger paper" surface also reads as more official/
        // trustworthy accounting software to a non-technical owner than
        // a dark "app" aesthetic does. Warm cream instead of stark white
        // doubles as a visual nod to the actual paper khata book this
        // product replaces.
        board: '#F7F2E7',    // page background — warm cream paper
        board2: '#FFFFFF',   // card surface — lifts above the page
        board3: '#EDE4D0',   // secondary surface — tan, for secondary buttons/badges
        chalk: '#1F2B24',    // primary text — the old dark green, now ink-on-paper
        chalkdim: '#8A7F6C', // secondary/muted text — warm gray-brown
        haldi: '#B8791A',    // turmeric gold — emphasis, highlighted figures, headings
        mirch: '#A8391F',    // chili red — debt owed, warnings, negative amounts
        dhania: '#3F7A34'    // coriander green — payments received, positive amounts
      }
    }
  },
  plugins: []
};

export default config;
