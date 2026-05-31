import { redirect } from "next/navigation";
import { appendSearchParams, type SearchParamRecord } from "@/lib/routing/search-params";

export default async function ManufacturingOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamRecord>;
}) {
  const { id } = await params;
  redirect(appendSearchParams(`/manufacturing/order/${id}`, await searchParams));
}
