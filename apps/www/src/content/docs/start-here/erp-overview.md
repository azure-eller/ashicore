---
title: ERP Overview
description: How Ashicore connects inventory, purchasing, manufacturing, sales, planning, and accounting handoff.
section: Start here
order: 10
---

Ashicore is built for small manufacturers that need one operational record for materials, production, finished goods, customer demand, and purchasing. It is not a generic task tracker with item names attached. The system is organized around documents that change inventory in controlled ways.

## The operating model

Everything starts with inventory, but inventory is not an editable number. Inventory is the result of documented events:

- purchase receipts bring material into lots
- manufacturing picks consume ingredient lots
- manufacturing completion creates finished-product lots
- sales shipments consume finished-product lots
- stocktakes reconcile physical counts back to the ledger
- dispositions decide whether stock is available, blocked, or rejected

Purchasing, manufacturing, sales, and stocktakes all talk to the inventory kernel. That is what keeps on-hand quantity, available quantity, committed demand, expected supply, lot cost, and audit history aligned.

## The daily flow

A normal make-and-ship business day usually looks like this:

1. Sales enters customer demand as sales orders.
2. Planning shows which products are short after on-hand stock and open supply are considered.
3. Purchasing creates or imports purchase orders for materials.
4. Receiving turns arrived purchase order lines into lot-backed inventory.
5. Manufacturing creates orders from recipes, releases expected output, picks ingredients, and completes product lots.
6. Sales allocates available finished goods or released manufacturing supply to customer demand.
7. Shipping consumes stock and closes the fulfillment loop.
8. Accounting receives clean operational documents instead of raw spreadsheet guesses.

The most important rule: stock changes when physical or committed reality changes, not when someone edits a note.

## The records that matter

Materials are purchased inputs. Products are manufactured outputs. Both are operational items with units, SKUs, costs, and lots.

Lots are the physical stock layers. Lot cost is what later drives consumption cost and shipment margin.

Purchase orders create expected material supply after they are ordered. Receiving a purchase order releases expected supply and creates lots.

Manufacturing orders create finished-good expected supply after release. They also create ingredient demand. Picking consumes ingredients; completion creates finished-product lots.

Sales orders create customer demand after confirmation. Planned shipments split that demand into physical fulfillment events. Shipping consumes stock.

Stocktakes are controlled inventory reconciliations. They do not rewrite history; they write gain, loss, or verification events.

## What users should trust

Use on-hand quantity to answer "what physically exists?"

Use available quantity to answer "what can I promise right now?"

Use expected quantity to answer "what is already on its way from purchasing or production?"

Use committed quantity to answer "what has already been promised to sales or production?"

Use planning to answer "what should we buy or make next?"

## What Ashicore deliberately does not do yet

Ashicore keeps v1 workflows narrow. It does not try to be a full APS scheduler, payroll system, warehouse management system, or accounting ledger. It does not model every alternate unit, every work-center detail, every freight invoice, or every production variance account.

That restraint is intentional. The operational record must be correct before the system adds more automation.

## Recommended reading path

Start with [Inventory](/docs/concepts/inventory), then read [Purchasing and Receiving](/docs/how-to/receive-inventory), [Manufacturing Orders](/docs/concepts/manufacturing-orders), [Sales Fulfillment](/docs/start-here/first-sales-workflow), and [Delete Rules](/docs/reference/delete-rules).
