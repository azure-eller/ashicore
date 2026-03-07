import { DataTable } from "../data-table";
import { getItems } from "../queries";

export default async function ProductsPage() {
  const items = await getItems({ itemType: "product" });
  return <DataTable initialData={items} itemType="product" />;
}
