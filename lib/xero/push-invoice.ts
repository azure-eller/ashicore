import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { Invoice, type Invoices, type LineItem } from "xero-node";
import {
  accountingDocumentSyncs,
  customers,
  organization,
  salesOrderLines,
  salesOrders,
} from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { buildAccountingDocumentEmail } from "@/lib/email/accounting-documents";
import { sendTransactionalEmail } from "@/lib/email/send";
import { getAuthedXeroClient } from "./client";
import {
  XeroError,
  extractXeroMessage,
  extractXeroStatusCode,
  redactXeroError,
} from "./errors";
import { upsertXeroContact, type XeroContactInput } from "./contacts";
import { buildXeroIdempotencyKey } from "./idempotency";
import { hashXeroPayload } from "./payload-hash";
import {
  ACCOUNTING_PROVIDER_XERO,
  markAccountingDocumentPushAttempt,
  persistAccountingDocumentEmailOutcome,
  persistAccountingDocumentPushFailure,
  persistAccountingDocumentPushSuccess,
} from "@/lib/accounting/sync-state";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";

const ACCOUNTING_DOCUMENT_SALES_ORDER = "sales_order";

type OrderForPush = {
  id: string;
  organizationName: string;
  orderNumber: string;
  status: string;
  customerId: string;
  customerName: string;
  requestedDate: string | null;
  shippedAt: Date | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  totalAmount: string;
  xeroInvoiceId: string | null;
  xeroInvoiceNumber: string | null;
  xeroPushStatus: string | null;
  xeroPushPayloadHash: string | null;
  xeroEmailStatus: string | null;
};

type CustomerForPush = {
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
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
};

type LineForPush = {
  itemName: string;
  itemSku: string | null;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
};

export type PushInvoiceResult = {
  xeroInvoiceId: string;
  xeroInvoiceNumber: string;
  status: "pushed";
  /** True when a fresh Xero invoice was created on this attempt. */
  created: boolean;
  /** True when an existing Xero invoice was adopted by reference. */
  adopted: boolean;
  /** Email outcome on this attempt, if any was attempted. */
  emailStatus: "sent" | "failed" | "skipped" | null;
};

type PushInvoiceOptions = {
  sendEmail?: boolean;
  allowAutoEmail?: boolean;
};

const orderInvoiceableStatuses = new Set([
  "open",
  "done",
]);

function shouldSendSalesInvoiceEmail(
  connection: { autoEmailSalesInvoices?: boolean },
  options: PushInvoiceOptions
) {
  return (
    options.sendEmail === true ||
    (options.allowAutoEmail !== false && connection.autoEmailSalesInvoices === true)
  );
}

function customerToXeroContact(customer: CustomerForPush): XeroContactInput {
  return {
    id: customer.id,
    source: "customer",
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    xeroContactId: customer.xeroContactId,
    billing: {
      line1: customer.billingLine1,
      line2: customer.billingLine2,
      city: customer.billingCity,
      region: customer.billingRegion,
      postcode: customer.billingPostcode,
      country: customer.billingCountry,
    },
    shipping: {
      line1: customer.shipLine1,
      line2: customer.shipLine2,
      city: customer.shipCity,
      region: customer.shipRegion,
      postcode: customer.shipPostcode,
      country: customer.shipCountry,
    },
  };
}

