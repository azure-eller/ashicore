---
title: First Inventory Workflow
description: Set up items, opening lots, dispositions, and cost so the rest of the ERP has a trustworthy base.
section: Start here
order: 20
---

Run this workflow before building serious purchasing, manufacturing, or sales data. The goal is not to enter every item in the company. The goal is to prove that one real operating flow has correct stock, unit, lot, and cost behavior.

## Choose the first slice

Pick one finished product and the materials needed to make it, or pick one resale item that will be bought and shipped.

Avoid starting with the full catalog. A small, real slice exposes unit, cost, and workflow issues faster than a giant import.

## Create items

Create materials for purchased inputs. Create products for manufactured outputs.

Use the stock unit that operators use when counting physical inventory. If a supplier sells a tote but the shop measures gallons, stock the item in gallons and set purchase conversion separately.

Use stable SKUs. Renaming is survivable because documents snapshot names, but SKUs become operational references across labels, reports, imports, and conversations.

## Enter opening stock

Opening stock should create traceable inventory history.

For each item that physically exists:

1. Enter quantity in the stock unit.
2. Enter or confirm stock-unit cost.
3. Choose disposition.
4. Create the opening lot or adjustment.
5. Review the item balance, lot balance, and ledger.

If cost is unknown, stop and decide on a defensible starting cost. Null-cost inventory creates bad margin and manufacturing cost later.

## Check lot truth

The item balance should answer "how much do we have?" The lot list should answer "where did that quantity come from?" The ledger should answer "why did it change?"

If those three answers do not agree, fix the item before using it in purchasing, manufacturing, sales, or stocktakes.

## Add pressure

After the first item has trustworthy stock, add one workflow that changes it:

- receive a purchase order for material
- pick material into a manufacturing order
- complete product output
- ship a sales order
- complete a stocktake

Then check the same three places again: item balance, lot list, ledger.

## Common mistakes

Using the supplier purchase unit as the stock unit makes physical counts painful. Stock units should match how the shop counts and consumes.

Entering opening stock without cost pushes the problem into manufacturing and sales margin.

Treating blocked material as available will cause false promises.

## Related docs

Read [Inventory](/docs/concepts/inventory), [Receive Inventory](/docs/how-to/receive-inventory), and [Inventory Statuses](/docs/reference/inventory-statuses).
