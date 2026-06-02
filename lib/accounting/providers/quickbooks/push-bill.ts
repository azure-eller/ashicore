import "server-only";

import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  accountingDocumentSyncs,
  integrationConnections,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_BILL,
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  markAccountingDocumentPushAttempt,
  persistAccountingDocumentPushFailure,
  persistAccountingDocumentPushSuccess,
} from "@/lib/accounting/sync-state";
import type { CreatePurchaseBill } from "@/lib/schemas/purchase-orders";
import {
  QuickBooksError,
  quickBooksQueryEndpoint,
  quickBooksRequest,
  quickBooksSqlString,
} from "./client";
import { upsertQuickBooksVendor } from "./contacts";

const PROVIDER_DOCUMENT_TYPE = "quickbooks_bill";
const STALE_PENDING_MS = 10 * 60 * 1000;
const QUICKBOOKS_DOC_NUMBER_MAX_LENGTH = 21;

type OrderForBill = {
  id: string;
  organizationId: string;
  orderNumber: string;
  createdAt: Date;
  status: string;
  supplierId: string;
  supplierName: string;
  taxAmount: string;
  qbBillId: string | null;
  qbBillNumber: string | null;
  qbBillStatus: string | null;
  qbBillLastPushAttemptAt: Date | null;
  quickBooksPurchaseAccountId: string | null;
};

type LineForBill = {
  itemName: string;
  itemSku: string | null;
  taxRatePercent: string;
  lineSubtotal: string;
};

type AdditionalCostForBill = {
  amount: string;
};

type QuickBooksBillResponse = {
  Bill?: {
    Id?: string;
    DocNumber?: string;
    TotalAmt?: number;
  };
};

type QuickBooksBillQueryResponse = {
  QueryResponse?: {
    Bill?: Array<{
      Id?: string;
      DocNumber?: string;
      TotalAmt?: number;
      VendorRef?: { value?: string; name?: string };
    }>;
  };
};

function payloadHash(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function stalePending(order: OrderForBill) {
  return (
    order.qbBillStatus === "pending" &&
    order.qbBillLastPushAttemptAt &&
    Date.now() - order.qbBillLastPushAttemptAt.getTime() < STALE_PENDING_MS
  );
}

async function loadPurchaseOrderForBillInTx(
  tx: Tx,
  orderId: string
): Promise<{
  order: OrderForBill;
  supplier: typeof suppliers.$inferSelect;
  lines: LineForBill[];
  additionalCosts: AdditionalCostForBill[];
} | null> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      organizationId: purchaseOrders.organizationId,
      orderNumber: purchaseOrders.orderNumber,
      createdAt: purchaseOrders.createdAt,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: purchaseOrders.supplierName,
      taxAmount: purchaseOrders.taxAmount,
      accountingPurchaseAccountCode:
        purchaseOrders.accountingPurchaseAccountCode,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, orderId), isNull(purchaseOrders.deletedAt)))
    .for("update");

  if (!order) return null;

  const [sync] = await tx
    .select({
      qbBillId: accountingDocumentSyncs.externalDocumentId,
      qbBillNumber: accountingDocumentSyncs.externalDocumentNumber,
      qbBillStatus: accountingDocumentSyncs.pushStatus,
      qbBillLastPushAttemptAt: accountingDocumentSyncs.lastPushAttemptAt,
    })
    .from(accountingDocumentSyncs)
    .where(
      and(
        eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_QUICKBOOKS),
        eq(
          accountingDocumentSyncs.documentType,
          ACCOUNTING_DOCUMENT_PURCHASE_BILL
        ),
        eq(accountingDocumentSyncs.documentId, order.id)
      )
    );

  const [connection] = await tx
    .select({
      purchaseAccountCode:
        integrationConnections.purchaseOrderDefaultAccountCode,
      fallbackAccountCode: integrationConnections.defaultAccountCode,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, order.organizationId),
        eq(integrationConnections.provider, ACCOUNTING_PROVIDER_QUICKBOOKS)
      )
    );

  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, order.supplierId));
  if (!supplier) return null;

  const lines = await tx
    .select({
      itemName: purchaseOrderLines.itemName,
      itemSku: purchaseOrderLines.itemSku,
      taxRatePercent: purchaseOrderLines.taxRatePercent,
      lineSubtotal: purchaseOrderLines.lineSubtotal,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
    .orderBy(purchaseOrderLines.sortOrder);

  const additionalCosts = await tx
    .select({ amount: purchaseOrderAdditionalCosts.amount })
    .from(purchaseOrderAdditionalCosts)
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId));

  return {
    order: {
      ...order,
      qbBillId: sync?.qbBillId ?? null,
      qbBillNumber: sync?.qbBillNumber ?? null,
      qbBillStatus: sync?.qbBillStatus ?? null,
      qbBillLastPushAttemptAt: sync?.qbBillLastPushAttemptAt ?? null,
      quickBooksPurchaseAccountId:
        order.accountingPurchaseAccountCode ??
        connection?.purchaseAccountCode ??
        connection?.fallbackAccountCode ??
        null,
    },
    supplier,
    lines,
    additionalCosts,
  };
}