async function loadOrderForPushInTx(
  tx: import("@/lib/db/with-org-context").Tx,
  orderId: string
): Promise<{
  order: OrderForPush;
  customer: CustomerForPush;
  lines: LineForPush[];
} | null> {
  const [order] = await tx
    .select({
      id: salesOrders.id,
      organizationName: organization.name,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      customerId: salesOrders.customerId,
      customerName: salesOrders.customerName,
      requestedDate: salesOrders.requestedDate,
      shippedAt: salesOrders.shippedAt,
      shipLine1: salesOrders.shipLine1,
      shipLine2: salesOrders.shipLine2,
      shipCity: salesOrders.shipCity,
      shipRegion: salesOrders.shipRegion,
      shipPostcode: salesOrders.shipPostcode,
      shipCountry: salesOrders.shipCountry,
      totalAmount: salesOrders.totalAmount,
      xeroInvoiceId: accountingDocumentSyncs.externalDocumentId,
      xeroInvoiceNumber: accountingDocumentSyncs.externalDocumentNumber,
      xeroPushStatus: accountingDocumentSyncs.pushStatus,
      xeroPushPayloadHash: accountingDocumentSyncs.pushPayloadHash,
      xeroEmailStatus: accountingDocumentSyncs.emailStatus,
    })
    .from(salesOrders)
    .innerJoin(organization, eq(salesOrders.organizationId, organization.id))
    .leftJoin(
      accountingDocumentSyncs,
      and(
        eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
        eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_SALES_ORDER),
        eq(accountingDocumentSyncs.documentId, salesOrders.id)
      )
    )
    .where(
      and(
        eq(salesOrders.id, orderId),
        isNull(salesOrders.deletedAt)
      )
    );

  if (!order) return null;

  const [customer] = await tx
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      xeroContactId: sql<string | null>`(
        SELECT external_id
        FROM integrations.external_records
        WHERE organization_id = ${customers.organizationId}
          AND provider = ${ACCOUNTING_PROVIDER_XERO}
          AND entity_type = 'customer'
          AND local_record_id = ${customers.id}
        LIMIT 1
      )`,
      billingLine1: customers.billingLine1,
      billingLine2: customers.billingLine2,
      billingCity: customers.billingCity,
      billingRegion: customers.billingRegion,
      billingPostcode: customers.billingPostcode,
      billingCountry: customers.billingCountry,
      shipLine1: customers.shipLine1,
      shipLine2: customers.shipLine2,
      shipCity: customers.shipCity,
      shipRegion: customers.shipRegion,
      shipPostcode: customers.shipPostcode,
      shipCountry: customers.shipCountry,
    })
    .from(customers)
    .where(eq(customers.id, order.customerId));

  if (!customer) return null;

  const lines = await tx
    .select({
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      quantity: salesOrderLines.quantity,
      unitPrice: salesOrderLines.unitPrice,
      lineTotal: salesOrderLines.lineSubtotal,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(salesOrderLines.sortOrder);

  return { order, customer, lines };
}

async function markPushAttempt(orgId: string, orderId: string): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await markAccountingDocumentPushAttempt(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
      documentId: orderId,
    });
  });
}

async function persistPushSuccess(
  orgId: string,
  orderId: string,
  invoiceId: string,
  invoiceNumber: string,
  payloadHash: string
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentPushSuccess(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
      documentId: orderId,
      externalDocumentId: invoiceId,
      externalDocumentNumber: invoiceNumber,
      payloadHash,
    });
  });
}

/**
 * Look up an existing Xero invoice by ERP order number. Used on retry to
 * adopt a previously-created Xero invoice when the local DB write of
 * `xero_invoice_id` failed after Xero accepted the create. Xero's idempotency
 * keys only protect retries within ~6 minutes; reference lookup covers the
 * longer-tail cron retry window.
 */
export async function findXeroInvoiceForSalesOrder(
  orgId: string,
  orderNumber: string
): Promise<{ invoiceID: string; invoiceNumber: string | null } | null> {
  const authed = await getAuthedXeroClient(orgId);
  try {
    const response = await authed.client.accountingApi.getInvoices(
      authed.tenantId,
      undefined, // ifModifiedSince
      undefined, // where
      undefined, // order
      undefined, // iDs
      [orderNumber] // invoiceNumbers
    );

    const matches = response.body.invoices ?? [];
    const accrec = matches.find(
      (inv) => inv.type === Invoice.TypeEnum.ACCREC && inv.invoiceID
    );

    if (!accrec?.invoiceID) return null;
    return {
      invoiceID: accrec.invoiceID,
      invoiceNumber: accrec.invoiceNumber ?? null,
    };
  } catch (error) {
    const status = extractXeroStatusCode(error);
    if (status === 404) return null;

    console.error("Xero invoice lookup failed:", redactXeroError(error));
    throw new XeroError(
      `Failed to check existing Xero invoices: ${extractXeroMessage(error)}`,
      status ?? 502
    );
  }
}

