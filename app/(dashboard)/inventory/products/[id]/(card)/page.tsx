import { redirect } from "next/navigation";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { tab, variant } = await searchParams;

  const selectedTab = Array.isArray(tab) ? tab[0] : tab;
  const selectedVariant = Array.isArray(variant) ? variant[0] : variant;
  const variantQuery = selectedVariant
    ? `?variant=${encodeURIComponent(selectedVariant)}`
    : "";
  if (selectedTab === "recipe") redirect(`/inventory/products/${id}/recipe${variantQuery}`);
  if (selectedTab === "operations" || selectedTab === "production") {
    redirect(`/inventory/products/${id}/production${variantQuery}`);
  }
  if (selectedTab === "lots") redirect(`/inventory/products/${id}/lots${variantQuery}`);
  if (selectedTab === "general") redirect(`/inventory/products/${id}${variantQuery}`);

  return null;
}
