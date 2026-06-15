---
read_when:
  - Building or changing a card page (entity or document detail surface)
  - Adding draft/auto-save behavior to any editing surface
  - Tempted to write a new save controller or form state manager
owns: "the card draft lifecycle pattern: one document-sync kernel, per-card serializers, bound fields"
---

# Card Kernel

Every card page (supplier, customer, item, purchase order, sales order,
manufacturing order) is built on **one** document-sync kernel:
[`lib/card-kernel/kernel.ts`](../lib/card-kernel/kernel.ts), bound to React
via [`use-card-kernel.ts`](../lib/card-kernel/use-card-kernel.ts), with
dot-path utilities in [`paths.ts`](../lib/card-kernel/paths.ts). Do not write
a new save controller — configure this one.

## The model: remember what you want, not what you did

The kernel keeps two documents and a computed diff:

- `draft` — the document the user sees, mutated only through `update()`
- `serverDoc` — the last server-confirmed document (always a deep clone:
  grids mutate row objects in place, and an aliased row would change both
  sides of the diff at once)
- **dirt is always `diffDocs(derive(serverDoc), draft)`** — a recomputable
  fact, never a queued log of edits. Failed saves need no re-queue
  machinery: nothing was consumed, so the diff still shows the dirt.

Collections (`lines`, `additionalCosts`, `ingredients`, `contacts`,
`variants`) diff by **row id**, never array index: a row on one side only is
whole-row dirt, shared rows diff per leaf, and changed relative order is
`$order` dirt. Payload rows carry their row id — existing rows send their DB
id, new rows mint a uuid the server persists — so identity survives
delete-and-reinsert reconciliations and the rebase matches rows exactly.

## The flush

`flush()` (debounced after every `update()`) is the whole save protocol:

1. **Serialize** the draft through the card's `serialize`, which also records
   an index↔rowId alias map for every emitted collection row.
2. **Validate with the route's own Zod schema** (the same module the API
   parses). Invalid ⇒ outcome `blocked` with path-keyed `fieldErrors` —
   visible, nothing sent, never silent.
3. Payload-clean ⇒ `saved` (status lives in payload space: a blank grid row
   is doc-dirty but payload-clean, so the pill says Saved and nothing fires).
4. Send with a **retry-stable idempotency key** and the expected `version`;
   create is the first save (client-generated ids or server-side
   idempotency replay make a retried create the same create).
5. **Rebase** the full-doc response: `draft = response + reapply still-dirty
   paths` — edits made during the flight plus pre-flight dirt the payload
   never carried (blank rows), computed from the serializer's own alias map.
6. 400 ⇒ translate the server's index-keyed error paths through the alias
   map so errors land on the row the validator actually saw. 409 with
   `{conflict, current}` ⇒ rebase onto `current` and retry once; surface a
   conflict only when a locally-dirty path changed on the server.
   Network/5xx ⇒ backoff (1s/4s/10s) under the same idempotency key.

`flush()` resolves with an outcome — `saved | blocked | conflict | failed` —
and callers must branch on it (`useCardEntityActions` does; status
transitions do). It never throws and never silently no-ops.

Kernels live **outside React** in a module registry keyed by entity id:
unmount can't drop a debounced edit, and payload-dirty kernels flush on
`pagehide` with `keepalive` fetches. A dirty draft is also mirrored to
`sessionStorage` (keyed by entity, version-gated, 5-minute TTL) on every edit
and on the `pagehide` flush; on the next mount the kernel rebases that draft
onto the current server doc and re-flushes, so a reload — or an unload whose
keepalive flush was skipped or dropped — restores the unsaved edits. The
mirror clears on the next clean save.

## What a card supplies

| Config | Job |
|---|---|
| `serialize` | Draft → the route's payload shape + the index↔rowId alias map (built in the same loop that emits each row) |
| `schema` | The route's own Zod schema (imported from `lib/schemas/*`) |
| `derive` | Pure, idempotent cascade math (SO totals, MO quantity scaling). Runs on both diff sides and after every rebase |
| `collections` | Which doc arrays diff by row id, and the id key |
| `create` / `update` | Thin `apiJson` adapters (the thrown `ApiJsonError` carries the body the kernel reads for 409s) |
| `readVersion` / `readId` / `readConflictDoc` | Version field, server-assigned ids, conflict-body conversion when the API doc shape differs from the draft shape |
| `onServerDoc` / `onCreated` | Query-cache write-through; URL reflection on first persist |

