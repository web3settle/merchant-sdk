import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  prefix: 'w3s-',
  theme: {
    extend: {
      colors: {
        'w3s-primary': '#6366f1',
        'w3s-primary-hover': '#4f46e5',
        'w3s-surface': 'rgba(15, 15, 25, 0.85)',
        'w3s-surface-light': 'rgba(30, 30, 50, 0.7)',
        'w3s-border': 'rgba(99, 102, 241, 0.25)',
        'w3s-text': '#e2e8f0',
        'w3s-text-muted': '#94a3b8',
        'w3s-success': '#22c55e',
        'w3s-error': '#ef4444',
        'w3s-warning': '#f59e0b',
      },
      backdropBlur: {
        'w3s': '16px',
      },
      borderRadius: {
        'w3s': '12px',
        'w3s-lg': '16px',
      },
      boxShadow: {
        'w3s': '0 8px 32px rgba(0, 0, 0, 0.4)',
        'w3s-glow': '0 0 20px rgba(99, 102, 241, 0.15)',
      },
    },
  },
  plugins: [],
};

export default config;
