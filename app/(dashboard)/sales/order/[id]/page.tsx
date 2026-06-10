import { redirect } from "next/navigation";
import { OrderCard } from "../../orders/[id]/order-card";
import {
  getSalesOrder,
  getSalesOrderCustomerOptions,
  getSalesOrderItemOptions,
} from "@/lib/sales/queries";
import { hasModuleAccess } from "@/lib/authz";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { getAddressEntries } from "@/lib/dal/addresses";
import { getActiveAccountingProvider } from "@/lib/dal/accounting";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireModuleReadAccess("sales");
  const { id } = await params;

  const [activeAccounting, customerOptions, itemOptions, addressEntries] = await Promise.all([
    getActiveAccountingProvider(),
    getSalesOrderCustomerOptions(),
    getSalesOrderItemOptions(),
    getAddressEntries(),
  ]);
  const order = await getSalesOrder(id, {
    includeDeleted: true,
    accountingProvider:
      activeAccounting.status === "ready" ? activeAccounting.provider : undefined,
  });

  if (!order) {
    redirect("/sales/orders");
  }

  const accountingInvoiceSetupStatus =
    activeAccounting.status === "conflict"
      ? "provider_conflict"
      : activeAccounting.status === "none"
        ? "not_connected"
        : activeAccounting.connection.defaultAccountCode
          ? "ready"
          : "missing_sales_account";

  return (
    <OrderCard
      initialOrder={order}
      customerOptions={customerOptions}
      addressOptions={addressEntries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        contactName: entry.contactName,
        contactPhone: entry.contactPhone,
        line1: entry.line1,
        line2: entry.line2,
        city: entry.city,
        region: entry.region,
        postcode: entry.postcode,
        country: entry.country,
        deliveryInstructions: entry.deliveryInstructions,
        notes: entry.notes,
      }))}
      itemOptions={itemOptions}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
      xeroInvoiceSetupStatus={accountingInvoiceSetupStatus}
      accountingProviderLabel={activeAccounting.label}
    />
  );
}
