"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { CardSection } from "@/components/card-page/card-page";
import { apiJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import { formatQuantity } from "@/lib/format";
import type { ItemLocationBalance } from "@/lib/inventory/types";
import {
  TransferStockDialog,
  useActiveLocations,
} from "./transfer-stock-dialog";

export function StockByLocationSection({
  itemId,
  unitLabel,
}: {
  itemId: string | null;
  unitLabel?: string | null;
}) {
  const locationsQuery = useActiveLocations();
  const multiLocation = (locationsQuery.data?.length ?? 0) > 1;

  const balancesQuery = useQuery({
    queryKey: queryKeys.itemLocationBalances.byItem(itemId),
    queryFn: () =>
      apiJson<ItemLocationBalance[]>(`/api/items/${itemId}/location-balances`),
    enabled: itemId != null && multiLocation,
  });

  if (itemId == null || !multiLocation) {
    return null;
  }

  return (
    <CardSection
      title="Stock by location"
      aria-label="Stock by location"
      actions={<TransferStockDialog prefillItemId={itemId} size="sm" />}
    >
      <div className="flex flex-col">
        {(balancesQuery.data ?? []).map((balance) => (
          <div
            key={balance.locationId}
            className="flex items-center justify-between border-b border-[var(--color-line)] py-(--space-2) text-[length:var(--text-sm)] last:border-b-0"
          >
            <span className="flex items-center gap-(--space-2)">
              {balance.locationName}
              {balance.isDefault ? <Badge variant="outline">Default</Badge> : null}
            </span>
            <span className="tabular-nums">
              {formatQuantity(balance.onHandQty)}
              {unitLabel ? (
                <span className="text-[var(--color-ink-faint)]"> {unitLabel}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </CardSection>
  );
}
