"use client";

import { useMemo } from "react";
import { type FilterFn } from "@tanstack/react-table";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { getColumns } from "./columns";
import type { ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

const productSearchFilter: FilterFn<ItemRow> = (row, columnId, filterValue) => {
  const search = String(filterValue).toLowerCase();
  // Check top-level row fields
  const name = row.original.name?.toLowerCase() ?? "";
  const sku = row.original.sku?.toLowerCase() ?? "";
  const category = row.original.category?.toLowerCase() ?? "";
  if (name.includes(search) || sku.includes(search) || category.includes(search)) {
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
}

export function DataTable({ initialData, itemType }: DataTableProps) {
  const columns = useMemo(() => getColumns(itemType), [itemType]);
  const isProduct = itemType === "product";

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
      addAriaLabel={itemType === "product" ? "New Product" : "New Material"}
      emptyMessage="No items yet."
      getRowCanExpand={isProduct
        ? (row) => row.original.isMaster && (row.original.subRows?.length ?? 0) > 0
        : undefined}
      getSubRows={isProduct
        ? (row) => row.subRows
        : undefined}
      subRowClassName="bg-muted/30"
      globalFilterFn={isProduct ? productSearchFilter : undefined}
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
