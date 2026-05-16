import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateXeroSettings } from "@/lib/dal/xero";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";

const updateSchema = z.object({
  tenantId: z.string().trim().nullable().optional(),
  defaultAccountCode: z.string().trim().nullable(),
  defaultTaxType: z.string().trim().nullable(),
  invoiceStatusPreference: z.enum(["DRAFT", "AUTHORISED"]),
  autoPushSalesInvoices: z.boolean().default(false),
  autoPushPurchaseOrders: z.boolean().default(false),
  autoSyncPurchaseOrdersFromAccounting: z.boolean().default(false),
  autoEmailSalesInvoices: z.boolean(),
  autoEmailPurchaseOrders: z.boolean(),
  purchaseOrderDefaultAccountCode: z.string().trim().nullable(),
  purchaseOrderDefaultTaxType: z.string().trim().nullable(),
  purchaseOrderStatusPreference: z.enum(["DRAFT", "SUBMITTED", "AUTHORISED"]),
});

export const PUT = apiHandler(async (request: Request) => {
  const context = await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = updateSchema.parse(body);

  const result = await updateXeroSettings({
    tenantId: data.tenantId?.length ? data.tenantId : null,
    defaultAccountCode: data.defaultAccountCode?.length
      ? data.defaultAccountCode
      : null,
    defaultTaxType: data.defaultTaxType?.length ? data.defaultTaxType : null,
    invoiceStatusPreference: data.invoiceStatusPreference,
    autoPushSalesInvoices: data.autoPushSalesInvoices,
    autoPushPurchaseOrders: data.autoPushPurchaseOrders,
    autoSyncPurchaseOrdersFromAccounting: data.autoSyncPurchaseOrdersFromAccounting,
    autoEmailSalesInvoices: data.autoEmailSalesInvoices,
    autoEmailPurchaseOrders: data.autoEmailPurchaseOrders,
    purchaseOrderDefaultAccountCode: data.purchaseOrderDefaultAccountCode?.length
      ? data.purchaseOrderDefaultAccountCode
      : null,
    purchaseOrderDefaultTaxType: data.purchaseOrderDefaultTaxType?.length
      ? data.purchaseOrderDefaultTaxType
      : null,
    purchaseOrderStatusPreference: data.purchaseOrderStatusPreference,
  });

  if (!result) {
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "xero_settings_update",
      outcome: "failure",
      source: "PUT /api/xero/settings",
      metadata: { reason: "not_connected" },
    });
    return NextResponse.json(
      { error: "Xero is not connected." },
      { status: 409 }
    );
  }

  if (!result.ok) {
    await tryRecordAccountingAuditEvent({
      organizationId: context.orgId,
      actor: { type: "user", userId: context.userId },
      eventType: "xero_settings_update",
      outcome: "failure",
      source: "PUT /api/xero/settings",
      metadata: { reason: "unauthorized_tenant" },
    });
    return NextResponse.json(
      {
        error:
          "That Xero organisation isn't in this connection's authorised list. Reconnect to update access.",
      },
      { status: 400 }
    );
  }

  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "xero_settings_update",
    outcome: "success",
    source: "PUT /api/xero/settings",
    tenantId: result.summary?.tenantId,
    tenantName: result.summary?.tenantName,
    metadata: {
      invoiceStatusPreference: data.invoiceStatusPreference,
      purchaseOrderStatusPreference: data.purchaseOrderStatusPreference,
      autoPushSalesInvoices: data.autoPushSalesInvoices,
      autoPushPurchaseOrders: data.autoPushPurchaseOrders,
      autoSyncPurchaseOrdersFromAccounting:
        data.autoSyncPurchaseOrdersFromAccounting,
      autoEmailSalesInvoices: data.autoEmailSalesInvoices,
      autoEmailPurchaseOrders: data.autoEmailPurchaseOrders,
      changedTenant: Boolean(data.tenantId),
    },
  });
  return NextResponse.json(result.summary);
});
