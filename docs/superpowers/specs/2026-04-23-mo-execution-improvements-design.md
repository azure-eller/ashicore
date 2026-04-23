---
status: draft
owner: azure-eller
---

# MO Execution Screen Improvements

## Problem

The manufacturing order execution screen (`/manufacturing/orders/[id]/execute`) has four UX problems:

1. **Pick button noise.** Buttons read `Pick 12.5 kg` — the quantity is already in the card subtitle, so the label duplicates information.
2. **Batch picking is ungated.** In batch-mode execution, users can pick ingredients before pressing "Start Batch N". Picking should be blocked until the current batch is actually started.
3. **Completion card eats screen space.** The actual-output + per-ingredient actuals form is always visible at the bottom, even before any picking has happened. It should be a dialog triggered by a "Complete Order" / "Complete Batch" button.
4. **Pick errors are off-screen.** Pick failures (e.g. insufficient stock) set `actionError` which renders inside the completion card at the very bottom of the screen. On a tall ingredient list, the error is not visible without scrolling.

Goals:

- Declutter the screen so the ingredients list is the focus.
- Make batch lifecycle (start → pick → complete) enforced, not discoverable.
- Show pick errors in the same visual area as the pick action.

Non-goals:

- No changes to the underlying API routes or DAL.
- No changes to the discrete-mode picking flow besides the button label.
- No changes to shortage warnings at release time — this spec is execution-only.

## Scope

Single file: `app/(dashboard)/manufacturing/manufacturing-execution.tsx`.

The existing types (`ManufacturingExecutionDetail`) and mutations (`pickMutation`, `startBatchMutation`, `completeOrderMutation`, `completeBatchMutation`) stay as-is. Only the rendering and local state layer changes.

## Design

### Pick button label

Replace the conditional that appends quantity + unit:

```tsx
// before
{isPicked ? "Picked" : pickMutation.isPending ? "Picking..." : `Pick ${formatQuantity(ingredient.remainingQuantity)} ${ingredient.unitName}`}

// after
{isPicked ? "Picked" : pickMutation.isPending && pickingIngredientId === ingredient.id ? "Picking..." : "Pick"}
```

`pickingIngredientId` is a new local state value (see "Pick error placement" below) that also scopes the "Picking..." label to the actual ingredient being picked, so the other buttons don't all flicker at once.

### Batch-mode pick gating

Picking is allowed only when:

- Manufacturing mode is `discrete`, OR
- Manufacturing mode is `batch` AND `execution.currentBatch` exists AND `execution.currentBatch.status === "in_progress"`.

Derived at the top of the component:

```tsx
const canPick =
  execution.manufacturingMode === "discrete" ||
  execution.currentBatch?.status === "in_progress";
```

The `disabled` prop on each pick button gains this check:

```tsx
disabled={isPicked || !canPick || pickMutation.isPending || isCompleting}
```

Under the "Ingredients" heading, when `manufacturingMode === "batch" && !canPick && execution.currentBatch`, render a small hint:

```tsx
<p className="text-sm text-muted-foreground">
  Start batch {execution.currentBatch.batchNumber} before picking.
</p>
```

When all batches are complete (`!execution.currentBatch`), no hint is needed — the existing "All batches are complete." message in the Batch Progress card already covers that case.

### Completion dialog

Delete the `CompletionCard` component and the `ingredient.pickedQuantity`-keyed actuals state that lives in it. Replace with a bottom action row:

```tsx
<div className="flex justify-end">
  <Button
    size="lg"
    disabled={!execution.canComplete || isCompleting}
    onClick={() => setCompleteOpen(true)}
  >
    {execution.manufacturingMode === "batch" ? "Complete Batch" : "Complete Order"}
  </Button>
</div>
```

The dialog is a new inline component `CompleteDialog` receiving: `open`, `onOpenChange`, `isBatchMode`, `defaultActualQuantity`, `ingredients`, `isCompleting`, `error`, `onSubmit`.

