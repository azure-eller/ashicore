## Project
ERP system - clean rebuild. Inventory module first.
Old repo for reference: /home/aeller/Projects/soil-erp

## Stack
Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui, TanStack Query, react-hook-form, Zod, Better Auth, pnpm

## Commands
- `pnpm dev` — start dev server
- `pnpm build` — production build (use to check for type errors)
- `pnpm lint` — ESLint
- `pnpm drizzle-kit generate` — generate migration from schema changes
- `pnpm drizzle-kit migrate` — apply migrations

## Rules
- No hardcoded Tailwind colors. Use shadcn semantic tokens only.
- One Zod schema per entity in lib/schemas/, derived from Drizzle table with createInsertSchema/createSelectSchema.
- Before creating or editing any form or form field, you MUST first read `docs/references/field-example.md` and `docs/references/react-hook-form-example.md` and follow those patterns exactly.
- All mutations use TanStack Query with simple loading states. No optimistic updates.
- API routes for all mutations. Wrap handlers with `apiHandler` from `lib/api/handler.ts`.
- When pulling from old repo, only take the data model/logic. Rewrite all UI to match current patterns.
- NEVER use drizzle push. Always use generate/migrate
- Icon library: HugeIcons (`@hugeicons/core` / `@hugeicons/react`). Do not use Lucide or other icon packages.
- shadcn/ui style: `radix-nova` with `stone` base color. Check `components.json` for aliases.

## API conventions
- API routes validate with Zod. Return errors as: `NextResponse.json({ errors: result.error.flatten().fieldErrors }, { status: 400 })`
- Soft delete endpoints set `deletedAt = new Date()` — never hard-delete master data via API.

## TanStack Query
- Query keys: `["entity", filterOrId]` e.g. `["items", "material"]`, `["units"]`
- Invalidate on mutation success: `queryClient.invalidateQueries({ queryKey: ["entity", ...] })`
- No optimistic updates. Use `mutation.isPending` for loading states.

## Soft deletes
Master data tables (items, unit definitions, customers, suppliers) use deletedAt for soft deletes.
Detail/line tables (BOM lines, order lines) use hard deletes.

## Data access
NEVER import db or query tables directly in pages, components, or API routes.
All DAL query functions use `withAuthedOrgContext(async (tx) => { ... })` from `lib/dal/auth.ts`.
Never call `getAuthedContext()` directly in query functions — `withAuthedOrgContext` handles auth internally.

## Row Level Security
ALL non-system tables (inventory schema and any future schemas) MUST have RLS enabled.
RLS is defined in schema files with `pgPolicy` + `.enableRLS()` — not in hand-written migrations. See `lib/db/schema/items.ts` for the pattern.
- `current_setting('app.current_org_id', true)` — `true` returns NULL (not error) when unset, blocking all rows (fail-closed).
- The `system` schema (Better Auth tables) must NEVER have RLS enabled.
- If a table has no direct `organization_id` (e.g. a line table), add a subquery policy on the parent table or document the deferral.
- Do NOT add `eq(table.organizationId, orgId)` WHERE clauses for org filtering. RLS handles org scoping. Only add business logic filters (soft deletes, status, etc.).

## Testing
- No test framework configured yet. Use `pnpm build` to catch type errors.

## Workflow
After exiting plan mode and before making any changes:
1. Create a new branch off of main: `git checkout main && git pull && git checkout -b <branch-name>`
2. Implement the changes and commit them
3. Push the branch: `git push -u origin <branch-name>`
4. Create a PR to merge back into main on GitHub
