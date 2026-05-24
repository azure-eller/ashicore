---
read_when:
  - Rewriting slow Playwright specs
  - Deciding whether old slow coverage should stay, fold, delete, or become verification
  - Adding or reviewing entries in test/e2e/slow/SLOW_TEST_STORIES.md
---

# Slow Suite Audit

## Goal

The slow lane should simulate an operating day for a small manufacturer. It should not become the archive for every bug the fast lane no longer carries.

Use this rule when rewriting the suite:

> Slow tests are not bug archives. A slow spec must be a realistic operational story that a real small manufacturer would recognize. Edge cases may appear only when they naturally occur inside that story.

## Baseline

Current executable slow suite:

| Area | Current files | Notes |
| --- | ---: | --- |
| Sales/customer | 2 | `sales-order.spec.ts`, `customer-crm.spec.ts` |
| Purchasing | 1 | `purchasing-order.spec.ts` |
| Manufacturing/SO-MO | 3 | `manufacturing-order.spec.ts`, `mo-execute-and-fulfill.spec.ts`, `so-mo-linkage.spec.ts` |
| Inventory/catalog/cost/stocktake | 4 | `inventory-form.spec.ts`, `inventory-visibility.spec.ts`, `cost-basis-story.spec.ts`, `stocktake.spec.ts` |
| Planning/allocation | 1 | `demand-queue-allocation.spec.ts` |

Current footprint: 11 slow spec files and about 12.9k lines. The bloat is not the domain split itself; it is incident-shaped checks inside large serial files, especially SO/MO linkage, MO execute/fulfill, sales order, stocktake, and manufacturing order.

## Rewrite Target

Rewrite size target: 5-7 canonical story files, guard max 9 slow spec files, roughly 40-50 active `test()` blocks total unless the registry justifies more, and materially less line count than today.

Target story files for the rewrite PR:

| File | Lane | Story | Must prove | Not covered | Safety | Justification if needed |
| --- | --- | --- | --- | --- | --- | --- |
| `sales-fulfillment.spec.ts` | `ci:slow:sales` | A customer places an order, demand appears, stock is shipped partially/finally, and the order/inventory state remains correct. | customer snapshot/context, demand creation, partial/final shipment, order status, inventory consumption once | every customer field, list rendering, stale UI copy, unrelated delete guards | `serial-only` | Ordered lifecycle story. |
| `purchasing-receiving.spec.ts` | `ci:slow:purchasing` | A buyer creates/submits a PO, receives it in parts, and expected supply becomes physical stock. | supplier/PO creation, submit, partial receive, final receive, expected supply closed, lot/balance truth | every supplier field, table behavior, status copy | `serial-only` | Ordered lifecycle story. |
| `manufacturing-execution.spec.ts` | `ci:slow:manufacturing` | An operator creates/releases/picks/completes an MO and ingredient/output stock is correct. | BOM snapshot, release demand, pick, completion, FIFO or lot output, subassembly only if compact | every error code, every idempotency replay, BR/RA incident archive | `serial-only` | Ordered lifecycle story. |
| `planning-allocation-story.spec.ts` | `ci:slow:planning` | A planner resolves scarce stock across ranked demand, expected PO/MO supply, and a shared component blocker. | rank priority, shortage, expected supply, shared component visibility, make/buy signal | every planning tab, drag/drop, parked planning flows, copy strings | `serial-only` | Cross-domain planning needs its own lane. |
| `stocktake-workflow.spec.ts` | `ci:slow:stocktake` | An operator opens a stocktake, counts lots, saves/reloads, completes, and sees reconciled state. | draft persistence, sparse counts, reload/continue, stale warning if natural, commit, visible reconciliation | re-proving basic count-to-event math already covered by fast | `serial-only` | Ordered workflow story. |
| `customer-sales-workspace.spec.ts` | `ci:slow:sales` | Customer contact/shipping/pricing context flows into downstream sales work. | customer workspace persistence only where it affects order or shipment context | generic CRM breadth, storage cleanup unless first-class and CI-stable | `serial-only` | Default delete/defer unless the rewrite proves this feeds sales operations. |
| `cost-basis-story.spec.ts` | `ci:slow:inventory` | A real inventory-cost workflow changes stock and exposes correct cost truth. | cost across at least two stock events, stockout or stocktake effect, business-visible cost truth | pure math permutations better suited for existing `verify:inventory` or a future verification lane | `serial-only` | Default delete/defer unless the rewrite proves this is an operator workflow. |

