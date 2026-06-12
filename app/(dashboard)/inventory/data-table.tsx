"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EntityCombobox } from "@/components/entity-combobox";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import { useActiveLocations } from "@/components/location-select";
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
  // Which location's quantities the list shows; null = the org default
  // (the server-rendered initial data).
  const [locationId, setLocationId] = useState<string | null>(null);
  const locations = useActiveLocations().data ?? [];
  const defaultLocation = locations.find((location) => location.isDefault);
  const queryKey = useMemo(
    () => [
      ...queryKeys.items.list(organizationId, itemType),
      locationId ?? "default",
    ],
    [itemType, locationId, organizationId]
  );

  useEffect(() => {
    if (locationId) return;
    queryClient.setQueryData(queryKey, initialData);
  }, [initialData, locationId, queryClient, queryKey]);

  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
      queryKey={queryKey}
      queryEndpoint={appendSearchParams("/api/items", {
        itemType,
        ...(locationId ? { locationId } : {}),
      })}
      queryErrorMessage="Failed to fetch items."
      searchAriaLabel="Search items"
      actions={<TransferStockDialog />}
      toolbarContent={
        locations.length > 1 ? (
          <div className="w-56">
            <EntityCombobox
              options={locations}
              value={locationId ?? defaultLocation?.id ?? null}
              onValueChange={(next) =>
                setLocationId(next === defaultLocation?.id ? null : next)
              }
              placeholder="Search locations..."
              emptyMessage="No locations found"
              renderSecondary={(location) => (
                <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-faint)]">
                  {location.isDefault ? "Default" : location.code}
                </span>
              )}
            />
          </div>
        ) : undefined
      }
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
