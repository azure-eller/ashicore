import "server-only";

import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { accountingDocumentSyncs, salesOrderLines, salesOrders } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

export async function salesOrderHasCancelledAccountingLinesInTx(
  tx: Tx,
  id: string
) {
  const [shortClosed] = await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        eq(salesOrders.id, id),
        isNull(salesOrders.deletedAt),
        gt(salesOrderLines.cancelledQuantity, "0")
      )
    )
    .limit(1);

  return shortClosed != null;
}

export async function salesOrderHasPushedAccountingInvoiceInTx(
  tx: Tx,
  id: string
) {
  const [pushedSync] = await tx
    .select({ id: accountingDocumentSyncs.id })
    .from(accountingDocumentSyncs)
    .where(
      and(
        eq(accountingDocumentSyncs.documentType, "sales_order"),
        eq(accountingDocumentSyncs.documentId, id),
        or(
          eq(accountingDocumentSyncs.pushStatus, "pushed"),
          sql`${accountingDocumentSyncs.externalDocumentId} IS NOT NULL`
        )
      )
    )
    .limit(1);

  return pushedSync != null;
}

export const SHORT_CLOSED_ACCOUNTING_INVOICE_MESSAGE =
  "This order has cancelled remaining items. Review the shipped quantities before sending an accounting invoice.";

export const PUSHED_ACCOUNTING_INVOICE_SHORT_CLOSE_MESSAGE =
  "This order has already been pushed to accounting. Accounting history must be preserved.";
