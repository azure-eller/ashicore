## Project

ERP system — clean rebuild. Inventory module first.
Old repo for reference: `/home/aeller/Projects/soil-erp`

## Stack

Next.js (App Router), Drizzle ORM, Neon Postgres, shadcn/ui, TanStack Query, react-hook-form, Zod, Better Auth, pnpm

## Commands

- `pnpm dev` — start dev server
- `pnpm build` — production build (catch type errors)
- `pnpm lint` — ESLint
- `pnpm test` — run all tests (Vitest)
- `pnpm test:ui` — run UI contract tests only
- `pnpm drizzle-kit generate` — generate migration from schema changes
- `pnpm drizzle-kit migrate` — apply migrations

## Documentation Structure

This repo has two layers of documentation:

**AGENTS.md** (this file) — quick reference. Contains the rule and the correct code. Every agent reads this at session start.

**Domain docs** (`docs/`) — deep reference. Contains the why, the exceptions, and the canonical examples. Read the relevant doc before working in that area.

When you discover a new pattern or gotcha:
1. Add the **rule + correct code** to the Coding Patterns section of this file
2. Add the **full explanation** to the relevant domain doc below
3. New docs must have `read_when:` YAML frontmatter listing when to load them

| Task area | Read |
|-----------|------|
| Forms / form fields | `docs/references/field-example.md`, `docs/references/react-hook-form-example.md` |
| UI, components, layout | `docs/ui-patterns.md` |
| API routes, mutations | `docs/api-patterns.md` |
| Schema, migrations, DAL | `docs/database.md` |
| Feature planning | `docs/architecture.md` |
| Test scenario generation | `docs/testing-scenario-generation.md` |

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

Postgres `numeric` columns are returned as strings by the driver. Always parse:

```ts
// ✓ Correct — parseFloat returns NaN for non-numeric strings, handles "0"
const qty = parseFloat(row.quantity);
if (!isNaN(qty)) { ... }

// ✗ Wrong — "0" is falsy, treats zero as missing
if (row.quantity) { ... }
```

### API error shape

- `{ error: string }` for general errors
- `{ errors: Record<string, string[]> }` for Zod field-level errors

### Soft deletes

Master data uses soft delete: `deletedAt = new Date()`. Filter with `isNull(items.deletedAt)`. Never hard-delete master data via API.

## Testing

### Test lanes

| Lane | Command | What it tests |
|------|---------|---------------|
| All tests | `pnpm test` | Everything |
| UI contracts | `pnpm test:ui` | Component behavior in JSDOM (no browser) |

### What to test

- **Schema tests**: Zod validation edge cases, cross-field refinements, nullable field handling
- **UI contract tests**: Form submission payloads, mode switching, validation display, error rendering, disabled states
- **API contract tests**: Route handler input/output shapes, error responses, status codes

### UI contract test pattern

Use React Testing Library with JSDOM. No real browser needed:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

test("submit button triggers form submission", async () => {
  const user = userEvent.setup();
  render(<MyForm />);
  await user.click(screen.getByRole("button", { name: /save/i }));
  expect(mockFetch).toHaveBeenCalled();
});
```

### When to add tests

- New form or form field → UI contract test for submit payload and validation
- New API route → API contract test for input/output shapes
- New schema with cross-field validation → Schema test for edge cases
- Bug fix → Regression test that fails without the fix

### Edge case thinking checklist

When writing tests, run through these questions for every feature you touch:

**State transitions**: For every toggle, mode switch, or state change in the UI:
- What happens to OTHER fields when this state changes?
- What does the **submit payload** look like after the state change? (Don't just check the UI — inspect the data.)
- What values from the previous state are still in the form data?

**Validation boundaries**: For every validation rule or visual warning:
- If the UI shows a warning (e.g. "percentages should sum to 100%"), does the schema actually **block submission**? Or can the user submit invalid data?
- Test the boundary: just under, exactly at, just over the limit.

**Cross-feature workflows**: Don't test the feature in isolation. Ask:
- What happens upstream? (What data feeds into this form?)
- What happens downstream? (What consumes the output of this form?)
- Test the specific combinations that matter: e.g. product with BOM vs without, quantity mode vs percentage mode, nested BOM vs flat.

**Submit payload verification**: For EVERY form test, verify the actual payload sent to the API, not just the visible UI state. The UI can look correct while the data underneath is wrong.

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

Use git worktrees for all feature work. Worktree directory: `.worktrees/`

After exiting plan mode and before making any changes:
1. Create a worktree: `git worktree add .worktrees/<branch-name> -b <branch-name>`
2. Work inside the worktree: `cd .worktrees/<branch-name>` and run `pnpm install`
3. Implement the changes and commit them
4. Push the branch: `git push -u origin <branch-name>`
5. Create a PR to merge back into main on GitHub
6. After merge, clean up: `git worktree remove .worktrees/<branch-name>`

## Canonical References

- Schema pattern (RLS, policies): `lib/db/schema/items.ts`
- DAL auth wrapper: `lib/dal/auth.ts`
- Org context setter: `lib/db/with-org-context.ts`
- Inventory DAL queries: `app/(dashboard)/inventory/queries.ts`
- Item form (unified): `app/(dashboard)/inventory/item-form.tsx`
- BOM editor: `app/(dashboard)/inventory/bom-editor.tsx`
- Data table: `app/(dashboard)/inventory/data-table.tsx`
- API handler wrapper: `lib/api/handler.ts`
- Zod schemas: `lib/schemas/items.ts`
