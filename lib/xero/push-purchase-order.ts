import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  PurchaseOrder,
  type PurchaseOrders,
  type LineItem,
} from "xero-node";
import { purchaseOrderLines, purchaseOrders, suppliers } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { getAuthedXeroClient } from "./client";
import {
  XeroError,
  extractXeroMessage,
  redactXeroError,
} from "./errors";
import { upsertXeroContact, type XeroContactInput } from "./contacts";
import { buildXeroIdempotencyKey } from "./idempotency";
import { hashXeroPayload } from "./payload-hash";

type OrderForPush = {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  expectedDate: string | null;
  notes: string | null;
  totalAmount: string;
  orderedAt: Date | null;
  xeroPurchaseOrderId: string | null;
  xeroPurchaseOrderNumber: string | null;
  xeroPushPayloadHash: string | null;
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
  lineTotal: string;
};

export type PushPurchaseOrderResult = {
  xeroPurchaseOrderId: string;
  xeroPurchaseOrderNumber: string;
  status: "pushed";
  created: boolean;
  adopted: boolean;
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
} | null> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: purchaseOrders.supplierName,
      expectedDate: purchaseOrders.expectedDate,
      notes: purchaseOrders.notes,
      totalAmount: purchaseOrders.totalAmount,
      orderedAt: purchaseOrders.orderedAt,
      xeroPurchaseOrderId: purchaseOrders.xeroPurchaseOrderId,
      xeroPurchaseOrderNumber: purchaseOrders.xeroPurchaseOrderNumber,
      xeroPushPayloadHash: purchaseOrders.xeroPushPayloadHash,
    })
    .from(purchaseOrders)
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
      lineTotal: purchaseOrderLines.lineTotal,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
    .orderBy(purchaseOrderLines.sortOrder);

  return { order, supplier, lines };
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
    const status = (error as { response?: { statusCode?: number } })?.response
      ?.statusCode;
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
  orderId: string
): Promise<PushPurchaseOrderResult> {
  const authed = await getAuthedXeroClient(orgId);
  const connection = authed.connection;

  const accountCode =
    connection.purchaseOrderDefaultAccountCode ?? connection.defaultAccountCode;
  if (!accountCode) {
    throw new XeroError(
      "Set a default Xero purchase order account code in settings before pushing.",
      400
    );
  }
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

  const lineItems: LineItem[] = data.lines.map((line) => ({
    description: line.itemSku
      ? `${line.itemName} (${line.itemSku})`
      : line.itemName,
    quantity: parseFloat(line.quantityOrdered),
    unitAmount: parseFloat(line.unitCost),
    accountCode,
    taxType: taxType ?? undefined,
    lineAmount: parseFloat(line.lineTotal),
  }));

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
    totalAmount: data.order.totalAmount,
    accountCode,
    taxType,
    lines: lineItems.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      lineAmount: line.lineAmount,
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
    if (data.order.xeroPushPayloadHash !== payloadHash) {
      await persistPushSuccess(
        orgId,
        orderId,
        purchaseOrderId,
        purchaseOrderNumber,
        payloadHash
      );
    }
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

  return {
    xeroPurchaseOrderId: purchaseOrderId,
    xeroPurchaseOrderNumber: purchaseOrderNumber,
    status: "pushed",
    created,
    adopted,
  };
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
