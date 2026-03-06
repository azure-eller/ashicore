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
All DAL query functions use `withAuthedOrgContext(async (tx) => { ... })` from `lib/dal/auth.ts`.
Never call `getAuthedContext()` directly in query functions — `withAuthedOrgContext` handles auth internally.

## Row Level Security
ALL non-system tables (inventory schema and any future schemas) MUST have RLS enabled.

RLS is defined in the Drizzle schema file using `pgPolicy` + `.enableRLS()` — not in hand-written migrations.
When creating a new table, include the policy in the table definition:

```ts
export const myTable = inventorySchema.table(
  "my_table",
  { id: uuid("id").defaultRandom().primaryKey(), organizationId: text("organization_id").notNull(), ... },
  (_table) => [
    pgPolicy("my_table_org_isolation", {
      for: "all",
      to: "public",
      using: sql`organization_id = current_setting('app.current_org_id', true)`,
    }),
  ]
).enableRLS();
```

Then run `drizzle-kit generate` — the migration includes ENABLE ROW LEVEL SECURITY and CREATE POLICY automatically.

- `current_setting('app.current_org_id', true)` — `true` returns NULL (not error) when unset, blocking all rows (fail-closed).
- The `system` schema (Better Auth tables) must NEVER have RLS enabled.
- If a table has no direct `organization_id` (e.g. a line table), add a subquery policy on the parent table or document the deferral.
- Do NOT add `eq(table.organizationId, orgId)` WHERE clauses for org filtering. RLS handles org scoping. Only add business logic filters (soft deletes, status, etc.).

## Workflow
After exiting plan mode and before making any changes:
1. Create a new branch off of main: `git checkout main && git pull && git checkout -b <branch-name>`
2. Implement the changes and commit them
3. Push the branch: `git push -u origin <branch-name>`
4. Create a PR to merge back into main on GitHub