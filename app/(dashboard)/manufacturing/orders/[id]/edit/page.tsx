import { redirect } from "next/navigation";

export default async function ManufacturingOrderEditRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/manufacturing/orders/${id}`);
}