Planning slow selection decision: add `test:slow:planning` and `ci:slow:planning` in the rewrite PR. Planning is cross-domain and should not hide under sales or manufacturing once it has a real canonical story.

## Current File Decisions

| Current file/group | Decision | Target | Rationale |
| --- | --- | --- | --- |
| `sales-order.spec.ts` overall | `rewrite` | `sales-fulfillment.spec.ts` | Contains the right sales lifecycle but mixes setup, customer CRUD, pricing, production action visibility, stale status, deletion guards, and skipped/fixme material. |
| Sales fixture setup | `fold` | `sales-fulfillment.spec.ts` | Keep as setup only; use API/fixtures where possible so the story starts quickly. |
| Customer create/edit/minimal customer tests | `fold` | `customer-sales-workspace.spec.ts` or sales setup | Keep only customer fields that feed order/shipping/pricing context. Delete generic form breadth. |
| Pricing category/schedule assignment | `fold` | `customer-sales-workspace.spec.ts` if pricing context is used by order | Keep only if the rewritten story asserts downstream order pricing behavior. |
| Confirmed order create/edit/demand tests | `keep` | `sales-fulfillment.spec.ts` | This is the core sales operating story. |
| Open shortage order delete | `fold` | `sales-fulfillment.spec.ts` or planning story | Keep only if it proves demand release in the main story. |
| Confirmed order cards/actions/status UI tests | `delete` | None | These are UI surface checks unless tied directly to completing the order workflow. |
| Manufacturable/non-manufacturable production action tests | `fold` | `planning-allocation-story.spec.ts` or manufacturing story | Keep one representative make/buy or create-MO visibility assertion; delete duplicates. |
| Sales deletion guard tests, including skipped/fixme blocks | `delete` or `convert to verify:*` | Future verification only if needed | Current shape is stale-client and historical guard coverage, not the core operating story. |
| `customer-crm.spec.ts` UI create/reload | `rewrite` | `customer-sales-workspace.spec.ts` | Keep only if customer workspace data feeds sales/shipping/pricing context. |
| Customer file upload/download/delete cleanup | `delete` or defer | Future integration story | Credential-gated file storage checks are not a core slow story unless customer file management is declared first-class. |
| Project/customer file cleanup guards | `delete` | None | Storage cleanup edge cases should not anchor the slow lane. |
| `purchasing-order.spec.ts` overall | `keep` | `purchasing-receiving.spec.ts` | Already resembles a canonical operational story. Trim field breadth and incidental delete guard assertions. |
| Supplier all-fields create | `fold` | `purchasing-receiving.spec.ts` setup | Keep only fields needed for PO workflow. |
| Draft PO create/edit/submit | `keep` | `purchasing-receiving.spec.ts` | Core purchasing lifecycle. |
| Partial/full receive | `keep` | `purchasing-receiving.spec.ts` | Core expected-to-physical transition. |
| Active delete guard in submit test | `fold` only if natural | `purchasing-receiving.spec.ts` | Keep only if it arises inside the PO lifecycle without expanding the story. |
| `manufacturing-order.spec.ts` overall | `rewrite` | `manufacturing-execution.spec.ts` | Contains the right MO lifecycle but should shrink to one operator story plus one or two class-level invariants. |
| BOM-backed fixtures and sales traceability | `fold` | `manufacturing-execution.spec.ts` setup | Keep as compact setup, preferably API-first. |
| Open MO create/link/edit/recalculate | `keep` | `manufacturing-execution.spec.ts` | Core MO setup and BOM snapshot behavior. |
| Create MOs from confirmed SO / skip non-manufacturable | `fold` | `planning-allocation-story.spec.ts` or manufacturing story | Keep one representative make-from-demand assertion; avoid duplicate SO/MO linkage coverage. |
| Delete released/in-progress MO returns expected/picked stock | `fold` | `manufacturing-execution.spec.ts` if natural | Keep one cancellation/reversal branch, not multiple deletion permutations. |
| Sales-allocated batch completion, FIFO completion, produced lot | `keep` | `manufacturing-execution.spec.ts` | This is the core stock correctness story. |
| Subassembly completion | `fold` | `manufacturing-execution.spec.ts` only if compact | Keep only if subassembly is central enough to the operator story. |
| MO output allocation promises / lot holds | `fold` | `planning-allocation-story.spec.ts` | Planning/allocation story owns expected output visibility. |
| Decimal ingredient and six-decimal cost precision | `convert to verify:*` unless naturally covered | `verify:inventory` or future `verify:cost-basis` | Precision math is better as deterministic verification unless it is part of the main MO workflow. |
| Active-item delete guard | `delete` or convert | Future verification | Not an operator-day story unless deletion is a domain workflow. |
| `mo-execute-and-fulfill.spec.ts` overall | `rewrite/delete heavily` | `manufacturing-execution.spec.ts`, `planning-allocation-story.spec.ts`, cost verification | This file is mostly scenario IDs, fixmes, API errors, derived values, and idempotency incidents. |
| S01/S02 cross-feature MO execute/fulfill | `fold` | `manufacturing-execution.spec.ts` | Keep one real end-to-end release/pick/complete/ship path if it can be made active and compact. |
| S03/S04/S06/S22 fixmes | `delete` | None | Parked fixmes should not survive the rewrite. |
| S05/S07 negative-stock override errors | `delete` or convert | Future verification if still core | Error override behavior is not a canonical slow story. |
| S09/S10 cost derived values | `convert to verify:*` | Existing `verify:inventory` or future cost verification | Cost math should move out of browser unless tied to an operator workflow. |
| S11 missing cost basis error | `delete` or convert | Future verification | Historical error-path guard. |
| S12 expected supply deltas | `fold` | manufacturing or planning story | Keep one expected-supply transition if it is part of the story. |
| S13 output reversal | `fold` only if chosen as reversal branch | manufacturing story | Keep at most one reversal/cancel branch. |
| S14/S20 no double-deduct/idempotent complete | `fold` | manufacturing story or verification | Keep one class-level invariant if compact; do not keep replay matrix. |
| S17 shipment costs margin side effects | `delete` | None | Accounting/BOL side-effect guard is not the MO operating story. |
| S19/S21 concurrency/idempotency | `convert to verify:*` or delete | Future domain verification | Concurrency safety is important, but browser slow is a poor default home. |
| `so-mo-linkage.spec.ts` overall | `rewrite/delete heavily` | planning/manufacturing stories | This is the largest regression archive: BR/RA/T incident naming, races, stale forms, bulk operations, and permissions. |
| Direct/bulk SO-linked MO create | `fold` | `planning-allocation-story.spec.ts` or manufacturing story | Keep one representative SO demand to MO claim path. |
| SO line rewrite / drift tests | `delete` or convert | Future domain verification | Historical stale-line regression shape. |
| Cancel/completed MO claim behavior | `fold` | manufacturing story | Keep one terminal/cancel state effect if natural. |
| Item delete/module permission guards | `delete` or auth lane if truly auth | None for slow rewrite | Mixed permission regression coverage; not a business story. |
| Parallel create/replay/concurrency tests | `convert to verify:*` or delete | Future domain verification | Preserve only a class-level invariant if the domain layer needs it; do not keep all variants. |
| Bulk atomic failure tests | `delete` or convert | Future verification | API atomicity matrix, not slow story. |
| Allocation rewrite helpers/stale form tests | `delete` or convert | Future verification | Helper-specific regression coverage. |
| `demand-queue-allocation.spec.ts` manual reservation | `fold` | `planning-allocation-story.spec.ts` if still supported | Keep only if manual reservation is part of the compact planning story. |
| `demand-queue-allocation.spec.ts` MO ingredient demand vs sales demand | `keep/fold` | `planning-allocation-story.spec.ts` | Good candidate for the canonical planning story, especially shared component and expected MO output behavior. |
| `stocktake.spec.ts` overall | `rewrite` | `stocktake-workflow.spec.ts` | Keep workflow persistence and reconciliation; remove duplicate cost/math branches. |
| Fixture creation | `fold` | stocktake setup | Use compact setup. |
| Positive stock default purchase price requirement | `convert to verify:*` or cost story | `verify:inventory` or `cost-basis-story.spec.ts` | Validation/cost math, not stocktake workflow. |
| All-items stocktake and draft item delete block | `fold` | stocktake story if natural | Keep all-items creation; delete item-delete guard unless needed. |
| Category-scoped stocktake via API | `delete` | None | Scope variant, not canonical operator story. |
| Clone line items from table actions | `delete` | None | UI action detail, not the stocktake story. |
| Sparse save/clear/reload counts | `keep` | `stocktake-workflow.spec.ts` | Core operator workflow. |
| Complete dirty counts/no movement when live matches | `fold` | stocktake story | Keep if it supports workflow truth without duplicating fast. |
| Partial counted lots | `keep` | `stocktake-workflow.spec.ts` | Real stocktake workflow behavior. |
| Stale completion warning/snapshots | `fold` | stocktake story | Keep one stale warning if it occurs naturally. |
| Delete draft without inventory mutation | `fold` only if compact | stocktake story | Keep if it completes the lifecycle. |
| Product/material opening stock cost tests | `convert to verify:*` | Existing `verify:inventory` or future cost verification | Cost derivation belongs in deterministic verification unless the cost story keeps it. |
| `cost-basis-story.spec.ts` API-only create/override/opening balance | `convert to verify:*` | Existing `verify:inventory` or future cost verification | API-only cost setup is not a Playwright slow story. |
| Receipt weighted average/stockout historical lot cost | `keep` if workflow-visible | `cost-basis-story.spec.ts` or verification | Keep only if rewritten around real receipt/stock movement with business-visible cost truth. |
| Stocktake gains/losses do not rewrite cost | `fold` or convert | stocktake/cost story or verification | Class-level invariant, not a standalone branch. |
| Default purchase price/manual positive stock fallbacks | `convert to verify:*` | Existing `verify:inventory` or future cost verification | Pure cost fallback permutations. |
| `inventory-form.spec.ts` overall | `rewrite` | catalog story only if needed | Current file mixes catalog card, sidebar/UI state, low-stock display, BOM form, API validation. |
| Active organization/sidebar placeholder check | `delete` | None | UI shell check, not slow operating story. |
| Material create/edit/autosave/minimal required | `fold` | `customer-sales-workspace.spec.ts` only if downstream context, or future catalog story | Keep catalog mutation only if it feeds an operating workflow. |
| Low-stock indicator | `delete` or planning story if blocker | None by default | Visual/status check unless planning story needs it. |
| Product without BOM / 3-row BOM / BOM edit | `fold` | `manufacturing-execution.spec.ts` setup if needed | Keep only the BOM construction required for MO workflow. |
| Non-positive BOM quantity API rejection | `delete` or convert | Future verification | API validation guard. |
| `inventory-visibility.spec.ts` overall | `delete` | None by default | Revenue ranking and variant grouping are UI/list visibility, not canonical slow operations. |
| Revenue-ranked products setup | `delete` | None | Historical list/ranking setup. |
| Product alphabetical variant grouping | `delete` | None | UI sorting/grouping detail. |

