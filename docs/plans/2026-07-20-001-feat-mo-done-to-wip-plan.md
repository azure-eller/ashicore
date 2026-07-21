# Manufacturing Done → Work in Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator move a Done manufacturing order back to Work in progress from the existing status dropdown; the transition reverses the completion's inventory effects (finished stock out, ingredients back, planning restored) and the order becomes editable and completable again. Works for MTS and linked MTO orders, discrete and batch.

**Architecture:** One new domain operation, `reopenManufacturingOrder`, composed entirely from existing kernel primitives: the shipped open-order output reversal (`reverseManufacturingOutputInTx`) undoes stock/cost effects, `editExpectedFromManufacturingInTx` + the release/re-add demand pair restore planning to full plan targets, and the completion close-out's flag writes are inverted. Eligibility is the kernel's existing no-negative-stock guard — if produced stock has since shipped or been consumed, the decrement throws and the whole transaction rolls back with a clear error. No new tables, no migrations, no feature flag, no provenance machinery.

**Tech Stack:** Next.js App Router API route, Drizzle in-tx domain op, existing card-page `OrderStatusControl` config, Playwright scratch-first tests.

## Global Constraints

- All stock/cost/demand/expected mutations go through existing inventory-kernel functions — never raw table updates for quantities (CLAUDE.md "Inventory kernel").
- DAL only; the route stays thin (`assertModuleWriteAccess` + `requireIdempotencyKey` + call the domain op).
- API route for the mutation; no server actions.
- No new tables or migrations. If implementation appears to need one, stop — the design is wrong.
- Playwright only, scratch-first: red suite in `test/e2e/scratch/`, distilled invariant into the fast manufacturing lane, scratch deleted before PR.
- `pnpm verify:inventory` must pass (this is inventory-affecting).
- Icons: HugeIcons only. Colors/spacing: semantic tokens only.
- Existing MTO rules are untouched: a linked open MO re-locks its sales line automatically (`assertSalesOrderLineQuantityEditableInTx`), and re-completion is already capped by `assertLinkedMtoOutputWithinSalesDemandInTx`.

## Design invariants (what the tests pin)

After `reopen` of a Done order that produced quantity P of planned N:

1. Finished-goods stock: the produced lot's balance drops by P at each output row's recorded lot/location/disposition; ledger gains compensating events (`eventSubtype: "manufacturing_output_reversal"`); original events untouched.
2. Ingredients: every consumption restocked at its recorded lot/location; ingredient demand for the MO reference equals the **full plan quantities**; expected supply for the MO reference equals **N**.
3. Order row: `status = "open"`, `completedAt = null`, `startedAt` non-null (derived status = Work in progress), `priorityRank` assigned at the end of the open queue, actual-cost rollups recomputed to the zero-output state.
4. Repeatability: complete → reopen → complete → reopen works; `reversedQuantity` + negative marker output rows keep history unambiguous; the op is idempotent under key replay.
5. Blocked path: if produced stock was shipped/consumed, the transition fails atomically (order stays Done, zero new events beyond the rolled-back tx) with a clear 409/400 message.
6. MTO: reopening a linked MO keeps `salesOrderId`/`salesOrderLineId`; the sales line quantity edit is blocked again while the MO is open; sales-order fulfillment views show the demand as unfulfilled again.

---

### Task 1: Red scratch suite

**Files:**
- Create: `test/e2e/scratch/mo-reopen.spec.ts`

**Interfaces:**
- Consumes: `test/helpers/api.ts` (`createItem`, `createManufacturingOrder`, `releaseManufacturingOrder`, `completeManufacturingOrder`, `createCustomer`, `createSalesOrder`, `testFetch`, `getOrgId`), Drizzle schema imports for DB assertions, DB access pattern copied from `test/e2e/fast/manufacturing-demand-and-completion.spec.ts` (read its top ~120 lines first and mirror its `db` fixture/setup exactly — including how it builds a BOM item + ingredient stock).
- Produces: the executable spec of the invariants above; later tasks iterate `pnpm test:scratch` until green.

