## Project

Multi-module ERP: inventory, manufacturing, sales, purchasing.
Android companion app lives at `~/Projects/erp-android`; check it when changing REST contracts or mobile workflows.

## Stack

Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui, TanStack Query, react-hook-form, Zod, Better Auth, pnpm

## Commands

- `pnpm dev` — start dev server
- `pnpm build` — production build (catch type errors)
- `pnpm lint` — ESLint
- `pnpm test` / `pnpm test:fast` — run all fast Playwright write-path smoke tests (dev server must be running)
- `pnpm test:fast:<domain>` — run one domain fast lane: `sales`, `inventory`, `purchasing`, `manufacturing`, `stocktake`
- `pnpm test:slow:<domain>` — run one slow lane: `sales`, `inventory`, `purchasing`, `manufacturing`, `stocktake`, `auth`
- `pnpm test:e2e:agent:live` — run the opt-in live Anthropic agent smoke on `claude-haiku-4-5` by default
- `pnpm test:slow` / `pnpm test:e2e:slow` — run all slow serial operational Playwright stories
- `pnpm test:e2e:auth` — legacy alias for auth, invite, and team-access regressions
- `pnpm test:inventory` — run the fast inventory write-path smoke flow
- `pnpm test:sales` — run the fast sales write-path smoke flow
- `pnpm test:reconciliation` — run inventory reconciliation Playwright specs
- `pnpm db:local:setup` — auto-start local Postgres if needed, then create this worktree's local DB, `app_user`, env, and run migrations
- `pnpm dev:seed-user` — create/update the canonical local login (`test@test.com` / `TestPassword123!`) in `test-paonia-soil-co`, then idempotently load Paonia-style dev data
- `pnpm load:paonia` — load the Paonia pilot-customer catalog (units, items, BOMs, opening stock) into the resolved org. Supports `--org <ref>`, `--dry-run`, `--sales-2026`, `--customers-only`.
- `pnpm load:paonia:dry-run` — plan-only run of the Paonia loader; no writes
- `pnpm load:paonia:reset -- --confirm <org-slug>` — wipe all customer data in the resolved org. Requires the typed-back org slug; blocked in `NODE_ENV=production` unless `--i-know-what-im-doing`. Add `--dry-run` to preview row counts.
- `pnpm load:paonia:reload -- --confirm <org-slug>` — reset then load the Paonia catalog in one invocation
- `pnpm diff:projections -- --org-id <org-id>` — diff ledger-derived inventory projections for one org
- `pnpm verify:inventory-state` — diff projections for the current Playwright test org from `test/.test-env.json`
- `pnpm verify:inventory-kernel` — fail if bridge-only stock helpers leak into new call sites
- `pnpm verify:inventory` — run both inventory kernel grep guards and projection diff for the current test org
- `pnpm worktree:cleanup <branch>` — drop that worktree DB, remove the worktree, and stop shared Postgres when no linked worktrees remain
- `pnpm db:local:start` — optional manual Postgres start
- `pnpm db:local:stop` — optional manual Postgres stop
- `pnpm db:generate` — generate migration (use this, not `drizzle-kit generate` directly)
- `pnpm verify:migration-order` — verify migration journal/file ordering against fresh `origin/main`
- `pnpm db:check-migrations` — verify migration idempotency and ordering
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
| Linear workflow / PR tracking | `docs/linear-workflow.md` |
| ERP agent reactivation / overhead | `docs/erp-agent.md` |
| MRP-lite planning | `docs/planning.md` |
| Auth, roles, team invites | `docs/auth-team.md` |
| Production launch, auth protection, observability | `docs/production-ops.md` |
| Manufacturing orders | `docs/manufacturing.md` |
| Sales orders, customers, shipping | `docs/sales.md` |
| Purchasing, suppliers, receiving | `docs/purchasing.md` |
| Stocktakes, reconciliation | `docs/stocktakes.md` |
| Test scenario generation | `docs/testing-scenario-generation.md` |
| Xero integration, OAuth, push retry | `docs/xero.md` |

## Database Roles

- `DATABASE_URL` (owner) — migrations only (`drizzle-kit generate/migrate`)
- `DATABASE_URL_APP` (app_user) — app runtime, RLS enforced, no DDL

