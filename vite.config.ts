import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';

/**
 * Roots of packages that MUST stay external — consumers supply them, the SDK
 * never bundles them. Each regex also matches submodule paths (wagmi/chains,
 * @solana/wallet-adapter-react/*, …).
 */
const EXTERNAL_ROOTS = [
  'react',
  'react-dom',
  'wagmi',
  'viem',
  '@wagmi/core',
  '@wagmi/connectors',
  '@tanstack/react-query',
  // Solana — all optional peers, bundled only on consumers who use /solana.
  '@solana/web3.js',
  '@solana/wallet-adapter-base',
  '@solana/wallet-adapter-react',
  // TRON
  'tronweb',
];

const externalPattern = new RegExp(
  `^(${EXTERNAL_ROOTS.map((r) => r.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})(/.*)?$`,
);

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/__tests__',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/styles.ts',
      ],
      rollupTypes: true,
      entryRoot: 'src',
    }),
  ],
  build: {
    target: 'es2020',
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        solana: resolve(__dirname, 'src/solana/index.ts'),
        tron: resolve(__dirname, 'src/tron/index.ts'),
        styles: resolve(__dirname, 'src/styles.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) =>
        `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: (id) => externalPattern.test(id),
      output: {
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? assetInfo.name ?? '';
          if (name.endsWith('.css')) return 'styles.css';
          return '[name][extname]';
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
    minify: 'esbuild',
    reportCompressedSize: false,
    emptyOutDir: true,
  },
});