- [ ] **Step 1: Read the existing fast spec's setup** (`test/e2e/fast/manufacturing-demand-and-completion.spec.ts`) and lift its helper pattern for: creating an ingredient item with opening stock, a finished-good item with a BOM, creating + releasing an MO, completing it. Note: `testFetch` generates a RANDOM idempotency key per call — for the idempotency-replay test pass an explicit key.

- [ ] **Step 2: Write the spec.** Skeleton (adapt setup calls to the real helper signatures found in Step 1 — assertions below are the contract and must survive verbatim in spirit):

```ts
import { and, eq, sql } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryDemandSummary,
  inventoryEvents,
  inventoryExpectedSummary,
  lots,
  manufacturingOrders,
} from "../../../lib/db/schema";
import { testFetch } from "../../helpers/api";

// per-test setup: ingredient item w/ stock 100, product item w/ BOM (2x ingredient),
// MO planned 10, released, completed with actualQuantity 10 → Done, product lot has 10.

test("reopen restores stock, planning, and lifecycle exactly", async ({ db }) => {
  const res = await testFetch(`/api/manufacturing-orders/${moId}/reopen`, { method: "POST" });
  expect(res.status).toBe(200);

  // 1. finished goods removed from the produced lot
  //    (assert lot/location balance back to 0)
  // 2. ingredient stock restored to 100
  // 3. reversal events exist; original completion events still present
  const reversals = await db.select().from(inventoryEvents)
    .where(eq(inventoryEvents.eventSubtype, "manufacturing_output_reversal"));
  expect(reversals.length).toBeGreaterThan(0);

  // 4. planning back to full plan targets
  //    demand summary for reference manufacturing_order/moId = 20 (2 x 10)
  //    expected summary for reference manufacturing_order/moId = 10
  // 5. order row: open, completedAt null, startedAt set, priorityRank at queue end,
  //    actualQuantity/actualCostPerUnit rollups cleared to zero-output state
  const [mo] = await db.select().from(manufacturingOrders)
    .where(eq(manufacturingOrders.id, moId));
  expect(mo.status).toBe("open");
  expect(mo.completedAt).toBeNull();
  expect(mo.startedAt).not.toBeNull();
});

test("reopen then complete again yields exactly one live output set", async () => {
  // reopen, then completeManufacturingOrder(actualQuantity 8)
  // assert product lot balance = 8, MO done, net output rows sum to 8,
  // and a second reopen also works (repeat cycle).
});

test("reopen is idempotent under key replay", async () => {
  // two POSTs with the SAME Idempotency-Key header → one set of reversal events.
});

test("reopen fails atomically when produced stock has shipped", async () => {
  // create customer + SO for the product, ship the produced units
  // (mirror shipping setup from test/e2e/fast/sales-demand-and-shipment.spec.ts),
  // then POST reopen → expect 400/409, MO still done, product lot unchanged,
  // zero manufacturing_output_reversal events.
});

test("linked MTO reopen keeps the link and re-locks the sales line", async () => {
  // create SO line with make-to-order MO (mirror MTO creation from the fast planning spec),
  // complete MO, reopen → salesOrderId/salesOrderLineId unchanged,
  // PATCH sales line quantity → 400 "linked to make-to-order",
  // sales order fulfillment no longer counts the reversed output.
});

test("batch MO reopen resets batches and reverses per-batch output", async () => {
  // batch-mode MO (batchCount 2), complete both batches → done,
  // reopen → both batch rows non-completed, batch outputs reversed,
  // order completable again.
});
```

- [ ] **Step 3: Run to verify red.** `cd .worktrees/mo-done-to-wip && pnpm test:scratch` — every test fails with 404/405 on `/reopen` (route absent). If anything passes, the test is vacuous — fix it.

- [ ] **Step 4: Commit** `git add test/e2e/scratch/mo-reopen.spec.ts && git commit -m "test: red scratch suite for MO done→WIP reopen"`

---

### Task 2: Domain op `reopenManufacturingOrder`

**Files:**
- Modify: `lib/manufacturing/queries/output.ts` (export `reverseManufacturingOutputInTx`; extract the post-reversal MO rollup recompute at `output.ts:~700-727` into a shared `recomputeManufacturingActualRollupsInTx(tx, orderId)` so both callers use it)
- Create: `lib/manufacturing/queries/reopen.ts`

