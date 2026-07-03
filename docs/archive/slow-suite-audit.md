---
status: archived
---

# Slow Suite Audit

> **Archived — historical record, not current reference.** The rewrite shipped; the live registry is `test/e2e/slow/SLOW_TEST_STORIES.md`. See `docs/archive/README.md`.

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
| Planning | 1 | `demand-queue-allocation.spec.ts` |

Current footprint: 11 slow spec files and about 12.9k lines. The bloat is not the domain split itself; it is incident-shaped checks inside large serial files, especially SO/MO linkage, MO execute/fulfill, sales order, stocktake, and manufacturing order.

## Rewrite Result

The rewrite landed as 5 canonical story files with the executable source of
truth in `test/e2e/slow/SLOW_TEST_STORIES.md`. The old baseline below remains
as the decision record for what was folded, deleted, or deferred.

Standalone customer workspace and cost-basis browser stories were not kept.
Customer context is folded into sales fulfillment, and one compact cost-truth
assertion is folded into manufacturing execution. Cost permutations remain a
future verification concern, not slow Playwright scope.

Final story files:

| File | Lane | Story | Must prove | Not covered | Safety | Justification if needed |
| --- | --- | --- | --- | --- | --- | --- |
| `sales-fulfillment.spec.ts` | `ci:slow:sales` | A customer places an order, demand appears, stock is shipped partially/finally, and the order/inventory state remains correct. | customer snapshot/context, demand creation, partial/final shipment, order status, inventory consumption once, delete releases demand | every customer field, list rendering, stale UI copy, unrelated delete guard matrix | `serial-only` | Ordered lifecycle story. |
| `purchasing-receiving.spec.ts` | `ci:slow:purchasing` | A buyer creates a PO, receives it in parts, and expected supply becomes physical stock. | supplier/PO creation, create-time expected supply, partial receive, final receive, expected supply closed, lot/balance truth | every supplier field, table behavior, status copy | `serial-only` | Ordered lifecycle story. |
| `manufacturing-execution.spec.ts` | `ci:slow:manufacturing` | An operator creates/releases/picks/completes an MO and ingredient/output stock is correct. | BOM snapshot, release demand, pick, completion, output lot and compact cost truth, delete rolls back expected output | every error code, every idempotency replay, BR/RA incident archive | `serial-only` | Ordered lifecycle story. |
| `planning-demand-queue-story.spec.ts` | `ci:slow:planning` | A planner resolves scarce stock across ranked demand, expected PO/MO supply, and a shared component blocker. | rank priority, shortage, expected supply, shared component visibility, make/buy signal | every planning tab, drag/drop, parked planning flows, copy strings | `serial-only` | Cross-domain planning needs its own lane. |
| `stocktake-workflow.spec.ts` | `ci:slow:stocktake` | An operator opens a stocktake, saves/reloads sparse counts, completes, and sees reconciled state. | draft persistence, sparse counts, reload/continue, commit, completed reconciliation state | re-proving basic count-to-event math already covered by fast | `serial-only` | Ordered workflow story. |

