## Project

ERP system — clean rebuild. Inventory module first.
Old repo for reference: `/home/aeller/Projects/soil-erp`

## Stack

Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui, TanStack Query, react-hook-form, Zod, Better Auth, pnpm

## Commands

- `pnpm dev` — start dev server
- `pnpm build` — production build (catch type errors)
- `pnpm lint` — ESLint
- `pnpm test` — run fast Playwright write-path smoke tests with parallel workers (dev server must be running)
- `pnpm test:e2e:slow` — run slow serial operational Playwright stories
- `pnpm test:e2e:auth` — run auth, invite, and team-access regressions
- `pnpm test:inventory` — run the fast inventory write-path smoke flow
- `pnpm test:sales` — run the fast sales write-path smoke flow
- `pnpm drizzle-kit generate` — generate migration from schema changes
- `pnpm drizzle-kit migrate` — apply migrations

## Documentation Structure

This repo has two layers of documentation:

**AGENTS.md** (this file) — quick reference. Contains the rule and the correct code. Every agent reads this at session start. **Keep entries concise** — short rules with code examples, not essays. If you need to add something here, use the fewest words possible.

**Domain docs** (`docs/`) — deep reference. Contains the why, the exceptions, and the canonical examples. Read the relevant doc before working in that area.

When you discover a new pattern or gotcha:
1. Add the **rule + correct code** to the Coding Patterns section of this file (keep it short)
2. Add the **full explanation** to the relevant domain doc below
3. New docs must have `read_when:` YAML frontmatter listing when to load them

| Task area | Read |
|-----------|------|
| Forms / form fields | `docs/references/field-example.md`, `docs/references/react-hook-form-example.md` |
| UI, components, layout | `docs/ui-patterns.md` |
| API routes, mutations | `docs/api-patterns.md` |
| Schema, migrations, DAL | `docs/database.md` |
| Feature planning | `docs/architecture.md` |
| Auth, roles, team invites | `docs/auth-team.md` |
| Production launch, auth protection, observability | `docs/production-ops.md` |
| Manufacturing orders | `docs/manufacturing.md` |
| Purchasing, suppliers, receiving | `docs/purchasing.md` |
| Stocktakes, reconciliation | `docs/stocktakes.md` |
| Test scenario generation | `docs/testing-scenario-generation.md` |

## Database Roles

- `DATABASE_URL` (owner) — migrations only (`drizzle-kit generate/migrate`)
- `DATABASE_URL_APP` (app_user) — app runtime, RLS enforced, no DDL

New schemas: grant `app_user` USAGE + CRUD on tables + sequences (see `docs/database.md`).
New tables: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + policy on `current_setting('app.current_org_id', true)`. Always use `FORCE` — without it the owner bypasses RLS.

## Critical Rules

- For code-changing work, NEVER edit files in the repo root checkout or on `main` unless the user explicitly asks for that. Use a dedicated git worktree.
- No hardcoded Tailwind colors — shadcn semantic tokens only
- API routes for all mutations — no server actions
- NEVER import db directly in pages, components, or API routes — use DAL
- NEVER use `drizzle push` — always `generate` + `migrate`
- Icons: HugeIcons only (`@hugeicons/core` / `@hugeicons/react`) — never Lucide
- shadcn/ui style: `radix-nova` with `stone` base color. Check `components.json` for aliases.
- Run `pnpm build` after changes to catch type errors
- Run `pnpm test` after changes to catch regressions

## Coding Patterns

These are gotchas that have caused real bugs. Follow them exactly.

### Date and datetime fields

Never use `<input type="date">`. Use `DatePicker` for date columns (`YYYY-MM-DD`) and `DateTimePicker` for timestamp columns (`YYYY-MM-DDTHH:mm:ss`). Both use string values matching Postgres types. See `docs/ui-patterns.md` for Controller examples.

### No local utility functions

Before defining a helper in a module, check `lib/format.ts` and `lib/schemas/shared.ts` first. Common helpers that exist there: `normalizeNumeric`, `normalizeMoney`, `parsePositive`, `getFieldArrayError`, `formatQuantity`, `formatDate`, `formatDateTime`, `formatPrice`. Never copy these into module files.