**Interfaces:**
- Consumes: `reverseManufacturingOutputInTx(tx, {organizationId, manufacturingOrderId, manufacturingOrderBatchId, productId, quantity, actorUserId, idempotencyKey?})` (`output.ts:284`); `getOutputQuantityInTx(tx, {manufacturingOrderId, manufacturingOrderBatchId})` — **null batch id means the `IS NULL` bucket only**, so batch orders iterate batches; `releaseIngredientDemandForManufacturingInTx(reason: "edited")` + `addIngredientDemandForManufacturingInTx` + `getManufacturingIngredientDemandRowsInTx` (kernel `operations/manufacturing.ts:214,156,770`); `editExpectedFromManufacturingInTx(tx, {..., nextQuantity})` (`:89`) — reconciles expected to a target in one call; `rerankOpenManufacturingOrdersInTx` (`shared.ts:236`) — NULL ranks sort last, so leaving rank null before rerank appends the MO to the queue end; `beginInventoryOperationInTx`/`finishInventoryOperationInTx`, `lockManufacturingPriorityQueueInTx`, `getLockedManufacturingOrderInTx`, `withAuthedOrgContext`.
- Produces: `export async function reopenManufacturingOrder(id: string, options?: { idempotencyKey?: string }): Promise<{ id: string }>` — consumed by Task 3's route.

- [ ] **Step 1: Export the reversal + extract the rollup recompute** in `output.ts`. Pure mechanical: `async function reverseManufacturingOutputInTx` → `export async function ...`; move the `SUM(quantity)/SUM(materialCostTotal)` + `getAbsorbedOperationCostForQuantityInTx` + `manufacturingOrders.update` block (currently inline after the reversal call in `recordManufacturingOutput`) into an exported helper and call it from both places.

- [ ] **Step 2: Write the op** in `lib/manufacturing/queries/reopen.ts`:

```ts
export async function reopenManufacturingOrder(
  id: string,
  options?: { idempotencyKey?: string }
): Promise<{ id: string }> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockManufacturingPriorityQueueInTx(tx, orgId);
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "reopenManufacturingOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
    });
    if (replay.replayed) return replay.result;

    const order = await getLockedManufacturingOrderInTx(tx, id);
    if (!order) throw new ManufacturingError("Order not found", 404);
    if (order.status !== "done" || order.deletedAt) {
      throw new ManufacturingError(
        "Only completed orders can return to work in progress.", 400);
    }

    // 1. Reverse every net output bucket (discrete null-batch + each batch).
    const buckets: Array<string | null> = [null];
    if (order.manufacturingMode === "batch") {
      buckets.push(...batchIdsWithOutput); // select distinct batch ids from output rows
    }
    for (const batchId of buckets) {
      const net = await getOutputQuantityInTx(tx, {
        manufacturingOrderId: id, manufacturingOrderBatchId: batchId });
      if (net > 0) {
        await reverseManufacturingOutputInTx(tx, {
          organizationId: orgId, manufacturingOrderId: id,
          manufacturingOrderBatchId: batchId, productId: order.productId,
          quantity: net, actorUserId: userId,
          idempotencyKey: options?.idempotencyKey ?? null,
        });
      }
    }
    await recomputeManufacturingActualRollupsInTx(tx, id);

    // 2. Batch rows executable again.
    //    completed → in_progress, completedAt null (actualQuantity already
    //    recomputed by the reversal's batch update).

    // 3. Planning to full plan targets.
    const demandRows = await getManufacturingIngredientDemandRowsInTx(tx, id);
    await releaseIngredientDemandForManufacturingInTx(tx, {
      organizationId: orgId, manufacturingOrderId: id, actorUserId: userId,
      reason: "edited", ingredientIds: demandRows.map((r) => r.ingredientId),
    });
    await addIngredientDemandForManufacturingInTx(tx, {
      organizationId: orgId, manufacturingOrderId: id, actorUserId: userId,
      ingredients: demandRows.map((r) => ({
        ingredientId: r.ingredientId, itemId: r.itemId,
        quantity: parseFloat(r.plannedQuantity),
      })),
    });
    await editExpectedFromManufacturingInTx(tx, {
      organizationId: orgId, manufacturingOrderId: id,
      productId: order.productId, actorUserId: userId,
      nextQuantity: parseFloat(order.plannedQuantity),
    });

    // 4. Lifecycle flags — exact inverse of the close-out at completion.ts:207-218.
    await tx.update(manufacturingOrders).set({
      status: "open", completedAt: null,
      startedAt: order.startedAt ?? new Date(), // derived status must read Work in progress
      priorityRank: null, updatedAt: new Date(),
    }).where(eq(manufacturingOrders.id, id));
    await rerankOpenManufacturingOrdersInTx(tx, orgId); // null rank → queue end

    const result = { id };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null, result });
    return result;
  });
}
```

