---
title: API Reference
description: A starter map for ERP resources and actions that should become formal public or agent-facing API docs.
section: Reference
order: 350
---

This is a product-facing reference map, not a finalized public API contract.

## Sales orders

Sales orders represent customer demand before and during fulfillment.

Common actions: create order, edit order, allocate stock, create shipment, ship order, delete draft or eligible order.

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

Inventory resources expose item cards, lots, ledger entries, balances, stocktakes, commitments, and expected supply.

Any future public API must preserve inventory invariants rather than exposing direct quantity mutation.
