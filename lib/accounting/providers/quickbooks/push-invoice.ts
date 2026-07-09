import "server-only";

import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  accountingDocumentSyncs,
  customers,
  integrationConnections,
  salesOrderLines,
  salesOrders,
} from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import {
  ACCOUNTING_DOCUMENT_SALES_ORDER,
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  markAccountingDocumentPushAttempt,
  persistAccountingDocumentPushFailure,
  persistAccountingDocumentPushSuccess,
} from "@/lib/accounting/sync-state";
import {
  SHORT_CLOSED_ACCOUNTING_INVOICE_MESSAGE,
  salesOrderHasCancelledAccountingLinesInTx,
} from "@/lib/sales/accounting-policy";
import { QuickBooksError, quickBooksQueryEndpoint, quickBooksRequest, quickBooksSqlString } from "./client";
import { upsertQuickBooksCustomer } from "./contacts";
import { ensureQuickBooksSalesServiceItem } from "./items";

const PROVIDER_DOCUMENT_TYPE = "quickbooks_invoice";
const STALE_PENDING_MS = 10 * 60 * 1000;
const QUICKBOOKS_DOC_NUMBER_MAX_LENGTH = 21;

type SalesOrderForInvoice = {
  id: string;
  organizationId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  orderDate: string;
  shipDate: string | null;
  status: string;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  shippingFeeDescription: string | null;
  shippingFeeAmount: string;
  shippingFeeTaxAmount: string;
  taxAmount: string;
  qbInvoiceId: string | null;
  qbInvoiceNumber: string | null;
  qbInvoiceStatus: string | null;
  qbInvoiceLastPushAttemptAt: Date | null;
  quickBooksSalesAccountId: string | null;
};

type SalesLineForInvoice = {
  itemName: string;
  itemSku: string | null;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  lineSubtotal: string;
};

type QuickBooksInvoiceResponse = {
  Invoice?: {
    Id?: string;
    DocNumber?: string;
    TotalAmt?: number;
  };
};

type QuickBooksInvoiceQueryResponse = {
  QueryResponse?: {
    Invoice?: Array<{
      Id?: string;
      DocNumber?: string;
      TotalAmt?: number;
      CustomerRef?: { value?: string; name?: string };
    }>;
  };
};

function payloadHash(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function stalePending(order: SalesOrderForInvoice) {
  return (
    order.qbInvoiceStatus === "pending" &&
    order.qbInvoiceLastPushAttemptAt &&
    Date.now() - order.qbInvoiceLastPushAttemptAt.getTime() < STALE_PENDING_MS
  );
}

async function loadSalesOrderForInvoiceInTx(
  tx: Tx,
  orderId: string
): Promise<{
  order: SalesOrderForInvoice;
  customer: typeof customers.$inferSelect;
  lines: SalesLineForInvoice[];
} | null> {
  const [order] = await tx
    .select({
      id: salesOrders.id,
      organizationId: salesOrders.organizationId,
      orderNumber: salesOrders.orderNumber,
      customerId: salesOrders.customerId,
      customerName: salesOrders.customerName,
      orderDate: salesOrders.orderDate,
      shipDate: salesOrders.shipDate,
      status: salesOrders.status,
      shipLine1: salesOrders.shipLine1,
      shipLine2: salesOrders.shipLine2,
      shipCity: salesOrders.shipCity,
      shipRegion: salesOrders.shipRegion,
      shipPostcode: salesOrders.shipPostcode,
      shipCountry: salesOrders.shipCountry,
      billingLine1: salesOrders.billingLine1,
      billingLine2: salesOrders.billingLine2,
      billingCity: salesOrders.billingCity,
      billingRegion: salesOrders.billingRegion,
      billingPostcode: salesOrders.billingPostcode,
      billingCountry: salesOrders.billingCountry,
      shippingFeeDescription: salesOrders.shippingFeeDescription,
      shippingFeeAmount: salesOrders.shippingFeeAmount,
      shippingFeeTaxAmount: salesOrders.shippingFeeTaxAmount,
      taxAmount: salesOrders.taxAmount,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), isNull(salesOrders.deletedAt)))
    .for("update");
  if (!order) return null;
  if (await salesOrderHasCancelledAccountingLinesInTx(tx, orderId)) {
    throw new QuickBooksError(SHORT_CLOSED_ACCOUNTING_INVOICE_MESSAGE, 409);
  }

  const [sync] = await tx
    .select({
      qbInvoiceId: accountingDocumentSyncs.externalDocumentId,
      qbInvoiceNumber: accountingDocumentSyncs.externalDocumentNumber,
      qbInvoiceStatus: accountingDocumentSyncs.pushStatus,
      qbInvoiceLastPushAttemptAt: accountingDocumentSyncs.lastPushAttemptAt,
    })
    .from(accountingDocumentSyncs)
    .where(
      and(
        eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_QUICKBOOKS),
        eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_SALES_ORDER),
        eq(accountingDocumentSyncs.documentId, order.id)
      )
    );

  const [connection] = await tx
    .select({ defaultAccountCode: integrationConnections.defaultAccountCode })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, order.organizationId),
        eq(integrationConnections.provider, ACCOUNTING_PROVIDER_QUICKBOOKS)
      )
    );

  const [customer] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, order.customerId));
  if (!customer) return null;

  const lines = await tx
    .select({
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      quantity: salesOrderLines.quantity,
      unitPrice: salesOrderLines.unitPrice,
      taxRatePercent: salesOrderLines.taxRatePercent,
      lineSubtotal: salesOrderLines.lineSubtotal,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, order.id))
    .orderBy(salesOrderLines.sortOrder);

  return {
    order: {
      ...order,
      qbInvoiceId: sync?.qbInvoiceId ?? null,
      qbInvoiceNumber: sync?.qbInvoiceNumber ?? null,
      qbInvoiceStatus: sync?.qbInvoiceStatus ?? null,
      qbInvoiceLastPushAttemptAt: sync?.qbInvoiceLastPushAttemptAt ?? null,
      quickBooksSalesAccountId: connection?.defaultAccountCode ?? null,
    },
    customer,
    lines,
  };
}

