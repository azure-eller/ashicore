# MO Execution Screen UX Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten the Pick button label, gate batch-mode picking behind "Start Batch", move completion into a dialog, and place pick errors next to the failing ingredient instead of the bottom of the screen.

**Architecture:** Pure client-side refactor of `app/(dashboard)/manufacturing/manufacturing-execution.tsx`. No API, schema, or DAL changes. Completion UI becomes a `Dialog` triggered by a single button. Error state is split per-action and rendered inline next to each action's trigger.

**Tech Stack:** Next.js App Router, React, shadcn/ui (`Dialog`, `Button`, `Input`, `Card`), TanStack Query mutations.

**Spec:** `docs/superpowers/specs/2026-04-23-mo-execution-improvements-design.md`

---

## File Structure

Single file touched for implementation:
- **Modify:** `app/(dashboard)/manufacturing/manufacturing-execution.tsx`

Test files updated to match the new DOM:
- **Modify:** `test/e2e/fast/manufacturing-write.spec.ts` (pick button text, dialog open/confirm)
- **Modify:** `test/e2e/slow/manufacturing-order.spec.ts` (same — discrete mode in this one)

No new files. No new dependencies.

---

## Task 1: Refactor error state and scope pick-in-flight to a single ingredient

**Files:**
- Modify: `app/(dashboard)/manufacturing/manufacturing-execution.tsx`

**Context:** Today, every mutation writes to one shared `actionError` string and `pickMutation.isPending` makes *all* pick buttons say "Picking..." at once. After this task, each action has its own error slot and only the clicked pick button shows the loading label.

- [ ] **Step 1.1: Replace actionError state with scoped slots**

At the top of `ManufacturingExecution`, replace the existing `actionError` declaration with:

```tsx
  const [pickError, setPickError] = useState<{ id: string; message: string } | null>(null);
  const [pickingIngredientId, setPickingIngredientId] = useState<string | null>(null);
  const [startBatchError, setStartBatchError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
```

Delete the old line:

```tsx
  const [actionError, setActionError] = useState<string | null>(null);
```

- [ ] **Step 1.2: Wire startBatchMutation to startBatchError**

Change the `onMutate` and `onError` handlers on `startBatchMutation` (roughly lines 200-207):

```tsx
    onMutate: () => {
      setStartBatchError(null);
    },
    onSuccess: refreshData,
    onError: (error) => {
      setStartBatchError(error.message);
    },
```

- [ ] **Step 1.3: Wire pickMutation to pickError and pickingIngredientId**

Change `pickMutation` (roughly lines 209-233). The `mutationFn` signature becomes richer because we need to know which ingredient we are picking in `onMutate` and `onError`:

```tsx
  const pickMutation = useMutation({
    mutationFn: async (ingredientId: string) => {
      const response = await fetch(
        `/api/manufacturing-orders/${execution.id}/ingredients/${ingredientId}/pick`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("manufacturing-pick", {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({}),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to pick ingredient.");
      }
      return ingredientId;
    },
    onMutate: (ingredientId) => {
      setPickingIngredientId(ingredientId);
      setPickError((prev) => (prev?.id === ingredientId ? null : prev));
    },
    onSuccess: async (_data, ingredientId) => {
      setPickingIngredientId(null);
      setPickError((prev) => (prev?.id === ingredientId ? null : prev));
      await refreshData();
    },
    onError: (error, ingredientId) => {
      setPickingIngredientId(null);
      setPickError({ id: ingredientId, message: error.message });
    },
  });
```

- [ ] **Step 1.4: Wire completeOrderMutation and completeBatchMutation to completeError**

On `completeOrderMutation` (roughly lines 235-262) change:

```tsx
    onMutate: () => {
      setCompleteError(null);
    },
    onSuccess: refreshData,
    onError: (error) => {
      setCompleteError(error.message);
    },
```

Apply the same change to `completeBatchMutation` (roughly lines 264-298).

- [ ] **Step 1.5: Verify build still compiles (no consumers yet)**

```bash
pnpm build 2>&1 | tail -20
```

Expected: build succeeds. There will be one unused-warning on `actionError` if the old reference in `CompletionCard` still exists — that gets removed in Task 4. If the build fails because `actionError` is referenced below, ignore it and move on — Task 4 deletes the reference. If the build fails for any other reason, stop and investigate.

- [ ] **Step 1.6: Commit**

```bash
git add app/\(dashboard\)/manufacturing/manufacturing-execution.tsx
git commit -m "refactor: scope mo execution error state per action"
```

---

## Task 2: Shorten Pick label and gate picking behind Start Batch

