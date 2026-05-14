import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getAddressEntries } from "@/lib/dal/addresses";
import { OrderForm } from "@/app/(dashboard)/sales/order-form";
import {
  getSalesOrderCustomerOptions,
  getSalesOrderItemOptions,
} from "@/app/(dashboard)/sales/queries";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; projectId?: string }>;
}) {
  await requireModuleWriteAccess("sales");
  const [{ customerId, projectId }, customerRows, items, addresses] = await Promise.all([
    searchParams,
    getSalesOrderCustomerOptions(),
    getSalesOrderItemOptions(),
    getAddressEntries(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1480px] py-8">
      <OrderForm
        customers={customerRows}
        items={items}
        addresses={addresses}
        initialCustomerId={customerId}
        initialCustomerProjectId={projectId}
      />
    </div>
  );
}
