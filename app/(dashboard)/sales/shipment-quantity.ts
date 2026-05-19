import { normalizeNumeric, parsePositive, roundQuantity } from "@/lib/format";

type ShipmentLineQuantity = {
  itemId?: string;
  quantity?: string | null;
};

type ShipmentQuantitySource = {
  lines?: ShipmentLineQuantity[] | null;
};

type DetailShipmentLineQuantity = {
  salesOrderLineId: string;
  quantity?: string | null;
};

type DetailShipmentQuantitySource = {
  lines: DetailShipmentLineQuantity[];
};

export function formatShipmentQuantityCapacity(quantity: number) {
  return normalizeNumeric(quantity);
}

export function clampShipmentQuantity(quantity: string, maxQuantity: number) {
  const trimmed = quantity.trim();
  if (!trimmed) return "";

  const parsedQuantity = Number(trimmed);
  if (!Number.isFinite(parsedQuantity)) return trimmed;
  if (parsedQuantity <= maxQuantity) return trimmed;
  if (maxQuantity <= 0) return "";
  return formatShipmentQuantityCapacity(maxQuantity);
}

export function sumShipmentLineQuantities(
  shipments: ShipmentQuantitySource[] | undefined,
  itemId: string,
  options?: { excludeIndex?: number }
) {
  return (shipments ?? []).reduce((sum, shipment, index) => {
    if (options?.excludeIndex === index) return sum;
    const quantity = shipment.lines?.find((line) => line.itemId === itemId)?.quantity;
    return sum + (parsePositive(quantity) ?? 0);
  }, 0);
}

export function getOrderFormShipmentLineCapacity(params: {
  shipments: ShipmentQuantitySource[] | undefined;
  shipmentIndex?: number;
  itemId: string;
  orderedQuantity: string | null | undefined;
}) {
  const orderedQuantity = parsePositive(params.orderedQuantity);
  if (orderedQuantity == null) return 0;

  const plannedElsewhere = sumShipmentLineQuantities(
    params.shipments,
    params.itemId,
    params.shipmentIndex == null ? undefined : { excludeIndex: params.shipmentIndex }
  );

  return Math.max(0, roundQuantity(orderedQuantity - plannedElsewhere));
}

export function getOrderDetailShipmentLineCapacity(params: {
  lineId: string;
  unplannedRemainingQuantity: string | null | undefined;
  shipment?: DetailShipmentQuantitySource;
}) {
  const unplannedQuantity = parsePositive(params.unplannedRemainingQuantity) ?? 0;
  const existingShipmentQuantity =
    parsePositive(
      params.shipment?.lines.find(
        (shipmentLine) => shipmentLine.salesOrderLineId === params.lineId
      )?.quantity
    ) ?? 0;

  return Math.max(0, roundQuantity(unplannedQuantity + existingShipmentQuantity));
}
