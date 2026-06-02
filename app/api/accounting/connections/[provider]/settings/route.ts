import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { isAccountingProvider } from "@/lib/accounting/providers";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { updateAccountingConnectionSettings } from "@/lib/dal/accounting";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

const updateSchema = z.object({
  defaultAccountCode: z.string().trim().nullable().optional(),
  defaultTaxType: z.string().trim().nullable().optional(),
  invoiceStatusPreference: z.enum(["DRAFT", "AUTHORISED"]).optional(),
  autoPushSalesInvoices: z.boolean().optional(),
  autoSyncPurchaseOrdersFromAccounting: z.boolean().optional(),
  autoEmailSalesInvoices: z.boolean().optional(),
  purchaseOrderDefaultAccountCode: z.string().trim().nullable().optional(),
  purchaseOrderDefaultTaxType: z.string().trim().nullable().optional(),
  purchaseOrderStatusPreference: z
    .enum(["DRAFT", "SUBMITTED", "AUTHORISED"])
    .optional(),
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const context = await getAuthedApiMemberContext(request.headers);
  const canManageSales = hasModuleAccess(
    context.assignedRoles,
    "sales",
    "operate"
  );
  const canManagePurchasing = hasModuleAccess(
    context.assignedRoles,
    "purchasing",
    "operate"
  );
  if (!canManageSales && !canManagePurchasing) {
    throw new AuthorizationError(
      "You do not have permission to update accounting settings.",
      403
    );
  }
  const { provider } = await (ctx as RouteContext).params;
  if (!isAccountingProvider(provider)) {
    return NextResponse.json(
      { error: "Unsupported accounting provider." },
      { status: 400 }
    );
  }

  const data = await parseJsonBody(request, updateSchema);
  const summary = await updateAccountingConnectionSettings({
    provider,
    defaultAccountCode: canManageSales
      ? data.defaultAccountCode === undefined
        ? undefined
        : data.defaultAccountCode?.length
          ? data.defaultAccountCode
          : null
      : undefined,
    defaultTaxType: canManageSales
      ? data.defaultTaxType === undefined
        ? undefined
        : data.defaultTaxType?.length
          ? data.defaultTaxType
          : null
      : undefined,
    invoiceStatusPreference: canManageSales
      ? data.invoiceStatusPreference
      : undefined,
    autoPushSalesInvoices: canManageSales
      ? data.autoPushSalesInvoices
      : undefined,
    autoEmailSalesInvoices: canManageSales
      ? data.autoEmailSalesInvoices
      : undefined,
    autoSyncPurchaseOrdersFromAccounting: canManagePurchasing
      ? data.autoSyncPurchaseOrdersFromAccounting
      : undefined,
    purchaseOrderDefaultAccountCode: canManagePurchasing
      ? data.purchaseOrderDefaultAccountCode === undefined
        ? undefined
        : data.purchaseOrderDefaultAccountCode?.length
          ? data.purchaseOrderDefaultAccountCode
          : null
      : undefined,
    purchaseOrderDefaultTaxType: canManagePurchasing
      ? data.purchaseOrderDefaultTaxType === undefined
        ? undefined
        : data.purchaseOrderDefaultTaxType?.length
          ? data.purchaseOrderDefaultTaxType
          : null
      : undefined,
    purchaseOrderStatusPreference: canManagePurchasing
      ? data.purchaseOrderStatusPreference
      : undefined,
  });
  if (!summary) {
    return NextResponse.json(
      { error: "Accounting provider is not connected." },
      { status: 409 }
    );
  }

return NextResponse.json(summary);
});
