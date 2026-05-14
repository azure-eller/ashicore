"use client";

import { useMemo } from "react";
import { type FilterFn } from "@tanstack/react-table";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { getColumns } from "./columns";
import type {
  InventoryProductView,
  ItemRow,
  ItemType,
} from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

const productSearchFilter: FilterFn<ItemRow> = (row, columnId, filterValue) => {
  const search = String(filterValue).toLowerCase();
  const displayName = row.original.displayName?.toLowerCase() ?? "";
  const name = row.original.name?.toLowerCase() ?? "";
  const sku = row.original.sku?.toLowerCase() ?? "";
  const category = row.original.category?.toLowerCase() ?? "";

  return (
    displayName.includes(search) ||
    name.includes(search) ||
    sku.includes(search) ||
    category.includes(search)
  );
};

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
    <DashboardDataTable
      columns={columns}
      data={initialData}
      initialData={initialData}
      queryKey={queryKey}
      searchAriaLabel="Search items"
      addHref={`/inventory/${ITEM_TYPE_SEGMENTS[itemType]}/new`}
      addAriaLabel={itemType === "product" ? "New Product" : "New Material"}
      emptyMessage={isProduct ? "No items yet." : "No materials yet."}
      globalFilterFn={isProduct ? productSearchFilter : undefined}
      deleteAction={{
        endpoint: "/api/items",
        invalidateQueryKeys:
          itemType === "product" ? [["items", itemType]] : [["items", itemType]],
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