type EmailDecision =
  | { action: "send"; reason: null }
  | { action: "skip"; reason: "draft" | "not_selected" | "no_email" | "already_sent" };

function decideEmail(params: {
  statusPref: Invoice.StatusEnum;
  sendEmail: boolean;
  customerEmail: string | null;
  existingEmailStatus: string | null;
}): EmailDecision {
  if (params.existingEmailStatus === "sent") {
    return { action: "skip", reason: "already_sent" };
  }
  if (params.statusPref !== Invoice.StatusEnum.AUTHORISED) {
    return { action: "skip", reason: "draft" };
  }
  if (!params.sendEmail) {
    return { action: "skip", reason: "not_selected" };
  }
  if (!params.customerEmail || params.customerEmail.trim() === "") {
    return { action: "skip", reason: "no_email" };
  }
  return { action: "send", reason: null };
}

async function persistEmailOutcome(
  orgId: string,
  orderId: string,
  outcome:
    | { status: "sent"; error?: never }
    | { status: "failed"; error: string }
    | { status: "skipped"; error?: never }
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentEmailOutcome(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
      documentId: orderId,
      outcome,
    });
  });
}

async function sendInvoiceEmail(
  params: {
    orgId: string;
    orderId: string;
    persistOutcome?: (
      outcome:
        | { status: "sent"; error?: never }
        | { status: "failed"; error: string }
        | { status: "skipped"; error?: never }
    ) => Promise<void>;
    organizationName: string;
    orderNumber: string;
    invoiceId: string;
    invoiceNumber: string | null;
    totalAmount: string;
    dueDate: string | null;
    customerName: string;
    customerEmail: string;
    lines: LineForPush[];
    tenantId: string;
    localEntityType?: typeof ACCOUNTING_DOCUMENT_SALES_ORDER;
    accountingApi: import("xero-node").AccountingApi;
  }
): Promise<void> {
  const key = buildXeroIdempotencyKey(params.orgId, "invoice-email", params.orderId, "send");
  try {
    const onlineInvoice = await params.accountingApi.getOnlineInvoice(
      params.tenantId,
      params.invoiceId
    );
    const url = onlineInvoice.body.onlineInvoices?.[0]?.onlineInvoiceUrl;
    if (!url) {
      throw new XeroError("Xero did not return an online invoice URL.", 502);
    }

    const invoiceNumber = params.invoiceNumber ?? params.orderNumber;
    const email = buildAccountingDocumentEmail({
      documentType: "invoice",
      documentNumber: invoiceNumber,
      issuerName: params.organizationName,
      recipientName: params.customerName,
      totalAmount: params.totalAmount,
      dueDate: params.dueDate,
      actionUrl: url,
      lines: params.lines.map((line) => ({
        description: line.itemSku
          ? `${line.itemName} (${line.itemSku})`
          : line.itemName,
        quantity: line.quantity,
        amount: line.lineTotal,
      })),
    });

    await sendTransactionalEmail({
      tag: "invoice",
      to: params.customerEmail.trim(),
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: key,
    });

    try {
      await params.accountingApi.updateInvoice(
        params.tenantId,
        params.invoiceId,
        {
          invoices: [
            {
              type: Invoice.TypeEnum.ACCREC,
              sentToContact: true,
            },
          ],
        },
        undefined,
        buildXeroIdempotencyKey(params.orgId, "invoice-email", params.orderId, "mark-sent")
      );
    } catch (error) {
      console.error("Xero invoice mark-sent failed:", redactXeroError(error));
    }

    await (params.persistOutcome ?? ((outcome) =>
      persistEmailOutcome(params.orgId, params.orderId, outcome)))({
      status: "sent",
    });
    await tryRecordAccountingAuditEvent({
      organizationId: params.orgId,
      actor: { type: "process", processName: "xero_email" },
      eventType: "xero_email",
      outcome: "success",
      source: "lib/xero/push-invoice:sendInvoiceEmail",
      tenantId: params.tenantId,
      localEntityType: params.localEntityType ?? ACCOUNTING_DOCUMENT_SALES_ORDER,
      localEntityId: params.orderId,
      metadata: { status: "sent" },
    });
  } catch (error) {
    const message = extractXeroMessage(error).slice(0, 500);
    console.error("Invoice email failed:", redactXeroError(error));
    await (params.persistOutcome ?? ((outcome) =>
      persistEmailOutcome(params.orgId, params.orderId, outcome)))({
      status: "failed",
      error: message,
    });
    await tryRecordAccountingAuditEvent({
      organizationId: params.orgId,
      actor: { type: "process", processName: "xero_email" },
      eventType: "xero_email",
      outcome: "failure",
      source: "lib/xero/push-invoice:sendInvoiceEmail",
      tenantId: params.tenantId,
      localEntityType: params.localEntityType ?? ACCOUNTING_DOCUMENT_SALES_ORDER,
      localEntityId: params.orderId,
      metadata: accountingAuditErrorMetadata(error),
    });
    throw new XeroError(
      `Failed to email invoice: ${message}`,
      502
    );
  }
}