### Shared Zod validators

`nullableString`, `isValidIsoDate`, and `positiveDecimalString` live in `lib/schemas/shared.ts`. Import from there — never copy these into new schema files.

For `createInsertSchema` overrides (items.ts), use `nullableStringStrict` (without `.optional()`) to match Drizzle's type handling.

### Count-based units

Packaging and internal assemblies should use the shared `Each` unit with `uom: "ea"` instead of faking counts as weight or volume.

```ts
{ name: "Each", size: "1", uom: "ea" }
```

### Don't re-validate after Zod

DAL functions receive Zod-parsed types. Don't add manual null/positive/required checks in the DAL — the schema already enforces these. Redundant validation adds dead code that can never trigger through the API.

### Nullable string fields (Zod schemas)

All optional text fields must use this pattern:

```ts
const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v != null ? v.trim() || null : null));
```

This accepts `string`, `null`, OR `undefined` — and normalizes to `string | null`. Forms send `undefined` for untouched fields. The schema must handle this.

### Form default values (react-hook-form)

Always list ALL fields in `defaultValues`, including optional ones with explicit `null`:

```ts
// ✓ Correct — every field has a default
defaultValues: {
  name: "",
  sku: null,
  category: null,
  description: null,
  defaultPurchasePrice: null,
  defaultSellingPrice: null,
  stock: "0",
  safetyStock: "0",
}

// ✗ Wrong — missing fields become undefined, break Zod validation
defaultValues: {
  name: "",
  stock: "0",
}
```

### Standalone form pages

Single-page create/edit forms should use a centered page shell with top actions and stacked `FieldSet` sections separated by `FieldSeparator` — not one centered card for the entire form.

```tsx
// ✓ Correct — page-width shell, header actions, stacked FieldSet sections
<div className="mx-auto w-full max-w-4xl py-8">
  <ItemForm />
</div>

// Inside the form component:
<div className="space-y-8">
  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
    <div className="space-y-1.5">
      <h1 className="text-3xl font-semibold tracking-tight">Add Product</h1>
      <p className="text-sm text-muted-foreground">Create a new product in your inventory.</p>
    </div>
    <div className="flex gap-3">
      <Button variant="outline" onClick={handleCancel}>Cancel</Button>
      <Button type="submit" form="item-form">Create Product</Button>
    </div>
  </div>

  <Separator />

  <form className="space-y-0">
    <FieldGroup className="gap-8">
      <FieldSet className="max-w-4xl gap-5">
        <FieldLegend>Basics</FieldLegend>
        <FieldDescription>Name, category, and unit details.</FieldDescription>
        <FieldGroup>{/* fields */}</FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet className="max-w-4xl gap-5">
        <FieldLegend>Pricing & Stock</FieldLegend>
        <FieldDescription>Set pricing and stock defaults.</FieldDescription>
        <FieldGroup>{/* fields */}</FieldGroup>
      </FieldSet>
    </FieldGroup>
  </form>
</div>

// ✗ Wrong — narrow centered form that reads like a modal
<div className="flex flex-1 items-center justify-center">
  <div className="w-full max-w-3xl">
    <Card>{/* whole form */}</Card>
  </div>
</div>
```

### Cancel button navigation

Cancel actions should keep in-app back navigation when possible, but fall back to a known route for direct URLs or external referrers.

```tsx
const handleCancel = () => {
  if (document.referrer.startsWith(window.location.origin)) {
    router.back()
    return
  }

  router.push("/inventory/materials")
}
```

### Better Auth hosts

Keep `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` as the canonical fallback URL. `lib/auth.ts` already allows `localhost`, `127.0.0.1`, and `[::1]` on any port. For LAN IPs or tunnel hosts, add patterns to `BETTER_AUTH_ALLOWED_HOSTS` instead of rewriting the canonical URL for a worktree port.

Vercel preview deploys may fall back to `VERCEL_BRANCH_URL` / `VERCEL_URL` for the canonical app URL and auto-allow `*.vercel.app` in preview.

### Team access presets

