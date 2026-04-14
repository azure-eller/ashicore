import { Suspense } from "react";
import { getManufacturingExecutionQueue } from "@/app/(dashboard)/manufacturing/queries";
import { ManufacturingExecutionQueue } from "@/app/(dashboard)/manufacturing/execution-queue";
import ManufacturingDataTableSkeleton from "../data-table-skeleton";

export default function ManufacturingExecutionPage() {
  return (
    <Suspense fallback={<ManufacturingDataTableSkeleton />}>
      <ManufacturingExecutionData />
    </Suspense>
  );
}

async function ManufacturingExecutionData() {
  const rows = await getManufacturingExecutionQueue();
  return <ManufacturingExecutionQueue rows={rows} />;
}