/**
 * Push an invoiceable sales order to Xero. Idempotent: if a Xero invoice
 * already exists for this order (locally tracked or discoverable by reference)
 * the existing invoice is adopted instead of creating a duplicate.
 *
 * Increments `xero_retry_count` and stamps `xero_last_push_attempt_at` on
 * every call so the cron can cap retries.
 */
export async function pushSalesOrderToXero(
  orgId: string,
  orderId: string,
  options: PushInvoiceOptions = {}
): Promise<PushInvoiceResult> {
  const data = await withOrgContext(orgId, async (tx) =>
    loadOrderForPushInTx(tx, orderId)
  );
  if (!data) {
    throw new XeroError("Order not found.", 404);
  }

  if (!orderInvoiceableStatuses.has(data.order.status)) {
    throw new XeroError(
      "Only open or done orders can be invoiced.",
      409
    );
  }

  const authed = await getAuthedXeroClient(orgId);
  const connection = authed.connection;

  if (!connection.defaultAccountCode) {
    throw new XeroError(
      "Set a sales invoice account code in Xero settings before creating invoices.",
      400
    );
  }

  await markPushAttempt(orgId, orderId);

  const accountingApi = authed.client.accountingApi;

  const lineItems: LineItem[] = data.lines.map((line) => ({
    description: line.itemSku
      ? `${line.itemName} (${line.itemSku})`
      : line.itemName,
    quantity: parseFloat(line.quantity),
    unitAmount: parseFloat(line.unitPrice),
    accountCode: connection.defaultAccountCode ?? undefined,
    taxType: connection.defaultTaxType ?? undefined,
    lineAmount: parseFloat(line.lineTotal),
  }));

  const statusPref =
    connection.invoiceStatusPreference === "DRAFT"
      ? Invoice.StatusEnum.DRAFT
      : Invoice.StatusEnum.AUTHORISED;

  const today = new Date().toISOString().slice(0, 10);
  const invoiceDate = data.order.shippedAt
    ? new Date(data.order.shippedAt).toISOString().slice(0, 10)
    : today;
  const dueDate = data.order.requestedDate ?? today;

  const payloadHash = hashXeroPayload({
    orderNumber: data.order.orderNumber,
    statusPref,
    invoiceDate,
    dueDate,
    totalAmount: data.order.totalAmount,
    accountCode: connection.defaultAccountCode,
    taxType: connection.defaultTaxType,
    lines: lineItems.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      lineAmount: line.lineAmount,
    })),
  });

  let invoiceId: string;
  let invoiceNumber: string;
  let created = false;
  let adopted = false;

  if (data.order.xeroInvoiceId) {
    invoiceId = data.order.xeroInvoiceId;
    invoiceNumber = data.order.xeroInvoiceNumber ?? data.order.orderNumber;
    // Always re-stamp success state. The cron forces xero_push_status to
    // 'failed' on rows it wants retried; reaching this branch means the
    // Xero invoice still exists by reference, so the row should land at
    // 'pushed' regardless of the prior status. A hash-only compare would
    // skip the persist and leave a stuck 'failed' status.
    await persistPushSuccess(
      orgId,
      orderId,
      invoiceId,
      invoiceNumber,
      payloadHash
    );
  } else {
    const lookupInvoiceNumber =
      data.order.xeroInvoiceNumber ?? data.order.orderNumber;
    const existing = await findXeroInvoiceForSalesOrder(
      orgId,
      lookupInvoiceNumber
    );
    if (existing) {
      invoiceId = existing.invoiceID;
      invoiceNumber = existing.invoiceNumber ?? lookupInvoiceNumber;
      adopted = true;
      await persistPushSuccess(
        orgId,
        orderId,
        invoiceId,
        invoiceNumber,
        payloadHash
      );
    } else {
      const contactId = await upsertXeroContact(
        orgId,
        customerToXeroContact(data.customer),
        authed.tenantId,
        accountingApi
      );

      const invoice: Invoice = {
        type: Invoice.TypeEnum.ACCREC,
        contact: { contactID: contactId },
        lineItems,
        date: invoiceDate,
        dueDate,
        invoiceNumber: data.order.orderNumber,
        reference: data.order.orderNumber,
        status: statusPref,
      };

      const createKey = buildXeroIdempotencyKey(
        orgId,
        "invoice",
        orderId,
        "create"
      );

      try {
        const invoices: Invoices = { invoices: [invoice] };
        const response = await accountingApi.createInvoices(
          authed.tenantId,
          invoices,
          undefined,
          undefined,
          createKey
        );
        const returned = response.body.invoices?.[0];
        if (!returned?.invoiceID) {
          throw new XeroError("Xero did not return an invoice ID.", 502);
        }
        invoiceId = returned.invoiceID;
        invoiceNumber = returned.invoiceNumber ?? data.order.orderNumber;
        created = true;
      } catch (error) {
        if (error instanceof XeroError) throw error;
        console.error("Xero invoice create failed:", redactXeroError(error));
        throw new XeroError(
          `Failed to push invoice to Xero: ${extractXeroMessage(error)}`,
          502
        );
      }

      await persistPushSuccess(
        orgId,
        orderId,
        invoiceId,
        invoiceNumber,
        payloadHash
      );
    }
  }

  let emailStatus: PushInvoiceResult["emailStatus"] = null;
  if (created || adopted) {
    const decision = decideEmail({
      statusPref,
      sendEmail: shouldSendSalesInvoiceEmail(connection, options),
      customerEmail: data.customer.email,
      existingEmailStatus: data.order.xeroEmailStatus,
    });

    if (decision.action === "send") {
      try {
        await sendInvoiceEmail({
          orgId,
          orderId,
          organizationName: data.order.organizationName,
          orderNumber: data.order.orderNumber,
          invoiceId,
          invoiceNumber,
          totalAmount: data.order.totalAmount,
          dueDate,
          customerName: data.customer.name,
          customerEmail: data.customer.email ?? "",
          lines: data.lines,
          tenantId: authed.tenantId,
          accountingApi,
        });
        emailStatus = "sent";
      } catch {
        emailStatus = "failed";
      }
    } else {
      await persistEmailOutcome(orgId, orderId, { status: "skipped" });
      emailStatus = "skipped";
    }
  }

  await tryRecordAccountingAuditEvent({
    organizationId: orgId,
    actor: { type: "process", processName: "xero_push" },
    eventType: "xero_push",
    outcome: "success",
    source: "lib/xero/push-invoice:pushSalesOrderToXero",
    tenantId: authed.tenantId,
    tenantName: authed.tenantName,
    localEntityType: ACCOUNTING_DOCUMENT_SALES_ORDER,
    localEntityId: orderId,
    metadata: { created, adopted, emailStatus },
  });

  return {
    xeroInvoiceId: invoiceId,
    xeroInvoiceNumber: invoiceNumber,
    status: "pushed",
    created,
    adopted,
    emailStatus,
  };
}