New schemas: grant `app_user` USAGE + CRUD on tables + sequences (see `docs/database.md`).
New tables: `.enableRLS()` + org-isolation `pgPolicy` in the Drizzle schema, plus `ALTER TABLE ... FORCE ROW LEVEL SECURITY` in the migration SQL (Drizzle has no `.forceRLS()` helper). Without `FORCE`, the owner bypasses RLS.
`system` schema keeps RLS off, but `app_user` still needs USAGE + CRUD on Better Auth tables.

## Critical Rules

- For code-changing work, NEVER edit files in the repo root checkout or on `main` unless the user explicitly asks for that. Use a dedicated git worktree.
- No hardcoded Tailwind colors — shadcn semantic tokens only
- API routes for all mutations — no server actions
- NEVER import db directly in pages, components, or API routes — use DAL
- NEVER use `drizzle push` — always `pnpm db:generate` + `pnpm drizzle-kit migrate` (CI rejects non-idempotent migrations)
- New migrations must be generated from fresh `origin/main`. Never insert/backdate migrations behind existing main migrations. Run `pnpm verify:migration-order` or `pnpm db:check-migrations`.
- After any production migration deploy, verify both: latest `drizzle.__drizzle_migrations` row matches the newest repo migration hash/timestamp, and production schema has the expected columns/types. Do not assume “migrations applied successfully” means historical migration ledger is clean.
- Icons: HugeIcons only (`@hugeicons/core` / `@hugeicons/react`) — never Lucide
- shadcn/ui style: `radix-nova` with `stone` base color. Check `components.json` for aliases.
- Run `pnpm build` after changes to catch type errors
- Run `pnpm test` after changes to catch regressions
- Inventory-affecting changes must run `pnpm verify:inventory` after the relevant Playwright tests refresh `test/.test-env.json`
- Create GitHub PRs ready for review, not as drafts.
- After opening or updating a PR, poll GitHub checks and review threads with `gh`/GitHub connector until all actionables are resolved.

## Linear Workflow

- Use Linear team `Erp` for ERP work. Read `docs/linear-workflow.md` before planning/importing work.
- Non-trivial code work should have one Linear issue before coding. Branches and PRs should include the issue ID.
- Existing open PR without an issue: create one Linear issue, label `GitHub PR`, attach the PR link, and avoid duplicates by searching the PR URL/number first.

## Coding Patterns

These are gotchas that have caused real bugs. Follow them exactly.

### ERP agent parked

The ERP agent is intentionally disabled. Read `docs/erp-agent.md` before reconnecting it. While disabled, keep `lib/db/schema/agent.ts` out of the runtime schema barrel; only the migration schema should export it.

### Paonia data loader

`scripts/load/` holds the pilot-customer loader. Engine in `engine/` is generic; data in `paonia/`. Edits go in `paonia/` — never put Paonia specifics in `engine/`.

```
scripts/load/
  paonia.ts                  # CLI entry
  engine/                    # generic: sync-units/items/boms/stock/customers/sales-orders, plan, apply, reset, report
  paonia/
    index.ts                 # LoaderConfig bundle
    units.ts | materials.ts | initial-stock.ts | constants.ts
    products/                # family-definitions, family-builder, sticker-builder, dynamic-dressing, standalone, bom-helpers, sku-builders
    sales-2026.ts | customers-2026.ts
```

Idempotency is signature-based (unit `name|size|uom`, item SKU/legacy SKU/name, BOM component+quantity hash, opening lot prefix `INIT-<sku>`, sales-order marker line in notes). Re-runs are safe and report unchanged rows.

Reset wipes ALL org-scoped data (not just loader-managed rows): `pnpm load:paonia:reset -- --confirm <org-slug>`. Add `--dry-run` to preview row counts. Blocked in `NODE_ENV=production` unless `--i-know-what-im-doing`.


### UI text minimalism

Don't write descriptive subtitles that restate what a heading, label, or button already says. Skip "Manage your X" / "Create a new Y" / "Update this Z" blurbs under page titles. Skip `<p>` descriptions under section headings when the heading is already clear. Skip `FieldDescription` text that repeats a field label. Headings, field labels, and button labels are enough.

