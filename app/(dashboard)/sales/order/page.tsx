import { requireModuleWriteAccess } from "@/lib/dal/auth";
import {
  getSalesOrderCustomerOptions,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";
import { getAddressEntries } from "@/lib/dal/addresses";
import { OrderCard } from "@/app/(dashboard)/sales/orders/[id]/order-card";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; projectId?: string }>;
}) {
  await requireModuleWriteAccess("sales");
  const params = await searchParams;
  const [customerOptions, itemOptions, addressOptions] = await Promise.all([
    getSalesOrderCustomerOptions(),
    getSalesOrderItemOptions(),
    getAddressEntries(),
  ]);
  const customerId =
    params.customerId &&
    customerOptions.some((customer) => customer.id === params.customerId)
      ? params.customerId
      : null;
  const projectId =
    customerId &&
    params.projectId &&
    customerOptions
      .find((customer) => customer.id === customerId)
      ?.projects.some((project) => project.id === params.projectId)
      ? params.projectId
      : null;

  return (
    <OrderCard
      initialOrder={null}
      initialDraftCustomerId={customerId}
      initialDraftProjectId={projectId}
      customerOptions={customerOptions}
      itemOptions={itemOptions}
      addressOptions={addressOptions}
    />
  );
}