Team invites should choose a preset (`admin`, `ops_manager`, `sales_manager`, `sales_operator`, `view_only`) and convert it to matrix roles. Presets are derived from module access later; non-matching access shows as `custom`.

```ts
const assignedRoles = buildPresetAssignedRoles("sales_operator")
const presetKey = getDerivedAccessPresetKey(moduleAccess)
```

### Portal theming

Portal components should use semantic background/text tokens on the portal content itself. Do not hardcode `dark` on individual dialogs or menus.

```tsx
<DialogContent className="bg-background text-foreground" />
<DropdownMenuContent className="bg-popover text-popover-foreground" />
```

### Tooltips

Use tooltips only for computed terms or alert indicators that need brief clarification. Reuse the existing label/link as the trigger — no extra info icons unless there is no natural hover target.

```tsx
<SortableHeader column={column} label="Calculated Stock" tooltip="Stock - committed + expected - safety stock." />
```

### Route loading reuse

New/edit loading states for the same form should share one route-level loader per item type. Detail routes should also have a local `[id]/loading.tsx` per item type so they never fall back to a parent list skeleton.

```tsx
// ✓ Correct — one shared loader for material new/edit
export { default } from "../../material-item-form-loading"

// ✓ Correct — one shared loader for product new/edit
export { default } from "../../product-item-form-loading"

// ✓ Correct — detail routes point to a shared item-type detail loader
export { default } from "../../material-item-detail-loading"
export { default } from "../../product-item-detail-loading"
```

### Postgres numeric fields

Postgres `numeric` columns are returned as strings by the driver. Always parse for display — use `formatQuantity()` from `lib/format.ts` or `parseFloat()`:

```ts
// ✓ Correct — parseFloat returns NaN for non-numeric strings, handles "0"
const qty = parseFloat(row.quantity);
if (!isNaN(qty)) { ... }

// ✗ Wrong — "0" is falsy, treats zero as missing
if (row.quantity) { ... }
```

When writing ANY numeric value to Postgres — quantities, costs, amounts, prices — always strip trailing zeros. This applies to every `normalizeXxxString` helper, not just quantities:

```ts
// ✓ Correct — use this pattern for ALL numeric normalization
return value.toFixed(4).replace(/\.?0+$/, "");

// ✗ Wrong — toFixed without stripping stores "1.5000"
return value.toFixed(4);
```

### Sequence-backed document numbers

If a DAL uses `nextval()` for order/lot numbers, the migration must `CREATE SEQUENCE` and `GRANT USAGE, SELECT ON SEQUENCE ... TO app_user`.

### Stocktake completion

Saving stocktake counts updates snapshot rows only. Completion applies counted truth from current live stock; if live stock changed since snapshot, return `409` with a stale payload and require confirmation.

### Stocktake draft saves

Draft stocktake saves should submit dirty lines only. Completing a dirty stocktake should save dirty counts first, then complete.

```ts
if (form.formState.isDirty) {
  await saveMutation.mutateAsync({ lines: dirtyLines })
}
await completeMutation.mutateAsync(false)
```

### Stocktake snapshot locking

Draft stocktake creation and item soft deletes must both lock affected `items` rows before checking draft references, so snapshot creation cannot race with delete.

### Stocktake scope picker

Stocktake scope stays in one dropdown: quick scopes first (`all`, `material`, `product`), then category scopes grouped under materials/products. Category scopes must encode both item type and category name.

```ts
buildStocktakeCategoryScope("material", "Soil")
// "material:category:Soil"
```

### Positive stock additions need cost

Any positive stock write that creates a lot must resolve a non-null `costPerUnit`. Materials use `defaultPurchasePrice`. Products derive cost from active BOM ingredients. If no cost basis exists, fail instead of creating a null-cost lot.

```ts
if (item.itemType === "material") {
  return item.defaultPurchasePrice
}

return deriveBomIngredientCost(...)
```

### Sales fulfillment

Sales fulfillment is one-shot: `confirmed -> fulfilled` consumes stock FIFO, writes `sales_fulfilled` stock movements, and recomputes `committedQty`. Fulfilled orders are historical and do not block customer/product soft delete.

### API error shape

