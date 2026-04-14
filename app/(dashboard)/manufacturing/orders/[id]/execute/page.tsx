import { redirect } from "next/navigation";
import { ManufacturingExecution } from "@/app/(dashboard)/manufacturing/manufacturing-execution";
import { getManufacturingExecutionDetail } from "@/app/(dashboard)/manufacturing/queries";

export default async function ManufacturingOrderExecutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const execution = await getManufacturingExecutionDetail(id);

  if (!execution) {
    redirect("/manufacturing/execution");
  }

  return <ManufacturingExecution execution={execution} />;
}
