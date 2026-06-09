# Fast Test Seams

Only these fast spec files are allowed. Each file protects one heartbeat seam
that is worth running on every serious PR.

| File | Seam invariant |
| --- | --- |
| `auth-org-context.spec.ts` | Authenticated browser context has an active org and can access a protected app/API path. |
| `inventory-mutation-kernel.spec.ts` | Inventory mutations write events and reconcile lot/item projection truth, including onboarding import opening balances, stocktake count authority, item-card variant generation/add-row focus, and billing plan SKU-cap enforcement while counting every catalog item row, including archived rows. |
| `stock-adjustment-route.spec.ts` | Stock adjustment route sets new on-hand and records a required typed reason on the adjustment-reason companion row (rejects blank reason); the item list exposes lot-tracking mode for mobile adjustment gating; for lot-tracked items, per-lot targets edit existing lots and create new lots from an operator-supplied lot number. Positive adjustments cost like stocktake gains: new lots and non-lot increases use the item's resolved unit cost (not zero), existing-lot increases preserve the lot's own cost, an unknown lotId 404s, and a replayed multi-lot key writes no duplicate events. |
| `sales-demand-and-shipment.spec.ts` | Sales creates demand without premature stock consumption, Shopify paid-order import uses the same demand path, and shipment consumes stock exactly once. |
| `purchasing-supply-and-receipt.spec.ts` | Purchasing creates expected supply, receipt converts it into physical stock, explicit PO edits clear additional costs without reviving legacy shipping, and editing freight after receipt rebases landed cost on eligible available tracked stock via an append-only `landed_cost_revaluation` event without mutating the receipt or blocking the PO edit. |
| `xero-purchase-bill-gates.spec.ts` | Purchase bill sync blocks unsafe accounting pushes before contacting Xero. |
| `manufacturing-demand-and-completion.spec.ts` | Manufacturing creates ingredient demand, completion consumes inputs while producing output once, and a batch order lots each batch into its own (nameable) produced lot. |
| `planning-demand-queue.spec.ts` | Demand queue scarce-stock math covers higher-ranked demand first without overclaiming available stock, and shared PO/SO/MO numbering continues from legacy and short suffixes without padding. |
| `produced-today.spec.ts` | "Produced today" counts every completed production for the org day, including non-sellable intermediates — not only sellable finished goods. |
