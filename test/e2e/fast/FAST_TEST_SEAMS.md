# Fast Test Seams

Only these fast spec files are allowed. Each file protects one heartbeat seam
that is worth running on every serious PR.

| File | Seam invariant |
| --- | --- |
| `auth-org-context.spec.ts` | Authenticated browser context has an active org and can access a protected app/API path. |
| `billing-entitlements.spec.ts` | Subscription webhooks are the only entitlement writer, and plugin gates make the correct shadow/enforced mutation decision across grant and downgrade. |
| `inventory-mutation-kernel.spec.ts` | Inventory and item-card mutations preserve projection truth, idempotent replay, card autosave/rebase/conflict behavior, saved-flush clone gating, fresh item-card reads, and SKU-cap accounting. |
| `stock-adjustment-route.spec.ts` | Stock adjustment writes reasoned per-item/per-lot stock targets with correct costing, validation, mobile gating metadata, and replay behavior. |
| `sales-demand-and-shipment.spec.ts` | Sales and customer document mutations preserve demand, idempotent replay, autosave/rebase/conflict behavior, saved-flush downstream-action gating, and shipment replay safety. |
| `purchasing-supply-and-receipt.spec.ts` | Supplier and purchase-order mutations preserve expected supply, idempotent replay, autosave/rebase/conflict behavior, saved-flush downstream-action gating, validation recovery, and landed-cost truth. |
| `xero-purchase-bill-gates.spec.ts` | Purchase bill sync blocks unsafe accounting pushes before contacting Xero. |
| `manufacturing-demand-and-completion.spec.ts` | Manufacturing mutations preserve idempotent create/duplicate replay, saved-flush downstream-action gating, ingredient demand, pick/completion stock truth, batch output lots, autosave/rebase/conflict behavior, and lifecycle notifications. |
| `planning-demand-queue.spec.ts` | Demand queue scarce-stock math covers higher-ranked demand first without overclaiming available stock, and shared PO/SO/MO numbering continues from legacy and short suffixes without padding. |
| `produced-today.spec.ts` | "Produced today" counts every completed production for the org day, including non-sellable intermediates — not only sellable finished goods. |