function assertNoTax(order: OrderForBill, lines: LineForBill[]) {
  const taxable =
    Number(order.taxAmount) !== 0 ||
    lines.some((line) => Number(line.taxRatePercent) !== 0);
  if (taxable) {
    throw new QuickBooksError(
      "QuickBooks tax mapping is not available yet. Remove tax from this purchase order before creating a QuickBooks bill.",
      400
    );
  }
}

function additionalCostTotal(additionalCosts: AdditionalCostForBill[]) {
  return additionalCosts.reduce((sum, cost) => sum + Number(cost.amount), 0);
}

async function findQuickBooksBill(orgId: string, docNumber: string) {
  const result = await quickBooksRequest<QuickBooksBillQueryResponse>(
    orgId,
    quickBooksQueryEndpoint(
      `select * from Bill where DocNumber = ${quickBooksSqlString(docNumber)}`
    )
  );
  const bill = result.QueryResponse?.Bill?.find((entry) => entry.Id);
  return bill?.Id
    ? {
        id: bill.Id,
        number: bill.DocNumber ?? docNumber,
        total: bill.TotalAmt ?? null,
      }
    : null;
}

function buildBillPayload(params: {
  input: CreatePurchaseBill;
  order: OrderForBill;
  lines: LineForBill[];
  vendorRef: { id: string; name: string };
}) {
  const accountId = params.input.accountingPurchaseAccountCode;
  return {
    DocNumber: params.input.invoiceNumber,
    TxnDate: params.order.createdAt.toISOString().slice(0, 10),
    VendorRef: {
      value: params.vendorRef.id,
      name: params.vendorRef.name,
    },
    PrivateNote: params.order.orderNumber,
    Line: params.lines.map((line) => ({
      DetailType: "AccountBasedExpenseLineDetail",
      Description: line.itemSku
        ? `${line.itemName} (${line.itemSku})`
        : line.itemName,
      Amount: Number(line.lineSubtotal),
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: accountId },
      },
    })),
  };
}

function assertQuickBooksBillNumber(input: CreatePurchaseBill) {
  if (input.invoiceNumber.length > QUICKBOOKS_DOC_NUMBER_MAX_LENGTH) {
    throw new QuickBooksError(
      `QuickBooks bill numbers must be ${QUICKBOOKS_DOC_NUMBER_MAX_LENGTH} characters or fewer.`,
      400
    );
  }
}

