import { Suspense } from "react";
import { DataTable } from "../data-table";
import DataTableSkeleton from "../data-table-skeleton";
import { getItems } from "../queries";

export default function MaterialsPage() {
  return (
    <Suspense fallback={<DataTableSkeleton />}>
      <MaterialsData />
    </Suspense>
  );
}

async function MaterialsData() {
  const items = await getItems({ itemType: "material" });
  return <DataTable initialData={items} itemType="material" />;
}
