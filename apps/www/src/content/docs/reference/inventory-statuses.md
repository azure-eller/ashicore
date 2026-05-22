---
title: Inventory Statuses
description: Definitions for on-hand, committed, available, expected, and blocked inventory.
section: Reference
order: 310
---

## Statuses

On hand is physical stock in Ashicore. Committed stock is reserved for demand. Available stock is usable stock after commitments and unavailable stock are considered. Expected stock is future supply from active inbound or production documents. Blocked stock exists but should not be promised or consumed.

## Allowed changes

On hand changes through receipts, manufacturing movements, shipments, stocktakes, opening stock, and corrections. Expected stock changes through ordered purchase orders and released manufacturing orders. Commitments change through allocation and release workflows.

## Blocked behavior

Blocked lots should not contribute to normal availability. Draft records should not create real stock.

## Related actions

Receive inventory, complete manufacturing, allocate stock, ship sales orders, and complete stocktakes.