A converted controller is the config plus thin `update(fn)` helpers — no op
vocabulary, no reducers, no coalescing, no merge functions.

## Optimistic concurrency

The six card entities carry a `version` column. Card saves send
`expectedVersion`; a stale save gets **409 `{error, conflict: true, current:
<full doc>, requestId}`** and the kernel auto-rebases. Absent
`expectedVersion` preserves last-write-wins — the Android app never sends it.
Scope note: workflow endpoints (ship, receive, pick, complete) do not bump
`version`; the column guards the card-edit surface. Server-side reconciliation
guards (shipped/received-line protection) cover the rest.

A fresh server doc handed in on mount or after navigation (`adoptServerDoc`)
is reconciled the same way: the kernel ignores a staler `version` and, while
the draft is clean, re-adopts the incoming doc wholesale. For that to defeat
stale overwrites the doc must be current, so card reads are uncached — client
`apiJson` GETs are `no-store` and the item-card detail routes render
dynamically (`force-dynamic` + `noStore`) instead of serving a cached
snapshot.

## Bound fields

[`components/card-page/bound-fields.tsx`](../components/card-page/bound-fields.tsx)
(`createCardFields<TPatch>()`): one Provider per card (values + commit +
readOnly + idPrefix + errors), each field binds by patch key. Field errors
resolve by path via `fieldErrorAt`; grid cells look up
`["lines", row.id, key]` directly.

## Card actions

[`card-action-boundary.ts`](../components/card-page/card-action-boundary.ts)
owns the card action boundary. Every action declares two independent facts:

| Axis | Values | Meaning |
|---|---|---|
| `flushPolicy` | `none`, `requireSaved`, `tolerateBlocked` | Whether the draft must be flushed before the action runs, and how validation-blocked drafts are handled. |
| `requiresPersistedId` | `true`, `false` | Whether the action needs an existing server row id. |

`runCardAction` / `resolveCardActionId` apply those facts in one order:
**flush according to policy → resolve persisted id if required → endpoint →
invalidate/navigate**. `requireSaved` proceeds only on `saved` and surfaces
blocked field errors or failure messages. `tolerateBlocked` allows delete/close
style actions to discard an invalid draft, but still aborts `failed` and
`conflict`. `none` is for actions that operate on current server truth and do
not read the unsaved draft.

Do not disable or hide actions on `dirty`, `saving`, or `failed` once the card
has a persisted id. The card is the draft: the control remains reachable, and
the action boundary decides whether to flush first, tolerate validation
failure, or run without flushing. Pure reachability gates based on a persisted
id, permission, already-running mutation, or terminal business state are fine.
Opening a dialog that refetches persisted server state is also reachable: it
runs a best-effort flush first so a valid dirty draft is persisted before the
refetch, but an unsavable (blocked/failed) draft is tolerated and the dialog
still opens on persisted state.

Examples:

- Duplicate, clone, create-bill, stock adjustment, recipe save, and operations
  save are `requireSaved + requiresPersistedId`.
- Create-MO, receive, and complete dialogs that refetch persisted server state
  run a best-effort flush before opening (a valid dirty draft is saved so the
  refetch reflects it; an unsavable draft still opens on persisted state) — they
  are never blocked on draft state.
- Delete and close are `tolerateBlocked + requiresPersistedId` when they discard
  the draft rather than copying it.
- Manual status overrides and bill-management views that act on server state are
  `none + requiresPersistedId`.
- A never-persisted draft may hide persisted actions or show them disabled with
  a reason; that is reachability, not a save-state gate.

## Known limitations

- Conflicts are detected at save time only (no live push); after a surfaced
  conflict, saving again overwrites — warn-once, then user intent wins.
- The `pagehide` keepalive flush caps bodies at 64KB; an enormous document
  may skip the unload flush, but the `sessionStorage` reload bridge still
  restores and re-flushes the draft on the next mount (strictly better than
  the guaranteed loss it replaced).
- Stocktake counts are a fire-and-forget batch queue (sequential PUTs in
  `stocktake-detail.tsx`), not a document draft — the kernel deliberately
  does not apply there.
