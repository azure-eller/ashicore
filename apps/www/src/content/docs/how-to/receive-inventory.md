---
title: Receive Inventory
description: Receive purchase order quantities into lot-backed stock with correct cost and expected-supply cleanup.
section: How-to
order: 210
---

Use receiving when material has physically arrived and the system should show that stock as present. Do not receive stock early just to make planning look better. Ordered purchase orders already provide expected supply.

## Before receiving

Check the purchase order status. Receiving is valid for ordered or partially received purchase orders.

Check the line unit. Purchase orders may use a purchase unit, while inventory stocks in a smaller stock unit. The receipt must land in the stock unit and use the converted stock-unit cost.

Check additional costs. Distributed landed costs affect stock-unit cost for future receipts. Costs marked not distributed only affect the purchase order total.

## Steps

1. Open the purchase order.
2. Review supplier, line item, ordered quantity, received quantity, and remaining quantity.
3. Enter the quantity that physically arrived for each line.
4. Choose disposition: available for usable material, blocked for material that exists but should not be promised.
5. Confirm the receipt.
6. Review the created lots and inventory ledger.

Blank receive inputs are ignored. Each non-zero received line creates a new internal lot.

## What happens after confirmation

Ashicore writes one purchase receipt inventory event per received lot. The received quantity becomes on-hand stock. If the lot is available, it can become promiseable supply; if blocked, it exists but stays out of normal allocation.

The system also releases the matching expected supply. A purchase order for 100 gallons that receives 40 gallons should now show 40 received and 60 remaining expected.

Receipt lot cost is saved at receipt time. Later landed-cost edits may create
controlled revaluation events for eligible on-hand tracked lots; they should not
silently rewrite receipt history.

## Partial receipts

Use partial receiving when only part of the order arrived.

Example: a PO line orders 500 lb. The supplier delivers 300 lb today. Receive 300 lb. The order remains partially received and 200 lb remains expected supply. When the rest arrives, receive the remaining quantity into a new lot.

Do not reduce an ordered quantity below what has already been received. Received history must remain intact.

## Blocked receipts

Use blocked disposition when stock is physically present but not ready for use. Common reasons include inspection, damaged packaging, quarantine, or pending quality approval.

Blocked stock should not satisfy customer promises or production picks until a user moves it to available through the proper disposition workflow.

## Common mistakes

Receiving against the wrong unit creates bad cost and quantity history. Check whether the price is per tote, bag, pallet, pound, gallon, or yard.

Receiving before arrival hides purchasing problems and can make sales or manufacturing believe stock is usable.

Editing quantities after partial receipt should affect future receipts only.
Landed-cost edits use the controlled revaluation path instead of silently
rewriting lots that already exist.

## Related docs

Read [Purchasing Setup](/docs/admin/setup), [Purchase Order Statuses](/docs/reference/purchase-order-statuses), and [Inventory](/docs/concepts/inventory).