```tsx
// ✗ Wrong — subtitle restates the heading
<h1>Edit Customer</h1>
<p className="text-sm text-muted-foreground">Update this customer's details.</p>

// ✓ Correct — the heading is enough
<h1>Edit Customer</h1>
```

### Date and datetime fields

Never use `<input type="date">`. Use `DatePicker` for date columns (`YYYY-MM-DD`) and `DateTimePicker` for timestamp columns (`YYYY-MM-DDTHH:mm:ss`). Both use string values matching Postgres types. See `docs/ui-patterns.md` for Controller examples.

### Date and time model

`*At` columns are exact instants: `timestamp("created_at", { withTimezone: true })`. Display operational instants with explicit `organizationTimeZone` via `formatDateTime(value, organizationTimeZone)`.

`*Date` columns are business dates: `date("ship_date", { mode: "string" })`. Display with `formatDate(value)` and never convert through JS `Date`.

Use `todayInTimeZone(organizationTimeZone)` for default business dates. Keep `new Date()` for true instant writes.

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

### Controlled text inputs (react-hook-form)

Controller text inputs should bind `value={field.value ?? ""}` so slow rerenders never drop typed text.

```tsx
<Input {...field} value={field.value ?? ""} />
<Textarea {...field} value={field.value ?? ""} />
```

### Variant names

Variants inherit `items.name` from their master. Never expose an editable variant name; show a read-only family name plus a derived title from `formatVariantDisplay()`.

```tsx
const title = formatVariantDisplay(masterName, variantAttrs, variantAxes)
```
### Standalone form pages

Create/edit pages use `CreatePageShell`, `CreatePageHeader`, `CreatePageGrid`, `CreateSection`, and optional `CreateSidebarCard` from `components/create-page.tsx`. Sections are card panels with `shadow-sm`; do not add repetitive section descriptions. Full markup in `docs/ui-patterns.md`.

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
Production Vercel aliases that can serve the UI must also be listed in `BETTER_AUTH_ALLOWED_HOSTS`; `proxy.ts` redirects page loads back to the canonical host.

Vercel preview deploys may fall back to `VERCEL_BRANCH_URL` / `VERCEL_URL` for the canonical app URL and auto-allow `*.vercel.app` in preview.

### Team access presets

Team invites should choose a preset (`admin`, `ops_manager`, `ops_operator`, `sales_manager`, `sales_operator`, `view_only`) and convert it to matrix roles. Presets are derived from module access later; non-matching access shows as `custom`.

```ts
const assignedRoles = buildPresetAssignedRoles("sales_operator")
const presetKey = getDerivedAccessPresetKey(moduleAccess)
```

### Team invite acceptance

Invite-page sign-in is not done until the pending invite is accepted and the invited org is active. Existing users must join through `joinInviteIfNeeded()` after sign-in or matching-session Continue.

### Portal theming

Portal components should use semantic background/text tokens on the portal content itself. Do not hardcode `dark` on individual dialogs or menus.

```tsx
<DialogContent className="bg-background text-foreground" />
<DropdownMenuContent className="bg-popover text-popover-foreground" />
```

### Dialog sizes

`DialogContent` and `AlertDialogContent` take a `size` prop. Default is `default` (~24rem) which is right for short confirmations. Dialogs that contain tables or wider content should declare a wider size explicitly rather than reaching for a one-off `className="max-w-*"`.

Variants: `sm | default | md | lg | xl | 2xl | 3xl | content`. `content` sizes to fit the content (`w-fit` capped at 90vw / 72rem) and is the right choice when the table inside determines width.

```tsx
// ✓ Correct — use the size prop to pick an appropriate width
<AlertDialogContent size="2xl">{/* shortage table */}</AlertDialogContent>
<DialogContent size="content">{/* width-driven by content */}</DialogContent>

// ✗ Wrong — one-off max-width override for a recurring width
<AlertDialogContent className="max-w-5xl">...</AlertDialogContent>
```

### Inverted / dark surfaces

To create a dark surface in light mode (or light in dark mode), scope `className="dark"` on the container. This is how shadcn does it on their create page. All children automatically pick up dark mode tokens through the `@custom-variant dark (&:is(.dark *))` rule — no manual CSS variable overrides needed.

