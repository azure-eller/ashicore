import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import {
  customers,
  integrationConnections,
  integrationImportRunRows,
  integrationImportRuns,
  items,
} from "@/lib/db/schema";
import { normalizeMoney, normalizeQuantityNumber } from "@/lib/format";
import { SalesError } from "@/lib/sales/queries/errors";
import { createCustomerInTx } from "@/lib/sales/queries/customers-write";
import { createSalesOrder } from "@/lib/sales/queries/order-write";
import {
  getExternalRecordByExternalIdInTx,
  upsertExternalRecordInTx,
} from "@/lib/integrations/external-records";
import { decryptXeroToken, isEncryptedXeroToken } from "@/lib/xero/token-crypto";
import { fetchPaidShopifyOrders, ShopifyError } from "./client";
import {
  SHOPIFY_PROVIDER,
  type ShopifyAddress,
  type ShopifyConnectionSettings,
  type ShopifyOrder,
  type ShopifyOrderLine,
} from "./types";

type ShopifyConnection = {
  tenantId: string;
  tenantName: string;
  accessToken: string;
  settings: ShopifyConnectionSettings | null;
};

export type ShopifyOrderImportResult = {
  runId: string;
  tenantName: string;
  fetched: number;
  created: number;
  skipped: number;
  errors: string[];
};

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSku(value: unknown) {
  return cleanString(value)?.toUpperCase() ?? null;
}

function normalizeShopifyId(value: string | number | null | undefined) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function shopifyOrderNumber(order: ShopifyOrder) {
  const name = cleanString(order.name);
  if (name) return `SHOP-${name.replace(/^#+/, "")}`.slice(0, 32);
  const number = normalizeShopifyId(order.order_number) ?? normalizeShopifyId(order.id);
  return `SHOP-${number}`.slice(0, 32);
}

function orderDate(order: ShopifyOrder) {
  const createdAt = cleanString(order.created_at);
  if (!createdAt) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function addressName(address: ShopifyAddress | null | undefined) {
  const company = cleanString(address?.company);
  if (company) return company;
  return [cleanString(address?.first_name), cleanString(address?.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function customerName(order: ShopifyOrder) {
  const shippingName = addressName(order.shipping_address);
  if (shippingName) return shippingName;
  const billingName = addressName(order.billing_address);
  if (billingName) return billingName;
  const customer = order.customer;
  const name = [cleanString(customer?.first_name), cleanString(customer?.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || cleanString(order.email) || "Shopify Customer";
}

function customerEmail(order: ShopifyOrder) {
  return (
    cleanString(order.email) ??
    cleanString(order.contact_email) ??
    cleanString(order.customer?.email)
  );
}

function customerPhone(order: ShopifyOrder) {
  return (
    cleanString(order.phone) ??
    cleanString(order.customer?.phone) ??
    cleanString(order.shipping_address?.phone)
  );
}

function decryptConnectionToken(row: {
  accessTokenCiphertext: string;
  tokenEncryptionKeyId: string | null;
}) {
  if (!isEncryptedXeroToken(row.accessTokenCiphertext)) {
    return row.accessTokenCiphertext;
  }
  return decryptXeroToken(row.accessTokenCiphertext, row.tokenEncryptionKeyId);
}

async function getShopifyConnectionInTx(tx: Tx): Promise<ShopifyConnection> {
  const [row] = await tx
    .select({
      tenantId: integrationConnections.tenantId,
      tenantName: integrationConnections.tenantName,
      accessTokenCiphertext: integrationConnections.accessTokenCiphertext,
      tokenEncryptionKeyId: integrationConnections.tokenEncryptionKeyId,
      settings: integrationConnections.settings,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.provider, SHOPIFY_PROVIDER))
    .limit(1);

  if (!row) {
    throw new ShopifyError("Shopify is not connected.", 409);
  }

  return {
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    accessToken: decryptConnectionToken(row),
    settings: row.settings as ShopifyConnectionSettings | null,
  };
}

async function findCustomerIdInTx(tx: Tx, orgId: string, order: ShopifyOrder) {
  const externalCustomerId = normalizeShopifyId(order.customer?.id);
  if (externalCustomerId) {
    const external = await getExternalRecordByExternalIdInTx(tx, {
      organizationId: orgId,
      provider: SHOPIFY_PROVIDER,
      entityType: "customer",
      externalId: externalCustomerId,
    });
    if (external) return external.localRecordId;
  }

  const email = customerEmail(order);
  if (email) {
    const [byEmail] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.email, email), isNull(customers.deletedAt)))
      .limit(1);
    if (byEmail) return byEmail.id;
  }

  const name = customerName(order);
  const [byName] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.name, name), isNull(customers.deletedAt)))
    .limit(1);
  if (byName) return byName.id;

  const [created] = await Promise.all([
    createCustomerInTx(tx, orgId, {
      name,
      customerCategoryId: null,
      accountState: "active",
      accountPriority: "standard",
      email,
      phone: customerPhone(order),
      billingLine1: cleanString(order.billing_address?.address1),
      billingLine2: cleanString(order.billing_address?.address2),
      billingCity: cleanString(order.billing_address?.city),
      billingRegion: cleanString(order.billing_address?.province),
      billingPostcode: cleanString(order.billing_address?.zip),
      billingCountry: cleanString(order.billing_address?.country),
      shipLine1: cleanString(order.shipping_address?.address1),
      shipLine2: cleanString(order.shipping_address?.address2),
      shipCity: cleanString(order.shipping_address?.city),
      shipRegion: cleanString(order.shipping_address?.province),
      shipPostcode: cleanString(order.shipping_address?.zip),
      shipCountry: cleanString(order.shipping_address?.country),
    }),
  ]);

  return created.id;
}

