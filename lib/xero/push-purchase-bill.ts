import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { Invoice, LineAmountTypes, type Invoices, type LineItem } from "xero-node";
import {
  accountingDocumentSyncs,
  integrationExternalRecords,
  organization,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_BILL,
  ACCOUNTING_PROVIDER_XERO,
  markAccountingDocumentPushAttempt,
  persistAccountingDocumentPushFailure,
  persistAccountingDocumentPushSuccess,
} from "@/lib/accounting/sync-state";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";
import { normalizeNumeric } from "@/lib/format";
import type { CreatePurchaseBill } from "@/lib/schemas/purchase-orders";
import { upsertXeroContact, type XeroContactInput } from "./contacts";
import { getAuthedXeroClient } from "./client";
import {
  XeroError,
  extractXeroMessage,
  extractXeroStatusCode,
  redactXeroError,
} from "./errors";
import { buildXeroIdempotencyKey } from "./idempotency";
import { hashXeroPayload } from "./payload-hash";

const PROVIDER_DOCUMENT_TYPE = "xero_accpay_invoice";
const TAX_MODE = LineAmountTypes.Exclusive;
const STALE_PENDING_MS = 10 * 60 * 1000;

type OrderForBill = {
  id: string;
  organizationId: string;
  organizationName: string;
  orderNumber: string;
  status: string;
  supplierId: string;
  supplierName: string;
  accountingPurchaseAccountCode: string | null;
  totalAmount: string;
  xeroBillId: string | null;
  xeroBillNumber: string | null;
  xeroBillStatus: string | null;
  xeroBillPayloadHash: string | null;
  xeroBillLastPushAttemptAt: Date | null;
};

type SupplierForBill = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  xeroContactId: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
};

type LineForBill = {
  itemName: string;
  itemSku: string | null;
  purchaseUnitName: string;
  stockingUnitName: string;
  purchaseToStockFactor: string;
  quantityOrdered: string;
  stockQuantityOrdered: string;
  quantityReceived: string;
  stockQuantityReceived: string;
  unitCost: string;
  accountingPurchaseAccountCode: string | null;
  lineTotal: string;
};

type AdditionalCostForBill = {
  amount: string;
};

export type CreatePurchaseBillResult = {
  xeroBillId: string;
  xeroBillNumber: string;
  status: "pushed";
  created: boolean;
  adopted: boolean;
};

function supplierToXeroContact(supplier: SupplierForBill): XeroContactInput {
  return {
    id: supplier.id,
    source: "supplier",
    name: supplier.name,
    email: supplier.email,
    phone: supplier.phone,
    xeroContactId: supplier.xeroContactId,
    billing: {
      line1: supplier.billingLine1,
      line2: supplier.billingLine2,
      city: supplier.billingCity,
      region: supplier.billingRegion,
      postcode: supplier.billingPostcode,
      country: supplier.billingCountry,
    },
    shipping: null,
  };
}

