import type { SalesOrderListRow } from "../types";
import {
  readSalesOrderNumber,
  type SalesOrderLaneId,
} from "./sales-order-lane-model";

export type SalesOrderDropCommand =
  | { type: "noop" }
  | {
      type: "blocked";
      title: string;
      description: string;
      suggestedAction?: string;
    }
  | {
      type: "confirm-order";
      orderId: string;
      targetLane: SalesOrderLaneId;
    }
  | { type: "open-create-mos"; orderId: string }
  | { type: "prepare-for-shipping"; orderId: string }
  | { type: "open-ship-dialog"; orderId: string }
  | { type: "confirm-cancel"; orderId: string };

export function getSalesOrderDropCommand({
  order,
  fromLane,
  toLane,
}: {
  order: SalesOrderListRow;
  fromLane: SalesOrderLaneId;
  toLane: SalesOrderLaneId;
}): SalesOrderDropCommand {
  if (fromLane === toLane) return { type: "noop" };

  if (fromLane === "shipped") {
    return {
      type: "blocked",
      title: "Shipped orders cannot be moved",
      description:
        "Shipping reversals and voids must use an explicit shipment workflow.",
    };
  }

  if (fromLane === "cancelled") {
    return {
      type: "blocked",
      title: "Cancelled orders cannot be moved",
      description: "Restore is not available from this board.",
    };
  }

  if (fromLane === "draft") {
    if (toLane === "shipped") {
      return {
        type: "blocked",
        title: "Confirm before shipping",
        description:
          "Draft orders must be confirmed and prepared before they can be shipped.",
      };
    }

    if (toLane === "cancelled") {
      return {
        type: "blocked",
        title: "Cancel from order detail",
        description: "Draft cancellation is not available from board drag and drop.",
      };
    }

    return { type: "confirm-order", orderId: order.id, targetLane: toLane };
  }

  if (toLane === "cancelled") {
    return {
      type: "blocked",
      title: "Cancel from order detail",
      description:
        "Cancelling live orders must use the explicit order or shipment workflow.",
    };
  }

  if (toLane === "draft") {
    return {
      type: "blocked",
      title: "Cannot move back to draft",
      description: "Live sales orders cannot be returned to draft from the board.",
    };
  }

  if (toLane === "in_production") {
    const shortQty = readSalesOrderNumber(order.fulfillmentSummary.shortQty);
    if (fromLane === "supply_needed" && order.hasManufacturableLines && shortQty > 0) {
      return { type: "open-create-mos", orderId: order.id };
    }

    return {
      type: "blocked",
      title: "No manufacturable shortage",
      description:
        "This order does not have a manufacturable shortage. Allocate stock or handle supply manually.",
      suggestedAction: "Open allocation manager",
    };
  }

  if (toLane === "ready_to_ship") {
    return { type: "prepare-for-shipping", orderId: order.id };
  }

  if (toLane === "shipped") {
    if (fromLane === "ready_to_ship") {
      return { type: "open-ship-dialog", orderId: order.id };
    }

    return {
      type: "blocked",
      title: "Order is not ready",
      description: "This order must be ready before it can be shipped.",
      suggestedAction: "Move to Ready to Ship first",
    };
  }

  return {
    type: "blocked",
    title: "Move is not supported",
    description: "This lane change does not map to an available sales workflow.",
  };
}
