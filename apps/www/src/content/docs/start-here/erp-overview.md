---
title: ERP Overview
description: The shortest mental model for how Ashicore connects inventory, purchasing, manufacturing, sales, and accounting.
section: Start here
order: 10
---

Ashicore is an operating system for small manufacturers. Its job is to keep customer demand, inbound supply, production work, physical stock, and accounting handoff aligned.

## User problem

Small teams usually run operations through spreadsheets, accounting exports, paper batch notes, and memory. That works until the same material is promised twice, a purchase order is forgotten, or finished goods are made without knowing whether the ingredients were actually available.

Ashicore makes the operational record explicit. It tracks what exists, what is promised, what is inbound, what needs to be made, and which document caused each change.

## Mental model

Think in flows, not modules:

1. Buy materials.
2. Receive materials into lots.
3. Make products from recipes.
4. Allocate products to customer demand.
5. Ship what physically leaves.
6. Reconcile stock when reality and the system differ.
7. Push clean financial documents to accounting.

Inventory is the shared truth underneath those flows. Purchasing, manufacturing, sales, and stocktakes should never bypass it.

## Core records

Materials and products are the items your team buys, makes, stocks, or sells. Lots are the physical stock layers behind each item. Purchase orders create inbound supply, manufacturing orders create production demand and output, sales orders create customer demand, and stocktakes reconcile the system against physical counts.

## Where to start

Start with a real workflow, not a perfect setup project. If you manufacture, create a product, recipe, opening material stock, manufacturing order, and finished output. If you distribute, create items, opening stock, customers, a sales order, allocation, and shipment.

Once the first workflow is trusted, add breadth: more items, suppliers, customers, purchase defaults, permissions, accounting, and reports.
