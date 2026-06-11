"use client";

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import { appendSearchParams } from "@/lib/routing/search-params";
import { getColumns } from "./columns";
import { TransferStockDialog } from "./transfer-stock-dialog";
import type { ItemRow, ItemType } from "@/lib/inventory/types";
import { queryKeys } from "@/lib/client/query-keys";

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
    () => queryKeys.items.list(organizationId, itemType),
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
      queryEndpoint={appendSearchParams("/api/items", { itemType })}
      queryErrorMessage="Failed to fetch items."
      searchAriaLabel="Search items"
      actions={<TransferStockDialog />}
      addHref={itemType === "product" ? "/inventory/product" : "/inventory/material"}
      addAriaLabel={itemType === "product" ? "New Product" : "New Material"}
      emptyMessage={isProduct ? "No items yet." : "No materials yet."}
      deleteAction={{
        endpoint: "/api/items",
        invalidateQueryKeys: [queryKeys.items.root],
        defaultErrorMessage: "Failed to delete items.",
        confirmTitle: (count) =>
          `Delete ${count} item${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected item${count !== 1 ? "s" : ""} will be removed from your inventory.`,
      }}
    />
  );
}
