# Existing Playwright Spec Audit — SO ↔ MO Coverage

Audit of 10 specs to find weak / missing assertions relevant to the sales-order ↔ manufacturing-order workflow (sales allocation, ingredient binding, lot-management drift).

> Note: the brief asked for `test/e2e/fast/sales-order.spec.ts` but that file does not exist in the worktree. The only fast sales spec is `test/e2e/fast/sales-write.spec.ts`, which is audited below.

---

### `test/e2e/slow/sales-order.spec.ts`

Size: 1661 LOC, 22 `test()` blocks (1 fixme).

- **What it asserts well**
  - DB-level commit/demand/shortage on confirm (lines 539–553, 687–689) and release on cancel (988–1002).
  - End-to-end ship flow: status flip to `done`, lot quantity delta, `sales_consumption` movement type/`referenceType` (1085–1136).
  - Stale-state delete guards: blocks delete when `sales_consumption` movement already recorded (1262–1294) and when a linked MO has had its `salesOrderLineId` rewritten (1297–1410).
  - Duplicate-ship rejection (1138–1168) — second ship returns 4xx, no extra `sales_consumption` rows, lots unchanged.
  - Product/customer delete guards driven by active SO (1551–1618).
  - "Create MOs" gating: confirmed manufacturable order shows action, non-manufacturable does not (834–970).

- **Surface-only assertions**
  - "Confirmed orders can be edited from detail" (770–778) only checks button visibility — no actual edit attempt or DB write.
  - The Create-MOs dialog tests (841–847, 884–893) only assert the dialog opens with the order number; they never submit and never verify the resulting MO row.
  - Reload assertions repeatedly check "Open" text + line items (e.g. 487–495, 599–606) without re-reading DB state.

- **Missing negative cases**
  - No test for `confirmOversell: false` rejection path on initial create — every shortage path passes `confirmOversell: true` (655, 793, 853, 1344).
  - Edit that *reduces* an SO line while a downstream MO is still draft/released is never exercised (the test in 850–908 *increases* qty 3→5→7 and never down-edits).
  - No assertion that re-confirming a stale "confirmed" payload that contradicts current line shapes is rejected — the stale path at 780–832 only covers a no-op confirm.
  - The MO-link rewrite test (1297) *manually* nulls `salesOrderLineId` via DB to fake the drift; the natural drift path (e.g. customer-driven SO line replacement while MO exists) is not exercised.

- **Concurrent/race gaps**
  - No concurrent SO confirm + MO release on the same product.
  - No concurrent edit of an SO while its linked MO is being released or picked.
  - The `expect.poll` waits (693–704, 718–759) only wait for projection rollups; they never assert atomicity vs another writer.

- **Flake risks**
  - Several `.toBeVisible({ timeout: 30000 })` and `15_000` polls without explicit failure cause (e.g. 233, 269, 565). Indicate slow first-load expectations rather than real timing budgets.
  - Heavy reliance on `getByText("Open", { exact: true })` scoped to `main` — a future status copy change ("Open" → "Confirmed") would silently break every flow.
  - `getByLabel("Sales Order Line")` combobox interaction (588–595) is order-sensitive on dropdown rendering; brittle to async option list re-renders.
  - Test 1 has a duplicate `sellable: true` key in `createItem` payloads (152, 163, 169 — and again in the manufacturing spec) — JS keeps the last, but it is a latent foot-gun.

---

### `test/e2e/slow/manufacturing-order.spec.ts`

Size: 2399 LOC, 15 `test()` blocks.

