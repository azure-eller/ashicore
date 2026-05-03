---
read_when:
  - Planning next repository milestones
  - Deciding what "done enough" means for a small-scale MRP rollout
  - Choosing which features to build now vs defer
---

# Small-Scale MRP Roadmap

## Target Operating Model

This repo should support a simple, usable small-scale MRP workflow:

- single organization
- single location
- lot-backed stock
- materials, products, BOMs, suppliers, and customers
- draft-to-complete workflows for purchasing, manufacturing, sales, and stocktakes
- one operational home screen that shows what needs attention today

The goal is not to build a full ERP. The goal is to make day-to-day execution reliable:

- what do we need to buy?
- what do we need to make?
- what is late or blocked?
- what stock needs to be reconciled?

## Current State

The transactional core already exists:

- inventory items with `stock`, `committedQty`, `expectedQty`, and `safetyStock`
- lot-backed stock and FIFO consumption
- purchase orders with receiving
- manufacturing orders with release and completion
- sales orders with confirmation and fulfillment
- stocktakes with reconcile-on-complete behavior
- team roles and module guards

The main gap is operational control. The repo currently behaves more like a set of solid module screens than a single daily workspace for a small operator.

## Ordered Roadmap

### 1. Clean baseline

Before more feature work:

- replace the default `README.md` with real setup and workflow docs
- add normal CI for `pnpm build`, `pnpm lint`, and a Playwright slice
- remove or relabel any fake multi-location affordances

Why first:

- keeps the repo honest
- makes future feature work cheaper to review and ship

### 2. Add an operations home screen

Replace root redirects with a real role-aware dashboard.

This page should answer:

- what is below target?
- what is overdue?
- what needs receiving?
- what needs fulfillment?
- what needs counting?

This should be an exception dashboard, not a BI dashboard.

### 3. Add exception queries behind the dashboard

First pass should include:

- materials below calculated stock target
- products below calculated stock target
- released manufacturing orders due soon or overdue
- purchase orders overdue or partially received
- confirmed sales orders that are at risk on live stock
- active draft stocktakes

Keep this query layer focused on actionability, not trend reporting.

### 4. Add guided buy/make actions

From the dashboard, allow users to start the next action immediately:

- create draft purchase order from a shortage row
- create draft manufacturing order from a shortage row

Keep this manual and draft-first:

- no auto-generated orders
- no reservations
- no background planning engine

### 5. Turn list pages into work queues

The current tables are good lookup screens. They should become queue screens.

Add:

- URL-backed status filters
- open vs history views
- overdue highlighting
- quick "needs attention" slices

Apply this to:

- sales orders
- purchase orders
- manufacturing orders
- stocktakes

### 6. Add minimal purchasing planning metadata

To make buy recommendations usable, materials should gain:

- optional preferred supplier
- optional supplier SKU
- optional lead time in days

Keep this intentionally small:

- one preferred supplier per material
- no vendor matrix
- no price breaks
- no pack-size conversion engine

### 7. Improve inventory audit quality

Small MRP systems fail when stock cannot be trusted.

Improve item history so users can see:

- movement type
- reference type and reference id or link
- actor
- clearer reason for edit-time adjustments

This should make stock history readable without database access.

### 8. Add supply-vs-demand drilldown on item detail

For any item, users should be able to answer why it is short.

Show:

- current stock
- committed quantity
- expected quantity
- safety stock
- open sales demand
- open purchasing supply
- released manufacturing supply

Keep this read-only at first.

### 9. Add lightweight owner reporting

After the operational loop is solid, add simple reports:

- inventory valuation
- open demand vs supply snapshot

Do not prioritize margin reporting yet unless fulfillment cost is stored explicitly in the sales domain.

## Minimum Viable Cut Line

The smallest acceptable small-scale MRP release is:

1. clean baseline
2. operations dashboard
3. exception queries
4. guided buy/make draft actions

That is the point where the product becomes a coherent operating tool instead of a set of transaction screens.

## Trustworthy Operating Cut Line

The next layer after MVP is:

5. queue-oriented lists
6. minimal purchasing planning metadata
7. improved audit visibility

That is the point where a small team can run on it with less manual coordination and less fear of hidden stock mistakes.

## Explicitly Deferred

These should stay out of scope for now:

- multi-location or bin tracking
- auto-generated MRP runs
- reservation logic
- work centers, labor, or overhead costing
- finite-capacity scheduling
- accounting ledger, AP/AR, GL, or payments
- full invoicing workflows beyond active Xero document sync
- returns workflows
- partial manufacturing completion
- partial sales fulfillment
- multi-supplier purchasing optimization

## Execution Guidance

Use small PRs that each add or extend a Playwright workflow.

Recommended execution order:

1. baseline and CI
2. operations dashboard shell
3. dashboard queries
4. guided actions
5. queue filters
6. purchasing planning metadata
7. stock audit improvements
8. item supply-demand drilldown
9. lightweight reporting

If tradeoffs come up, prefer:

- better visibility over more automation
- draft-first actions over background generation
- auditability over cleverness
- single-location clarity over premature scalability
