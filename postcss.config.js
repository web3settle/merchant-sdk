// Tailwind v4 moved its PostCSS plugin into a separate package; passing `tailwindcss`
// itself as a PostCSS plugin throws at build time ("it looks like you're trying to use
// tailwindcss directly as a PostCSS plugin"). That is why `npm run build` was failing.
//
// autoprefixer stays: Tailwind v4 handles prefixing for its own utilities, but this SDK
// also ships hand-written rules in src/styles.css.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