```tsx
// ✓ Correct — dark class scopes all children to dark tokens
<Sidebar className="dark" />
<Card className="dark bg-card/90 shadow-xl backdrop-blur-xl" />

// ✗ Wrong — manually overriding CSS variables for each token
// ✗ Wrong — hardcoding colors like bg-[#303030] text-white
```

The app sidebar uses this pattern. Never replace it with manual `--sidebar-*` variable swaps or hardcoded colors.

### Tooltips

Use tooltips when they clarify computed terms, domain jargon, alert indicators, disabled/ambiguous icon-only actions, or compact form guidance that would otherwise add noisy helper text. Skip tooltips that only restate a plain-English label or obvious action. See `docs/ui-patterns.md` for the full ruleset.

Copy: one line, ≤ 80 chars, ends with a period, leads with the definition or formula. Don't restate the trigger label. Shared strings live in `lib/tooltip-copy.ts`.

Triggers: prefer the existing label, link, badge, or status marker. Standalone help icons are acceptable beside form labels when the guidance is useful but too distracting as visible helper text. No `cursor-help`.

```tsx
<SortableHeader column={column} label="Calculated Stock" tooltip="Stock - demand + expected - safety stock." />

// Non-sortable label
<TooltipHeader label="Available" tooltip="Reservable stock after demand and reservations." />

// Status pill or badge
<Tooltip>
  <TooltipTrigger asChild>
    <Badge variant="secondary">Not Sellable</Badge>
  </TooltipTrigger>
  <TooltipContent side="top">Item is hidden from sales orders.</TooltipContent>
</Tooltip>
```

### Route loading

All `loading.tsx` files re-export the shared skeleton. Don't write per-route loaders.

```tsx
export { default } from "@/components/dashboard-route-loading";
```

Parent layouts must stay light enough for child route loaders to stream. Don't put non-essential auth, DB, or preference reads in `app/layout.tsx` or dashboard layouts; those awaits block `loading.tsx` and make navigation look frozen.

### Postgres numeric fields

Postgres `numeric` columns are returned as strings by the driver. Always parse for display — use `formatQuantity()` from `lib/format.ts` or `parseFloat()`:

```ts
// ✓ Correct — parseFloat returns NaN for non-numeric strings, handles "0"
const qty = parseFloat(row.quantity);
if (!isNaN(qty)) { ... }

// ✗ Wrong — "0" is falsy, treats zero as missing
if (row.quantity) { ... }
```

API/DAL read queries must trim fixed Postgres scale before returning numeric strings. Use `trimScale()` / `trimScaleNullable()` from `lib/db/numeric.ts` in select projections and aggregate subqueries.

```ts
quantity: trimScale(lots.quantity).as("quantity"),
stock: trimScale(sql`COALESCE(SUM(${lots.quantity}), 0)`).as("stock"),
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

### Stocktakes

See `docs/stocktakes.md`. Critical:

- Saving counts updates snapshot rows only. Completion applies counted truth from current live stock; if live stock changed since snapshot, return `409` with a stale payload and require confirmation.
- Draft saves submit dirty lines only. Completing a dirty stocktake saves dirty counts first, then completes.
- Draft creation and item soft deletes must both lock affected `items` rows before checking draft references — snapshot creation must not race with delete.
- Scope picker is one dropdown: quick scopes (`all`, `material`, `product`, `subassembly`) then category scopes. Category scopes encode item type + name: `buildStocktakeCategoryScope("material", "Soil")` → `"material:category:Soil"`.
- Stocktake products are sellable final products only. Non-sellable products count as `subassembly` scope.
- Stocktakes snapshot active available lots into `stocktake_lot_items`; count lots when present and derive the parent item count from lot counts.
- Stocktake count fields autosave on blur. Do not add a separate Save button.

### Positive stock additions need cost

Any positive stock write that creates a lot must resolve a non-null `costPerUnit`. Materials convert `defaultPurchasePrice` from purchase-unit price to stock-unit cost using `purchaseToStockFactor`. Products derive cost from active BOM ingredients. If no cost basis exists, fail instead of creating a null-cost lot.

```ts
if (item.itemType === "material") {
  return resolveStockUnitCostFromDefaultPurchasePrice({
    defaultPurchasePrice: item.defaultPurchasePrice,
    purchaseToStockFactor: item.purchaseToStockFactor,
  })
}