async function loadPurchaseOrderForBillInTx(
  tx: Tx,
  orderId: string,
): Promise<{
  order: OrderForBill;
  supplier: SupplierForBill;
  lines: LineForBill[];
  additionalCosts: AdditionalCostForBill[];
} | null> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      organizationId: purchaseOrders.organizationId,
      organizationName: organization.name,
      orderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: purchaseOrders.supplierName,
      accountingPurchaseAccountCode: purchaseOrders.accountingPurchaseAccountCode,
      totalAmount: purchaseOrders.totalAmount,
    })
    .from(purchaseOrders)
    .innerJoin(organization, eq(purchaseOrders.organizationId, organization.id))
    .where(and(eq(purchaseOrders.id, orderId), isNull(purchaseOrders.deletedAt)))
    .for("update");

  if (!order) return null;

  const [sync] = await tx
    .select({
      xeroBillId: accountingDocumentSyncs.externalDocumentId,
      xeroBillNumber: accountingDocumentSyncs.externalDocumentNumber,
      xeroBillStatus: accountingDocumentSyncs.pushStatus,
      xeroBillPayloadHash: accountingDocumentSyncs.pushPayloadHash,
      xeroBillLastPushAttemptAt: accountingDocumentSyncs.lastPushAttemptAt,
    })
    .from(accountingDocumentSyncs)
    .where(
      and(
        eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
        eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
        eq(accountingDocumentSyncs.documentId, order.id),
      ),
    );

  const orderWithSync: OrderForBill = {
    ...order,
    xeroBillId: sync?.xeroBillId ?? null,
    xeroBillNumber: sync?.xeroBillNumber ?? null,
    xeroBillStatus: sync?.xeroBillStatus ?? null,
    xeroBillPayloadHash: sync?.xeroBillPayloadHash ?? null,
    xeroBillLastPushAttemptAt: sync?.xeroBillLastPushAttemptAt ?? null,
  };

  const [supplier] = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      email: suppliers.email,
      phone: suppliers.phone,
      xeroContactId: sql<string | null>`(
        SELECT ${integrationExternalRecords.externalId}
        FROM ${integrationExternalRecords}
        WHERE ${integrationExternalRecords.provider} = ${ACCOUNTING_PROVIDER_XERO}
          AND ${integrationExternalRecords.entityType} = 'supplier'
          AND ${integrationExternalRecords.localRecordId} = ${suppliers.id}
        LIMIT 1
      )`,
      billingLine1: suppliers.billingLine1,
      billingLine2: suppliers.billingLine2,
      billingCity: suppliers.billingCity,
      billingRegion: suppliers.billingRegion,
      billingPostcode: suppliers.billingPostcode,
      billingCountry: suppliers.billingCountry,
    })
    .from(suppliers)
    .where(eq(suppliers.id, order.supplierId));

  if (!supplier) return null;

  const lines = await tx
    .select({
      itemName: purchaseOrderLines.itemName,
      itemSku: purchaseOrderLines.itemSku,
      purchaseUnitName: purchaseOrderLines.purchaseUnitName,
      stockingUnitName: purchaseOrderLines.stockingUnitName,
      purchaseToStockFactor: purchaseOrderLines.purchaseToStockFactor,
      quantityOrdered: purchaseOrderLines.quantityOrdered,
      stockQuantityOrdered: purchaseOrderLines.stockQuantityOrdered,
      quantityReceived: purchaseOrderLines.quantityReceived,
      stockQuantityReceived: purchaseOrderLines.stockQuantityReceived,
      unitCost: purchaseOrderLines.unitCost,
      accountingPurchaseAccountCode: purchaseOrderLines.accountingPurchaseAccountCode,
      lineTotal: purchaseOrderLines.lineTotal,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
    .orderBy(purchaseOrderLines.sortOrder);

  const additionalCosts = await tx
    .select({ amount: purchaseOrderAdditionalCosts.amount })
    .from(purchaseOrderAdditionalCosts)
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId));

  return { order: orderWithSync, supplier, lines, additionalCosts };
}

function conversionSummary(line: LineForBill) {
  if (
    line.purchaseUnitName === line.stockingUnitName ||
    Number(line.purchaseToStockFactor) === 1
  ) {
    return null;
  }

  return `${normalizeNumeric(Number(line.quantityReceived))} x ${line.purchaseUnitName} = ${normalizeNumeric(Number(line.stockQuantityReceived))} ${line.stockingUnitName} stock`;
}

function lineDescription(line: LineForBill) {
  const summary = conversionSummary(line);
  return summary ? `${line.itemName} - ${summary}` : line.itemName;
}

function additionalCostTotal(additionalCosts: AdditionalCostForBill[]) {
  return additionalCosts.reduce((sum, cost) => sum + Number(cost.amount), 0);
}

function billLineAmount(line: LineForBill) {
  return Number(line.quantityReceived) * Number(line.unitCost);
}

