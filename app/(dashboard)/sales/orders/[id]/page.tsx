import { redirect } from "next/navigation";
import { OrderCard } from "./order-card";
import {
  getSalesOrder,
  getSalesOrderCustomerOptions,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getXeroConnection } from "@/lib/dal/xero";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;

  const [order, xeroConnection, customerOptions, itemOptions] = await Promise.all([
    getSalesOrder(id, { includeDeleted: true }),
    getXeroConnection(),
    getSalesOrderCustomerOptions(),
    getSalesOrderItemOptions(),
  ]);

  if (!order) {
    redirect("/sales/orders");
  }

  const xeroInvoiceSetupStatus = !xeroConnection
    ? "not_connected"
    : xeroConnection.defaultAccountCode
      ? "ready"
      : "missing_sales_account";

  return (
    <OrderCard
      initialOrder={order}
      customerOptions={customerOptions}
      itemOptions={itemOptions}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
      xeroInvoiceSetupStatus={xeroInvoiceSetupStatus}
    />
  );
}