async function upsertShopifyCustomerExternalRecordInTx(
  tx: Tx,
  orgId: string,
  order: ShopifyOrder,
  customerId: string
) {
  const externalCustomerId = normalizeShopifyId(order.customer?.id);
  if (!externalCustomerId) return;

  await upsertExternalRecordInTx(tx, {
    organizationId: orgId,
    provider: SHOPIFY_PROVIDER,
    entityType: "customer",
    localRecordId: customerId,
    externalId: externalCustomerId,
    externalName: customerName(order),
    metadata: { email: customerEmail(order) },
  });
}

function importableLine(line: ShopifyOrderLine) {
  const sku = normalizeSku(line.sku);
  const quantity = Number(line.fulfillable_quantity ?? line.quantity);
  const price = Number(line.price);
  if (!sku || !Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return { sku, quantity, price };
}

async function buildSalesLinesInTx(tx: Tx, order: ShopifyOrder) {
  const bySku = new Map<string, { quantity: number; price: number }>();
  for (const line of order.line_items ?? []) {
    const parsed = importableLine(line);
    if (!parsed) continue;
    const existing = bySku.get(parsed.sku);
    bySku.set(parsed.sku, {
      quantity: (existing?.quantity ?? 0) + parsed.quantity,
      price: parsed.price,
    });
  }

  if (bySku.size === 0) {
    throw new ShopifyError(
      `Shopify order ${order.name ?? order.id} has no importable paid SKU lines.`,
      400
    );
  }

  const skuRows = await tx
    .select({ id: items.id, sku: items.sku })
    .from(items)
    .where(
      and(
        inArray(sql<string>`upper(${items.sku})`, [...bySku.keys()]),
        eq(items.sellable, true),
        isNull(items.deletedAt)
      )
    );
  const itemBySku = new Map(
    skuRows.flatMap((row) => {
      const sku = normalizeSku(row.sku);
      return sku ? [[sku, row.id]] : [];
    })
  );

  const missingSkus = [...bySku.keys()].filter((sku) => !itemBySku.has(sku));
  if (missingSkus.length > 0) {
    throw new ShopifyError(
      `Shopify order ${order.name ?? order.id} has unmatched SKU(s): ${missingSkus.join(", ")}.`,
      400
    );
  }

  return [...bySku.entries()].map(([sku, line]) => ({
    itemId: itemBySku.get(sku)!,
    quantity: String(normalizeQuantityNumber(line.quantity)),
    unitPrice: normalizeMoney(line.price),
    taxRateId: undefined,
  }));
}

async function createImportRunInTx(
  tx: Tx,
  orgId: string,
  connection: ShopifyConnection
) {
  const [run] = await tx
    .insert(integrationImportRuns)
    .values({
      organizationId: orgId,
      provider: SHOPIFY_PROVIDER,
      entityType: "sales_orders",
      tenantId: connection.tenantId,
      tenantName: connection.tenantName,
      createdCount: 0,
      skippedCount: 0,
      errorCount: 0,
    })
    .returning({ id: integrationImportRuns.id });
  return run.id;
}

async function markOrderImportedInTx(params: {
  tx: Tx;
  orgId: string;
  runId: string;
  order: ShopifyOrder;
  salesOrderId: string;
}) {
  await upsertExternalRecordInTx(params.tx, {
    organizationId: params.orgId,
    provider: SHOPIFY_PROVIDER,
    entityType: "sales_order",
    localRecordId: params.salesOrderId,
    externalId: normalizeShopifyId(params.order.id),
    externalCode: cleanString(params.order.name),
    externalName: cleanString(params.order.name),
    metadata: {
      financialStatus: params.order.financial_status,
      fulfillmentStatus: params.order.fulfillment_status,
    },
    externalUpdatedAt: params.order.created_at
      ? new Date(params.order.created_at)
      : null,
  });

  await params.tx.insert(integrationImportRunRows).values({
    organizationId: params.orgId,
    provider: SHOPIFY_PROVIDER,
    runId: params.runId,
    entityType: "sales_orders",
    action: "created",
    localRecordId: params.salesOrderId,
    externalRecordId: normalizeShopifyId(params.order.id),
    localName: shopifyOrderNumber(params.order),
  });
}

async function incrementRunCountsInTx(
  tx: Tx,
  runId: string,
  counts: { created: number; skipped: number; errors: number }
) {
  await tx
    .update(integrationImportRuns)
    .set({
      createdCount: counts.created,
      skippedCount: counts.skipped,
      errorCount: counts.errors,
      updatedAt: new Date(),
    })
    .where(eq(integrationImportRuns.id, runId));
}

export async function importPaidShopifyOrders(
  orgId: string,
  options?: { shopBaseUrl?: string | null }
): Promise<ShopifyOrderImportResult> {
  const connection = await withOrgContext(orgId, async (tx) =>
    getShopifyConnectionInTx(tx)
  );
  const shopDomain = connection.settings?.shopDomain ?? connection.tenantId;
  const response = await fetchPaidShopifyOrders({
    shopDomain,
    accessToken: connection.accessToken,
    shopBaseUrl: options?.shopBaseUrl,
  });
  const orders = response.orders ?? [];
  const runId = await withOrgContext(orgId, async (tx) =>
    createImportRunInTx(tx, orgId, connection)
  );

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const order of orders) {
    const externalOrderId = normalizeShopifyId(order.id);
    if (!externalOrderId) {
      skipped += 1;
      errors.push("Shopify order is missing an ID.");
      continue;
    }

    const prepared = await withOrgContext(orgId, async (tx) => {
      const existing = await getExternalRecordByExternalIdInTx(tx, {
        organizationId: orgId,
        provider: SHOPIFY_PROVIDER,
        entityType: "sales_order",
        externalId: externalOrderId,
      });
      if (existing) return { skipped: true as const };

      const customerId = await findCustomerIdInTx(tx, orgId, order);
      await upsertShopifyCustomerExternalRecordInTx(tx, orgId, order, customerId);
      const lines = await buildSalesLinesInTx(tx, order);
      return { skipped: false as const, customerId, lines };
    });

    if (prepared.skipped) {
      skipped += 1;
      continue;
    }

    try {
      const salesOrder = await createSalesOrder(
        {
          quantityContractVersion: 2,
          customerId: prepared.customerId,
          customerProjectId: null,
          status: "open",
          orderNumber: shopifyOrderNumber(order),
          orderDate: orderDate(order),
          requestedDate: null,
          shipDate: null,
          notes: `Imported from Shopify order ${order.name ?? order.id}.`,
          shipLine1: cleanString(order.shipping_address?.address1),
          shipLine2: cleanString(order.shipping_address?.address2),
          shipCity: cleanString(order.shipping_address?.city),
          shipRegion: cleanString(order.shipping_address?.province),
          shipPostcode: cleanString(order.shipping_address?.zip),
          shipCountry: cleanString(order.shipping_address?.country),
          billingLine1: cleanString(order.billing_address?.address1),
          billingLine2: cleanString(order.billing_address?.address2),
          billingCity: cleanString(order.billing_address?.city),
          billingRegion: cleanString(order.billing_address?.province),
          billingPostcode: cleanString(order.billing_address?.zip),
          billingCountry: cleanString(order.billing_address?.country),
          shippingFeeDescription: null,
          shippingFeeAmount: null,
          shippingFeeTaxAmount: null,
          lines: prepared.lines,
        },
        { idempotencyKey: `shopify-order-import:${externalOrderId}` }
      );

      await withOrgContext(orgId, async (tx) => {
        await markOrderImportedInTx({
          tx,
          orgId,
          runId,
          order,
          salesOrderId: salesOrder.id,
        });
      });
      created += 1;
    } catch (error) {
      if (error instanceof SalesError || error instanceof ShopifyError) {
        errors.push(error.message);
        continue;
      }
      throw error;
    }
  }

  await withOrgContext(orgId, async (tx) => {
    await incrementRunCountsInTx(tx, runId, {
      created,
      skipped,
      errors: errors.length,
    });
  });

  return {
    runId,
    tenantName: connection.tenantName,
    fetched: orders.length,
    created,
    skipped,
    errors,
  };
}
