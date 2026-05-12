import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  PurchaseOrder,
  type PurchaseOrders,
  type LineItem,
} from "xero-node";
import {
  organization,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { formatAddress } from "@/lib/format";
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

type OrderForPush = {
  id: string;
  organizationName: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  expectedDate: string | null;
  notes: string | null;
  xeroPurchaseAccountCode: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  totalAmount: string;
  orderedAt: Date | null;
  xeroPurchaseOrderId: string | null;
  xeroPurchaseOrderNumber: string | null;
  xeroPushStatus: string | null;
  xeroPushPayloadHash: string | null;
  xeroPoEmailStatus: string | null;
};

type SupplierForPush = {
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

type LineForPush = {
  itemName: string;
  itemSku: string | null;
  purchaseUnitName: string;
  quantityOrdered: string;
  unitCost: string;
  xeroPurchaseAccountCode: string | null;
  lineTotal: string;
};

type AdditionalCostForPush = {
  costType: "shipping" | "customs" | "other";
  reference: string | null;
  xeroPurchaseAccountCode: string | null;
  amount: string;
};

export type PushPurchaseOrderResult = {
  xeroPurchaseOrderId: string;
  xeroPurchaseOrderNumber: string;
  status: "pushed";
  created: boolean;
  adopted: boolean;
  emailStatus: "sent" | "failed" | "skipped" | null;
};

type PushPurchaseOrderOptions = {
  sendEmail?: boolean;
};

function supplierToXeroContact(supplier: SupplierForPush): XeroContactInput {
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

async function loadOrderForPushInTx(
  tx: import("@/lib/db/with-org-context").Tx,
  orderId: string
): Promise<{
  order: OrderForPush;
  supplier: SupplierForPush;
  lines: LineForPush[];
  additionalCosts: AdditionalCostForPush[];
} | null> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      organizationName: organization.name,
      orderNumber: purchaseOrders.orderNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: purchaseOrders.supplierName,
      expectedDate: purchaseOrders.expectedDate,
      notes: purchaseOrders.notes,
      xeroPurchaseAccountCode: purchaseOrders.xeroPurchaseAccountCode,
      shipLine1: purchaseOrders.shipLine1,
      shipLine2: purchaseOrders.shipLine2,
      shipCity: purchaseOrders.shipCity,
      shipRegion: purchaseOrders.shipRegion,
      shipPostcode: purchaseOrders.shipPostcode,
      shipCountry: purchaseOrders.shipCountry,
      totalAmount: purchaseOrders.totalAmount,
      orderedAt: purchaseOrders.orderedAt,
      xeroPurchaseOrderId: purchaseOrders.xeroPurchaseOrderId,
      xeroPurchaseOrderNumber: purchaseOrders.xeroPurchaseOrderNumber,
      xeroPushStatus: purchaseOrders.xeroPushStatus,
      xeroPushPayloadHash: purchaseOrders.xeroPushPayloadHash,
      xeroPoEmailStatus: purchaseOrders.xeroPoEmailStatus,
    })
    .from(purchaseOrders)
    .innerJoin(organization, eq(purchaseOrders.organizationId, organization.id))
    .where(
      and(
        eq(purchaseOrders.id, orderId),
        isNull(purchaseOrders.deletedAt)
      )
    );

  if (!order) return null;

  const [supplier] = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      email: suppliers.email,
      phone: suppliers.phone,
      xeroContactId: suppliers.xeroContactId,
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
      quantityOrdered: purchaseOrderLines.quantityOrdered,
      unitCost: purchaseOrderLines.unitCost,
      xeroPurchaseAccountCode: purchaseOrderLines.xeroPurchaseAccountCode,
      lineTotal: purchaseOrderLines.lineTotal,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
    .orderBy(purchaseOrderLines.sortOrder);

  const additionalCosts = await tx
    .select({
      costType: purchaseOrderAdditionalCosts.costType,
      reference: purchaseOrderAdditionalCosts.reference,
      xeroPurchaseAccountCode: purchaseOrderAdditionalCosts.xeroPurchaseAccountCode,
      amount: purchaseOrderAdditionalCosts.amount,
    })
    .from(purchaseOrderAdditionalCosts)
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, orderId))
    .orderBy(purchaseOrderAdditionalCosts.sortOrder);

  return {
    order,
    supplier,
    lines,
    additionalCosts: additionalCosts.map((cost) => ({
      costType: cost.costType as AdditionalCostForPush["costType"],
      reference: cost.reference,
      xeroPurchaseAccountCode: cost.xeroPurchaseAccountCode,
      amount: cost.amount,
    })),
  };
}