- `{ error: string }` for general errors
- `{ errors: Record<string, string[]> }` for Zod field-level errors
- Domain errors (SalesError, ManufacturingError) use `error.toResponse()` in route handlers
- Guarded API `GET` handlers should also use `apiHandler`, not bare `export async function GET`, so `AuthorizationError` returns JSON instead of a 500
- Shared `lib/` code should throw typed errors when routes need non-500 handling. Catch them explicitly in route handlers:

```ts
if (error instanceof ManufacturingError) return error.toResponse();
if (error instanceof InsufficientStockError) {
  return NextResponse.json({ error: error.message }, { status: 409 });
}
throw error;
```

### Roles and module guards

Better Auth member role arrays are the source of truth. Use governance roles `owner|admin|member` plus matrix roles like `sales:operate`. Personal settings stay readable for all authenticated members; team management stays owner/admin only. Guard dashboard reads in layouts/pages and guard API reads/writes in routes.

```ts
await requireModuleReadAccess("sales")
await assertModuleWriteAccess("manufacturing", request.headers)
```

Unlocked product BOMs use `inventory:operate`. Locked BOM state lives on the product item row; locking/unlocking and editing locked BOMs require `inventory:admin`, but manufacturing can still run from locked BOMs.

Auth helpers that read `headers()` must stay request-scoped, and `/org-setup` must auto-activate a signed-in user’s only org membership before showing org creation.

### Detail page tables

Always use shadcn `Table` / `TableHeader` / `TableBody` / `TableRow` / `TableCell` — never raw `<table>` / `<tr>` / `<td>`. Raw HTML tables bypass theme tokens and won't pick up future Table component changes.

### Shared dashboard tables

List pages with search + add + optional bulk delete should use `DashboardDataTable` from `components/dashboard-data-table.tsx`. Keep route table files to columns + config only.

```tsx
<DashboardDataTable columns={columns} queryKey={["customers"]} addHref="/sales/customers/new" />
```

### Domain errors

API-facing business errors should extend `DomainError` from `lib/errors/domain-error.ts`. Use `errors` for field errors and `extra` for domain payloads.

```ts
export class SalesError extends DomainError<{ oversell: OversellWarningPayload }> {}
```

### Bulk delete mutations

Bulk delete actions that can fail on business rules must go through one API mutation that validates all selected ids in a single transaction. Do not fire one `DELETE` per row from the client.

```ts
// ✓ Correct — one request, server validates and deletes atomically
await fetch("/api/customers", {
  method: "DELETE",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids }),
})

// ✗ Wrong — partial success if one delete fails
await Promise.all(
  ids.map((id) => fetch(`/api/customers/${id}`, { method: "DELETE" }))
)
```

### Calendar date strings

Date strings must validate both format and calendar validity before hitting Postgres.

```ts
const requestedDate = nullableString.refine(
  (value) => value == null || isValidIsoDate(value),
  "Requested date must be a real date in YYYY-MM-DD format"
)
```

### Auth email URLs

Invite, verification, and password-reset emails must use the configured canonical app URL. Never build auth links from `request.url`.

```ts
const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL
```

### Observability hygiene

Sentry and API error logging must redact secrets and user-entered notes. Never capture passwords, tokens, cookies, raw request bodies, or customer notes/comments by default.

```ts
delete event.request?.data
scope.setContext("request", { method, path })
```

### Product deletes with active sales orders

Products referenced by active draft or confirmed sales orders cannot be soft-deleted. Block the delete in inventory instead of teaching the sales form how to recover missing draft products.

```ts
const [activeOrderRef] = await tx
  .select({ id: salesOrderLines.id })
  .from(salesOrderLines)
  .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
  .where(
    and(
      eq(salesOrderLines.itemId, id),
      isNull(salesOrders.deletedAt),
      inArray(salesOrders.status, ["draft", "confirmed"])
    )
  )
  .limit(1)

if (activeOrderRef) {
  return { deleted: false, usedInActiveOrders: true }
}
```

### Manufacturing expected quantity

`items.expectedQty` is inbound supply, not a manual counter. Recompute it from active released manufacturing orders plus active ordered/partial purchase orders after every status-changing write.