export async function getOnlineInvoiceUrlForOrder(
  orgId: string,
  orderId: string
): Promise<string> {
  const authed = await getAuthedXeroClient(orgId);

  const order = await withOrgContext(orgId, async (tx) => {
    const [row] = await tx
      .select({
        xeroInvoiceId: accountingDocumentSyncs.externalDocumentId,
        xeroPushStatus: accountingDocumentSyncs.pushStatus,
      })
      .from(salesOrders)
      .leftJoin(
        accountingDocumentSyncs,
        and(
          eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
          eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_SALES_ORDER),
          eq(accountingDocumentSyncs.documentId, salesOrders.id)
        )
      )
      .where(and(eq(salesOrders.id, orderId), isNull(salesOrders.deletedAt)));
    return row ?? null;
  });

  if (!order) {
    throw new XeroError("Order not found.", 404);
  }
  if (!order.xeroInvoiceId || order.xeroPushStatus !== "pushed") {
    throw new XeroError("Push the invoice to Xero before opening it.", 409);
  }

  const response = await authed.client.accountingApi.getOnlineInvoice(
    authed.tenantId,
    order.xeroInvoiceId
  );
  const url = response.body.onlineInvoices?.[0]?.onlineInvoiceUrl;
  if (!url) {
    throw new XeroError("Xero did not return an online invoice URL.", 502);
  }

  return url;
}