async function markPushAttempt(orgId: string, orderId: string): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(purchaseOrders)
      .set({
        xeroLastPushAttemptAt: new Date(),
        xeroRetryCount: sql`${purchaseOrders.xeroRetryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, orderId));
  });
}

async function persistPushSuccess(
  orgId: string,
  orderId: string,
  purchaseOrderId: string,
  purchaseOrderNumber: string,
  payloadHash: string
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(purchaseOrders)
      .set({
        xeroPurchaseOrderId: purchaseOrderId,
        xeroPurchaseOrderNumber: purchaseOrderNumber,
        xeroPushStatus: "pushed",
        xeroPushError: null,
        xeroPushedAt: new Date(),
        xeroPushPayloadHash: payloadHash,
        xeroRetryCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, orderId));
  });
}

/**
 * Look up an existing Xero purchase order by ERP PO number. Used on retry
 * to adopt a previously-created Xero PO when the local DB write of
 * `xero_purchase_order_id` failed after Xero accepted the create. Xero
 * idempotency keys only protect retries within ~6 minutes; reference
 * lookup covers the longer-tail cron retry window.
 */
export async function findXeroPurchaseOrderForPurchaseOrder(
  orgId: string,
  orderNumber: string
): Promise<{ purchaseOrderID: string; purchaseOrderNumber: string | null } | null> {
  const authed = await getAuthedXeroClient(orgId);
  try {
    const response = await authed.client.accountingApi.getPurchaseOrderByNumber(
      authed.tenantId,
      orderNumber
    );
    const matches = response.body.purchaseOrders ?? [];
    const found = matches.find((po) => po.purchaseOrderID);
    if (!found?.purchaseOrderID) return null;
    return {
      purchaseOrderID: found.purchaseOrderID,
      purchaseOrderNumber: found.purchaseOrderNumber ?? null,
    };
  } catch (error) {
    // Xero returns 404 when the PO number does not exist. Don't treat as
    // a fatal error — just signal "no match" so the caller falls through
    // to create.
    const status = extractXeroStatusCode(error);
    if (status === 404) return null;

    console.error("Xero PO lookup failed:", redactXeroError(error));
    return null;
  }
}

function resolveStatusPreference(
  preference: string | null
): PurchaseOrder.StatusEnum {
  switch (preference) {
    case "SUBMITTED":
      return PurchaseOrder.StatusEnum.SUBMITTED;
    case "AUTHORISED":
      return PurchaseOrder.StatusEnum.AUTHORISED;
    case "DRAFT":
    default:
      return PurchaseOrder.StatusEnum.DRAFT;
  }
}

type EmailDecision =
  | { action: "send"; reason: null }
  | { action: "skip"; reason: "not_selected" | "no_email" | "already_sent" };

function decidePurchaseOrderEmail(params: {
  sendEmail: boolean;
  supplierEmail: string | null;
  existingEmailStatus: string | null;
}): EmailDecision {
  if (params.existingEmailStatus === "sent") {
    return { action: "skip", reason: "already_sent" };
  }
  if (!params.sendEmail) {
    return { action: "skip", reason: "not_selected" };
  }
  if (!params.supplierEmail || params.supplierEmail.trim() === "") {
    return { action: "skip", reason: "no_email" };
  }
  return { action: "send", reason: null };
}

const ADDITIONAL_COST_TYPE_LABELS: Record<AdditionalCostForPush["costType"], string> = {
  shipping: "Shipping",
  customs: "Customs",
  other: "Other",
};

async function persistPurchaseOrderEmailOutcome(
  orgId: string,
  orderId: string,
  outcome:
    | { status: "sent"; error?: never }
    | { status: "failed"; error: string }
    | { status: "skipped"; error?: never }
): Promise<void> {
  await withOrgContext(orgId, async (tx) => {
    const conditions = [eq(purchaseOrders.id, orderId)];
    if (outcome.status !== "sent") {
      conditions.push(sql`COALESCE(${purchaseOrders.xeroPoEmailStatus}, '') <> 'sent'`);
    }

    await tx
      .update(purchaseOrders)
      .set({
        xeroPoEmailStatus: outcome.status,
        xeroPoEmailError: outcome.status === "failed" ? outcome.error : null,
        xeroPoEmailedAt: outcome.status === "sent" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(and(...conditions));
  });
}

function sanitizePdfFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
}

async function sendPurchaseOrderPdfEmail(params: {
  orgId: string;
  orderId: string;
  organizationName: string;
  orderNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string | null;
  totalAmount: string;
  expectedDate: string | null;
  supplierName: string;
  supplierEmail: string;
  lines: LineForPush[];
  tenantId: string;
  accountingApi: import("xero-node").AccountingApi;
}): Promise<void> {
  try {
    const response = await params.accountingApi.getPurchaseOrderAsPdf(
      params.tenantId,
      params.purchaseOrderId
    );
    const pdf = Buffer.isBuffer(response.body)
      ? response.body
      : Buffer.from(response.body);
    const purchaseOrderNumber = params.purchaseOrderNumber ?? params.orderNumber;
    const safeOrderNumber =
      sanitizePdfFileSegment(purchaseOrderNumber) || "purchase-order";
    const email = buildAccountingDocumentEmail({
      documentType: "purchase-order",
      documentNumber: purchaseOrderNumber,
      issuerName: params.organizationName,
      recipientName: params.supplierName,
      totalAmount: params.totalAmount,
      dueDate: params.expectedDate,
      lines: params.lines.map((line) => ({
        description: line.itemSku
          ? `${line.itemName} (${line.itemSku})`
          : line.itemName,
        quantity: line.quantityOrdered,
        unitLabel: line.purchaseUnitName,
        amount: line.lineTotal,
      })),
    });

    await sendTransactionalEmail({
      tag: "purchase-order",
      to: params.supplierEmail.trim(),
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [
        {
          filename: `${safeOrderNumber}.pdf`,
          content: pdf.toString("base64"),
        },
      ],
      idempotencyKey: buildXeroIdempotencyKey(
        params.orgId,
        "purchase-order-email",
        params.orderId,
        "send"
      ),
    });

    try {
      const purchaseOrder = (
        await params.accountingApi.getPurchaseOrder(
          params.tenantId,
          params.purchaseOrderId
        )
      ).body.purchaseOrders?.[0];
      if (
        purchaseOrder?.status === PurchaseOrder.StatusEnum.AUTHORISED ||
        purchaseOrder?.status === PurchaseOrder.StatusEnum.BILLED
      ) {
        await params.accountingApi.updatePurchaseOrder(
          params.tenantId,
          params.purchaseOrderId,
          { purchaseOrders: [{ sentToContact: true }] },
          buildXeroIdempotencyKey(
            params.orgId,
            "purchase-order-email",
            params.orderId,
            "mark-sent"
          )
        );
      }
    } catch (error) {
      console.error("Xero purchase order mark-sent failed:", redactXeroError(error));
    }

    await persistPurchaseOrderEmailOutcome(params.orgId, params.orderId, {
      status: "sent",
    });
  } catch (error) {
    const message = extractXeroMessage(error).slice(0, 500);
    console.error("Xero purchase order email failed:", redactXeroError(error));
    await persistPurchaseOrderEmailOutcome(params.orgId, params.orderId, {
      status: "failed",
      error: message,
    });
    throw new XeroError(`Failed to email purchase order: ${message}`, 502);
  }
}

/**
 * Push a submitted ERP purchase order to Xero as a Xero Purchase Order
 * (NOT a Bill — a Bill represents a supplier invoice and is deferred to a
 * future AP workflow).
 *
 * Idempotent: if a Xero PO already exists for this order (locally tracked
 * or discoverable by reference) the existing PO is adopted instead of
 * creating a duplicate.
 *
 * Increments `xero_retry_count` and stamps `xero_last_push_attempt_at` on
 * every call so the cron can cap retries.
 */
export async function pushPurchaseOrderToXero(
  orgId: string,
  orderId: string,
  options: PushPurchaseOrderOptions = {}
): Promise<PushPurchaseOrderResult> {
  const authed = await getAuthedXeroClient(orgId);
  const connection = authed.connection;

  const taxType =
    connection.purchaseOrderDefaultTaxType ?? connection.defaultTaxType;

  const data = await withOrgContext(orgId, async (tx) =>
    loadOrderForPushInTx(tx, orderId)
  );
  if (!data) {
    throw new XeroError("Purchase order not found.", 404);
  }

  await markPushAttempt(orgId, orderId);

  const accountingApi = authed.client.accountingApi;
  const fallbackAccountCode =
    data.order.xeroPurchaseAccountCode ??
    connection.purchaseOrderDefaultAccountCode ??
    connection.defaultAccountCode;

  const missingAccountLine = data.lines.find(
    (line) => !(line.xeroPurchaseAccountCode ?? fallbackAccountCode)
  );
  const missingAccountCost = data.additionalCosts.find(
    (cost) => !(cost.xeroPurchaseAccountCode ?? fallbackAccountCode)
  );
  if (missingAccountLine || missingAccountCost) {
    throw new XeroError(
      "Set Xero purchase account codes on the purchase order lines or defaults before pushing.",
      400
    );
  }

  const deliveryAddress = formatAddress({
    line1: data.order.shipLine1,
    line2: data.order.shipLine2,
    city: data.order.shipCity,
    region: data.order.shipRegion,
    postcode: data.order.shipPostcode,
    country: data.order.shipCountry,
  }) || undefined;

  const lineItems: LineItem[] = data.lines.map((line) => ({
    itemCode: line.itemSku ?? undefined,
    description: line.itemName,
    quantity: parseFloat(line.quantityOrdered),
    unitAmount: parseFloat(line.unitCost),
    accountCode: line.xeroPurchaseAccountCode ?? fallbackAccountCode ?? undefined,
    taxType: taxType ?? undefined,
    lineAmount: parseFloat(line.lineTotal),
  }));
  lineItems.push(
    ...data.additionalCosts.map((cost) => ({
      description: cost.reference
        ? `${ADDITIONAL_COST_TYPE_LABELS[cost.costType]} - ${cost.reference}`
        : ADDITIONAL_COST_TYPE_LABELS[cost.costType],
      quantity: 1,
      unitAmount: parseFloat(cost.amount),
      accountCode: cost.xeroPurchaseAccountCode ?? fallbackAccountCode ?? undefined,
      taxType: taxType ?? undefined,
      lineAmount: parseFloat(cost.amount),
    }))
  );

  const statusPref = resolveStatusPreference(
    connection.purchaseOrderStatusPreference
  );

  const today = new Date().toISOString().slice(0, 10);
  const orderedDate = data.order.orderedAt
    ? new Date(data.order.orderedAt).toISOString().slice(0, 10)
    : today;
  const deliveryDate = data.order.expectedDate ?? undefined;

  const payloadHash = hashXeroPayload({
    orderNumber: data.order.orderNumber,
    statusPref,
    orderedDate,
    deliveryDate,
    deliveryAddress,
    totalAmount: data.order.totalAmount,
    fallbackAccountCode,
    taxType,
    lines: lineItems.map((line) => ({
      itemCode: line.itemCode,
      description: line.description,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      lineAmount: line.lineAmount,
      accountCode: line.accountCode,
    })),
  });

  let purchaseOrderId: string;
  let purchaseOrderNumber: string;
  let created = false;
  let adopted = false;

  if (data.order.xeroPurchaseOrderId) {
    purchaseOrderId = data.order.xeroPurchaseOrderId;
    purchaseOrderNumber =
      data.order.xeroPurchaseOrderNumber ?? data.order.orderNumber;
    // Always re-stamp success state. The cron forces xero_push_status to
    // 'failed' on rows it wants retried; reaching this branch means the
    // Xero PO still exists by reference, so the row should land at
    // 'pushed' regardless of the prior status. A hash-only compare would
    // skip the persist and leave a stuck 'failed' status.
    await persistPushSuccess(
      orgId,
      orderId,
      purchaseOrderId,
      purchaseOrderNumber,
      payloadHash
    );
  } else {
    const existing = await findXeroPurchaseOrderForPurchaseOrder(
      orgId,
      data.order.orderNumber
    );
    if (existing) {
      purchaseOrderId = existing.purchaseOrderID;
      purchaseOrderNumber =
        existing.purchaseOrderNumber ?? data.order.orderNumber;
      adopted = true;
      await persistPushSuccess(
        orgId,
        orderId,
        purchaseOrderId,
        purchaseOrderNumber,
        payloadHash
      );
    } else {
      const contactId = await upsertXeroContact(
        orgId,
        supplierToXeroContact(data.supplier),
        authed.tenantId,
        accountingApi
      );

      const purchaseOrder: PurchaseOrder = {
        contact: { contactID: contactId },
        lineItems,
        date: orderedDate,
        deliveryDate,
        deliveryAddress,
        purchaseOrderNumber: data.order.orderNumber,
        reference: data.order.orderNumber,
        status: statusPref,
      };

      const createKey = buildXeroIdempotencyKey(
        orgId,
        "purchase-order",
        orderId,
        "create"
      );

      try {
        const purchaseOrdersPayload: PurchaseOrders = {
          purchaseOrders: [purchaseOrder],
        };
        const response = await accountingApi.createPurchaseOrders(
          authed.tenantId,
          purchaseOrdersPayload,
          undefined,
          createKey
        );
        const returned = response.body.purchaseOrders?.[0];
        if (!returned?.purchaseOrderID) {
          throw new XeroError("Xero did not return a purchase order ID.", 502);
        }
        purchaseOrderId = returned.purchaseOrderID;
        purchaseOrderNumber =
          returned.purchaseOrderNumber ?? data.order.orderNumber;
        created = true;
      } catch (error) {
        if (error instanceof XeroError) throw error;
        console.error(
          "Xero purchase order create failed:",
          redactXeroError(error)
        );
        throw new XeroError(
          `Failed to push purchase order to Xero: ${extractXeroMessage(error)}`,
          502
        );
      }

      await persistPushSuccess(
        orgId,
        orderId,
        purchaseOrderId,
        purchaseOrderNumber,
        payloadHash
      );
    }
  }

  let emailStatus: PushPurchaseOrderResult["emailStatus"] = null;
  if (created || adopted) {
    const decision = decidePurchaseOrderEmail({
      sendEmail: options.sendEmail === true,
      supplierEmail: data.supplier.email,
      existingEmailStatus: data.order.xeroPoEmailStatus,
    });

    if (decision.action === "send") {
      try {
        await sendPurchaseOrderPdfEmail({
          orgId,
          orderId,
          organizationName: data.order.organizationName,
          orderNumber: data.order.orderNumber,
          purchaseOrderId,
          purchaseOrderNumber,
          totalAmount: data.order.totalAmount,
          expectedDate: data.order.expectedDate,
          supplierName: data.supplier.name,
          supplierEmail: data.supplier.email ?? "",
          lines: data.lines,
          tenantId: authed.tenantId,
          accountingApi,
        });
        emailStatus = "sent";
      } catch {
        emailStatus = "failed";
      }
    } else {
      if (decision.reason !== "already_sent") {
        await persistPurchaseOrderEmailOutcome(orgId, orderId, {
          status: "skipped",
        });
      }
      emailStatus = "skipped";
    }
  }

  return {
    xeroPurchaseOrderId: purchaseOrderId,
    xeroPurchaseOrderNumber: purchaseOrderNumber,
    status: "pushed",
    created,
    adopted,
    emailStatus,
  };
}

/**
 * Manually retry the supplier email for an already-pushed Xero purchase order.
 */
export async function emailPurchaseOrderForOrder(
  orgId: string,
  orderId: string
): Promise<{ status: "sent" }> {
  const authed = await getAuthedXeroClient(orgId);

  const data = await withOrgContext(orgId, async (tx) =>
    loadOrderForPushInTx(tx, orderId)
  );

  if (!data) {
    throw new XeroError("Purchase order not found.", 404);
  }
  if (!data.order.xeroPurchaseOrderId || data.order.xeroPushStatus !== "pushed") {
    throw new XeroError(
      "Push the purchase order to Xero before sending the email.",
      409
    );
  }
  if (!data.supplier.email || data.supplier.email.trim() === "") {
    throw new XeroError(
      "Supplier has no email on file. Add one before retrying the send.",
      409
    );
  }

  await sendPurchaseOrderPdfEmail({
    orgId,
    orderId,
    organizationName: data.order.organizationName,
    orderNumber: data.order.orderNumber,
    purchaseOrderId: data.order.xeroPurchaseOrderId,
    purchaseOrderNumber: data.order.xeroPurchaseOrderNumber,
    totalAmount: data.order.totalAmount,
    expectedDate: data.order.expectedDate,
    supplierName: data.supplier.name,
    supplierEmail: data.supplier.email,
    lines: data.lines,
    tenantId: authed.tenantId,
    accountingApi: authed.client.accountingApi,
  });

  return { status: "sent" };
}

/**
 * Mark a purchase order's Xero push as failed. Safe to call with any
 * error; redacts secrets before persisting the message.
 */
export async function markXeroPurchaseOrderPushFailed(
  orgId: string,
  orderId: string,
  error: unknown
): Promise<void> {
  const message = extractXeroMessage(error).slice(0, 500);
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(purchaseOrders)
      .set({
        xeroPushStatus: "failed",
        xeroPushError: message,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, orderId));
  });
}