```ts
await recomputeExpectedQty(tx, affectedItemIds)
```

### Purchase receipts

PO receiving must create lots through the shared stock helper and write purchasing movement metadata.

```ts
await createPositiveLotAndMovementInTx(tx, {
  movementType: "purchase_received",
  referenceType: "purchase_order",
  referenceId: id,
})
```

### Stock and aggregate locking

Any mutation that changes lot stock, `items.committedQty`, or `items.expectedQty` must lock affected `items` rows first. FIFO deductions must also lock candidate lot rows before reading balances.

If a workflow decision depends on current row state, lock that row with `FOR UPDATE` before reading it. Use this for order status transitions and absolute stock-target edits.

```ts
const [order] = await tx
  .select({ status: manufacturingOrders.status })
  .from(manufacturingOrders)
  .where(eq(manufacturingOrders.id, id))
  .for("update")

await lockItemsInTx(tx, affectedItemIds)

const lotsForUpdate = await tx
  .select()
  .from(lots)
  .where(and(eq(lots.itemId, itemId), sql`${lots.quantity} > 0`))
  .orderBy(asc(lots.receivedAt), asc(lots.id))
  .for("update", { of: lots })
```

### Manufacturing shortages

Release may warn with `409` + shortage payload and continue after confirmation. Completion must hard-block on shortages before any stock mutation.

```ts
if (shortages.length > 0 && !confirmShortage) {
  throw new ManufacturingError("Short on ingredients", 409, {
    shortage: { ingredients: shortages },
  })
}
```

### Manufacturing quantity math

Round derived manufacturing quantities to 4 decimals before shortage checks or stock deltas. Never compare or deduct raw JS float multiplication.

```ts
const actualNeeded = multiplyQuantity(ingredient.quantityPerUnit, actualQuantity)
```

### Manufacturing sales-line snapshots

`manufacturingOrders.salesOrderLineId` is a snapshot. Draft MO edits must survive sales-order line rewrites by re-linking via `salesOrderId + productId` when possible, or preserving the stored snapshot if the user did not change it.

```ts
if (isUnchangedSnapshot && replacementLine) return replacementLine
if (isUnchangedSnapshot) return existingSnapshot
```

### Manufacturing sales-line claims

`manufacturingOrders.salesOrderLineId` is also a one-time claim for sales-driven MO creation. Linked `draft`, `released`, and `completed` MOs block another linked MO for that sales line; only `cancelled` reopens it.

```ts
inArray(manufacturingOrders.status, ["draft", "released", "completed"])
```

### Manufacturing product templates

New manufacturing-order product pickers should only list products whose active BOM still has at least one non-deleted ingredient.

```ts
.filter((product) => (bomByProduct.get(product.id) ?? []).length > 0)
```

### Item deletes with active manufacturing orders

Items used by draft or released manufacturing orders cannot be soft-deleted, whether they are the finished product or an ingredient snapshot row.

```ts
if (activeManufacturingRef) {
  return { deleted: false, usedInActiveManufacturing: true }
}
```

### Soft deletes

Master data uses soft delete: `deletedAt = new Date()`. Filter with `isNull(items.deletedAt)`. Never hard-delete master data via API.

Sales orders use soft delete. Sales order lines follow the inventory line-table pattern: hard-delete and re-insert them when editing a draft order.

```ts
await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id))

await tx.insert(salesOrderLines).values(
  preparedLines.map((line) => ({
    salesOrderId: id,
    ...line,
  }))
)
```

## Testing

**Playwright e2e only** — no Vitest, no unit tests, no mocks. `pnpm test` runs Playwright.

Fast vs slow:
- Fast specs live in `test/e2e/fast/` and cover browser write paths only: fill form, submit, minimal success UI, DB assertions.
- Slow specs live in `test/e2e/slow/` and stay serial, operational stories: create, edit, transition, and verify real user workflows.
- Auth regressions live in `test/e2e/auth-security.spec.ts` and run separately from the fast/slow domain split.
- Keep slow specs rooted in normal operations. Only include guards/errors when they arise inside a realistic workflow.