- **What it asserts well**
  - Sales-link binding: edits an MO to attach a sales line and verifies `salesOrderId/salesOrderLineId/salesOrderNumber/salesCustomerName` snapshots (600–612).
  - The "skips non-manufacturable lines" test (625–734) — DB count of created MOs (697) plus exact `salesOrderLineId` mapping (702).
  - Completed-MO blocks repeat Create MOs (736–848) — both UI absence and 400 with the canonical error string.
  - Batch-mode end-to-end with allocation promise → lot-hold transition (1246–1516) — checks `stockAllocations` rows by `sourceType` and `status`.
  - Output-allocation promise → lot-hold materialization on completion (1944–2129) — exactly the supply-side allocation bug class.
  - Six-decimal cost carry-through (2296–2397) for purchase-to-stock conversion.
  - Decimal quantity completion without false shortage (2131–2214).
  - FIFO lot consumption ordering & per-event count (`movements.toHaveLength(5)`) at 1670–1687.

- **Surface-only assertions**
  - Several `expect(page.locator("table").first()).toContainText("10")` matches at 542–545 will pass on any text that contains "10" (matches "10.0000", "100", row counts, etc).
  - The `expect(page.locator("dl").getByText("$22.00", { exact: true }))` (1581) ties to a formatted DOM rather than the underlying `actualMaterialCost` numeric — already covered in DB. Acceptable, but listing/header-only.
  - The "in-progress batch deletion blocked" test (1096–1244) hand-rolls an `inventory_ingredient_consumption` event via `db.insert` and direct lot/balance updates (1179–1208) — it tests the *guard* code path but bypasses the kernel that would actually produce that row, so a regression in the real ingredient-consumption write path would not be caught here.

- **Missing negative cases**
  - The "blocks direct sales-linked creation" test (462–475) only asserts the API 400 — no DB read confirming no `manufacturingOrders` row was inserted.
  - No test for `confirmShortage: false` shortage warning on MO create (every shortage path passes `confirmShortage: true`).
  - No test for re-linking an MO to a *different* sales line (only "attach from null" and "rewrite line then keep snapshot").
  - No test that an `open` (draft) MO can be edited while its linked SO line is concurrently rewritten — the test at 854–873 simulates the rewrite serially via `updateSalesOrder` and then re-reads, but there is no contention.
  - No test that ingredient *quantityPerUnit* is normalized to 4 decimals — `0.1` * `3` is tested (2131–2214) but, e.g., `0.0001` precision is not.

- **Concurrent/race gaps**
  - No concurrent pick attempts on the same ingredient.
  - No concurrent batch `/start` calls.
  - The allocation-promise → lot-hold materialization (1944–2129) runs purely sequentially; no test exercises "MO completes while downstream pick is in flight".
  - The sequence increment for `MO-YYYY-NNNN` is read with raw `nextval` (482–487) — no test verifies sequence holes do not appear when concurrent creates fail.

- **Flake risks**
  - `await page.waitForLoadState("networkidle")` at 2040 — known to flake on Next.js apps with background revalidations.
  - `expect.poll` with `15_000` timeout chained 7+ times in a single test (1245+, 1442+, 1566+). Any one slow projection roll-up cascades.
  - The web-actuals batch test (1246) relies on `[data-slot="card"]` filtering by material text — order-sensitive when card lists re-order.
  - `await page.keyboard.press("Escape")` after Create-MOs dialog assertions (e.g. 848, 894) without waiting for dialog dismissal can race the next page navigation.

---

### `test/e2e/slow/partial-sales-shipments.spec.ts`

Size: 363 LOC, 1 `test()` block.

- **What it asserts well**
  - First ship of partial quantity: order stays `open`, `shippedAt` null, balance and demand drop only by shipped amount (193–210).
  - `inventoryEvents` reference shape and quantity for the partial consume (212–226).
  - Cost-edit idempotency vs inventory: event count before/after a cost PUT is identical (228–268) — directly guards the "freight changes touched inventory" bug class.
  - Margin recompute on the API response (279–294) with all margin components asserted.
  - Sequence number `S2` and `sequence: 2` on the second shipment (319–328).
  - Final `done` transition only after second shipment ships (344–349).

