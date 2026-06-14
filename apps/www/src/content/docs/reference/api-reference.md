---
title: API Reference
description: Current API and agent-access boundaries for Ashicore resources and actions.
section: Reference
order: 350
---

Ashicore's browser app uses internal REST routes. External agent access is
narrower: read operational context through the agent surfaces, and stage allowed
changes for user review. Do not treat inventory quantity as a writable field.

## Shared response rules

API payloads preserve exact decimals as strings. Exact quantities, costs, and
money values should not be coerced to JavaScript numbers.

Field validation failures use:

```json
{ "error": "Ship date is required", "errors": { "shipDate": ["Ship date is required"] } }
```

General failures use:

```json
{ "error": "Purchase order not found" }
```

## Agent access

The in-app agent can query live ERP facts through a read-only SQL tool scoped to
the current organization. Queries must be `SELECT` statements and should include
`LIMIT`.

For inventory quantities, agents should use the canonical
`agent_query.items_stock` view. It carries the inventory-kernel math for
on-hand, demand, available, and expected quantities. Agents should not recompute
availability directly from lot rows.

Agent writes are staged, not committed. The agent lists allowed actions,
describes the input schema, validates a draft, and stages it for user review.
The user reviews, edits, and approves before the app commits anything.

The remote MCP surface exposes read-only production-planning context through the
agent access settings and token flow.

## Sales orders

Sales orders represent customer demand before and during fulfillment.

Common actions: create order, edit eligible open order, allocate stock, create shipment, ship order, delete eligible open order.

Important entities: sales orders, sales order lines, shipments, shipment lines, customers, addresses, allocations.

## Purchase orders

Purchase orders represent supplier demand and expected inbound supply.

Common actions: create order, submit/order, receive, edit eligible quantities, delete eligible order.

Important entities: purchase orders, purchase order lines, suppliers, supplier items, receipt lots, expected supply.

## Manufacturing orders

Manufacturing orders represent production demand and finished output.

Common actions: create order, release, pick or consume materials, complete order, review output.

Important entities: manufacturing orders, recipe snapshots, material lines, output lots, operation costs.

## Inventory

Inventory resources expose item cards, lots, ledger entries, balances, stocktakes, demand coverage, and expected supply.

Any public or agent-facing API must preserve inventory invariants rather than exposing direct quantity mutation. Stock, lots, costs, demand, expected supply, dispositions, and physical execution go through the inventory/domain paths.
