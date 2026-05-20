import { requireModuleWriteAccess } from "@/lib/dal/auth";
import {
  getSalesOrderCustomerOptions,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";
import { OrderCard } from "@/app/(dashboard)/sales/orders/[id]/order-card";
import { getAddressEntries } from "@/lib/dal/addresses";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; projectId?: string }>;
}) {
  await requireModuleWriteAccess("sales");
  const params = await searchParams;
  const [customerOptions, itemOptions, addressEntries] = await Promise.all([
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
    />
  );
}