- [ ] **Step 3: Check reversal's ingredient-row handling.** Run `grep -n "manufacturingOrderIngredients" lib/manufacturing/queries/output.ts` and read the reversal body's treatment of `pickedQuantity` / `actualQuantity` / `pickStatus`. If a reversed completion leaves them stale (the scratch re-complete test will show it), reset them in the op to pre-execution values (`pickedQuantity: "0"`, `actualQuantity: null`, `pickStatus: "not_picked"`). Do NOT touch demand/stock here — only the planning-row projections.

- [ ] **Step 4: Error mapping.** The shipped-stock case surfaces as the kernel's `InsufficientStockError` (or the reversal's own "Output cannot be reduced below zero"). Do not swallow it in the op; Task 3's route maps it to a 409 with the operator message.

- [ ] **Step 5: Iterate `pnpm test:scratch`** until the domain-level assertions pass (route tests still red until Task 3). Commit: `git commit -m "feat(manufacturing): reopen domain op — done back to work in progress"` (stage `lib/manufacturing/queries/reopen.ts`, `lib/manufacturing/queries/output.ts`).

---

### Task 3: API route + client

**Files:**
- Create: `app/api/manufacturing-orders/[id]/reopen/route.ts`
- Modify: `lib/api/clients/manufacturing-orders.ts`

**Interfaces:**
- Consumes: `reopenManufacturingOrder` from Task 2; `apiHandler`, `requireIdempotencyKey`, `assertModuleWriteAccess`, `InsufficientStockError`, `ManufacturingError`, `getManufacturingOrder`.
- Produces: `POST /api/manufacturing-orders/[id]/reopen` returning the refreshed `ManufacturingOrderDetail`; client `reopenManufacturingOrder(orderId): Promise<ManufacturingOrderDetail>`.

- [ ] **Step 1: Route** — mirror `[id]/complete/route.ts` exactly (`assertModuleWriteAccess("manufacturing")`, `requireIdempotencyKey(request, "reopenManufacturingOrder")`, no body schema):

```ts
export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "reopenManufacturingOrder");
  const { id } = await (ctx as RouteContext).params;
  try {
    await reopenManufacturingOrder(id, { idempotencyKey });
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    if (error instanceof InsufficientStockError) {
      return jsonError(
        "Some produced stock has already been shipped or consumed, so this order can't return to work in progress.",
        409
      );
    }
    throw error;
  }
  const detail = await getManufacturingOrder(id);
  if (!detail) return jsonNotFound("Order not found");
  return NextResponse.json(detail);
});
```

- [ ] **Step 2: Client fn** next to `startManufacturingOrder` (`lib/api/clients/manufacturing-orders.ts:126`), same shape: `json<ManufacturingOrderDetail>(path, { method: "POST", idempotencyKey: "reopenManufacturingOrder", body: {} })`.

- [ ] **Step 3: Run `pnpm test:scratch`** — API-level tests go green (UI untouched so far). Commit: `git commit -m "feat(manufacturing): reopen API route and client"`.

---

### Task 4: UI — dropdown transition + confirm dialog

