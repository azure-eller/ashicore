import type { SalesOrderDetail } from "./types";

export function buildSalesOrderLineRemovalPayload(
  order: SalesOrderDetail,
  lineId: string
) {
  return {
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    status: order.status === "confirmed" ? "confirmed" : "draft",
    orderDate: order.orderDate,
    shipDate: order.shipDate,
    requestedDate: order.requestedDate,
    notes: order.notes,
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
    lines: order.lines
      .filter((line) => line.id !== lineId)
      .map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    confirmOversell: true,
  };
}