function isRecentPending(order: OrderForBill) {
  if (order.xeroBillStatus !== "pending") return false;
  if (!order.xeroBillLastPushAttemptAt) return true;
  return (
    Date.now() - order.xeroBillLastPushAttemptAt.getTime() <
    STALE_PENDING_MS
  );
}

function buildSnapshot(params: {
  input: CreatePurchaseBill;
  data: NonNullable<Awaited<ReturnType<typeof loadPurchaseOrderForBillInTx>>>;
  lineItems: LineItem[];
  fallbackAccountCode: string;
  taxType: string | null;
}) {
  const omittedAdditionalCostTotal = additionalCostTotal(params.data.additionalCosts);
  return {
    invoiceNumber: params.input.invoiceNumber,
    billDate: params.input.billDate,
    dueDate: params.input.dueDate,
    reference: params.input.reference?.trim() || params.data.order.orderNumber,
    supplier: {
      id: params.data.supplier.id,
      name: params.data.supplier.name,
    },
    purchaseOrder: {
      id: params.data.order.id,
      orderNumber: params.data.order.orderNumber,
      status: params.data.order.status,
    },
    lineAmountTypes: TAX_MODE,
    taxMode: "exclusive",
    taxType: params.taxType,
    fallbackAccountCode: params.fallbackAccountCode,
    lineItems: params.lineItems.map((line) => ({
      itemCode: line.itemCode ?? null,
      description: line.description ?? null,
      quantity: line.quantity ?? null,
      unitAmount: line.unitAmount ?? null,
      lineAmount: line.lineAmount ?? null,
      accountCode: line.accountCode ?? null,
      taxType: line.taxType ?? null,
    })),
    totals: {
      materialSubtotal: params.data.lines.reduce(
        (sum, line) => sum + billLineAmount(line),
        0,
      ),
      additionalCostsOmitted: omittedAdditionalCostTotal > 0,
      omittedAdditionalCostTotal,
    },
  };
}

export async function findXeroPurchaseBill(
  orgId: string,
  invoiceNumber: string,
): Promise<{
  invoiceID: string;
  invoiceNumber: string | null;
  contactID: string | null;
  reference: string | null;
  subTotal: number | null;
} | null> {
  const authed = await getAuthedXeroClient(orgId);
  try {
    const response = await authed.client.accountingApi.getInvoices(
      authed.tenantId,
      undefined,
      undefined,
      undefined,
      undefined,
      [invoiceNumber],
    );
    const bill = (response.body.invoices ?? []).find(
      (invoice) =>
        invoice.type === Invoice.TypeEnum.ACCPAY &&
        invoice.invoiceID &&
        invoice.status &&
        ![Invoice.StatusEnum.DELETED, Invoice.StatusEnum.VOIDED].includes(
          invoice.status as Invoice.StatusEnum,
        ),
    );
    return bill?.invoiceID
      ? {
          invoiceID: bill.invoiceID,
          invoiceNumber: bill.invoiceNumber ?? null,
          contactID: bill.contact?.contactID ?? null,
          reference: bill.reference ?? null,
          subTotal:
            bill.subTotal ??
            bill.lineItems?.reduce(
              (sum, line) => sum + (line.lineAmount ?? 0),
              0,
            ) ??
            null,
        }
      : null;
  } catch (error) {
    const status = extractXeroStatusCode(error);
    if (status === 404) return null;

    console.error("Xero purchase bill lookup failed:", redactXeroError(error));
    throw new XeroError(
      `Failed to check existing Xero bills: ${extractXeroMessage(error)}`,
      status ?? 502,
    );
  }
}