**Files:**
- Modify: `app/(dashboard)/manufacturing/manufacturing-execution.tsx`

**Context:** Today the Pick button label is `Pick 12.5 kg`. We change it to `Pick` — the remaining quantity is already in the card subtitle. In batch mode, picking is disabled until `currentBatch.status === "in_progress"`.

- [ ] **Step 2.1: Derive canPick**

Just below the existing `defaultActualQuantity` line in `ManufacturingExecution`:

```tsx
  const canPick =
    execution.manufacturingMode === "discrete" ||
    execution.currentBatch?.status === "in_progress";
```

- [ ] **Step 2.2: Update the Pick button label and disabled state**

Inside the ingredients `.map((ingredient) => ...)` render (roughly lines 441-479), change the `Button` to:

```tsx
                    <Button
                      variant={isPicked ? "outline" : "default"}
                      disabled={
                        isPicked ||
                        !canPick ||
                        pickMutation.isPending ||
                        isCompleting
                      }
                      onClick={() => pickMutation.mutate(ingredient.id)}
                    >
                      {isPicked
                        ? "Picked"
                        : pickingIngredientId === ingredient.id
                          ? "Picking..."
                          : "Pick"}
                    </Button>
```

- [ ] **Step 2.3: Add the "Start batch N before picking." hint**

Replace the existing Ingredients heading block (roughly lines 432-438):

```tsx
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Ingredients</h2>
            <p className="text-sm text-muted-foreground">
              Pick each ingredient at its remaining quantity. FIFO lot selection is automatic.
            </p>
            {execution.manufacturingMode === "batch" &&
              !canPick &&
              execution.currentBatch && (
                <p className="text-sm text-muted-foreground">
                  Start batch {execution.currentBatch.batchNumber} before picking.
                </p>
              )}
          </div>
```

(The closing `</div>` for this wrapper stays where it is — we are only editing the inner block that holds the heading and descriptions.)

- [ ] **Step 2.4: Verify the dev server renders the change**

Start (or reuse) the dev server and navigate to any batch-mode MO `/execute` page.

```bash
pnpm dev
```

Expected (no code verification here — visual check):
- Before Start Batch: pick buttons are disabled, the "Start batch N before picking." hint is visible.
- After Start Batch: pick buttons enable and read `Pick`.
- Clicking a pick button: only that button says `Picking...` until the request resolves.

- [ ] **Step 2.5: Commit**

```bash
git add app/\(dashboard\)/manufacturing/manufacturing-execution.tsx
git commit -m "feat: gate batch picking behind start batch and shorten Pick label"
```

---

## Task 3: Render pick and start-batch errors inline next to their triggers

**Files:**
- Modify: `app/(dashboard)/manufacturing/manufacturing-execution.tsx`

**Context:** `pickError` lives on the ingredient card it belongs to. `startBatchError` lives in the Batch Progress card under the Start Batch button.

- [ ] **Step 3.1: Add pick error row inside the ingredient card**

Inside the `ingredients.map(...)` render, expand the `Card > CardContent` so the failing ingredient shows its error below the main row. Replace the existing single `<CardContent>` child block with:

```tsx
                <Card key={ingredient.id} size="sm" className="border border-border/80">
                  <CardContent className="flex flex-col gap-2 py-1">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {ingredient.itemSku
                              ? `${ingredient.itemName} (${ingredient.itemSku})`
                              : ingredient.itemName}
                          </p>
                          <Badge variant="outline">{ingredient.itemType}</Badge>
                          {isPicked && <Badge variant="outline">Picked</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Planned {formatQuantity(ingredient.plannedQuantity)} {ingredient.unitName}
                          {" • "}
                          Picked {formatQuantity(ingredient.pickedQuantity)} {ingredient.unitName}
                          {" • "}
                          Remaining {formatQuantity(ingredient.remainingQuantity)} {ingredient.unitName}
                        </p>
                      </div>
                      <Button
                        variant={isPicked ? "outline" : "default"}
                        disabled={
                          isPicked ||
                          !canPick ||
                          pickMutation.isPending ||
                          isCompleting
                        }
                        onClick={() => pickMutation.mutate(ingredient.id)}
                      >
                        {isPicked
                          ? "Picked"
                          : pickingIngredientId === ingredient.id
                            ? "Picking..."
                            : "Pick"}
                      </Button>
                    </div>
                    {pickError?.id === ingredient.id && (
                      <p className="text-sm text-destructive">{pickError.message}</p>
                    )}
                  </CardContent>
                </Card>
```

- [ ] **Step 3.2: Add start-batch error row inside the Batch Progress card**

