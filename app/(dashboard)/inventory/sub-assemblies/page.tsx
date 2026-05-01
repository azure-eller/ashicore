import { Suspense } from "react";
import { DataTable } from "../data-table";
import DataTableLoading from "../data-table-loading";
import { getItems } from "../queries";

export default function SubAssembliesPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <SubAssembliesData />
    </Suspense>
  );
}

async function SubAssembliesData() {
  const items = await getItems({ itemType: "product", view: "sub-assemblies" });
  return <DataTable initialData={items} itemType="product" view="sub-assemblies" />;
}