return deriveBomIngredientCost(...)
```

### Lot numbers

Auto-created lots use the received business date as the lot number per product: `LOT-YYYY-MM-DD`, then `LOT-YYYY-MM-DD-01`, `LOT-YYYY-MM-DD-02`. Do not pass explicit loader-style lot numbers unless importing a source lot number that must be preserved.

### Material running stock cost

Materials keep `items.currentStockUnitCost` as the item-level stock-unit cost basis. Positive stock flows resolve cost in this order: explicit unit cost, `currentStockUnitCost`, then `defaultPurchasePrice / purchaseToStockFactor`. Opening balances seed it, purchase receipts weighted-average it, but correction flows and negative flows do not rewrite it.

```ts
if (explicitUnitCost != null) return explicitUnitCost
if (item.currentStockUnitCost != null) return item.currentStockUnitCost
return resolveStockUnitCostFromDefaultPurchasePrice(...)
```

### Sales

See `docs/sales.md` and `docs/planning.md`. Critical:

- Confirmed orders reserve the full order. Draft shipments plan only; shipped shipments consume/release. BOL state: `draft` = planned, `shipped` = final.
- `partially_shipped` orders still block customer/product deletes while remaining demand exists.
- Planning downstream rows are sales-order attribution paths only — use `salesOrderProductionDemandPaths`, never infer from `sourceRefs`, BOM revisions, or MOs. Direct SO demand stays flat on the card.
- Outbound shipment costs and customer freight recovery are margin-only. Editing them must not mutate inventory, Xero invoices, AP, GL, or BOL behavior.

### API error shape

- `{ error: string }` for general errors
- `{ error: string, errors: Record<string, string[]> }` for field-level errors
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

### Editable line-item forms

Mutable multi-control arrays use `EditableLineItems` from `components/editable-line-items.tsx`; it wraps `EditableLineGrid`, owns row chrome (drag handle, right-side remove, add button), and always creates one initial blank row. Pass only data columns/headers. Pass `isLineBlank` when the last row should append one blank row after it becomes nonblank; do not hand-code append/remove/reorder logic in row controls. Mark the first editable row control with `data-editable-line-primary` so Add row can focus it. Use flexible `minmax(..., fr)` tracks and a compact `minWidth`; use bare `EditableLineGrid` only for fixed editable grids like stocktake counts.

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

### Xero PO emails

Xero has no API endpoint to email purchase orders. Fetch the Xero-rendered PDF, send it through `sendTransactionalEmail`, and track `xero_po_email_status`.

### Playwright email outbox

Playwright email assertions must force outbox mode with the runtime flag file, not only process env. The dev server may inherit repo-root Resend vars before tests start.

```ts
fs.writeFileSync(EMAIL_OUTBOX_MODE_FLAG, "1")
if (!senderConfig || (await shouldWriteEmailOutbox())) await writeEmailOutbox(email)
```

### Observability hygiene

For production errors, use the Sentry skill. Source credentials from `~/.config/erp/sentry.env`; org/project are `7050technologies/javascript-nextjs`. Never commit or paste tokens.

Sentry and API error logging must redact secrets and user-entered notes. Never capture passwords, tokens, cookies, raw request bodies, or customer notes/comments by default.

Sentry Autofix PRs: use the PR body's packet as source of truth; push fixes to the existing branch; do not create a second PR unless necessary; preserve auth, org context, RLS, inventory ledger behavior, idempotency, and validation; add/update a regression test when practical; run `pnpm lint`, `pnpm build`, and targeted tests; update the PR body with root cause/fix/tests/risk notes; leave a summary comment; never auto-merge.

Keep Sentry `includeLocalVariables` local-only and opt-in. It opens the Node inspector and can explode Vercel cold starts.

```ts
delete event.request?.data
scope.setContext("request", { method, path })

const includeLocalVariables =
  process.env.NODE_ENV === "development" &&
  process.env.SENTRY_INCLUDE_LOCAL_VARIABLES === "1"