## Rewrite Rules

- Prefer deleting old coverage over moving it to a new slow story.
- Fold class-level invariants only into the nearest story when they are compact and business-critical.
- Convert pure math, idempotency, concurrency, schema, redaction, and validation checks to `verify:*` candidates instead of Playwright slow.
- `verify:cost-basis` does not exist today and is not hidden scope for the slow rewrite. Design it separately only if cost-basis coverage is still needed after the rewrite.
- Do not keep skipped or fixme slow tests during the rewrite unless they are made active inside a canonical story.
- Keep story setup narrow. Use API/DB helpers for prerequisites unless creating the prerequisite is part of the story.
- If one story needs more than eight active tests, explain why in `SLOW_TEST_STORIES.md` rather than splitting the story into artificial files.
- Legacy `test/scenarios/**` audit/spec JSON files are out of executable slow-lane scope. The rewrite should mark them superseded or update/delete scenario metadata only when a rewritten story directly relies on it.
- Auth/team remains in the existing auth lane. It should follow the same no-bug-archive principle, but it is not part of this slow-domain rewrite.

## Follow-Up Rewrite Work

1. Add `test/e2e/slow/SLOW_TEST_STORIES.md` using the target registry table above.
2. Add a simple slow registry guard:
   - Every slow spec file is listed in the registry.
   - Every registry file exists.
   - Slow spec file count is at most 9.
   - Multiple files under the same lane require a non-empty justification.
3. Add `test:slow:planning` and `ci:slow:planning`.
4. Rename/rewrite the executable slow specs to the target story names.
5. Delete or convert the remaining historical regression coverage according to this audit.
