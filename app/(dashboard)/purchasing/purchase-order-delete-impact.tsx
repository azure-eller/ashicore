"use client";

import { useQuery } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type { PurchaseOrderDeleteImpact } from "@/lib/purchasing/types";

const quantityFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
});

function formatImpactItem(item: PurchaseOrderDeleteImpact["items"][number], quantity: number) {
  return `${quantityFormat.format(quantity)} ${item.stockingUnitName} ${item.itemName}`;
}

export function PurchaseOrderDeleteImpactSummary({
  orderId,
  orderNumber,
}: {
  orderId: string | null;
  orderNumber: string | null;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.purchaseOrders.deletePreview(orderId ?? "__draft__"),
    queryFn: () =>
      apiJson<PurchaseOrderDeleteImpact>(
        `/api/purchase-orders/${orderId}/delete-preview`,
        { fallbackError: "Failed to check stock received on this order." },
      ),
    enabled: orderId != null,
    staleTime: 0,
  });

  const label = orderNumber ?? "This order";
  if (orderId == null || isError) {
    return (
      <>
        {label} will be deleted. Any stock received on it that is still on hand
        will be removed. This cannot be undone.
      </>
    );
  }
  if (isPending || !data) {
    return <>Checking stock received on {label}…</>;
  }

  const removals = data.items.filter((item) => item.removeQty > 0);
  const kept = data.items.filter((item) => item.keptQty > 0);

  return (
    <>
      {removals.length === 0 ? (
        <>{data.orderNumber} will be deleted.</>
      ) : (
        <>
          {data.orderNumber} will be deleted, and stock received on it that is
          still on hand will be removed:
          {removals.map((item) => (
            <span key={item.itemId} className="mt-(--space-2) block">
              {formatImpactItem(item, item.removeQty)}
            </span>
          ))}
        </>
      )}
      {kept.length > 0 ? (
        <span className="mt-(--space-2) block">
          Already used and kept in history:{" "}
          {kept.map((item) => formatImpactItem(item, item.keptQty)).join(", ")}.
        </span>
      ) : null}
      {data.billSynced ? (
        <span className="mt-(--space-2) block">
          A bill for this order was sent to your accounting provider and will
          not be removed there. Delete it in the provider if needed.
        </span>
      ) : null}
      <span className="mt-(--space-2) block">This cannot be undone.</span>
    </>
  );
}
