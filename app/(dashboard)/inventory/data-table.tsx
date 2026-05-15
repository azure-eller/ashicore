"use client";

import { useMemo } from "react";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import { getColumns } from "./columns";
import type { InventoryProductView, ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

interface DataTableProps {
  initialData: ItemRow[];
  itemType: ItemType;
  view?: InventoryProductView;
}

export function DataTable({ initialData, itemType, view }: DataTableProps) {
  const columns = useMemo(() => getColumns(itemType, view), [itemType, view]);
  const isProduct = itemType === "product";
  const queryKey = isProduct
    ? ["items", itemType, view ?? "products"]
    : ["items", itemType];

  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
      queryKey={queryKey}
      queryFn={async () => {
        const params = new URLSearchParams({ itemType });
        if (isProduct && view) {
          params.set("view", view);
        }
        const response = await fetch(`/api/items?${params}`);
        if (!response.ok) {
          throw new Error("Failed to fetch items.");
        }

        return response.json();
      }}
      searchAriaLabel="Search items"
      addHref={`/inventory/${ITEM_TYPE_SEGMENTS[itemType]}/new`}
      addAriaLabel={itemType === "product" ? "New Product" : "New Material"}
      emptyMessage={isProduct ? "No items yet." : "No materials yet."}
      deleteAction={{
        endpoint: "/api/items",
        invalidateQueryKeys: [["items", itemType]],
        defaultErrorMessage: "Failed to delete items.",
        confirmTitle: (count) =>
          `Delete ${count} item${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected item${count !== 1 ? "s" : ""} will be removed from your inventory.`,
      }}
    />
  );
}
