import { requireModuleWriteAccess } from "@/lib/dal/auth";
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
  const [{ customerId, projectId }, customerRows, items] = await Promise.all([
    searchParams,
    getSalesOrderCustomerOptions(),
    getSalesOrderItemOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1480px] py-8">
      <OrderForm
        customers={customerRows}
        items={items}
        initialCustomerId={customerId}
        initialCustomerProjectId={projectId}
      />
    </div>
  );
}
