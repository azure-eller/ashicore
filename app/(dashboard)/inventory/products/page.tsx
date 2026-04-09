import { Suspense } from "react";
import { DataTable } from "../data-table";
import DataTableSkeleton from "../data-table-skeleton";
import { getItems } from "../queries";

export default function ProductsPage() {
  return (
    <Suspense fallback={<DataTableSkeleton />}>
      <ProductsData />
    </Suspense>
  );
}

async function ProductsData() {
  const items = await getItems({ itemType: "product" });
  return <DataTable initialData={items} itemType="product" />;
}
