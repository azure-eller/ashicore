import { Suspense } from "react";
import { DataTable } from "../data-table";
import DataTableLoading from "../data-table-loading";
import { getItems } from "../queries";

export default function ProductsPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <ProductsData />
    </Suspense>
  );
}

async function ProductsData() {
  const items = await getItems({ itemType: "product", view: "products" });
  return <DataTable initialData={items} itemType="product" view="products" />;
}
