"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { SalesOrderListRow } from "./types";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";
import { useConfirmSalesOrderFlow } from "./orders-board/use-confirm-sales-order-flow";

type Props = {
  order: Pick<
    SalesOrderListRow,
    | "id"
    | "status"
    | "hasManufacturableLines"
    | "fulfillmentSummary"
    | "shippingReadiness"
  >;
};

export function SoStageAction({ order }: Props) {
  const confirmFlow = useConfirmSalesOrderFlow(order.id);
  const errorMessage = confirmFlow.errorMessage;

  if (order.status === "draft") {
    return (
      <>
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={confirmFlow.isPending}
              onClick={(event) => {
                event.stopPropagation();
                confirmFlow.confirm();
              }}
            >
              {confirmFlow.isPending ? "Confirming..." : "Confirm"}
            </Button>
            {errorMessage ? (
              <Link
                href={`/sales/orders/${order.id}`}
                className="max-w-xs text-xs text-destructive hover:underline"
              >
                {errorMessage}
              </Link>
            ) : null}
          </div>
        </div>
        {confirmFlow.dialogs}
      </>
    );
  }

  if (order.status === "confirmed" || order.status === "partially_shipped") {
    if (
      !order.hasManufacturableLines ||
      Number(order.fulfillmentSummary.shortQty) <= 0
    ) {
      return null;
    }

    return (
      <>
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center justify-end gap-2">
              <CreateManufacturingOrdersDialog
                salesOrderId={order.id}
                buttonVariant="secondary"
              />
            </div>
            {errorMessage ? (
              <Link
                href={`/sales/orders/${order.id}`}
                className="max-w-xs text-xs text-destructive hover:underline"
              >
                {errorMessage}
              </Link>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return null;
}
