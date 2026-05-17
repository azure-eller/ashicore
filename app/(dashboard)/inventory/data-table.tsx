"use client";

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import { getColumns } from "./columns";
import type { ItemRow, ItemType } from "./types";
import { ITEM_TYPE_SEGMENTS } from "./types";

interface DataTableProps {
  initialData: ItemRow[];
  itemType: ItemType;
  organizationId: string;
}

export function DataTable({
  initialData,
  itemType,
  organizationId,
}: DataTableProps) {
  const queryClient = useQueryClient();
  const columns = useMemo(() => getColumns(itemType), [itemType]);
  const isProduct = itemType === "product";
  const queryKey = useMemo(
    () => ["items", organizationId, itemType],
    [itemType, organizationId]
  );

  useEffect(() => {
    queryClient.setQueryData(queryKey, initialData);
  }, [initialData, queryClient, queryKey]);

  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
      queryKey={queryKey}
      queryFn={async () => {
        const params = new URLSearchParams({ itemType });
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
        invalidateQueryKeys: [["items"]],
        defaultErrorMessage: "Failed to delete items.",
        confirmTitle: (count) =>
          `Delete ${count} item${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected item${count !== 1 ? "s" : ""} will be removed from your inventory.`,
      }}
    />
  );
}
