## Project

ERP system — clean rebuild. Inventory module first.
Old repo for reference: `/home/aeller/Projects/soil-erp`

## Stack

Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui, TanStack Query, react-hook-form, Zod, Better Auth, pnpm

## Commands

- `pnpm dev` — start dev server
- `pnpm build` — production build (catch type errors)
- `pnpm lint` — ESLint
- `pnpm test` — run Playwright e2e tests (dev server must be running)
- `pnpm test:inventory` — run the inventory e2e flow only
- `pnpm test:sales` — run the sales e2e flow only
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

### No local utility functions

Before defining a helper in a module, check `lib/format.ts` and `lib/schemas/shared.ts` first. Common helpers that exist there: `normalizeNumeric`, `normalizeMoney`, `parsePositive`, `getFieldArrayError`, `formatQuantity`, `formatDate`, `formatDateTime`, `formatPrice`. Never copy these into module files.

### Shared Zod validators

`nullableString`, `isValidIsoDate`, and `positiveDecimalString` live in `lib/schemas/shared.ts`. Import from there — never copy these into new schema files.

For `createInsertSchema` overrides (items.ts), use `nullableStringStrict` (without `.optional()`) to match Drizzle's type handling.

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

### Stocktake snapshot locking

Draft stocktake creation and item soft deletes must both lock affected `items` rows before checking draft references, so snapshot creation cannot race with delete.

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

Better Auth org member roles are the source of truth. Normalize legacy `"member"` as viewer access, guard dashboard reads in layouts/pages, and guard API reads/writes in routes.

```ts
await requireModuleReadAccess("sales")
await assertModuleWriteAccess("manufacturing", request.headers)
```

Auth helpers that read `headers()` must stay request-scoped, and `/org-setup` must auto-activate a signed-in user’s only org membership before showing org creation.

### Detail page tables

Always use shadcn `Table` / `TableHeader` / `TableBody` / `TableRow` / `TableCell` — never raw `<table>` / `<tr>` / `<td>`. Raw HTML tables bypass theme tokens and won't pick up future Table component changes.

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

Tests follow **serial domain stories** mirroring real user workflows. Keep each file self-contained so inventory and sales can run together or in isolation.

### Key rules

- `test.describe.configure({ mode: "serial" })` for tests that depend on each other
- Share data between tests via variables at the describe level, not helper functions
- All created items use `Date.now()` timestamps in names to avoid collisions
- After form submission, **query the database directly** via the `db` fixture to verify the row
- The `db` fixture uses the app role with RLS — same security path as the real app
- Dev server must be running (`pnpm dev`) before `pnpm test`

### Key files

- `test/e2e/fixtures.ts` — custom `test` with `db` fixture (Drizzle + Neon + RLS)
- `test/e2e/inventory-form.spec.ts` — serial inventory creation flow
- `test/e2e/sales-order.spec.ts` — serial sales flow with its own product/customer setup
- `test/global-setup.ts` — creates test user/org/unit, writes `.test-env.json`
- `test/helpers/api.ts` — authenticated fetch helpers

## PR Expectations

A change is "done" when:

1. `pnpm build` passes (no type errors)
2. `pnpm test` passes (no regressions)
3. `pnpm lint` passes
4. Branch pushed and PR opened with description
5. For UI changes: screenshot or description of what changed visually

## Multi-Agent Safety

When multiple agents may be working in the repo:

- Do not create, apply, or drop git stash
- Do not switch branches unless explicitly requested
- Scope commits to your own changes only
- Do not run `git add .` or `git add -A` — stage specific files
- Do not modify files outside the scope of your task
- Assume other agents may be working in parallel — keep unrelated files untouched

## Workflow

Use git worktrees for all feature work. Main stays clean — never commit feature work directly to main.

```bash
# 1. Create worktree (`.worktrees/` is gitignored)
git worktree add .worktrees/<branch-name> -b <branch-name>

# 2. Install deps (pnpm uses a shared store — fast, mostly symlinks)
cd .worktrees/<branch-name> && pnpm install

# 3. Work, commit, push
git push -u origin <branch-name>

# 4. Open PR via `gh pr create`

# 5. After merge, clean up both worktree and branch
git worktree remove .worktrees/<branch-name>
git branch -d <branch-name>
```

**Rules:**
- Always `pnpm install` in new worktrees — lockfile resolution differs per working tree
- Run `pnpm build` and `pnpm test` inside the worktree before pushing
- Clean up merged worktrees promptly: `git worktree list` to audit

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
