// Empty on purpose. Astro styles run through `@tailwindcss/vite`, not PostCSS,
// but PostCSS still auto-discovers config by walking up the tree. When Vercel
// builds with Root Directory `apps/www`, this shadows the repo-root
// `postcss.config.mjs` so the apps/www install does not try to load
// `@tailwindcss/postcss` (an ERP-only dependency that is absent here). Do not delete.
export default {};
