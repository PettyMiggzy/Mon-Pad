import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx,js,jsx}',
    './components/**/*.{ts,tsx,js,jsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          purple: 'var(--p)',
          'purple-light': 'var(--p2)',
          'purple-deep': 'var(--p-deep)',
          cyan: 'var(--cyan)',
          'cyan-light': 'var(--cyan2)',
        },
        monshi: 'var(--pink)',
        royalty: 'var(--gold)',
        card: 'var(--bg-card)',
        border: {
          DEFAULT: 'var(--bd)',
          strong: 'var(--bd2)',
          glow: 'var(--bd-glow)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Russo One', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
export default config;
