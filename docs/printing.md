# Printable documents

Operational documents are server-rendered PDFs. A **Print** action opens the PDF
inline in a new browser tab so the browser's normal print dialog can choose a
printer, paper handling, copies, or Save as PDF. A **Download PDF** action returns
the same rendered document as an attachment with a useful filename. Neither action
prints the application screen.

The supported document families and variants are:

- purchase orders: purchase order, request for quote, and cumulative
  received-inventory summary (ordered and received-to-date quantities, not a
  put-away task list)
- sales orders: sales order, order with statuses, order without discounts,
  packing list, and open-order packing list with planned lot tracing
- manufacturing orders: full order, order without costs, operator notes,
  partial-progress order, partial-progress order without costs, and pick list
- stocktakes: blind count sheet while open and reconciliation report after completion

List selections can be printed or downloaded as one merged PDF, up to 50 records.
The same renderer is used for preview, attachment download, bulk output, and emailed
purchase-order attachments so those paths cannot drift visually.

PDF routes require read access to the corresponding module, run their reads in the
active organization context, and return `Cache-Control: private, no-store`. Template
and disposition values are allow-listed. Reconciliation reports are unavailable until
the stocktake is completed, and partial-progress manufacturing documents are only
offered after work has started. Planned lot tracing is pick guidance for open sales
orders, not shipment history, so traced packing lists are rejected for completed orders.

Packing lists use remaining quantities for open orders and shipped quantities for
completed orders. Manufacturing pick lists use remaining ingredient quantities and
show the current planned lots, including unassigned shortages. Document and table
headers repeat on subsequent pages.

Do not add `window.print()` to card or list pages. New printable surfaces should add a
server PDF projection and explicit inline/attachment actions. Validate a representative
multi-page record; a successful response alone does not prove that content is complete.