function assertNoTax(order: SalesOrderForInvoice, lines: SalesLineForInvoice[]) {
  const taxable =
    Number(order.taxAmount) !== 0 ||
    Number(order.shippingFeeTaxAmount) !== 0 ||
    lines.some((line) => Number(line.taxRatePercent) !== 0);
  if (taxable) {
    throw new QuickBooksError(
      "QuickBooks tax mapping is not available yet. Remove tax from this order before sending it to QuickBooks.",
      400
    );
  }
}

async function findQuickBooksInvoice(orgId: string, docNumber: string) {
  const result = await quickBooksRequest<QuickBooksInvoiceQueryResponse>(
    orgId,
    quickBooksQueryEndpoint(
      `select * from Invoice where DocNumber = ${quickBooksSqlString(docNumber)}`
    )
  );
  const invoice = result.QueryResponse?.Invoice?.find((entry) => entry.Id);
  return invoice?.Id
    ? {
        id: invoice.Id,
        number: invoice.DocNumber ?? docNumber,
        total: invoice.TotalAmt ?? null,
      }
    : null;
}

function buildInvoicePayload(params: {
  order: SalesOrderForInvoice;
  lines: SalesLineForInvoice[];
  customerRef: { id: string; name: string };
  itemRefs: Array<{ id: string; name: string }>;
}) {
  const lineItems = params.lines.map((line, index) => ({
    DetailType: "SalesItemLineDetail",
    Description: line.itemSku
      ? `${line.itemName} (${line.itemSku})`
      : line.itemName,
    Amount: Number(line.lineSubtotal),
    SalesItemLineDetail: {
      ItemRef: {
        value: params.itemRefs[index]?.id,
        name: params.itemRefs[index]?.name,
      },
      Qty: Number(line.quantity),
      UnitPrice: Number(line.unitPrice),
      TaxCodeRef: { value: "NON" },
    },
  }));

  const shippingAmount = Number(params.order.shippingFeeAmount);
  if (shippingAmount !== 0) {
    lineItems.push({
      DetailType: "SalesItemLineDetail",
      Description:
        params.order.shippingFeeDescription ?? "Shipping",
      Amount: shippingAmount,
      SalesItemLineDetail: {
        ItemRef: {
          value: params.itemRefs[0]?.id,
          name: params.itemRefs[0]?.name,
        },
        Qty: 1,
        UnitPrice: shippingAmount,
        TaxCodeRef: { value: "NON" },
      },
    });
  }

  return {
    DocNumber: params.order.orderNumber,
    TxnDate: params.order.orderDate,
    CustomerRef: {
      value: params.customerRef.id,
      name: params.customerRef.name,
    },
    PrivateNote: params.order.orderNumber,
    BillAddr: compactAddress({
      line1: params.order.billingLine1,
      line2: params.order.billingLine2,
      city: params.order.billingCity,
      region: params.order.billingRegion,
      postcode: params.order.billingPostcode,
      country: params.order.billingCountry,
    }),
    ShipAddr: compactAddress({
      line1: params.order.shipLine1,
      line2: params.order.shipLine2,
      city: params.order.shipCity,
      region: params.order.shipRegion,
      postcode: params.order.shipPostcode,
      country: params.order.shipCountry,
    }),
    GlobalTaxCalculation: "NotApplicable",
    Line: lineItems,
  };
}

function compactAddress(input: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
}) {
  if (
    !input.line1 &&
    !input.line2 &&
    !input.city &&
    !input.region &&
    !input.postcode &&
    !input.country
  ) {
    return undefined;
  }
  return {
    Line1: input.line1 ?? undefined,
    Line2: input.line2 ?? undefined,
    City: input.city ?? undefined,
    CountrySubDivisionCode: input.region ?? undefined,
    PostalCode: input.postcode ?? undefined,
    Country: input.country ?? undefined,
  };
}

