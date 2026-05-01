import { Suspense } from "react";
import { DataTable } from "../data-table";
import DataTableLoading from "../data-table-loading";
import { getItems } from "../queries";

export default function MaterialsPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <MaterialsData />
    </Suspense>
  );
}

async function MaterialsData() {
  const items = await getItems({ itemType: "material" });
  return <DataTable initialData={items} itemType="material" />;
}