- **Surface-only assertions**
  - `await expect(page.locator("main")).toContainText("1 of 2 shipped")` (202–203, 353–354) — surface-only checks for the progress label. Fine, but no underlying DB count.

- **Missing negative cases**
  - Overlapping shipment block (167–177) only checks status `400`; never asserts the error message body or that no new shipment row was inserted.
  - No coverage for editing a *planned* shipment's quantity to zero (empty-lines payload) — a known shape that has caused validation regressions.
  - No coverage for deleting a planned (draft) shipment — only for "delete partially shipped order" (1535–1539 of the slow sales spec), which 400s.
  - No test for shipping the *first* shipment when the only available stock has been blocked or rejected mid-flight.

- **Concurrent/race gaps**
  - None. Both shipments are sequenced via `await`. No concurrent ship on two separate shipments of the same order.

- **Flake risks**
  - The fallback at 304–316 — if 201 was not returned, the test falls back to a DB read of "the planned shipment" — masks API failures by always finding something. A new bug that makes the create silently succeed but return 200 would be hidden.

---

### `test/e2e/slow/customer-crm.spec.ts`

Size: 512 LOC, 5 `test()` blocks.

- **What it asserts well**
  - Customer + contacts (with role flags) + correspondence + project + file upload chain with end-to-end DB reads (147–301).
  - Project delete cascades file soft-delete and blob removal (391–431).
  - Customer delete cascades contacts, correspondence, projects, files, and blob (433–511).
  - Asserts `customerProjectFiles.deletedAt` is non-null after delete (382–383, 504–505) and post-delete `GET` returns 404 (385–388, 422–426).

- **Surface-only assertions**
  - Reload coverage at 281–301 re-checks visible text; deliberately surface-only by design.

- **Missing negative cases**
  - None of these flows interact with the SO ↔ MO workflow at all. Not a coverage gap *for CRM*, but means there is zero test where a customer with active SOs has their project/contact deleted mid-order.
  - The blob-token skip (`test.skip(!hasBlobToken, …)`) silently skips the cleanup paths in CI runs without credentials — failures there are invisible.

- **Concurrent/race gaps**
  - None addressed.

- **Flake risks**
  - Heavy reliance on `getByRole("button", { name: /^Projects/ })` and similar regex matchers — vulnerable to copy changes like "Project files".
  - The `@vercel/blob` `list({ prefix })` polling (359–360, 383, 429, 466, 505) assumes immediate consistency from Vercel Blob; flake risk is low but real.

---

### `test/e2e/fast/manufacturing-write.spec.ts`

Size: 1473 LOC, 11 `test()` blocks.

- **What it asserts well**
  - Browser MO create + edit roundtrip with DB write verification (37–170).
  - Per-group remainder choices (172–312) — both `leave_loose` and `create_partial_group`, including duplicated copies on `/duplicate`.
  - Batch readiness rollups via `/api/manufacturing-orders` list (314–385).
  - Manufacturing-mode compatibility: product set to `batch` but BOM has no batch lines → falls back to `discrete` (387–448) — directly relevant to ingredient-binding regressions.
  - Out-of-order batch execution rejection on `/start`, `/pick`, `/complete` (929–967).
  - Approved alternate ingredient consumption + 4-decimal demand value (1309–1471).
  - `manufacturing_variance_gain`/`loss` event creation on actuals — though that lives in `manufacturing-actuals.spec.ts`, this spec asserts the *pick-time* event shape via `inventoryEvents` (1429–1444).

- **Surface-only assertions**
  - `expect(page.getByRole("row", { name: new RegExp(batchSandName) })).toContainText("9")` (896) — `9` substring will match "19", "90", "0.9", etc.
  - The duplicate dialog visibility check at 681 only asserts presence of the alertdialog; it does not assert the underlying `pickStatus` after the override is dismissed.

