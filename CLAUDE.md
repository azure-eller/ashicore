# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm lint         # ESLint (flat config, ESLint 9)
```

No test runner is configured.

## Architecture

Early-stage **Next.js 16 + React 19** app using the App Router with **pnpm** as the package manager.

### UI Component System

- **shadcn style:** `radix-nova` (configured in `components.json`)
- **Icons:** hugeicons (`@hugeicons/react` + `@hugeicons/core-free-icons`), not lucide-react
- **Primitives:** Radix UI (`radix-ui` unified package) for most components; Base UI (`@base-ui/react`) specifically for Combobox
- **Styling:** Tailwind v4 with CSS-first config (no `tailwind.config` file — all theming via `@theme inline` blocks and CSS custom properties in `app/globals.css`)
- **Dark mode:** `.dark` class toggle (not `prefers-color-scheme`)
- All UI components use `data-slot` attributes for CSS targeting
- Variant management via `class-variance-authority` (CVA)
- Class merging via `cn()` from `lib/utils.ts` (clsx + tailwind-merge)

### Path Aliases

`@/*` maps to the project root (e.g., `@/components/ui/button`).

### Key Directories

- `app/` — Next.js App Router pages and layouts (single page currently)
- `components/ui/` — Reusable UI primitives (shadcn radix-nova style)
- `components/` — Application-level components
- `lib/utils.ts` — `cn()` helper

### Fonts

Three Google Fonts loaded in `app/layout.tsx`: Inter (`--font-sans`), Geist Sans (`--font-geist-sans`), Geist Mono (`--font-geist-mono`).
