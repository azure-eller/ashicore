import { redirect } from "next/navigation";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/purchasing/orders/${id}`);
}
