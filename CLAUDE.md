## Project

Multi-module ERP: inventory, manufacturing, sales, purchasing.
Android companion app lives at `~/Projects/erp-android`; check it when changing REST contracts or mobile workflows.

## Stack

Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui, TanStack Query, react-hook-form, Zod, Better Auth, pnpm

## Commands

- `pnpm dev` — start dev server with capped heap and source maps disabled
- `pnpm build` — production build (catch type errors)
- `pnpm lint` — ESLint
- `pnpm test` / `pnpm test:fast` — run all fast Playwright write-path smoke tests (dev server must be running)
- `pnpm test:fast:<domain>` — run one domain fast lane: `sales`, `inventory`, `purchasing`, `manufacturing`, `stocktake`
- `pnpm test:slow:<domain>` — run one slow lane: `sales`, `inventory`, `purchasing`, `manufacturing`, `stocktake`, `auth`
- `pnpm test:slow` / `pnpm test:e2e:slow` — run all slow serial operational Playwright stories
- `pnpm test:e2e:auth` — legacy alias for auth, invite, and team-access regressions
- `pnpm test:inventory` — run the fast inventory write-path smoke flow
- `pnpm test:sales` — run the fast sales write-path smoke flow
- `pnpm test:reconciliation` — run inventory reconciliation Playwright specs
- `pnpm db:local:setup` — auto-start local Postgres if needed, then create this worktree's local DB, `app_user`, env, and run migrations
- `pnpm dev:seed-user` — create/update the canonical local login (`test@test.com` / `TestPassword123!`) in `test-paonia-soil-co`, then idempotently load Paonia-style dev data
- `pnpm rotate:xero-token-key -- --environment production --apply` — operator-run Xero token encryption key rotation; see `docs/xero-security-evidence.md`
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
| Design system (tokens, color, type, density, status conventions) | `docs/design-system/01_DESIGN_SYSTEM.md` |
| API routes, mutations | `docs/api-patterns.md` |
| Schema, migrations, DAL | `docs/database.md` |
| Feature planning | `docs/architecture.md` |
| Linear workflow / PR tracking | `docs/linear-workflow.md` |
| ERP agent reactivation / overhead | `docs/erp-agent.md` |
| MRP-lite planning | `docs/planning.md` |
| Auth, roles, team invites | `docs/auth-team.md` |
| Production launch, auth protection, observability | `docs/production-ops.md` |
| Xero App Store / partner readiness | `docs/xero-partner-readiness.md` |
| Xero security evidence / key rotation | `docs/xero-security-evidence.md` |
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
- Design tokens: shadcn semantic classes for colors (`bg-primary`, `text-muted-foreground`, `border-border`); V2 raw tokens for spacing/sizing/type (`gap-(--space-3)`, `h-(--height-input-md)`, `text-[length:var(--text-sm)]`); `var(--color-*)` only for states shadcn doesn't model (`bg-[var(--color-accent-hover)]`). Never hardcode Tailwind colors. Sharp corners — no `rounded-*` except `rounded-full` on circular avatars/dots. Full spec: `docs/design-system/01_DESIGN_SYSTEM.md`.
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
- GitHub CI is a final clean-room gate, not the development test loop. Run the required local checks, record results in the PR, then add `ci:ready` only when the PR is ready for final verification.
- Create GitHub PRs ready for review, not as drafts.
- After opening or updating a PR, poll GitHub checks and review threads with `gh`/GitHub connector until all actionables are resolved.

## Linear Workflow

- Use Linear team `Erp` for ERP work. Read `docs/linear-workflow.md` before planning/importing work.
- Non-trivial code work should have one Linear issue before coding. Branches and PRs should include the issue ID.
- Existing open PR without an issue: create one Linear issue, label `GitHub PR`, attach the PR link, and avoid duplicates by searching the PR URL/number first.

## Coding Patterns

These are gotchas that have caused real bugs. Follow them exactly.

### ERP agent parked

Disabled; runtime barrel (`lib/db/schema/index.ts`) must not export `agent.ts`. Full state in `docs/erp-agent.md`.

### Paonia data loader

`scripts/load/`: generic engine in `engine/`, pilot-customer specifics in `paonia/`. Edits go in `paonia/`. Idempotent by signature; re-runs safe. Reset (`pnpm load:paonia:reset -- --confirm <org-slug>`) wipes ALL org-scoped data, not just loader rows; `--dry-run` previews counts.


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

