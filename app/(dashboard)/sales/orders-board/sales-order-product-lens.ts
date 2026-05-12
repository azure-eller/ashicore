import type { SalesOrderListRow } from "../types";
import { deriveSalesOrderLane, readSalesOrderNumber, toQuantityString } from "./sales-order-lane-model";

export type ProductLensOption = {
  itemId: string;
  label: string;
  unitName: string;
};

export type ProductLensAggregate = {
  itemId: string;
  label: string;
  unitName: string;
  allocatedQty: string;
  remainingQty: string;
  shortQty: string;
  statusLabel: string;
};

export function getProductLensOptions(orders: SalesOrderListRow[]) {
  const options = new Map<string, ProductLensOption>();

  orders.forEach((order) => {
    order.lines.forEach((line) => {
      if (!line.itemId || options.has(line.itemId)) return;
      options.set(line.itemId, {
        itemId: line.itemId,
        label: getLineLabel(line.masterName, line.attrs),
        unitName: line.unitName,
      });
    });
  });

  return [...options.values()].toSorted((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true })
  );
}

export function orderContainsProductLensItem(
  order: SalesOrderListRow,
  itemId: string | null
) {
  if (!itemId) return true;
  return order.lines.some((line) => line.itemId === itemId);
}

export function getProductLensAggregate(
  order: SalesOrderListRow,
  itemId: string
): ProductLensAggregate | null {
  const matchingLines = order.lines.filter((line) => line.itemId === itemId);
  if (matchingLines.length === 0) return null;

  const allocatedQty = matchingLines.reduce(
    (sum, line) => sum + readSalesOrderNumber(line.allocatedQty),
    0
  );
  const remainingQty = matchingLines.reduce(
    (sum, line) =>
      sum + readSalesOrderNumber(line.remainingQty ?? line.quantity),
    0
  );
  const shortQty = matchingLines.reduce(
    (sum, line) => sum + readSalesOrderNumber(line.shortQty),
    0
  );
  const hasProductionWait = matchingLines.some(
    (line) => line.allocationStatus === "waiting_production"
  );
  const firstLine = matchingLines[0];

  return {
    itemId,
    label: getLineLabel(firstLine.masterName, firstLine.attrs),
    unitName: firstLine.unitName,
    allocatedQty: toQuantityString(allocatedQty),
    remainingQty: toQuantityString(remainingQty),
    shortQty: toQuantityString(shortQty),
    statusLabel: getProductLensStatusLabel({
      order,
      allocatedQty,
      remainingQty,
      shortQty,
      hasProductionWait,
    }),
  };
}

function getLineLabel(masterName: string, attrs: string[]) {
  return [masterName, ...attrs].filter(Boolean).join(" · ");
}

function getProductLensStatusLabel({
  order,
  allocatedQty,
  remainingQty,
  shortQty,
  hasProductionWait,
}: {
  order: SalesOrderListRow;
  allocatedQty: number;
  remainingQty: number;
  shortQty: number;
  hasProductionWait: boolean;
}) {
  if (deriveSalesOrderLane(order) === "shipped") return "shipped";
  if (hasProductionWait) return "waiting production";
  if (shortQty <= 0 && allocatedQty >= remainingQty) return "ready";
  if (allocatedQty > 0 && shortQty > 0) {
    return `partial · short ${toQuantityString(shortQty)}`;
  }
  if (shortQty > 0) return `short ${toQuantityString(shortQty)}`;
  return "ready";
}