**Dialog body (discrete mode):**

- Actual Output input only.
- `DialogContent size="default"`.

**Dialog body (batch mode):**

- Actual Output input.
- Per-ingredient actual consumed quantities (same fields currently in `CompletionCard`: each shows planned/picked, has an input defaulting to picked).
- `DialogContent size="lg"`.

**Dialog footer:** Cancel + Confirm. Confirm fires the existing mutation; on success the parent clears `completeOpen` via `onOpenChange`. On error, the dialog stays open and renders `error` inline above the footer.

**State reset:** the dialog's own local state (`actualQuantity`, `actualsById`) resets when `open` flips from `false` → `true`, using `useEffect` keyed on `open` and `defaultActualQuantity`. This replaces the current `key={actualQuantityResetKey}` remount trick.

### Pick error placement

Replace the single `actionError` state with three scoped error slots:

```tsx
const [pickError, setPickError] = useState<{ id: string; message: string } | null>(null);
const [pickingIngredientId, setPickingIngredientId] = useState<string | null>(null);
const [startBatchError, setStartBatchError] = useState<string | null>(null);
const [completeError, setCompleteError] = useState<string | null>(null);
```

Mutation wiring:

- `pickMutation.mutate(id)` → `onMutate` sets `pickingIngredientId = id` and clears `pickError`; `onSuccess` clears both; `onError` sets `pickError = { id, message }`.
- `startBatchMutation` → `onMutate` clears `startBatchError`; `onError` sets it.
- `completeOrderMutation` / `completeBatchMutation` → `onMutate` clears `completeError`; `onError` sets it. Dialog reads `completeError` via the `error` prop.

Rendering:

- `pickError` renders **inside the ingredient card that failed**, below the main row:
  ```tsx
  {pickError?.id === ingredient.id && (
    <p className="text-sm text-destructive">{pickError.message}</p>
  )}
  ```
- `startBatchError` renders inside the Batch Progress card, below the Start Batch button row.
- `completeError` renders inside the dialog above the footer.

No global `actionError` remains — each action's error lives next to its trigger.

### Data flow summary

1. Render order (top to bottom) unchanged: header → Order Summary card → Batch Progress card (if batch) → Ingredients section → Complete button.
2. Ingredients card gains conditional disabled + conditional inline error row.
3. Completion UI moves from an always-visible card to `Dialog` gated by a trigger button.

No API changes. No query changes. No new props on `ManufacturingExecution`.

## Error handling

- Insufficient stock on pick: backend returns 4xx with `{ error }`. Existing `pickMutation.onError` path still fires; the message now lands on the failing ingredient's card instead of at the bottom of the screen.
- Start-batch failure: message appears inside the batch card.
- Complete failure: message appears inside the dialog. Dialog does not auto-close, so the user can correct actuals and retry.

## Testing

Existing Playwright coverage for manufacturing execution must continue to pass. Specifically:

- `test/e2e/slow/manufacturing-*.spec.ts` — any spec that picks ingredients or completes orders. Button text assertions may need updating from `Pick N unit` to `Pick`, and completion flows may need to open a dialog before clicking Confirm.
- Batch execution flow: verify that a pick attempt while `currentBatch.status === "pending"` finds a disabled button (no network call).

Run after implementation:

- `pnpm build`
- `pnpm lint`
- `pnpm test:e2e:slow` for manufacturing (domain-specific)
- `pnpm verify:inventory` (picks write stock movements, so inventory projection guard applies)

## Out of scope / deferred

- Toast infrastructure (Sonner). Mentioned during brainstorming; not needed — inline errors cover the visibility problem. Revisit if users ever ask for ephemeral success confirmations.
- Collapsible per-ingredient actuals in the dialog. User explicitly wants the full list visible in batch mode.
- Discrete-mode per-ingredient actuals. Removed from the UI; backend still accepts `ingredientActuals`, so we send an array where each entry defaults `actualConsumedQuantity = pickedQuantity` for each ingredient silently.
