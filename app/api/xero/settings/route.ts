import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { getXeroConnection, updateXeroSettings } from "@/lib/dal/xero";
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

function salesInvoiceStatus(value: string | null | undefined) {
  return value === "AUTHORISED" ? "AUTHORISED" : "DRAFT";
}

function purchaseOrderStatus(value: string | null | undefined) {
  if (value === "SUBMITTED" || value === "AUTHORISED") return value;
  return "DRAFT";
}

export const PUT = apiHandler(async (request: Request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  const canManageSalesXero = hasModuleAccess(
    context.assignedRoles,
    "sales",
    "operate"
  );
  const canManagePurchasingXero = hasModuleAccess(
    context.assignedRoles,
    "purchasing",
    "operate"
  );
  const canManageXeroSettings = canManageSalesXero || canManagePurchasingXero;
  if (!canManageXeroSettings) {
    throw new AuthorizationError("You do not have permission to update Xero settings.", 403);
  }
  const data = await parseJsonBody(request, updateSchema);
  const existing = await getXeroConnection();

  const result = await updateXeroSettings({
    tenantId:
      canManageSalesXero && data.tenantId?.length
        ? data.tenantId
        : existing?.tenantId ?? null,
    defaultAccountCode: canManageSalesXero
      ? data.defaultAccountCode?.length
        ? data.defaultAccountCode
        : null
      : existing?.defaultAccountCode ?? null,
    defaultTaxType: canManageSalesXero
      ? data.defaultTaxType?.length
        ? data.defaultTaxType
        : null
      : existing?.defaultTaxType ?? null,
    invoiceStatusPreference: canManageSalesXero
      ? data.invoiceStatusPreference
      : salesInvoiceStatus(existing?.invoiceStatusPreference),
    autoPushSalesInvoices: canManageSalesXero
      ? data.autoPushSalesInvoices
      : existing?.autoPushSalesInvoices ?? false,
    autoPushPurchaseOrders: false,
    autoSyncPurchaseOrdersFromAccounting: canManagePurchasingXero
      ? data.autoSyncPurchaseOrdersFromAccounting
      : existing?.autoSyncPurchaseOrdersFromAccounting ?? false,
    autoEmailSalesInvoices: canManageSalesXero
      ? data.autoEmailSalesInvoices
      : existing?.autoEmailSalesInvoices ?? false,
    autoEmailPurchaseOrders: false,
    purchaseOrderDefaultAccountCode: canManagePurchasingXero
      ? data.purchaseOrderDefaultAccountCode?.length
        ? data.purchaseOrderDefaultAccountCode
        : null
      : existing?.purchaseOrderDefaultAccountCode ?? null,
    purchaseOrderDefaultTaxType: canManagePurchasingXero
      ? data.purchaseOrderDefaultTaxType?.length
        ? data.purchaseOrderDefaultTaxType
        : null
      : existing?.purchaseOrderDefaultTaxType ?? null,
    purchaseOrderStatusPreference: canManagePurchasingXero
      ? data.purchaseOrderStatusPreference
      : purchaseOrderStatus(existing?.purchaseOrderStatusPreference),
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

  const summary = result.summary;
  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "xero_settings_update",
    outcome: "success",
    source: "PUT /api/xero/settings",
    tenantId: summary?.tenantId,
    tenantName: summary?.tenantName,
    metadata: {
      invoiceStatusPreference: summary?.invoiceStatusPreference,
      purchaseOrderStatusPreference: summary?.purchaseOrderStatusPreference,
      autoPushSalesInvoices: summary?.autoPushSalesInvoices,
      autoPushPurchaseOrders: false,
      autoSyncPurchaseOrdersFromAccounting:
        summary?.autoSyncPurchaseOrdersFromAccounting,
      autoEmailSalesInvoices: summary?.autoEmailSalesInvoices,
      autoEmailPurchaseOrders: false,
      changedTenant: Boolean(data.tenantId && data.tenantId !== existing?.tenantId),
    },
  });
  return NextResponse.json(summary);
});
