import { redirect } from "next/navigation";

// The dedicated edit form is retired — the detail page is inline-editable.
export default async function EditOrderRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/sales/orders/${id}`);
}
