import { requireModuleReadAccess } from "@/lib/dal/auth";
import { ManufacturingOrderCardShell } from "./card-shell";

export default async function ManufacturingOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleReadAccess("manufacturing");
  const { id } = await params;
  return <ManufacturingOrderCardShell orderId={id} />;
}
