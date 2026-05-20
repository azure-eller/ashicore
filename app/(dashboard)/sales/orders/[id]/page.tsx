import { redirect } from "next/navigation";
import { OrderDetail } from "@/app/(dashboard)/sales/order-detail";
import { OrderCard } from "./order-card";
import {
  getSalesOrder,
  getSalesOrderCustomerOptions,
} from "@/app/(dashboard)/sales/queries";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getXeroConnection } from "@/lib/dal/xero";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const search = (await searchParams) ?? {};
  const useLegacyView = search.view === "legacy";

  const [order, xeroConnection, customerOptions] = await Promise.all([
    getSalesOrder(id, { includeDeleted: true }),
    getXeroConnection(),
    getSalesOrderCustomerOptions(),
  ]);

  if (!order) {
    redirect("/sales/orders");
  }

  const xeroInvoiceSetupStatus = !xeroConnection
    ? "not_connected"
    : xeroConnection.defaultAccountCode
      ? "ready"
      : "missing_sales_account";

  if (useLegacyView) {
    return (
      <OrderDetail
        order={order}
        canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
        xeroInvoiceSetupStatus={xeroInvoiceSetupStatus}
      />
    );
  }

  return (
    <OrderCard
      initialOrder={order}
      customerOptions={customerOptions}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
      xeroInvoiceSetupStatus={xeroInvoiceSetupStatus}
    />
  );
}
