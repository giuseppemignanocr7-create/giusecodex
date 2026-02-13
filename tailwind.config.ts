import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#1e1e2e',
        surface: '#252536',
        overlay: '#2a2a3d',
        muted: '#6c7086',
        text: '#cdd6f4',
        accent: '#89b4fa',
        green: '#a6e3a1',
        red: '#f38ba8',
        yellow: '#f9e2af',
        purple: '#cba6f7',
      },
    },
  },
  plugins: [],
} satisfies Config;
