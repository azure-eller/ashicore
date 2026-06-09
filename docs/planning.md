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
- `salesOrderProductionDemandPaths[]` for Production-page downstream attribution
- `PlanningRecommendation[]` with reason codes, source refs, warnings, and safe draft action payloads
- `inputHash` as the staleness marker for draft actions

Future agent tools should consume the snapshot and action payloads directly. They should not scrape raw sales, purchasing, manufacturing, or inventory tables.

## Production Downstream Demand

Production downstream rows are customer-demand attribution, not BOM/MO/source-ref drilldown.

- Direct sales-order demand for the card item stays flat on the card and does not create a downstream expander.
- A card can still expand when that item is also a sub-assembly in another uncovered sales-order-driven production path.
- Paths are sales-order-only. Safety stock and released manufacturing component demand remain in netting/blockers but do not create downstream paths.
- Supply allocation is per item across the combined demand queue. On-hand covers earliest demand first; open dated supply only covers demand due on or after that expected date.
- Null required dates sort after dated demand. Undated open supply does not cover dated sales-order paths.
- Path quantities stay exact normalized numeric strings; UI formatting handles rounded/discrete display.
- Emitted paths must not expose BOM revision IDs, manufacturing order IDs, manufacturing ingredient IDs, or raw `sourceRefs`.

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

Demand coverage follows the same active-demand boundary: confirmed and partially shipped sales orders are included, while draft sales orders and draft MOs are ignored.

Netting uses:

```ts
projectedQuantity = onHand + incomingPurchaseOrders + incomingManufacturingOrders - demand
shortageQuantity = Math.max(0, -projectedQuantity)
availableStock = Math.max(0, onHand)
```

`availableStock` is physical display context only. Queue coverage decides which demand is covered by that stock; the planning formula does not persist or subtract soft reservations because confirmed sales and released manufacturing component needs are already demand facts.

## Replenishment Status

Replenishment status is intentionally safety-stock based. The service avoids lead-time, cover-day, MOQ, and order-multiple fields because those values are often guesses and can imply false precision.

- `order_now`: projected stock is at or below safety stock, or there is a true shortage
- `order_soon`: projected stock is above safety stock but within 20% of it
- `stocked`: projected stock is more than 20% above safety stock

Items with zero safety stock and no shortage are `stocked` so the page does not create noise.

## BOM Explosion

BOM explosion uses current BOM revisions only. It recursively explodes shortages for manufactured products into component demand and carries parent demand source refs plus the BOM revision source ref into component facts.

Component quantities must use the BOM revision's recipe basis:

- `unit`: `outputQty * line.quantity`
- `batch`: `ceil(outputQty / bom.outputQuantity) * line.quantity`

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