In the `execution.manufacturingMode === "batch" && (...)` block, find the `execution.currentBatch ? (...) : (...)` ternary. Wrap the current batch render in a fragment so we can append the error below it. Replace the `execution.currentBatch ? (...)` branch contents with:

```tsx
              {execution.currentBatch ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/80 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">
                          Batch {execution.currentBatch.batchNumber}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Planned {formatQuantity(execution.currentBatch.plannedQuantity)}{" "}
                          {execution.unitName}
                          {execution.currentBatch.startedAt && (
                            <> • Started {formatDateTime(execution.currentBatch.startedAt)}</>
                          )}
                        </p>
                      </div>
                      {execution.currentBatch.status === "pending" && (
                        <Button
                          onClick={() => startBatchMutation.mutate()}
                          disabled={startBatchMutation.isPending}
                        >
                          {startBatchMutation.isPending ? "Starting..." : "Start Batch"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {startBatchError && (
                    <p className="text-sm text-destructive">{startBatchError}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All batches are complete. Review the final order details if needed.
                </p>
              )}
```

- [ ] **Step 3.3: Verify dev server still renders (no regressions)**

Open a batch-mode MO `/execute` page in the dev server. Trigger a pick failure (easiest: set up an MO with a released batch where one ingredient has zero available stock, then click Pick). Confirm the error renders under that ingredient's card, not anywhere else.

- [ ] **Step 3.4: Commit**

```bash
git add app/\(dashboard\)/manufacturing/manufacturing-execution.tsx
git commit -m "feat: show pick and start-batch errors inline with their triggers"
```

---

## Task 4: Replace CompletionCard with a Dialog

**Files:**
- Modify: `app/(dashboard)/manufacturing/manufacturing-execution.tsx`

**Context:** Completion moves from an always-visible card at the bottom into a dialog triggered by a single button. Discrete mode shows just Actual Output; batch mode shows Actual Output + per-ingredient actual-consumed inputs (same fields that are there today).

- [ ] **Step 4.1: Replace the imports block**

At the top of the file, make sure the imports cover Dialog. Replace the current import block (roughly lines 1-22) with:

```tsx
"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import { ManufacturingPickProgressBadge } from "./pick-progress-badge";
import type { ManufacturingExecutionDetail } from "./types";
```

- [ ] **Step 4.2: Replace the CompletionCard component with CompleteDialog**

Delete the entire `CompletionCard` function (roughly lines 37-153). In its place, add:

```tsx
export type IngredientActualInput = {
  ingredientId: string;
  actualConsumedQuantity: string;
};

type CompleteDialogIngredient = {
  id: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  plannedQuantity: string;
  pickedQuantity: string;
};

function CompleteDialog({
  open,
  onOpenChange,
  isBatchMode,
  defaultActualQuantity,
  ingredients,
  isCompleting,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isBatchMode: boolean;
  defaultActualQuantity: string;
  ingredients: CompleteDialogIngredient[];
  isCompleting: boolean;
  error: string | null;
  onSubmit: (value: string, ingredientActuals: IngredientActualInput[]) => void;
}) {
  const [actualQuantity, setActualQuantity] = useState(defaultActualQuantity);
  const [actualsById, setActualsById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setActualQuantity(defaultActualQuantity);
      setActualsById({});
    }
  }, [open, defaultActualQuantity]);

  const handleConfirm = () => {
    onSubmit(
      actualQuantity,
      ingredients.map((ingredient) => ({
        ingredientId: ingredient.id,
        actualConsumedQuantity:
          actualsById[ingredient.id] ?? ingredient.pickedQuantity,
      }))
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={isBatchMode ? "lg" : "default"}>
        <DialogHeader>
          <DialogTitle>
            {isBatchMode ? "Complete Current Batch" : "Complete Order"}
          </DialogTitle>
          <DialogDescription>
            {isBatchMode
              ? "Enter the actual good output and the actual ingredient consumption from this batch."
              : "Enter the actual good output for this order."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="actual-output">
              Actual Output
            </label>
            <Input
              id="actual-output"
              inputMode="decimal"
              value={actualQuantity}
              onChange={(event) => setActualQuantity(event.target.value)}
            />
          </div>

          {isBatchMode && ingredients.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Actual Ingredient Consumption</p>
                <p className="text-xs text-muted-foreground">
                  Defaults to the picked quantity. Adjust if the worker used more or less than planned — variance is written as an inventory movement.
                </p>
              </div>
              <div className="grid gap-3">
                {ingredients.map((ingredient) => {
                  const inputId = `actual-consumed-${ingredient.id}`;
                  const value = actualsById[ingredient.id] ?? ingredient.pickedQuantity;
                  return (
                    <div key={ingredient.id} className="space-y-1">
                      <label className="text-sm font-medium" htmlFor={inputId}>
                        {ingredient.itemSku
                          ? `${ingredient.itemName} (${ingredient.itemSku})`
                          : ingredient.itemName}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Planned {formatQuantity(ingredient.plannedQuantity)} {ingredient.unitName}
                        {" · "}
                        Picked {formatQuantity(ingredient.pickedQuantity)} {ingredient.unitName}
                      </p>
                      <Input
                        id={inputId}
                        inputMode="decimal"
                        value={value}
                        onChange={(event) =>
                          setActualsById((prev) => ({
                            ...prev,
                            [ingredient.id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCompleting}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isCompleting}>
            {isCompleting ? "Completing..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4.3: Wire the dialog into ManufacturingExecution**

Add dialog open state near the other `useState` hooks inside `ManufacturingExecution`:

```tsx
  const [completeOpen, setCompleteOpen] = useState(false);
