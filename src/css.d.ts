// TypeScript 6 requires an explicit declaration for side-effect imports of
// non-code assets. `src/styles.ts` exists solely to make
// `import '@web3settle/merchant-sdk/styles.css'` a buildable entry point.
declare module '*.css';
