"use client";

import { useMemo } from "react";
import { type FilterFn } from "@tanstack/react-table";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { getColumns } from "./columns";
import type { InventoryProductView, ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

const productSearchFilter: FilterFn<ItemRow> = (row, columnId, filterValue) => {
  const search = String(filterValue).toLowerCase();
  // Check top-level row fields
  const displayName = row.original.displayName?.toLowerCase() ?? "";
  const name = row.original.name?.toLowerCase() ?? "";
  const sku = row.original.sku?.toLowerCase() ?? "";
  const category = row.original.category?.toLowerCase() ?? "";
  if (
    displayName.includes(search) ||
    name.includes(search) ||
    sku.includes(search) ||
    category.includes(search)
  ) {
    return true;
  }
  // For masters, also check variant names/SKUs/attrs in subRows
  const subRows = row.original.subRows;
  if (subRows) {
    return subRows.some(
      (v) =>
        v.name.toLowerCase().includes(search) ||
        (v.sku?.toLowerCase().includes(search) ?? false) ||
        (v.variantAttrs && Object.values(v.variantAttrs).some(
          (attr) => attr.toLowerCase().includes(search)
        ))
    );
  }
  return false;
};

interface DataTableProps {
  initialData: ItemRow[];
  itemType: ItemType;
  view?: InventoryProductView;
}

export function DataTable({ initialData, itemType, view }: DataTableProps) {
  const columns = useMemo(() => getColumns(itemType, view), [itemType, view]);
  const isProduct = itemType === "product";
  const isSubAssemblies = view === "sub-assemblies";
  const queryKey = isProduct
    ? ["items", itemType, view ?? "products"]
    : ["items", itemType];

  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={queryKey}
      queryFn={async () => {
        const params = new URLSearchParams({ itemType });
        if (view) {
          params.set("view", view);
        }

        const response = await fetch(`/api/items?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Failed to fetch items");
        }

        return response.json();
      }}
      searchAriaLabel="Search items"
      addHref={`/inventory/${ITEM_TYPE_SEGMENTS[itemType]}/new`}
      addAriaLabel={itemType === "product" ? "New Product" : "New Material"}
      emptyMessage="No items yet."
      getRowCanExpand={isProduct && !isSubAssemblies
        ? (row) => row.original.isMaster && (row.original.subRows?.length ?? 0) > 0
        : undefined}
      getSubRows={isProduct && !isSubAssemblies
        ? (row) => row.subRows
        : undefined}
      subRowClassName="bg-muted/30"
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