```

Close the dialog whenever a completion succeeds. Extend both `completeOrderMutation.onSuccess` and `completeBatchMutation.onSuccess` handlers (declared in Task 1) so they close the dialog:

```tsx
    onSuccess: async () => {
      setCompleteOpen(false);
      await refreshData();
    },
```

Apply this to both mutations. `refreshData` is already declared above them.

- [ ] **Step 4.4: Replace the bottom <CompletionCard> render with a trigger + <CompleteDialog>**

At the bottom of the top-level JSX return — where `<CompletionCard ... />` currently lives (roughly lines 483-512) — replace that block with:

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

        <CompleteDialog
          open={completeOpen}
          onOpenChange={(next) => {
            if (!isCompleting) {
              setCompleteOpen(next);
            }
          }}
          isBatchMode={execution.manufacturingMode === "batch"}
          defaultActualQuantity={defaultActualQuantity}
          ingredients={execution.ingredients.map((ingredient) => ({
            id: ingredient.id,
            itemName: ingredient.itemName,
            itemSku: ingredient.itemSku,
            unitName: ingredient.unitName,
            plannedQuantity: ingredient.plannedQuantity,
            pickedQuantity: ingredient.pickedQuantity,
          }))}
          isCompleting={isCompleting}
          error={completeError}
          onSubmit={(value, ingredientActuals) => {
            if (execution.manufacturingMode === "batch") {
              completeBatchMutation.mutate({
                actualQuantity: value,
                ingredientActuals,
              });
              return;
            }

            completeOrderMutation.mutate({
              actualQuantity: value,
              ingredientActuals,
            });
          }}
        />
```

- [ ] **Step 4.5: Delete the now-unused actualQuantityResetKey line**

Remove the `actualQuantityResetKey` declaration near the top of `ManufacturingExecution`. It was only used by the old `CompletionCard`'s `key` prop.

- [ ] **Step 4.6: Verify build passes**

```bash
pnpm build 2>&1 | tail -20
```

Expected: build succeeds with no type errors. If the build fails, read the error and fix the specific symbol referenced.

- [ ] **Step 4.7: Verify lint passes**

```bash
pnpm lint 2>&1 | tail -10
```

Expected: no errors. The known React Compiler + TanStack warning from other files is unrelated — ignore it.

- [ ] **Step 4.8: Commit**

```bash
git add app/\(dashboard\)/manufacturing/manufacturing-execution.tsx
git commit -m "feat: move mo completion into a dialog"
```

---

## Task 5: Update Playwright tests for the new DOM

**Files:**
- Modify: `test/e2e/fast/manufacturing-write.spec.ts`
- Modify: `test/e2e/slow/manufacturing-order.spec.ts`

**Context:** Existing tests click `getByRole("button", { name: /Pick / })` and fill `Actual Output` before clicking the completion button. The new flow requires an exact `Pick` match and opening the dialog before filling Actual Output.

- [ ] **Step 5.1: Update fast batch flow**

Open `test/e2e/fast/manufacturing-write.spec.ts`. Inside the `runBatch` helper (roughly lines 297-314), replace the body with:

```ts
    const runBatch = async (output: string, expectedActual: string, expectedExpected: string) => {
      await page.getByRole("button", { name: "Start Batch" }).click();

      const sandCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: batchSandName })
        .first();
      const compostCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: batchCompostName })
        .first();

      await sandCard.getByRole("button", { name: "Pick", exact: true }).click();
      await compostCard.getByRole("button", { name: "Pick", exact: true }).click();

      await page.getByRole("button", { name: "Complete Batch" }).click();
      await page.getByLabel("Actual Output").fill(output);
      await page.getByRole("button", { name: "Confirm" }).click();
```

