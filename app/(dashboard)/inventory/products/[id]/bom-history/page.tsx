import { redirect } from "next/navigation";

export default async function ProductBomHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  redirect(`/inventory/products/${id}/recipe`);
}