- **Missing negative cases**
  - The blocked batch (944) is asserted to return 400 but the response body is never read — a future regression that changes 400 → 409 with a generic "conflict" payload would still pass.
  - `priorityRank` reorder test (495–622) does not exercise a `PATCH` with a missing id list or a duplicate id list.
  - The "legacy template ingredient read is side-effect free" test (1150–1307) mutates the DB *into* a legacy shape directly (`db.delete(manufacturingOrderBatches)`), then verifies the GET is non-mutating. Good. But it never verifies that subsequent legacy *writes* (start/complete) still work, only that the read is idempotent.
  - No coverage for picking against a BOM line whose chosen alternate has been deleted post-create.

- **Concurrent/race gaps**
  - No concurrent `/duplicate` calls — duplication uses `nextval` for `MO-`. A double-click could expose a sequence skip.
  - No concurrent batch starts on different batches of the same order.

- **Flake risks**
  - `page.getByText("3 batches")` (894) and `page.getByText(/of up to 2 test-unit-/)` (895) are brittle to copy revision.
  - The `runBatch` helper at 972–1057 chains 3 sequential `expect.poll` blocks per batch with 15s timeouts; one slow projection rollup compounds into 45s+ of wall time before the actual failure surfaces.

---

### `test/e2e/fast/manufacturing-actuals.spec.ts`

Size: 490 LOC, 3 `test()` blocks.

- **What it asserts well**
  - Over- and under-consumption variance: writes `manufacturing_variance_gain` and `manufacturing_variance_loss` events with exact `quantity` (`0.0200`) and `itemId` (150–211).
  - 409 with `shortage.ingredients[].warningType: "stock_shortage"` payload when discrete actuals exceed stock (259–363).
  - Same shape for batch mode actuals (365–489).
  - Reads `manufacturingOrders.actualQuantity` to confirm the *rejected* completion left it null (361–362, 487–488) — guards "complete failed but state advanced" bugs.

- **Surface-only assertions**
  - None — this is a pure backend spec, all assertions are DB or API.

- **Missing negative cases**
  - No test for `actualConsumedQuantity: null` (missing key) — only over/under values.
  - No test for variance large enough to cross multiple lots in FIFO order (only single-lot scenarios).
  - No test that variance events carry `unitCost` / `extendedCost` reflecting the lot they came from — only `quantity` and `itemId` are asserted.

- **Concurrent/race gaps**
  - None. Two `/complete` calls on the same batch concurrently are not exercised — relevant because variance writes touch ledger and item balances.

- **Flake risks**
  - `expect(parseFloat(remainingSoil.onHandQty)).toBeCloseTo(198, 4)` (230) — tolerance `4` allows ±0.0001 drift; acceptable, but the same precision check at 246 / 256 makes a real 0.0001-precision regression undetectable.

---

### `test/e2e/fast/reservation-correctness.spec.ts`

Size: 563 LOC, 10 `test()` blocks.

- **What it asserts well**
  - Backorder demand: open SO with `confirmOversell: false` writes `demand=10`, `committed=4`, `shortage=6`, `availableToPromise=-6` (199–227).
  - Confirmed SO edits refresh reservations atomically and update `committedQty`, `demandQty`, `shortageQty`, `availableToPromise` (252–280).
  - Blocked-lot disposition excluded from `committedQty` even when SO confirmed (282–356).
  - MO release does *not* hard-reserve raw material (only writes demand) — exactly the bug class fixed recently (358–397).
  - Concurrent sales confirmations cannot reserve the same stock twice (458–488) — uses `Promise.all` and asserts exactly one wins (well, both 200s but second oversells; the test asserts the final balances rather than per-call outcomes).
  - Item-detail page surfaces stock commitments by customer (541–562).

- **Surface-only assertions**
  - Browser "shows partial reservation" test (490–539) — after creating the SO it only checks the "Open" label visibility, not any DB-driven UI value. The DB asserts that follow are good, but the UI half adds little signal.

