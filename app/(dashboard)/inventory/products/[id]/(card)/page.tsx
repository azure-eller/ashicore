import { redirect } from "next/navigation";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;

  const selectedTab = Array.isArray(tab) ? tab[0] : tab;
  if (selectedTab === "recipe") redirect(`/inventory/products/${id}/recipe`);
  if (selectedTab === "operations" || selectedTab === "production") {
    redirect(`/inventory/products/${id}/production`);
  }
  if (selectedTab === "lots") redirect(`/inventory/products/${id}/lots`);
  if (selectedTab === "general") redirect(`/inventory/products/${id}`);

  return null;
}
