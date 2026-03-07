import { DataTable } from "../data-table";
import { getItems } from "../queries";

export default async function MaterialsPage() {
  const items = await getItems({ itemType: "material" });
  return <DataTable initialData={items} itemType="material" />;
}