export async function createPurchaseBillInQuickBooks(
  orgId: string,
  orderId: string,
  input: CreatePurchaseBill
) {
  const prepared = await withOrgContext(orgId, async (tx) => {
    const data = await loadPurchaseOrderForBillInTx(tx, orderId);
    if (!data) throw new QuickBooksError("Purchase order not found.", 404);
    if (data.order.status === "draft") {
      throw new QuickBooksError(
        "Submit the purchase order before creating a QuickBooks bill.",
        409
      );
    }
    if (data.order.status === "cancelled") {
      throw new QuickBooksError("Cancelled purchase orders cannot be billed.", 409);
    }
    if (data.order.qbBillId && data.order.qbBillStatus === "pushed") {
      return { data, existing: true as const };
    }
    if (stalePending(data.order)) {
      throw new QuickBooksError("QuickBooks bill sync is already running.", 409);
    }
    if (!data.order.quickBooksPurchaseAccountId) {
      throw new QuickBooksError(
        "Set a QuickBooks purchase bill account before creating bills.",
        409
      );
    }
    if (
      additionalCostTotal(data.additionalCosts) > 0 &&
      input.confirmAdditionalCostsOmitted !== true
    ) {
      throw new QuickBooksError(
        "Confirm that additional costs will be added manually in QuickBooks.",
        400
      );
    }
    assertNoTax(data.order, data.lines);
    await markAccountingDocumentPushAttempt(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
      documentId: orderId,
      pushStatus: "pending",
      providerDocumentType: PROVIDER_DOCUMENT_TYPE,
    });
    return { data, existing: false as const };
  });

  if (prepared.existing) {
    return {
      quickBooksBillId: prepared.data.order.qbBillId,
      quickBooksBillNumber: prepared.data.order.qbBillNumber,
      xeroBillId: prepared.data.order.qbBillId,
      xeroBillNumber: prepared.data.order.qbBillNumber,
      status: "pushed" as const,
      created: false,
      adopted: false,
    };
  }

  const accountCode =
    input.accountingPurchaseAccountCode.trim() ||
    prepared.data.order.quickBooksPurchaseAccountId;
  if (!accountCode) {
    throw new QuickBooksError(
      "Set a QuickBooks purchase bill account before creating bills.",
      409
    );
  }
  const billInput = { ...input, accountingPurchaseAccountCode: accountCode };
  assertQuickBooksBillNumber(billInput);

  try {
    const vendorRef = await upsertQuickBooksVendor(
      orgId,
      prepared.data.supplier
    );
    const payload = buildBillPayload({
      input: billInput,
      order: prepared.data.order,
      lines: prepared.data.lines,
      vendorRef,
    });
    const hash = payloadHash(payload);
    const existing = await findQuickBooksBill(orgId, billInput.invoiceNumber);

    let billId = existing?.id ?? null;
    let billNumber = existing?.number ?? billInput.invoiceNumber;
    let created = false;
    let adopted = false;

    if (billId) {
      adopted = true;
    } else {
      const createdBill = await quickBooksRequest<QuickBooksBillResponse>(
        orgId,
        "/bill",
        { method: "POST", body: JSON.stringify(payload) }
      );
      if (!createdBill.Bill?.Id) {
        throw new QuickBooksError("QuickBooks did not return a bill id.", 502);
      }
      billId = createdBill.Bill.Id;
      billNumber = createdBill.Bill.DocNumber ?? billNumber;
      created = true;
    }

    await withOrgContext(orgId, async (tx) => {
      await persistAccountingDocumentPushSuccess(tx, {
        organizationId: orgId,
        provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
        documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
        documentId: orderId,
        externalDocumentId: billId,
        externalDocumentNumber: billNumber,
        payloadHash: hash,
        providerDocumentType: PROVIDER_DOCUMENT_TYPE,
        payloadSnapshot: payload,
      });
    });

    return {
      quickBooksBillId: billId,
      quickBooksBillNumber: billNumber,
      xeroBillId: billId,
      xeroBillNumber: billNumber,
      status: "pushed" as const,
      created,
      adopted,
    };
  } catch (error) {
    await markQuickBooksBillPushFailed(orgId, orderId, error);
    throw error;
  }
}

export async function markQuickBooksBillPushFailed(
  orgId: string,
  orderId: string,
  error: unknown
) {
  const message =
    error instanceof Error ? error.message : "QuickBooks bill push failed.";
  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentPushFailure(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
      documentId: orderId,
      error: message,
      providerDocumentType: PROVIDER_DOCUMENT_TYPE,
    });
  });
}
