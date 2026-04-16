import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import {
  Address,
  Contact,
  Invoice,
  type Contacts,
  type Invoices,
  type LineItem,
} from "xero-node";
import { customers, salesOrderLines, salesOrders } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { getAuthedXeroClient } from "./client";
import {
  XeroError,
  extractXeroMessage,
  redactXeroError,
} from "./errors";

type OrderForPush = {
  id: string;
  orderNumber: string;
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
};

function buildXeroAddresses(customer: CustomerForPush): Address[] {
  const addresses: Address[] = [];

  const billing: Address = {
    addressType: Address.AddressTypeEnum.POBOX,
    addressLine1: customer.billingLine1 ?? undefined,
    addressLine2: customer.billingLine2 ?? undefined,
    city: customer.billingCity ?? undefined,
    region: customer.billingRegion ?? undefined,
    postalCode: customer.billingPostcode ?? undefined,
    country: customer.billingCountry ?? undefined,
  };
  if (Object.values(billing).some((v) => v != null && v !== billing.addressType)) {
    addresses.push(billing);
  }

  const shipping: Address = {
    addressType: Address.AddressTypeEnum.STREET,
    addressLine1: customer.shipLine1 ?? undefined,
    addressLine2: customer.shipLine2 ?? undefined,
    city: customer.shipCity ?? undefined,
    region: customer.shipRegion ?? undefined,
    postalCode: customer.shipPostcode ?? undefined,
    country: customer.shipCountry ?? undefined,
  };
  if (Object.values(shipping).some((v) => v != null && v !== shipping.addressType)) {
    addresses.push(shipping);
  }

  return addresses;
}

async function upsertXeroContact(
  orgId: string,
  customer: CustomerForPush,
  tenantId: string,
  accountingApi: import("xero-node").AccountingApi
): Promise<string> {
  const contactPayload: Contact = {
    name: customer.name,
    emailAddress: customer.email ?? undefined,
    addresses: buildXeroAddresses(customer),
  };

  if (customer.xeroContactId) {
    contactPayload.contactID = customer.xeroContactId;
  }

  const contacts: Contacts = { contacts: [contactPayload] };
  try {
    const response = customer.xeroContactId
      ? await accountingApi.updateOrCreateContacts(tenantId, contacts)
      : await accountingApi.createContacts(tenantId, contacts);

    const returned = response.body.contacts?.[0];
    if (!returned?.contactID) {
      throw new XeroError("Xero did not return a contact ID.", 502);
    }

    if (returned.contactID !== customer.xeroContactId) {
      await withOrgContext(orgId, async (tx) => {
        await tx
          .update(customers)
          .set({ xeroContactId: returned.contactID, updatedAt: new Date() })
          .where(eq(customers.id, customer.id));
      });
    }

    return returned.contactID;
  } catch (error) {
    console.error("Xero contact upsert failed:", redactXeroError(error));
    throw new XeroError(
      `Could not sync customer to Xero: ${extractXeroMessage(error)}`,
      502
    );
  }
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
      orderNumber: salesOrders.orderNumber,
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
    })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.id, orderId),
        eq(salesOrders.status, "shipped"),
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
      xeroContactId: customers.xeroContactId,
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
      lineTotal: salesOrderLines.lineTotal,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(salesOrderLines.sortOrder);

  return {
    order,
    customer,
    lines,
  };
}

/**
 * Push a shipped sales order to Xero. Updates the customer's xeroContactId
 * on first sync and stores the returned invoice id/number on the sales
 * order. Throws XeroError on failure; callers should catch and persist
 * `xeroPushStatus = 'failed'`.
 */
export async function pushSalesOrderToXero(
  orgId: string,
  orderId: string
): Promise<PushInvoiceResult> {
  const authed = await getAuthedXeroClient(orgId);
  const connection = authed.connection;

  if (!connection.defaultAccountCode) {
    throw new XeroError(
      "Set a default Xero account code in settings before pushing invoices.",
      400
    );
  }

  const data = await withOrgContext(orgId, async (tx) =>
    loadOrderForPushInTx(tx, orderId)
  );
  if (!data) {
    throw new XeroError("Order not found.", 404);
  }

  const accountingApi = authed.client.accountingApi;

  const contactId = await upsertXeroContact(
    orgId,
    data.customer,
    authed.tenantId,
    accountingApi
  );

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

  const invoice: Invoice = {
    type: Invoice.TypeEnum.ACCREC,
    contact: { contactID: contactId },
    lineItems,
    date: data.order.shippedAt
      ? new Date(data.order.shippedAt).toISOString().slice(0, 10)
      : today,
    dueDate: data.order.requestedDate ?? today,
    invoiceNumber: data.order.orderNumber,
    reference: data.order.orderNumber,
    status: statusPref,
  };

  let invoiceId: string;
  let invoiceNumber: string;

  try {
    const invoices: Invoices = { invoices: [invoice] };
    const response = await accountingApi.createInvoices(
      authed.tenantId,
      invoices
    );
    const returned = response.body.invoices?.[0];
    if (!returned?.invoiceID) {
      throw new XeroError("Xero did not return an invoice ID.", 502);
    }
    invoiceId = returned.invoiceID;
    invoiceNumber = returned.invoiceNumber ?? data.order.orderNumber;
  } catch (error) {
    console.error("Xero invoice create failed:", redactXeroError(error));
    throw new XeroError(
      `Failed to push invoice to Xero: ${extractXeroMessage(error)}`,
      502
    );
  }

  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(salesOrders)
      .set({
        xeroInvoiceId: invoiceId,
        xeroInvoiceNumber: invoiceNumber,
        xeroPushStatus: "pushed",
        xeroPushError: null,
        xeroPushedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, orderId));
  });

  return { xeroInvoiceId: invoiceId, xeroInvoiceNumber: invoiceNumber, status: "pushed" };
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
    await tx
      .update(salesOrders)
      .set({
        xeroPushStatus: "failed",
        xeroPushError: message,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, orderId));
  });
}
