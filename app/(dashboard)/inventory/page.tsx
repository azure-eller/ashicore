// app/(dashboard)/inventory/page.tsx
import { Button } from "@/components/ui/button";
import { DataTable } from "./data-table";
import { getItems } from "./queries";

export default async function InventoryPage() {
  const initialData = await getItems();

  return (
    <div className="container mx-auto py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <Button>Add Item</Button>
      </div>
      <DataTable initialData={initialData} />
    </div>
  );
}