### BOM consumption modes

BOM line scaling lives on `bom_revision_components`, not product identity. Use `per_output_unit` for linear ingredients, `per_batch` for process recipe inputs, and `per_group` for packaging/logistics groups. Snapshot the selected mode and calculated counts onto MO ingredient rows.
Estimated unit cost uses average per-output consumption for `per_batch` / `per_group`; MO planning uses operational policies.

```ts
{ consumptionMode: "per_batch", basisOutputQuantity: "9", batchScalingMode: "proportional" }
{ consumptionMode: "per_group", basisOutputQuantity: "50", groupRemainderPolicy: "ask" }
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

### MFA in test worktrees

`pnpm db:local:setup` writes `AUTH_MFA_DISABLED=1` to worktree `.env.local`; this bypasses MFA only in `development` / `test`. Do not set it in production.

### Team access presets

Team invites should choose a preset (`admin`, `ops_manager`, `ops_operator`, `sales_manager`, `sales_operator`, `view_only`) and convert it to matrix roles. Presets are derived from module access later; non-matching access shows as `custom`.

```ts
const assignedRoles = buildPresetAssignedRoles("sales_operator")
const presetKey = getDerivedAccessPresetKey(moduleAccess)
```

### Team invite acceptance

Invite-page sign-in is not done until the pending invite is accepted and the invited org is active. Existing users must join through `joinInviteIfNeeded()` after sign-in or matching-session Continue.

### Portal, dialog, dark surfaces, tooltips

All in `docs/ui-patterns.md`. Quick rules:
- Portal content: semantic surface/text tokens; never hardcode `dark` on individual dialogs/menus.
- Dialog widths: use the `size` prop on `DialogContent` / `AlertDialogContent`; never one-off `max-w-*`.
- Inverted surfaces: scope `className="dark"` on the container; never override `--sidebar-*` vars or hardcode colors.
- Tooltips: only for computed terms, jargon, alert indicators, disabled actions, or ambiguous icon-only buttons. One line ≤ 80 chars ending with a period; shared strings in `lib/tooltip-copy.ts`. No `cursor-help`.

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
- Scope picker is one dropdown: quick scopes (`all`, `material`, `product`) then category scopes. Category scopes encode item type + name: `buildStocktakeCategoryScope("material", "Soil")` → `"material:category:Soil"`.
- Stocktake product scopes include all made items, including non-sellable internal products.
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
- Sales allocation targets are two buckets: `sales_order_line` means unplanned residual demand; `sales_shipment_line` means planned shipment demand. Shipment create/edit/delete moves allocations between those buckets automatically.
- `partially_shipped` orders still block customer/product deletes while remaining demand exists.
- Sales Allocation tab is authoritative. Allocation demand is only confirmed/partial SO lines; draft SOs and draft MOs are ignored. MO supply is allocatable only after release.
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

### Tables

- **ERP tables**: AG Grid by default. Use `ERPDataGridList` for standard list pages, `ERPDataGrid` for read-only/detail grids, and `EditableLineDataGrid` for editable line editors.
- **shadcn Table**: only for narrow non-ERP layout tables or legacy code awaiting AG Grid migration.
- **Never** raw `<table>` / `<tr>` / `<td>` — bypasses theme tokens.

### Editable line-item forms

Dense AG Grid line editors use `EditableLineDataGrid` from `components/editable-line-data-grid.tsx`: React state owns row data, AG Grid owns editing (`field`/`valueSetter`/custom editors + `onCellValueChanged`), Zod/API validates final payload. Do not use RHF `useFieldArray` for AG Grid cells.

`EditableLineItems` / `EditableLineGrid` are legacy staging components. Do not use them for new ERP row editors; migrate existing use sites to `EditableLineDataGrid`.

### Shared dashboard list grids

List pages with search + add + optional bulk delete should use `ERPDataGridList` from `components/erp-data-grid-list.tsx`. Keep route table files to AG Grid columns + config only. Use `ERPDataGrid` directly only for custom list behavior such as persisted row drag.

```tsx
<ERPDataGridList columns={columns} rows={initialData} queryKey={["customers"]} addHref="/sales/customers/new" />
```

### Domain errors

API-facing business errors should extend `DomainError` from `lib/errors/domain-error.ts`. Use `errors` for field errors and `extra` for domain payloads.

```ts
export class SalesError extends DomainError<{ negativeStock: NegativeStockWarningPayload }> {}
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

