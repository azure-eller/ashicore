---
read_when:
  - Building or changing a card page (entity or document detail surface)
  - Adding draft/auto-save behavior to any editing surface
  - Tempted to write a new save controller or form state manager
owns: "the card draft lifecycle pattern: one engine, per-card adapters, bound fields"
---

# Card Kernel

> **Migration in progress — new cards use `lib/card-kernel/`.** The
> document-sync kernel ([`lib/card-kernel/kernel.ts`](../lib/card-kernel/kernel.ts),
> bound via [`use-card-kernel.ts`](../lib/card-kernel/use-card-kernel.ts))
> replaces the op-queue engine below: one draft document + the last
> server-confirmed document, dirt computed as a diff (never a queued log),
> validation with the route's own Zod schema (`blocked` is a visible
> outcome), full-doc responses rebased under still-dirty paths, idempotent
> create via client ids or stable idempotency keys, and optimistic
> concurrency (`expectedVersion` → 409 `{conflict, current}` → auto-rebase).
> Supplier, customer, item, purchase order, sales order, and manufacturing
> order cards are converted; the stocktake detail is the last op-queue
> surface to follow, then the old engine is deleted. **The op-queue engine
> is frozen: converting cards only, no new adopters.**

The stocktake detail is the one remaining op-queue card, built on
**one** draft lifecycle engine:
[`lib/hooks/use-draft-save-engine.ts`](../lib/hooks/use-draft-save-engine.ts).
New cards use the document-sync kernel above; either way, do not write a new
save controller — configure the engine.

## What the engine owns (never reimplement)

- The status machine: `idle → dirty → saving → saved | error`
- Debounced flushing with an op queue and monotonic revisions
- In-flight handling: edits during a save queue up and flush again after
- Draft→persisted identity: `create` on first save, `currentId` thereafter,
  `onPersisted` for URL reflection (`reflectPersistedCardUrlWithoutNavigation`)
- Failure safety: failed ops re-queue for retry; `flush()` deduplicates
- `mergeServerResult` for external refreshes (skipped while dirty/saving)

## What a card supplies (the adapter)

| Config | Job |
|---|---|
| `TOp` + `applyOp` | The card's edit vocabulary and pure reducer (stocktake count merges) |
| `create` / `save` | Persistence strategy: patch, snapshot, or hybrid — the card's choice |
| `mergeServerOwnedFields` | Conflict resolution: which server fields win, what survives when `hasNewerLocalEdits` |
| `coalesceOps` (optional) | Collapse queued ops (entity cards merge patches into one) |
| `isSaveable` | Gate flushing until the draft is creatable (e.g. has a name/product) |

Reference adapter: the stocktake detail (`stocktake-detail.tsx` —
count-update merges). The converted cards (item, supplier, customer, purchase
order, sales order, manufacturing order) configure the document-sync kernel
instead of the op-queue config above; the manufacturing order controller
(`use-manufacturing-order-draft-controller.ts`) is the reference kernel
adapter — a pure `derive` cascade (planned and remaining quantities),
`serialize`, idempotent client-id create, and `expectedVersion` concurrency.

Per-card domain logic is **supposed** to live in the adapter. Do not try to
genericize totals recomputation or ingredient alternates into the engine.

## Bound fields

Header fields bind by patch key instead of hand-wiring value/onCommit pairs —
[`components/card-page/bound-fields.tsx`](../components/card-page/bound-fields.tsx):

```tsx
const SupplierFields = createCardFields<PatchSupplier>(); // module scope

<SupplierFields.Provider values={display} commit={commitSupplierPatch}
                         readOnly={readOnly} idPrefix="supplier">
  <SupplierFields.Text name="paymentTerms" label="Payment terms"
                       tooltip={PAYMENT_TERMS_TOOLTIP} />
</SupplierFields.Provider>
```

Field names are typechecked against the patch type; ids are
`${idPrefix}-${kebab(name)}`. Commit semantics (trim, null for empty, no-op
skip, Enter-to-blur) come from `CommitInput` and stay uniform.

## Field errors (the path-keyed envelope)

Validation errors flow through one flat shape end to end:
`FieldErrorRecord` (`lib/api/field-errors.ts`) — dot-notation path →
messages, e.g. `{ "lines.3.unitCost": ["must be ≥ 0"] }`.

- **Server**: `apiHandler` already converts Zod issues into this shape
  (`fieldErrorsFromIssues`) and returns it as `errors` on 400 responses.
- **Client**: `apiJson` throws `ApiJsonError` carrying that record.
- **Engine**: on a failed flush, `getFieldErrors` (default: read
  `.errors`/`.fieldErrors` off the thrown error) populates
  `engine.fieldErrors`; it clears when the next flush starts. Client-side
  pre-validation joins the same channel by throwing
  `{ error, errors }` from the adapter's `create`/`save`.
- **Fields**: pass `errors={engine.fieldErrors}` to the bound-fields
  Provider — each field looks up its own path and renders invalid styling
  plus the message. Grid columns look up cells with
  `fieldErrorAt(fieldErrors, ["lines", rowIndex, key])` for
  `cellClassRules`/`tooltipValueGetter`.

Never convert the record into nested objects or build per-card error
plumbing — look paths up flat with `fieldErrorAt`.

## Header actions (duplicate / delete)

Duplicate and delete are one hook —
[`components/card-page/use-card-entity-actions.tsx`](../components/card-page/use-card-entity-actions.tsx).
It owns the ritual: **flush the engine → resolve the persisted id → call the
endpoint → invalidate → navigate**, plus the delete confirm dialog. Because
every action flushes first, a pending edit is saved (or its validation error
aborts the action) before the endpoint runs — never wire a header mutation
that skips the flush. Pass `hasPendingOps` so duplicate also refuses to copy
stale server state when a flush no-ops (unsaveable draft); delete ignores
pending edits by design.

```tsx
const actions = useCardEntityActions({
  entity: "supplier-action",
  getId: () => engine.currentId,
  flush: engine.flush,
  invalidateQueryKeys: [queryKeys.suppliers.root],
  delete: {
    label: "Delete supplier",
    run: (id) => deleteSupplier(id),
    navigateTo: "/purchasing/suppliers",
    confirm: { title: "Delete supplier?", description: <>…</> },
  },
});

<CardPageHeader menuActions={[printAction, actions.deleteAction]} … />
{actions.dialogs}
```

Bespoke workflows (PO email/bill dialogs, item-card clone with its custom
pending UI) stay hand-written — descriptors cover the uniform rituals only.

## Known limitations

- Engine saves carry no idempotency keys; a partial-failure retry can
  double-apply. Server endpoints behind `save` must tolerate retries. For the
  same reason `create` must be a single request — a follow-up fetch that fails
  would re-queue the ops and create the entity again on the next flush.
- Unmount discards queued (debounced) ops — there is no flush-on-unmount.
  Keep text-field debounces short enough that navigating away rarely loses an
  edit.
- Adapters must throw `Error` instances (`ApiJsonError` / `ApiClientError`,
  or `{ error, errors }` wrapped in one) — surfaces like the delete confirm
  dialog render `error.message`.