- **Missing negative cases**
  - Concurrent SO confirms test (458–488) uses `confirmOversell: true` on both. It does *not* test "two concurrent confirms with `confirmOversell: false` and one must lose with a clear error".
  - No coverage for confirming an SO whose product has just been soft-deleted between create and confirm.
  - No coverage for "MO release competes with SO confirm for the same product's expected/committed pools".

- **Concurrent/race gaps**
  - Only one concurrency test, and it bypasses the negative-stock guard via `confirmOversell: true`. The harder race — two confirms competing under finite stock with the guard *engaged* — is uncovered.

- **Flake risks**
  - `await new Promise((resolve) => setTimeout(resolve, 25))` is not used here (good), but `Promise.all` on two HTTP calls is inherently weather-dependent for *which* arrives first.
  - `selectDate(page, …)` (511–512) navigates picker dialogs without waiting on the calendar to settle. Likely fine; observed to flake under load in similar tests.

---

### `test/e2e/fast/sales-write.spec.ts`

Size: 3526 LOC, 34 `test()` blocks. (No `test/e2e/fast/sales-order.spec.ts` exists.)

- **What it asserts well**
  - Customer create + edit + contacts + correspondence + projects with DB reads (149–302).
  - Sales-order create with full DB assertion on `customerName`, `shipDate`, lines, balance commits (361–556).
  - Allocation manager save flow — verifies "Need", "Allocated", "short" labels and the workspace API response shape (859–1000+).
  - Validation: empty lines (602–618), ship-before-order date (620–637) — both return readable error message + field-error array.
  - Duplicates (639–674) — DB read confirms `customerId`, `quantity`, `unitPrice` carry over.
  - Detail-page line delete with PUT (676–747) reduces lines from 2 to 1.
  - Reservations refresh on confirmed-order edit + planned-shipment line update (749–857).

- **Surface-only assertions**
  - The "no Xero invoice account warning" flow (539–548) — only checks visible link/href, not Xero state.
  - Many list-page checks (444–452) verify row existence + link href + tooltip text; useful, but per-test repetition of the same pattern.

- **Missing negative cases**
  - No "edit an SO that has a linked released MO" test. The unique SO ↔ MO interaction is uncovered in fast lane.
  - No test for the "stale client status downgrade" pattern (covered slow at sales-order.spec.ts:780, but fast lane would catch faster).
  - No allocation save with `quantity` that exceeds available — the success path is covered, the conflict path is not.
  - No coverage for confirming an SO whose linked customer's `pricingScheduleId` changed mid-edit.

- **Concurrent/race gaps**
  - None. All flows are serial.

- **Flake risks**
  - The Xero `integrationConnections` insertion (485–537) writes mutable test state into a shared org row via `onConflictDoUpdate` — concurrent sales-write specs could clobber each other if run in parallel. Fast lane uses 2 workers locally and 4 in CI.
  - `getByText("✓ complete")` at 996 — unicode glyph string match. Vulnerable to copy/style revision.
  - Allocation tests scrape numbers via regex `text(/^0$/)` (920) — likely to false-match unrelated zeros on the same panel.

---

### `test/e2e/reconciliation/kernel-invariants.spec.ts`

Size: 780 LOC, 12 `test()` blocks.

- **What it asserts well**
  - Idempotency claim replay vs. payload-change conflict (232–315) — the kernel's primary contract.
  - Pending-claim path: `IdempotencyInFlightError` raised on retry (317–360).
  - Business-operation replay end-to-end for items, sales-orders, PO submit, ship, MO release, SO delete (362–621) — each followed by `expectProjectionDiffClean(orgId, [itemId])`.
  - Concurrent shipments on the same stock: exactly one 200, one 4xx/409, projection clean (623–661).
  - Cross-flow concurrency: SO ship vs. MO ingredient pick on shared stock (663–706) — exactly one wins, projection clean.
  - Stocktake complete racing shipment: completion returns 409 with stale payload, projection still clean (708–778).

- **Surface-only assertions**
  - None — purely backend/DB.

