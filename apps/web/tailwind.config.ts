import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        brand: '#0f766e',
      },
    },
  },
  plugins: [],
};

export default config;
