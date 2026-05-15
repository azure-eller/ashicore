"use client";

import type { SalesOrderListRow } from "./types";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";

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
  if (order.status === "open") {
    if (
      !order.hasManufacturableLines ||
      Number(order.fulfillmentSummary.shortQty) <= 0
    ) {
      return null;
    }

    return (
      <div className="flex justify-end">
        <CreateManufacturingOrdersDialog
          salesOrderId={order.id}
          buttonVariant="secondary"
        />
      </div>
    );
  }

  return null;
}
