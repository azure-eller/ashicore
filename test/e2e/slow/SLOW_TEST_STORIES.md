# Slow Test Stories

Only these slow spec files are allowed. Slow specs are operating stories, not
bug archives: each file must describe a workflow a small manufacturer would
recognize and must avoid incidental UI/regression breadth.

| File | Lane | Active tests | Story | Must prove | Not covered | Safety | Justification |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `sales-fulfillment.spec.ts` | `sales` | 4 | A customer places an order, demand appears, stock ships partially/finally, and order/inventory state stays correct. | customer context snapshot, demand creation, partial/final shipment, order status, stock consumed once, delete releases commitments | CRM breadth, pricing matrix, card/action UI, delete guard matrix | `serial-only` | |
| `purchasing-receiving.spec.ts` | `purchasing` | 3 | A buyer submits a PO, receives it in parts, and expected supply becomes physical stock. | supplier/PO setup, ordered expected supply, partial/final receipt, lot/balance truth | all supplier fields, validation variants, delete guards | `serial-only` | |
| `manufacturing-execution.spec.ts` | `manufacturing` | 5 | An operator releases, picks, and completes an MO with correct ingredient and output stock. | BOM snapshot, ingredient demand, pick consumption, output stock, done status, compact output cost truth, delete rolls back expected output | replay/concurrency/idempotency matrix, negative-stock override branches, cost-basis permutations | `serial-only` | |
| `planning-allocation-story.spec.ts` | `planning` | 3 | A planner sees scarce stock, ranked demand, expected supply, and shared component blockers in one compact scenario. | rank priority, shortage, expected supply signal, shared component blocker, make/buy signals | tabs, drag/drop, copy strings, parked planning flows | `serial-only` | |
| `stocktake-workflow.spec.ts` | `stocktake` | 4 | An operator creates a stocktake, saves/reloads sparse counts, commits, and sees reconciled state. | draft persistence, reload/continue, commit, completed reconciliation state | basic count-to-event math already covered by fast, category variants, clone UI action | `serial-only` | |
