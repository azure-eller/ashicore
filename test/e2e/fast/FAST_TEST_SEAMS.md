# Fast Test Seams

Only these fast spec files are allowed. Each file protects one heartbeat seam
that is worth running on every serious PR.

| File | Seam invariant |
| --- | --- |
| `auth-org-context.spec.ts` | Authenticated browser context has an active org and can access a protected app/API path. |
| `inventory-mutation-kernel.spec.ts` | Inventory mutations write events and reconcile lot/item projection truth, including stocktake count authority. |
| `sales-demand-and-shipment.spec.ts` | Sales creates demand without premature stock consumption, and shipment consumes stock exactly once. |
| `purchasing-supply-and-receipt.spec.ts` | Purchasing creates expected supply and receipt converts it into physical stock. |
| `manufacturing-demand-and-completion.spec.ts` | Manufacturing creates ingredient demand and completion consumes inputs while producing output once. |
| `planning-demand-queue.spec.ts` | Demand queue scarce-stock math covers higher-ranked demand first without overclaiming available stock. |