**Files:**
- Modify: `components/card-page/order-status-configs.tsx` (`manufacturingOrderStatusConfig` at `:471`, `isManufacturingStatusDisabled` at `:521`; the dialog component lives in this file like `ReceiveConfirmDialog` at `:581`)

**Interfaces:**
- Consumes: client `reopenManufacturingOrder` from Task 3; `ManufacturingStatusFields` already carries `actualQuantity` for the dialog copy.
- Produces: on a Done order the dropdown offers "Work in progress" as a `"dialog"` transition; other targets remain disabled from `done`.

- [ ] **Step 1: `transitionKind`** — replace the blanket `if (from === "done") return "disabled"` (`:483`) with:

```ts
if (from === "done") return to === "in_progress" ? "dialog" : "disabled";
```

- [ ] **Step 2: `renderDialog`** — add the case before the completion-dialog return: `to === "in_progress" && ctx.order.status === "done"` renders `ManufacturingReopenDialog` (define in this file, modeled on `ReceiveConfirmDialog`): title "Return to work in progress?", body copy "This removes the produced quantity from stock and restores the consumed materials. The order becomes editable and can be completed again." Confirm button calls `reopenManufacturingOrder(order.id)`; on error show the API message inline in the dialog (the 409 shipped-stock message must be readable); on success `onDone()`.

- [ ] **Step 3: Relax the disable helper.** `grep -rn "isManufacturingStatusDisabled" app components lib` — for each usage decide: the status *control* must stay enabled on Done (so the dropdown opens), while field/section editing stays locked. Adjust only the control gating.

- [ ] **Step 4: Verify in the running app** (dev server from `pnpm boot` is up): complete an MO, open its card, move status Done → Work in progress, confirm, watch stock/status change. Then `pnpm test:scratch` fully green. Commit: `git commit -m "feat(manufacturing): done→WIP status transition with confirm dialog"`.

- [ ] **Step 5: Screenshot pass** per `docs/ui-review-checklist.md`: throwaway `reviewTest` scratch spec with `captureForReview` on the MO card (Done state, dialog open, reopened state, and the 409 error state), inspect `.tmp/ui-shots/`, fix visible issues, delete the spec.

---

### Task 5: Distill, verify, land

**Files:**
- Modify: `test/e2e/fast/manufacturing-demand-and-completion.spec.ts` (fold the essential invariant in), `test/e2e/fast/FAST_TEST_SEAMS.md` (list the new seam)
- Delete: `test/e2e/scratch/mo-reopen.spec.ts`

- [ ] **Step 1: Distill.** One fast test guarding the mutation seam: complete → reopen → assert stock/demand/expected/status restored → complete again → assert single live output set. The MTO-link and blocked-reopen cases fold into the same test only if they don't already fall out of existing slow stories; keep it to the essential invariant per `docs/testing.md`. Delete the scratch suite.
- [ ] **Step 2: Full verification.** `pnpm test:fast:manufacturing`, `pnpm test:fast:inventory`, `pnpm test:fast:sales` (fulfillment reads), `pnpm test:slow:manufacturing`, `pnpm verify:inventory`, `pnpm build`, `pnpm lint`.
- [ ] **Step 3: Mobile impact.** Spawn the subagent per CLAUDE.md: it reads `~/Projects/erp-android/CLAUDE.md`, then traces whether an order that returns from done to open (completedAt null again, outputs net-zero with negative markers, new `/reopen` route it never calls) breaks any Android read/execution assumption.
- [ ] **Step 4: Land.** `pnpm review app/\(dashboard\)/manufacturing/orders --slow manufacturing`, then `no-mistakes axi run --yes --intent "Done MOs can move back to work in progress; completion effects reversed via kernel compensation"`. Labels: `ci:slow:manufacturing`, then `ci:ready`. Leave the dev server on a reopened MO card.

## Explicitly out of scope (rejected fortress scope)

Execution-cycle tables, provenance columns/triggers/sequences, eligibility census, feature flag, support-mailto flows, sales-edit→MO reconciliation with detach/relink history, shipping auto-completion of linked MOs, prefilling the next completion dialog from reversed actuals (nice-to-have follow-up). If any task appears to need one of these, stop and re-read the architecture review.