export async function createPurchaseBillAccountingSync(
  orgId: string,
  orderId: string,
  input: CreatePurchaseBill,
): Promise<CreatePurchaseBillResult> {
  const idempotencyKey = buildXeroIdempotencyKey(
    orgId,
    "purchase-bill",
    orderId,
    `v1:${input.invoiceNumber}`,
  );

  const data = await withOrgContext(orgId, async (tx) => {
    const loaded = await loadPurchaseOrderForBillInTx(tx, orderId);
    if (!loaded) return null;
    if (loaded.order.status !== "received") {
      throw new XeroError("V1 supports Xero bills after full receipt.", 409);
    }
    if (
      loaded.additionalCosts.length > 0 &&
      input.confirmAdditionalCostsOmitted !== true
    ) {
      throw new XeroError(
        "Confirm that additional costs will be added manually in Xero.",
        400,
      );
    }
    if (isRecentPending(loaded.order)) {
      throw new XeroError("Xero bill sync is already running.", 409);
    }
    if (loaded.order.xeroBillStatus === "pushed" && loaded.order.xeroBillId) {
      return loaded;
    }
    return loaded;
  });

  if (!data) {
    throw new XeroError("Purchase order not found.", 404);
  }

  const alreadyPushed =
    data.order.xeroBillStatus === "pushed" && data.order.xeroBillId;

  if (alreadyPushed) {
    if (
      !data.order.xeroBillNumber ||
      data.order.xeroBillNumber !== input.invoiceNumber
    ) {
      throw new XeroError(
        "This purchase order already has a Xero bill. Void it in Xero before recreating.",
        409,
      );
    }

    return {
      xeroBillId: data.order.xeroBillId!,
      xeroBillNumber: data.order.xeroBillNumber,
      status: "pushed",
      created: false,
      adopted: false,
    };
  }

  const authed = await getAuthedXeroClient(orgId);
  const connection = authed.connection;
  const accountingApi = authed.client.accountingApi;
  const taxType = connection.purchaseOrderDefaultTaxType ?? connection.defaultTaxType;
  const fallbackAccountCode =
    connection.purchaseOrderDefaultAccountCode ?? connection.defaultAccountCode;

  if (!fallbackAccountCode) {
    throw new XeroError(
      "Set a purchase account code in Xero settings before creating supplier bills.",
      400,
    );
  }

  const locked = await withOrgContext(orgId, async (tx) => {
    const loaded = await loadPurchaseOrderForBillInTx(tx, orderId);
    if (!loaded) return null;
    if (isRecentPending(loaded.order)) {
      throw new XeroError("Xero bill sync is already running.", 409);
    }
    if (loaded.order.xeroBillStatus === "pushed" && loaded.order.xeroBillId) {
      return { status: "pushed" as const, order: loaded.order };
    }

    await markAccountingDocumentPushAttempt(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
      documentId: orderId,
      pushStatus: "pending",
      providerDocumentType: PROVIDER_DOCUMENT_TYPE,
      idempotencyKey,
    });
    return { status: "ready" as const, data: loaded };
  });

  if (!locked) {
    throw new XeroError("Purchase order not found.", 404);
  }

  if (locked.status === "pushed") {
    if (
      !locked.order.xeroBillNumber ||
      locked.order.xeroBillNumber !== input.invoiceNumber
    ) {
      throw new XeroError(
        "This purchase order already has a Xero bill. Void it in Xero before recreating.",
        409,
      );
    }

    return {
      xeroBillId: locked.order.xeroBillId!,
      xeroBillNumber: locked.order.xeroBillNumber,
      status: "pushed",
      created: false,
      adopted: false,
    };
  }

  const currentData = locked.data;
  const lineItems: LineItem[] = currentData.lines.map((line) => ({
    itemCode: line.itemSku ?? undefined,
    description: lineDescription(line),
    quantity: Number(line.quantityReceived),
    unitAmount: Number(line.unitCost),
    accountCode: line.accountingPurchaseAccountCode ?? fallbackAccountCode,
    taxType: taxType ?? undefined,
  }));
  const snapshot = buildSnapshot({
    input,
    data: currentData,
    lineItems,
    fallbackAccountCode,
    taxType,
  });
  const payloadHash = hashXeroPayload(snapshot);
  const reference = input.reference?.trim() || currentData.order.orderNumber;
  const expectedSubTotal = currentData.lines.reduce(
    (sum, line) => sum + billLineAmount(line),
    0,
  );

  let billId: string;
  let billNumber: string;
  let created = false;
  let adopted = false;

  const contactId = await upsertXeroContact(
    orgId,
    supplierToXeroContact(currentData.supplier),
    authed.tenantId,
    accountingApi,
  );
  const existing = await findXeroPurchaseBill(orgId, input.invoiceNumber);
  if (existing) {
    const contactMatches = existing.contactID === contactId;
    const referenceMatches = existing.reference === reference;
    const subtotalMatches =
      existing.subTotal == null ||
      Math.abs(existing.subTotal - expectedSubTotal) < 0.01;

    if (!contactMatches || !referenceMatches || !subtotalMatches) {
      throw new XeroError(
        "A Xero bill already exists with this supplier invoice number, but it does not match this purchase order.",
        409,
      );
    }

    billId = existing.invoiceID;
    billNumber = existing.invoiceNumber ?? input.invoiceNumber;
    adopted = true;
  } else {
    const bill: Invoice = {
      type: Invoice.TypeEnum.ACCPAY,
      contact: { contactID: contactId },
      lineItems,
      lineAmountTypes: TAX_MODE,
      date: input.billDate,
      dueDate: input.dueDate,
      invoiceNumber: input.invoiceNumber,
      reference,
      status: Invoice.StatusEnum.DRAFT,
    };

    try {
      const response = await accountingApi.createInvoices(
        authed.tenantId,
        { invoices: [bill] } satisfies Invoices,
        undefined,
        undefined,
        idempotencyKey,
      );
      const returned = response.body.invoices?.[0];
      if (!returned?.invoiceID) {
        throw new XeroError("Xero did not return a bill ID.", 502);
      }
      billId = returned.invoiceID;
      billNumber = returned.invoiceNumber ?? input.invoiceNumber;
      created = true;
    } catch (error) {
      if (error instanceof XeroError) throw error;
      const status = extractXeroStatusCode(error);
      console.error("Xero purchase bill create failed:", redactXeroError(error));
      throw new XeroError(
        `Failed to create Xero bill: ${extractXeroMessage(error)}`,
        status ?? 502,
      );
    }
  }

  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentPushSuccess(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
      documentId: orderId,
      externalDocumentId: billId,
      externalDocumentNumber: billNumber,
      payloadHash,
      providerDocumentType: PROVIDER_DOCUMENT_TYPE,
      idempotencyKey,
      payloadSnapshot: snapshot,
    });
  });

  await tryRecordAccountingAuditEvent({
    organizationId: orgId,
    actor: { type: "process", processName: "xero_push" },
    eventType: "xero_push",
    outcome: "success",
    source: "lib/xero/push-purchase-bill:createPurchaseBillAccountingSync",
    tenantId: authed.tenantId,
    tenantName: authed.tenantName,
    provider: ACCOUNTING_PROVIDER_XERO,
    localEntityType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
    localEntityId: orderId,
    metadata: {
      invoiceNumber: input.invoiceNumber,
      billId,
      billNumber,
      created,
      adopted,
    },
  });

  return {
    xeroBillId: billId,
    xeroBillNumber: billNumber,
    status: "pushed",
    created,
    adopted,
  };
}

export async function markXeroPurchaseBillPushFailed(
  orgId: string,
  orderId: string,
  error: unknown,
) {
  const message = extractXeroMessage(error).slice(0, 500);
  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentPushFailure(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
      documentId: orderId,
      error: message,
      providerDocumentType: PROVIDER_DOCUMENT_TYPE,
    });
  });
  await tryRecordAccountingAuditEvent({
    organizationId: orgId,
    actor: { type: "process", processName: "xero_push" },
    eventType: "xero_push",
    outcome: "failure",
    source: "lib/xero/push-purchase-bill:markXeroPurchaseBillPushFailed",
    provider: ACCOUNTING_PROVIDER_XERO,
    localEntityType: ACCOUNTING_DOCUMENT_PURCHASE_BILL,
    localEntityId: orderId,
    metadata: accountingAuditErrorMetadata(error),
  });
}
