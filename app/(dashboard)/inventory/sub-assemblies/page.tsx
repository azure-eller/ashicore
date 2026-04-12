import { Suspense } from "react";
import { DataTable } from "../data-table";
import DataTableSkeleton from "../data-table-skeleton";
import { getItems } from "../queries";

export default function SubAssembliesPage() {
  return (
    <Suspense fallback={<DataTableSkeleton />}>
      <SubAssembliesData />
    </Suspense>
  );
}

async function SubAssembliesData() {
  const items = await getItems({ itemType: "product", view: "sub-assemblies" });
  return <DataTable initialData={items} itemType="product" view="sub-assemblies" />;
}
