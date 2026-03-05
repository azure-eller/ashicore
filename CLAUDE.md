## Project
ERP system - clean rebuild. Inventory module first.
Old repo for reference: /home/aeller/Projects/soil-erp

## Stack
Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui, TanStack Query, react-hook-form, Zod, Better Auth, pnpm

## Rules
- No hardcoded Tailwind colors. Use shadcn semantic tokens only.
- One Zod schema per entity in lib/schemas/, derived from Drizzle table with createInsertSchema/createSelectSchema.
- All forms follow the pattern in [reference form path once it exists].
- All mutations use TanStack Query with simple loading states. No optimistic updates.
- Server actions for single-entity CRUD. API routes for multi-entity/transactional operations.
- When pulling from old repo, only take the data model/logic. Rewrite all UI to match current patterns.
- NEVER use drizzle push. Always use generate/migrate

## Soft deletes
Master data tables (items, unit definitions, customers, suppliers) use deletedAt for soft deletes.
Detail/line tables (BOM lines, order lines) use hard deletes.

## Data access
NEVER import db or query tables directly in pages, components, or API routes.
ALL database queries go through lib/dal.ts which enforces organization scoping.
Every query function in the DAL calls getAuthedContext() first.