### Xero token key rotation

Xero token encryption supports `XERO_TOKEN_ENCRYPTION_KEYS` plus active `XERO_TOKEN_ENCRYPTION_KEY_ID`. Rotate only with the operator script:

```bash
pnpm rotate:xero-token-key -- --environment production --apply
```

### Accounting PO imports

Official supplier-facing POs are accounting-provider-first. Import open provider POs into ERP for receiving; auto-sync may create missing materials. ERP PO delivery address is header-level only — do not add per-line delivery address controls.

Connector workflows use `/api/accounting/*` plus `lib/accounting/providers/*`; provider-specific OAuth/API mapping stays inside the adapter.

### Accounting audit events

Xero/accounting integration actions must write append-only `integrations.audit_events` rows through `lib/accounting/audit-events.ts`. Store only allowlisted/redacted metadata — never OAuth codes, tokens, cookies, raw request bodies, passwords, customer notes, or comments.

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

- Standard operation costs are BOM-revision costing rows, not workflow steps. Snapshot resource name/type/rate onto MOs; UI copy says “absorbed labor / operation cost,” not “actual labor.”
- Resource deletes must be blocked while referenced by BOM operation cost rows or MO operation snapshots.
- `items.expectedQty` is inbound supply, not a manual counter. Recompute from active released MOs + active ordered/partial POs after every status-changing write via `recomputeExpectedQty(tx, affectedItemIds)`. Batch-mode MOs contribute only unfinished planned output.
- Round derived quantities to 4 decimals before shortage checks or stock deltas. Use `multiplyQuantity(...)` — never raw JS float multiplication.
- MOs store `requestedQuantity` (user input) separately from `plannedQuantity` (batch-rounded). Forms edit `requestedQuantity`; execution math uses `plannedQuantity`.
- Manual batch MOs may use decimal batch counts; store integer execution rows and scale the final batch's planned output/ingredients.
- Release records ingredient demand for planning but does not reserve/commit ingredient stock. Picking is the stock-consuming step and may warn before negative stock or lot-eligibility overrides.
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
- If you touch one domain deeply, run that domain's slow spec too: `pnpm test:slow:<domain>`
  Domain slow lanes may include multiple story files: sales includes order, CRM, and partial-shipment stories; inventory includes item-form, cost-basis, and visibility stories.
- If you touch auth, invites, or team access, run `pnpm test:slow:auth`
  This command includes both `auth-security.spec.ts` and `team-management.spec.ts`.
- If you touch stock mutations, reservations, expected supply, inventory projections, or inventory-affecting API routes, run the affected slow spec(s) and then `pnpm verify:inventory`
- `pnpm verify:inventory` is the standard inventory integrity workflow: grep guards + projection diff for the current Playwright test org
- Do not run the whole slow lane locally unless the change is cross-domain or explicitly needs broad workflow verification
- PRs must have exactly the needed slow labels: `ci:slow:sales`, `ci:slow:inventory`, `ci:slow:purchasing`, `ci:slow:manufacturing`, `ci:slow:stocktake`, `ci:slow:auth`, `ci:slow:all`, or `ci:slow:none`. Missing labels fail the slow selector only after `ci:ready` is present; `ci:slow:none` is only for docs/CI-only changes and cannot be combined with other slow labels.
- Add the slow-selection label before `ci:ready`. Add `ci:ready` only after local validation is complete and documented in the PR body or a PR comment. If you push another commit after final CI, remove `ci:ready`, rerun local validation, then re-add it.
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
5. PR body or comment records the local validation commands and outcomes
6. PR has the correct `ci:slow:*` label(s), then `ci:ready` is added last for final GitHub verification
7. Branch pushed and ready PR opened with description; never leave PRs in draft because bots review only ready PRs
8. For UI changes: screenshot or description of what changed visually

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
- Order form (line items): `app/(dashboard)/sales/order-form.tsx`
- BOM editor: `app/(dashboard)/inventory/bom-editor.tsx`
- Data table: `app/(dashboard)/inventory/data-table.tsx`
- Shared components: `components/sortable-header.tsx`
- Format helpers: `lib/format.ts`
- API handler wrapper: `lib/api/handler.ts`
- Zod schemas: `lib/schemas/items.ts`, `lib/schemas/sales-orders.ts`, `lib/schemas/customers.ts`