```

Cold-start debugging uses proxy-stamped request IDs. Grab `x-erp-request-id` from the HTML/API response, then find matching `[perf]` runtime logs. `rsc.root_layout.complete` logs `sinceProxyMs` for full server wall time, and API responses expose `Server-Timing` plus `x-erp-*` DB timing headers.

### Product deletes with active sales orders

Products referenced by active `draft`, `confirmed`, or `partially_shipped` sales orders cannot be soft-deleted. Block the delete in inventory instead of teaching the sales form how to recover missing draft products.

### Purchase receipts

PO receiving must create lots through the shared stock helper and write purchasing movement metadata.

```ts
await createPositiveLotAndMovementInTx(tx, {
  movementType: "purchase_received",
  referenceType: "purchase_order",
  referenceId: id,
})
```

### Inventory disposition

Lot balances are keyed by `organizationId + itemId + locationId + lotId + disposition`. Physical on-hand sums all dispositions; available/ATP/FIFO use only `available`. Receipts and MO output may create `available` or `blocked`. Release/block/reject/scrap must go through the inventory kernel and write `quality_disposition_events`.

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

### Manufacturing

See `docs/manufacturing.md`. Critical:

- `items.expectedQty` is inbound supply, not a manual counter. Recompute from active released MOs + active ordered/partial POs after every status-changing write via `recomputeExpectedQty(tx, affectedItemIds)`. Batch-mode MOs contribute only unfinished planned output.
- Round derived quantities to 4 decimals before shortage checks or stock deltas. Use `multiplyQuantity(...)` — never raw JS float multiplication.
- MOs store `requestedQuantity` (user input) separately from `plannedQuantity` (batch-rounded). Forms edit `requestedQuantity`; execution math uses `plannedQuantity`.
- Manual batch MOs may use decimal batch counts; store integer execution rows and scale the final batch's planned output/ingredients.
- Release may warn `409` + shortage payload and continue after `confirmShortage: true`. Completion hard-blocks on shortages before any stock mutation.
- Discrete orders pick every ingredient before `/complete`. Completion reuses persisted pick allocations — never deduct stock again. Detail/history pages link into `/execute`; the actual work lives in execution queue/detail routes.
- Batch-mode orders create execution batches on release, pick/complete one batch at a time, stay `released` until the final batch completes, and produce one lot per batch. Direct parent completion is invalid for batch-mode.
- BOM line alternates are draft-planning choices: choose the material before release; released execution only picks the chosen ingredient.
- `salesOrderLineId` is both a snapshot and a one-time claim. Linked `draft|released|completed` MOs block another linked MO for that sales line; only `cancelled` reopens it. On sales-line rewrites, re-link via `salesOrderId + productId` when possible, or preserve unchanged snapshots.
- New-MO product pickers list only products whose active BOM has at least one non-deleted ingredient.
- Items used by `draft` or `released` MOs cannot be soft-deleted (finished product OR ingredient snapshot row).

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

**Playwright e2e only** — no Vitest, no unit tests, no mocks. `e2e` means Playwright; `fast` and `slow` are the lanes.

Fast vs slow:
- Fast specs live in `test/e2e/fast/` and cover browser write paths only: fill form, submit, minimal success UI, DB assertions.
- Slow specs live in `test/e2e/slow/` and stay serial, operational stories: create, edit, transition, reload, and verify UI/API/DB/storage effects where relevant.
- Auth regressions live in `test/e2e/auth-security.spec.ts` and run separately from the fast/slow domain split.
- Keep slow specs rooted in normal operations. Only include guards/errors when they arise inside a realistic workflow.
- Use `test/e2e/slow/customer-crm.spec.ts` as the breadth model for slow stories.

Tests follow **serial domain stories** mirroring real user workflows. Keep each file self-contained so inventory and sales can run together or in isolation.

### Key rules

- Narrow domain changes: run `pnpm build`, `pnpm lint`, and the relevant `pnpm test:fast:<domain>` locally.
- Shared or cross-domain changes: run `pnpm build`, `pnpm lint`, and `pnpm test:fast` locally.
- Local fast lanes default to 2 Playwright workers. CI overrides this with `PLAYWRIGHT_FAST_WORKERS=4`.
- Live Anthropic agent coverage is opt-in: `pnpm test:e2e:agent:live`
- If you touch one domain deeply, run that domain's slow spec too: `pnpm test:slow:<domain>`
  Domain slow lanes may include multiple story files: sales includes order, CRM, and partial-shipment stories; inventory includes item-form, cost-basis, and visibility stories.
- If you touch auth, invites, or team access, run `pnpm test:slow:auth`
  This command includes both `auth-security.spec.ts` and `team-management.spec.ts`.
- If you touch stock mutations, reservations, expected supply, inventory projections, or inventory-affecting API routes, run the affected slow spec(s) and then `pnpm verify:inventory`
- `pnpm verify:inventory` is the standard inventory integrity workflow: grep guards + projection diff for the current Playwright test org
- Do not run the whole slow lane locally unless the change is cross-domain or explicitly needs broad workflow verification
- PRs must have exactly the needed slow labels: `ci:slow:sales`, `ci:slow:inventory`, `ci:slow:purchasing`, `ci:slow:manufacturing`, `ci:slow:stocktake`, `ci:slow:auth`, `ci:slow:all`, or `ci:slow:none`. Missing labels fail CI; `ci:slow:none` is only for docs/CI-only changes and cannot be combined with other slow labels.
- Use `ci:slow:all` for shared DB/schema/DAL/API/test infrastructure changes; it runs the full slow directory plus auth regressions.
- Failed scheduled slow runs open/update an investigation PR, comment with run details, and dispatch Claude Code with the run and artifact links. Treat those PRs as fix branches, not merge-ready reports.
- Do not add new one-off story suites outside `fast/`, `slow/`, or `auth-security.spec.ts`
- `test.describe.configure({ mode: "serial" })` for tests that depend on each other
- Share data between tests via variables at the describe level, not helper functions
- All created items use `Date.now()` timestamps in names to avoid collisions
- After form submission, **query the database directly** via the `db` fixture to verify the row
- The `db` fixture uses the app role with RLS — same security path as the real app
- Dev server must be running (`pnpm dev`) before `pnpm test`
- Canonical local login is `test@test.com` / `TestPassword123!`; `pnpm dev:seed-user` keeps this user on fake org `test-paonia-soil-co` and loads Paonia-style data.
- Playwright global setup still creates isolated generated test data in `test-org`.

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
2. `pnpm lint` passes
3. Relevant local fast/slow Playwright commands pass per the Testing rules
4. Inventory-affecting changes also pass `pnpm verify:inventory`
5. PR has the correct `ci:slow:*` label(s)
6. Branch pushed and ready PR opened with description; never leave PRs in draft because bots review only ready PRs
7. For UI changes: screenshot or description of what changed visually

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
- Worktrees fall back to the repo root `.env.local` for shared settings, but DB URLs must come from the worktree `.env.local` created by `pnpm db:local:setup`
- Local Postgres uses one shared server, but `pnpm db:local:setup` creates one database per worktree. Run `pnpm dev:seed-user` once per new worktree DB to load Paonia-style data into fake org `test-paonia-soil-co`.
- Do not use `gh pr merge --delete-branch` from a feature worktree. Merge first, then delete the remote branch and run `pnpm worktree:cleanup <branch>` separately from the repo root.
- After a PR merges, agents MUST run `pnpm worktree:cleanup <branch>` from the repo root to drop the local DB and remove the worktree. If no linked worktrees remain, shared local Postgres should be stopped too.
- Local Postgres data persists across `pnpm db:local:stop`; no reseed is required after a normal restart.

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
- Inventory DAL queries: `app/(dashboard)/inventory/queries.ts` (barrel) → bulk in `app/(dashboard)/inventory/queries/internal.ts`; per-feature splits in sibling files
- Sales DAL queries + SalesError: `app/(dashboard)/sales/queries.ts`
- Item form (unified): `app/(dashboard)/inventory/item-form/index.tsx` (with `dialogs/`, `fields/` siblings)
- Order form (line items + oversell): `app/(dashboard)/sales/order-form.tsx`
- BOM editor: `app/(dashboard)/inventory/bom-editor.tsx`
- Data table: `app/(dashboard)/inventory/data-table.tsx`
- Shared components: `components/sortable-header.tsx`
- Format helpers: `lib/format.ts`
- API handler wrapper: `lib/api/handler.ts`
- Zod schemas: `lib/schemas/items.ts`, `lib/schemas/sales-orders.ts`, `lib/schemas/customers.ts`
