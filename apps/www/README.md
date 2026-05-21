# Ashicore Public Website

`apps/www` is the public static website for `https://ashicore.app`.

The authenticated ERP app remains the existing Next.js app at the repository root. The public Astro project owns the root domain and rewrites only explicit ERP route prefixes to the ERP project's stable production origin.

## Architecture

- Astro static output only.
- No CMS in v1; content is version-controlled Markdown/Astro files.
- No auth, database, migrations, cron jobs, TanStack Query, dashboard providers, analytics, chat widgets, third-party tracking, or external embeds.
- No catch-all rewrite from `/*` to ERP.
- No `/_next/*` rewrite. The ERP app must use `assetPrefix` through `NEXT_PUBLIC_ERP_ASSET_ORIGIN`, `ERP_ASSET_ORIGIN`, or `VERCEL_PROJECT_PRODUCTION_URL`.

## Deployment

Vercel project settings for the public site:

- Root directory: `apps/www`
- Build command: `npm run build`
- Output directory: `dist`

`vercel.json` contains static rewrites to `https://erp-orcin-pi.vercel.app`. Replace that host with the ERP project’s stable production origin before assigning `ashicore.app` to this Vercel project. Do not point rewrites back to `https://ashicore.app`.

## Route Ownership

Astro owns public routes such as `/`, `/privacy`, `/terms`, `/support`, `/security`, `/resources`, and `/subprocessors`.

The ERP app owns `/sign-in`, `/console`, dashboard prefixes such as `/sales` and `/inventory`, `/android`, `/.well-known/*`, and `/api/*`.

Run:

```bash
pnpm --filter @ashicore/www lint
```

This verifies the route map and confirms `apps/www` does not import ERP internals.

## Content

Policy and trust pages live in `src/pages/*.md` and render through `src/layouts/ContentPage.astro`. Update those files directly for policy/support/resource changes.