Keep the `await expect.poll(...)` block that follows untouched — we are only editing the lines above it.

- [ ] **Step 5.2: Update slow discrete flow**

Open `test/e2e/slow/manufacturing-order.spec.ts`. Around line 964, replace:

```ts
    await sandCard.getByRole("button", { name: /Pick / }).click();
    await compostCard.getByRole("button", { name: /Pick / }).click();

    await page.getByLabel("Actual Output").fill("6");
    await page.getByRole("button", { name: "Complete Order" }).click();
```

with:

```ts
    await sandCard.getByRole("button", { name: "Pick", exact: true }).click();
    await compostCard.getByRole("button", { name: "Pick", exact: true }).click();

    await page.getByRole("button", { name: "Complete Order" }).click();
    await page.getByLabel("Actual Output").fill("6");
    await page.getByRole("button", { name: "Confirm" }).click();
```

- [ ] **Step 5.3: Commit test updates**

```bash
git add test/e2e/fast/manufacturing-write.spec.ts test/e2e/slow/manufacturing-order.spec.ts
git commit -m "test: update mo execution tests for dialog completion flow"
```

---

## Task 6: Final verification

**Context:** Run the full local verification ladder before declaring done. These commands run inside the worktree.

- [ ] **Step 6.1: Build**

```bash
pnpm build 2>&1 | tail -10
```

Expected: `Compiled successfully` and no type errors.

- [ ] **Step 6.2: Lint**

```bash
pnpm lint 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6.3: Start the dev server (background)**

```bash
pnpm dev
```

Run this in the background. Wait until the server logs "Ready in ..." before running tests.

- [ ] **Step 6.4: Run fast Playwright smoke**

```bash
pnpm test 2>&1 | tail -40
```

Expected: all fast specs pass, including `manufacturing-write.spec.ts`.

- [ ] **Step 6.5: Run the manufacturing slow spec**

```bash
pnpm test:e2e:slow -- test/e2e/slow/manufacturing-order.spec.ts 2>&1 | tail -40
```

Expected: pass. If a test times out looking for a `Pick` button, check the exact-match change in Task 5.

- [ ] **Step 6.6: Run inventory verification**

Picking ingredients writes stock movements, so run:

```bash
pnpm verify:inventory 2>&1 | tail -10
```

Expected: grep guards clean, projection diff returns no drift for the current Playwright test org.

- [ ] **Step 6.7: Stop the dev server**

Kill the background `pnpm dev` process.

- [ ] **Step 6.8: Push and open PR**

```bash
git fetch origin main && git rebase origin/main
git push -u origin mo-execution-ux
gh pr create --title "Improve MO execution screen UX" --body "$(cat <<'EOF'
## Summary
- Shorten Pick button label to `Pick` and scope the `Picking...` state to the ingredient being picked
- Gate batch-mode picking behind Start Batch and show a hint when the current batch has not started
- Move completion into a dialog so the ingredient list is the focus of the screen
- Render pick/start-batch errors inline next to their triggers instead of at the bottom of the page

Spec: `docs/superpowers/specs/2026-04-23-mo-execution-improvements-design.md`

## Test plan
- [ ] `pnpm build`
- [ ] `pnpm lint`
- [ ] `pnpm test` (fast manufacturing write spec)
- [ ] `pnpm test:e2e:slow` for `manufacturing-order.spec.ts`
- [ ] `pnpm verify:inventory`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec Coverage Checklist

Spec requirement → task mapping:

- **Pick button label "Pick"** → Task 2, Step 2.2
- **Batch-mode picking disabled until Start Batch** → Task 2, Steps 2.1, 2.2
- **"Start batch N before picking." hint** → Task 2, Step 2.3
- **Completion dialog (discrete: output only; batch: output + actuals)** → Task 4, Steps 4.2, 4.4
- **Dialog size `lg` for batch, `default` for discrete** → Task 4, Step 4.2
- **Completion trigger button disabled until `canComplete`** → Task 4, Step 4.4
- **Dialog state resets on open via `useEffect`** → Task 4, Step 4.2
- **Scoped error slots: pickError, startBatchError, completeError** → Task 1, Steps 1.1–1.4
- **Scoped pick-in-flight via `pickingIngredientId`** → Task 1, Step 1.3 + Task 2, Step 2.2
- **Inline rendering: pick error on its card, start-batch error in batch card, complete error in dialog** → Task 3 + Task 4
- **No API/schema changes** → enforced by only touching the listed files
- **Playwright coverage updated for dialog flow** → Task 5
