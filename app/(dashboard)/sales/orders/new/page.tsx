import { redirect } from "next/navigation";

export default async function NewOrderRedirect({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; projectId?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.customerId) query.set("customerId", params.customerId);
  if (params.projectId) query.set("projectId", params.projectId);
  const suffix = query.toString();
  redirect(`/sales/order${suffix ? `?${suffix}` : ""}`);
}