Planning slow selection decision: `test:slow:planning` and `ci:slow:planning` are real lanes. `test:slow:inventory` and `ci:slow:inventory` are retired; inventory-affecting work routes to the relevant operating story plus `test:fast:inventory` / `verify:inventory`.

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
| Manufacturable/non-manufacturable production action tests | `fold` | `planning-demand-queue-story.spec.ts` or manufacturing story | Keep one representative make/buy or create-MO visibility assertion; delete duplicates. |
| Sales deletion guard tests, including skipped/fixme blocks | `delete` or `convert to verify:*` | Future verification only if needed | Current shape is stale-client and historical guard coverage, not the core operating story. |
| `customer-crm.spec.ts` UI create/reload | `rewrite` | `customer-sales-workspace.spec.ts` | Keep only if customer workspace data feeds sales/shipping/pricing context. |
| Customer file upload/download/delete cleanup | `delete` or defer | Future integration story | Credential-gated file storage checks are not a core slow story unless customer file management is declared first-class. |
| Project/customer file cleanup guards | `delete` | None | Storage cleanup edge cases should not anchor the slow lane. |
| `purchasing-order.spec.ts` overall | `keep` | `purchasing-receiving.spec.ts` | Already resembles a canonical operational story. Trim field breadth and incidental delete guard assertions. |
| Supplier all-fields create | `fold` | `purchasing-receiving.spec.ts` setup | Keep only fields needed for PO workflow. |
| PO create/edit/receive | `keep` | `purchasing-receiving.spec.ts` | Core purchasing lifecycle. |
| Partial/full receive | `keep` | `purchasing-receiving.spec.ts` | Core expected-to-physical transition. |
| Active delete guard in purchasing story | `fold` only if natural | `purchasing-receiving.spec.ts` | Keep only if it arises inside the PO lifecycle without expanding the story. |
| `manufacturing-order.spec.ts` overall | `rewrite` | `manufacturing-execution.spec.ts` | Contains the right MO lifecycle but should shrink to one operator story plus one or two class-level invariants. |
| BOM-backed fixtures and sales traceability | `fold` | `manufacturing-execution.spec.ts` setup | Keep as compact setup, preferably API-first. |
| Open MO create/link/edit/recalculate | `keep` | `manufacturing-execution.spec.ts` | Core MO setup and BOM snapshot behavior. |
| Create MOs from confirmed SO / skip non-manufacturable | `fold` | `planning-demand-queue-story.spec.ts` or manufacturing story | Keep one representative make-from-demand assertion; avoid duplicate SO/MO linkage coverage. |
| Delete released/in-progress MO returns expected/picked stock | `fold` | `manufacturing-execution.spec.ts` if natural | Keep one cancellation/reversal branch, not multiple deletion permutations. |
| Sales-allocated batch completion, FIFO completion, produced lot | `keep` | `manufacturing-execution.spec.ts` | This is the core stock correctness story. |
| Subassembly completion | `fold` | `manufacturing-execution.spec.ts` only if compact | Keep only if subassembly is central enough to the operator story. |
| MO expected output visibility / lot holds | `fold` | `planning-demand-queue-story.spec.ts` | Planning story owns expected output visibility. |
| Decimal ingredient and six-decimal cost precision | `convert to verify:*` unless naturally covered | `verify:inventory` or future `verify:cost-basis` | Precision math is better as deterministic verification unless it is part of the main MO workflow. |
| Active-item delete guard | `delete` or convert | Future verification | Not an operator-day story unless deletion is a domain workflow. |
| `mo-execute-and-fulfill.spec.ts` overall | `rewrite/delete heavily` | `manufacturing-execution.spec.ts`, `planning-demand-queue-story.spec.ts`, cost verification | This file is mostly scenario IDs, fixmes, API errors, derived values, and idempotency incidents. |
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
| Direct/bulk SO-linked MO create | `fold` | `planning-demand-queue-story.spec.ts` or manufacturing story | Keep one representative SO demand to MO claim path. |
| SO line rewrite / drift tests | `delete` or convert | Future domain verification | Historical stale-line regression shape. |
| Cancel/completed MO claim behavior | `fold` | manufacturing story | Keep one terminal/cancel state effect if natural. |
| Item delete/module permission guards | `delete` or auth lane if truly auth | None for slow rewrite | Mixed permission regression coverage; not a business story. |
| Parallel create/replay/concurrency tests | `convert to verify:*` or delete | Future domain verification | Preserve only a class-level invariant if the domain layer needs it; do not keep all variants. |
| Bulk atomic failure tests | `delete` or convert | Future verification | API atomicity matrix, not slow story. |
| Demand queue rewrite helpers/stale form tests | `delete` or convert | Future verification | Helper-specific regression coverage. |
| `demand-queue-allocation.spec.ts` MO ingredient demand vs sales demand | `keep/fold` | `planning-demand-queue-story.spec.ts` | Good candidate for the canonical planning story, especially shared component and expected MO output behavior. |
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

## Rewrite Implementation

- `test/e2e/slow/SLOW_TEST_STORIES.md` is the executable registry.
- `pnpm verify:slow-stories` enforces registry/file consistency and active test counts.
- `test/scenarios/mo-execute-and-fulfill/**` and `test/scenarios/so-mo-linkage/**` were deleted with the old scenario archives so their `test-specs.json` files cannot point at removed specs.
