# Fast Test Seams

Only these fast spec files are allowed. Each file protects one heartbeat seam
that is worth running on every serious PR.

| File | Seam invariant |
| --- | --- |
| `auth-org-context.spec.ts` | Authenticated browser context has an active org and can access a protected app/API path. |
| `inventory-mutation-kernel.spec.ts` | Inventory mutations write events and reconcile lot/item projection truth, including stocktake count authority. |
| `stock-adjustment-route.spec.ts` | Stock adjustment route sets new on-hand and records a required reason in event metadata (rejects blank reason); the item list exposes lot-tracking mode for mobile adjustment gating; for lot-tracked items, per-lot targets edit existing lots and create new lots from an operator-supplied lot number. Positive adjustments cost like stocktake gains: new lots and non-lot increases use the item's resolved unit cost (not zero), existing-lot increases preserve the lot's own cost, an unknown lotId 404s, and a replayed multi-lot key writes no duplicate events. |
| `sales-demand-and-shipment.spec.ts` | Sales creates demand without premature stock consumption, and shipment consumes stock exactly once. |
| `purchasing-supply-and-receipt.spec.ts` | Purchasing creates expected supply and receipt converts it into physical stock. |
| `xero-purchase-bill-gates.spec.ts` | Purchase bill sync blocks unsafe accounting pushes before contacting Xero. |
| `manufacturing-demand-and-completion.spec.ts` | Manufacturing creates ingredient demand and completion consumes inputs while producing output once. |
| `planning-demand-queue.spec.ts` | Demand queue scarce-stock math covers higher-ranked demand first without overclaiming available stock. |
| `produced-today.spec.ts` | "Produced today" counts every completed production for the org day, including non-sellable intermediates — not only sellable finished goods. |
