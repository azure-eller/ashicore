import { redirect } from "next/navigation";

export default async function ManufacturingOrderNewRedirect({
  searchParams,
}: {
  searchParams: Promise<{ salesOrderId?: string }>;
}) {
  const { salesOrderId } = await searchParams;
  const target = salesOrderId
    ? `/manufacturing/order?salesOrderId=${encodeURIComponent(salesOrderId)}`
    : "/manufacturing/order";
  redirect(target);
}
