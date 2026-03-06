// app/(dashboard)/inventory/page.tsx
import { DataTable } from "./data-table";
import { getItems } from "./queries";

export default async function InventoryPage() {
  const initialData = await getItems();

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-2xl font-bold mb-6">Inventory</h1>
      <DataTable initialData={initialData} />
    </div>
  );
}