- **Missing negative cases**
  - No replay coverage for MO complete (only release).
  - No replay coverage for stocktake complete itself outside the race path.
  - No replay coverage for SO confirm (the SO-create replay exists, but the confirm transition does not).
  - No reuse-vs-conflict test where the `Idempotency-Key` header is *omitted* on the second call — current tests always send the header.

- **Concurrent/race gaps**
  - Two-writer cases are covered; three-writer (e.g. SO ship + MO pick + stocktake complete) is not.
  - The 25ms `setTimeout` at 757 to nudge the race is a known anti-pattern — the test passes today but is timing-sensitive.

- **Flake risks**
  - `setTimeout(resolve, 25)` (757) — if the dev server is warm and the stocktake completion ever lands before the ship, the assertion at 769 (`shipResponse.status).toBe(200)`) flips.
  - The `expectProjectionDiffClean` helper is called inside each test; if the helper itself drifts it will mask real test failures. No test covers the helper.

---

## Cross-cutting findings

- **DB-fixture coverage is consistently strong.** Every spec uses the `db` Drizzle fixture with RLS to verify post-mutation state; the pattern is well-established. New specs should keep this pattern.

- **No test exercises the SO-confirm ↔ MO-release race.** Reservation-correctness covers two concurrent SO confirms; kernel-invariants covers SO ship vs. MO pick; nothing covers two writers racing the same product's `expectedQty` rollup at confirm + release time. Given the recent 16-fix history in allocation drift, this is the largest concurrent gap.

- **Negative-stock confirmation flow has no slow-spec coverage.** Every shortage path in the slow sales/MO specs passes `confirmOversell: true` or `confirmShortage: true`; the rejection path is exercised only in fast lane (manufacturing-actuals 409 and reservation-correctness backorder), never end-to-end with a UI confirm-or-cancel modal.

- **The MO ↔ SO snapshot rewrite path is tested only by manual DB mutation.** `sales-order.spec.ts:1297` nulls `salesOrderLineId` directly. `manufacturing-order.spec.ts:854` rewrites the SO line and re-reads — but no test rewrites the SO *line* while the linked MO is `released` or has picks attached. This is precisely the recent "sales-linked MO ingredient loading" bug class (commit 948c155e).

- **Concurrency coverage is mostly limited to one kernel spec.** Outside `kernel-invariants.spec.ts`, only `reservation-correctness.spec.ts:458` runs `Promise.all` on two API calls. Slow specs run strictly serially. Any new SO ↔ MO contention spec should be a new fast or kernel-level test rather than expanding the slow lane.

- **Lot-management drift is heavily tested at the receipt + ship layer, sparsely at allocation transitions.** Output allocation → lot hold (manufacturing-order.spec.ts:1944) is the only test that exercises a `stockAllocations` row transitioning from `sourceType: manufacturing_order` to `sourceType: inventory_lot`. Sales shipment allocation transitions (`sales_order_line` → `sales_shipment_line` on shipment plan) are asserted via balance rollups but never via direct `stockAllocations` row queries.

- **Status-text-only assertions are pervasive.** `getByText("Open", { exact: true })`, `getByText("Completed", { exact: true })`, `toContainText("Not started")` are scattered across all UI specs. A status-vocabulary refactor would silently break dozens of tests without a single backend-level assertion failure. Slow specs do back these with DB reads, but fast specs often do not.

- **Surface-side assertions over-rely on substring matches inside `table.first()`.** Cases like `toContainText("10")` (manufacturing-order.spec.ts:544) or `toContainText("9")` (manufacturing-write.spec.ts:896) match any text containing the digit. New specs should prefer `getByRole("cell", { name: "10", exact: true })` or DB-level checks.

- **Idempotency claims are tested for ship, release, confirm-create, SO delete, but NOT for SO confirm transition or MO complete.** Both are inventory-mutating endpoints with the same replay class — a clear gap.