/**
 * Mark an order's Xero push as failed. Safe to call with any error; redacts
 * secrets before persisting the message.
 */
export async function markXeroPushFailed(
  orgId: string,
  orderId: string,
  error: unknown
): Promise<void> {
  const message = extractXeroMessage(error).slice(0, 500);
  await withOrgContext(orgId, async (tx) => {
    await persistAccountingDocumentPushFailure(tx, {
      organizationId: orgId,
      provider: ACCOUNTING_PROVIDER_XERO,
      documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
      documentId: orderId,
      error: message,
    });
  });
  await tryRecordAccountingAuditEvent({
    organizationId: orgId,
    actor: { type: "process", processName: "xero_push" },
    eventType: "xero_push",
    outcome: "failure",
    source: "lib/xero/push-invoice:markXeroPushFailed",
    localEntityType: ACCOUNTING_DOCUMENT_SALES_ORDER,
    localEntityId: orderId,
    metadata: accountingAuditErrorMetadata(error),
  });
}

/**
 * Manually retry the customer email for an already-pushed sales invoice.
 * Idempotency-key dedupes immediate replays within Xero's 6-minute window;
 * outside that window the user is responsible for not spamming.
 */
export async function emailSalesInvoiceForOrder(
  orgId: string,
  orderId: string
): Promise<{ status: "sent" }> {
  const authed = await getAuthedXeroClient(orgId);

  const data = await withOrgContext(orgId, async (tx) =>
    loadOrderForPushInTx(tx, orderId)
  );

  if (!data) {
    throw new XeroError("Order not found.", 404);
  }
  if (!orderInvoiceableStatuses.has(data.order.status)) {
    throw new XeroError(
      "Only open or done orders can be invoiced.",
      409
    );
  }
  if (!data.order.xeroInvoiceId || data.order.xeroPushStatus !== "pushed") {
    throw new XeroError(
      "Push the invoice to Xero before sending the email.",
      409
    );
  }
  if (!data.customer.email || data.customer.email.trim() === "") {
    throw new XeroError(
      "Customer has no email on file. Add one before retrying the send.",
      409
    );
  }

  await sendInvoiceEmail({
    orgId,
    orderId,
    organizationName: data.order.organizationName,
    orderNumber: data.order.orderNumber,
    invoiceId: data.order.xeroInvoiceId,
    invoiceNumber: data.order.xeroInvoiceNumber,
    totalAmount: data.order.totalAmount,
    dueDate: data.order.requestedDate,
    customerName: data.customer.name,
    customerEmail: data.customer.email,
    lines: data.lines,
    tenantId: authed.tenantId,
    accountingApi: authed.client.accountingApi,
  });

  await tryRecordAccountingAuditEvent({
    organizationId: orgId,
    actor: { type: "process", processName: "xero_email" },
    eventType: "xero_email",
    outcome: "success",
    source: "lib/xero/push-invoice:emailSalesInvoiceForOrder",
    tenantId: authed.tenantId,
    tenantName: authed.tenantName,
    localEntityType: ACCOUNTING_DOCUMENT_SALES_ORDER,
    localEntityId: orderId,
    metadata: { status: "sent" },
  });

  return { status: "sent" };
}