function assertQuickBooksInvoiceNumber(order: SalesOrderForInvoice) {
  if (order.orderNumber.length > QUICKBOOKS_DOC_NUMBER_MAX_LENGTH) {
    throw new QuickBooksError(
      `QuickBooks invoice numbers must be ${QUICKBOOKS_DOC_NUMBER_MAX_LENGTH} characters or fewer.`,
      400
    );
  }
}

export async function pushSalesOrderToQuickBooks(orgId: string, orderId: string) {
  const prepared = await withOrgContext(orgId, async (tx) => {
    const data = await loadSalesOrderForInvoiceInTx(tx, orderId);
    if (!data) throw new QuickBooksError("Sales order not found.", 404);
    if (data.order.status !== "open" && data.order.status !== "done") {
      throw new QuickBooksError("Only open or done orders can be invoiced.", 409);
    }
    if (data.order.qbInvoiceId && data.order.qbInvoiceStatus === "pushed") {
      return { data, existing: true as const };
    }
    if (!data.order.quickBooksSalesAccountId) {
      throw new QuickBooksError(
        "Set a QuickBooks sales invoice account before sending invoices.",
        409
      );
    }
    if (stalePending(data.order)) {
      throw new QuickBooksError("QuickBooks invoice sync is already running.", 409);
    }
    assertQuickBooksInvoiceNumber(data.order);
    assertNoTax(data.order, data.lines);
    await markAccountingDocumentPushAttempt(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
      documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
      documentId: orderId,
      pushStatus: "pending",
      providerDocumentType: PROVIDER_DOCUMENT_TYPE,
    });
    return { data, existing: false as const };
  });

  if (prepared.existing) {
    return {
      quickBooksInvoiceId: prepared.data.order.qbInvoiceId,
      quickBooksInvoiceNumber: prepared.data.order.qbInvoiceNumber,
      status: "pushed" as const,
      created: false,
      adopted: false,
    };
  }

  try {
    const salesAccountId = prepared.data.order.quickBooksSalesAccountId;
    if (!salesAccountId) {
      throw new QuickBooksError(
        "Set a QuickBooks sales invoice account before sending invoices.",
        409
      );
    }
    const customerRef = await upsertQuickBooksCustomer(
      orgId,
      prepared.data.customer
    );
    const itemRefs = await Promise.all(
      prepared.data.lines.map((line) =>
        ensureQuickBooksSalesServiceItem(orgId, salesAccountId, {
          name: line.itemName,
          sku: line.itemSku,
        })
      )
    );
    const payload = buildInvoicePayload({
      order: prepared.data.order,
      lines: prepared.data.lines,
      customerRef,
      itemRefs,
    });
    const hash = payloadHash(payload);
    const existing = await findQuickBooksInvoice(
      orgId,
      prepared.data.order.orderNumber
    );

    let invoiceId = existing?.id ?? null;
    let invoiceNumber = existing?.number ?? prepared.data.order.orderNumber;
    let created = false;
    let adopted = false;

    if (invoiceId) {
      adopted = true;
    } else {
      const createdInvoice = await quickBooksRequest<QuickBooksInvoiceResponse>(
        orgId,
        "/invoice",
        { method: "POST", body: JSON.stringify(payload) }
      );
      if (!createdInvoice.Invoice?.Id) {
        throw new QuickBooksError("QuickBooks did not return an invoice id.", 502);
      }
      invoiceId = createdInvoice.Invoice.Id;
      invoiceNumber = createdInvoice.Invoice.DocNumber ?? invoiceNumber;
      created = true;
    }

    await withOrgContext(orgId, async (tx) => {
      await persistAccountingDocumentPushSuccess(tx, {
        organizationId: orgId,
        provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
        documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
        documentId: orderId,
        externalDocumentId: invoiceId,
        externalDocumentNumber: invoiceNumber,
        payloadHash: hash,
        providerDocumentType: PROVIDER_DOCUMENT_TYPE,
        payloadSnapshot: payload,
      });
    });

    return {
      quickBooksInvoiceId: invoiceId,
      quickBooksInvoiceNumber: invoiceNumber,
      status: "pushed" as const,
      created,
      adopted,
    };
  } catch (error) {
    await markQuickBooksInvoicePushFailed(orgId, orderId, error);
    throw error;
  }
}

export async function markQuickBooksInvoicePushFailed(
  orgId: string,
  orderId: string,
  error: unknown
) {
  const message =
    error instanceof Error ? error.message : "QuickBooks invoice push failed.";
  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentPushFailure(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
      documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
      documentId: orderId,
      error: message,
      providerDocumentType: PROVIDER_DOCUMENT_TYPE,
    });
  });
}
