"use client";

import { DashboardDataTable } from "@/components/dashboard-data-table";
import { columns } from "./columns";
import type { ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

interface DataTableProps {
  initialData: ItemRow[];
  itemType: ItemType;
}

export function DataTable({ initialData, itemType }: DataTableProps) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["items", itemType]}
      queryFn={async () => {
        const response = await fetch(`/api/items?itemType=${itemType}`);
        if (!response.ok) {
          throw new Error("Failed to fetch items");
        }

        return response.json();
      }}
      searchAriaLabel="Search items"
      addHref={`/inventory/${ITEM_TYPE_SEGMENTS[itemType]}/new`}
      addAriaLabel="Add item"
      emptyMessage="No items yet."
      deleteAction={{
        endpoint: "/api/items",
        invalidateQueryKeys: [["items", itemType]],
        defaultErrorMessage: "Failed to delete items.",
        confirmTitle: (count) =>
          `Delete ${count} item${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected item${count !== 1 ? "s" : ""} will be removed from your inventory.`,
        trackDeletingRows: true,
      }}
    />
  );
}
