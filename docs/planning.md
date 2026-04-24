---
read_when:
  - Working on MRP-lite or planning snapshots
  - Editing planning recommendations or draft buy/make actions
  - Exposing planning data to UI or future agent tools
---

# Planning

MRP-lite is deterministic and read-first. It builds one `PlanningSnapshot` from current projected inventory, confirmed demand, safety stock, open expected supply, and current BOM revisions. It does not persist runs, forecast, schedule capacity, or create autonomous supply.

## Snapshot Contract

The planning service returns stable structured objects:

- `PlanningItemRow[]` for netting results
- `DemandFact[]`, `SupplyFact[]`, `InventoryFact[]`, and `BomRequirementFact[]` for drilldown
- `PlanningRecommendation[]` with reason codes, source refs, warnings, and safe draft action payloads
- `inputHash` as the staleness marker for draft actions

Future agent tools should consume the snapshot and action payloads directly. They should not scrape raw sales, purchasing, manufacturing, or inventory tables.

## Netting

Demand sources:

- confirmed, non-deleted sales order lines
- safety stock targets
- remaining released manufacturing ingredient demand
- component demand from BOM explosion of parent shortages

Supply sources:

- projected on-hand inventory
- ordered or partially received purchase-order remaining quantities
- released manufacturing-order remaining output

Netting uses:

```ts
projectedQuantity = onHand + incomingPurchaseOrders + incomingManufacturingOrders - demand
shortageQuantity = Math.max(0, -projectedQuantity)
availableStock = Math.max(0, onHand - reserved)
```

`availableStock` is display context only. It excludes reserved stock so the UI does not imply reserved quantity is free, but the shortage formula does not subtract reservations again because confirmed sales and released manufacturing component needs are already demand facts.

## BOM Explosion

BOM explosion uses current BOM revisions only. It recursively explodes shortages for manufactured products into component demand and carries parent demand source refs plus the BOM revision source ref into component facts.

Limitations:

- maximum explosion depth is 8 levels
- cycles are skipped and surfaced as warnings
- deleted component items are excluded by the current-BOM query
- no finite scheduling, lead-time offsetting, scrap, or yield adjustment is applied

## Draft Actions

Planning actions create drafts only:

- `create_purchase_order` creates a draft PO from a current purchase recommendation
- `create_manufacturing_order` creates a draft MO from a current make recommendation

The server recomputes the snapshot before acting. `inputHash` is carried as a staleness marker, but unrelated org changes do not block an action when the same recommendation is still present. The current recommendation must match the submitted recommendation id, item, quantity, required date, supplier/BOM, and ingredients. If the recommendation disappeared or changed, the action returns `409`. Created drafts include a planning recommendation marker in notes so repeated clicks on the same recommendation are rejected.

Supplier suggestions are intentionally limited until item-level purchasing metadata exists:

- use the item's most recent active supplier from purchase-order history
- otherwise use the sole active supplier
- otherwise return `review_item_setup` with `missing_supplier` or `ambiguous_supplier`