Tests follow **serial domain stories** mirroring real user workflows. Keep each file self-contained so inventory and sales can run together or in isolation.

### Key rules

- Default local test after normal changes: `pnpm test`
- If you touch one domain deeply, run that domain's slow spec too: `pnpm test:e2e:<domain>:slow`
- If you touch auth, invites, or team access, run `pnpm test:e2e:auth`
  This command includes both `auth-security.spec.ts` and `team-management.spec.ts`.
- Do not run the whole slow lane locally unless the change is cross-domain or explicitly needs broad workflow verification
- Do not add new one-off story suites outside `fast/`, `slow/`, or `auth-security.spec.ts`
- `test.describe.configure({ mode: "serial" })` for tests that depend on each other
- Share data between tests via variables at the describe level, not helper functions
- All created items use `Date.now()` timestamps in names to avoid collisions
- After form submission, **query the database directly** via the `db` fixture to verify the row
- The `db` fixture uses the app role with RLS — same security path as the real app
- Dev server must be running (`pnpm dev`) before `pnpm test`

### Key files

- `test/e2e/fixtures.ts` — custom `test` with `db` fixture (Drizzle + Neon + RLS)
- `test/e2e/fast/` — fast write-path smoke specs
- `test/e2e/slow/` — serial operational stories by domain
- `test/e2e/auth-security.spec.ts` — auth and permission regressions
- `test/global-setup.ts` — creates test user/org/unit, writes `.test-env.json`
- `test/helpers/api.ts` — authenticated fetch helpers

## PR Expectations

A change is "done" when:

1. `pnpm build` passes (no type errors)
2. `pnpm test` passes (no regressions)
3. `pnpm lint` passes
4. Branch pushed and ready PR opened with description; never leave PRs in draft because bots review only ready PRs
5. For UI changes: screenshot or description of what changed visually

## Multi-Agent Safety

When multiple agents may be working in the repo:

- Do not create, apply, or drop git stash
- Scope commits to your own changes only
- Do not run `git add .` or `git add -A` — stage specific files
- Do not modify files outside the scope of your task
- Assume other agents may be working in parallel — keep unrelated files untouched

## Worktree Rule

For code-changing work:

- Do not edit files in `/home/aeller/Projects/erp` or on `main` unless the user explicitly asks for that
- Create or enter a dedicated worktree before making changes
- Do not reuse another active worktree unless the user explicitly points to it
- `pnpm dev`, `pnpm build`, and `pnpm test` load the repo root `.env.local` automatically in worktrees; only create a per-worktree `.env.local` when you need overrides

```bash
git worktree add .worktrees/<branch-name> -b <branch-name>
cd .worktrees/<branch-name>
pnpm install
```

- Run `pnpm build`, `pnpm test`, and `pnpm lint` in the worktree that contains the change
- After merge, remove the worktree with `git worktree remove .worktrees/<branch-name>`

### Keeping worktrees current

Other branches merge while you work. Always rebase before key actions to avoid conflicts.

```bash
git fetch origin main && git rebase origin/main
```

Run this:
- Before your first commit in a worktree
- Before opening or pushing a PR

Never merge main into your branch — always rebase so history stays linear.

## Canonical References

- Schema pattern (RLS, policies): `lib/db/schema/items.ts`
- DAL auth wrapper: `lib/dal/auth.ts`
- Org context setter: `lib/db/with-org-context.ts`
- Inventory DAL queries: `app/(dashboard)/inventory/queries.ts`
- Sales DAL queries + SalesError: `app/(dashboard)/sales/queries.ts`
- Item form (unified): `app/(dashboard)/inventory/item-form.tsx`
- Order form (line items + oversell): `app/(dashboard)/sales/order-form.tsx`
- BOM editor: `app/(dashboard)/inventory/bom-editor.tsx`
- Data table: `app/(dashboard)/inventory/data-table.tsx`
- Shared components: `components/sortable-header.tsx`, `components/field-skeleton.tsx`
- Format helpers: `lib/format.ts`
- API handler wrapper: `lib/api/handler.ts`
- Zod schemas: `lib/schemas/items.ts`, `lib/schemas/sales-orders.ts`, `lib/schemas/customers.ts`
