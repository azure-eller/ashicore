import Decimal, { type Numeric } from "decimal.js-light";
import type { SalesLineQuantities } from "./types";

const QUANTITY_SCALE = 4;
const NUMERIC_12_4_MAX = new Decimal("99999999.9999");

function decimal(value: Numeric) {
  return new Decimal(value);
}

function normalizeQuantity(value: Numeric) {
  const normalized = decimal(value)
    .toDecimalPlaces(QUANTITY_SCALE, Decimal.ROUND_HALF_UP)
    .toFixed(QUANTITY_SCALE)
    .replace(/\.?0+$/, "");
  return normalized === "-0" ? "0" : normalized;
}

export function sellingToStockQuantity(
  sellingQuantity: string | number,
  salesToStockFactor: string | number,
) {
  const factor = decimal(salesToStockFactor);
  if (factor.lte(0)) {
    throw new Error("Sales-to-stock factor must be greater than zero.");
  }
  return normalizeQuantity(
    decimal(sellingQuantity).times(factor),
  );
}

export function isSalesQuantityRepresentable(value: string | number) {
  try {
    return decimal(value).abs().lte(NUMERIC_12_4_MAX);
  } catch {
    return false;
  }
}

export function stockToSellingQuantity(
  stockQuantity: string | number,
  salesToStockFactor: string | number,
) {
  const factor = decimal(salesToStockFactor);
  if (factor.lte(0)) {
    throw new Error("Sales-to-stock factor must be greater than zero.");
  }
  return normalizeQuantity(decimal(stockQuantity).dividedBy(factor));
}

/**
 * Reconciles an edited commercial total with the line's stored stock total.
 *
 * Fulfillment records commercial and stock quantities as an exact pair. Once
 * part of a line is shipped or cancelled, converting the new total from
 * scratch can introduce a rounding remainder (for example, 0.3333 × 3 =
 * 0.9999). Preserve the completed pair and convert only the editable
 * remainder. A no-op edit also preserves the current stock remainder exactly.
 */
export function reconcileSalesOrderQuantityEdit(params: {
  nextSellingQuantity: string | number;
  currentSellingQuantity: string | number;
  currentStockQuantity: string | number;
  completedSellingQuantity: string | number;
  completedStockQuantity: string | number;
  salesToStockFactor: string | number;
}) {
  const completedSelling = decimal(params.completedSellingQuantity);
  const completedStock = decimal(params.completedStockQuantity);
  const nextSellingRemaining = decimal(params.nextSellingQuantity).minus(
    completedSelling,
  );
  const currentSellingRemaining = decimal(params.currentSellingQuantity).minus(
    completedSelling,
  );
  const currentStockRemaining = decimal(params.currentStockQuantity).minus(
    completedStock,
  );
  const nextStockRemaining = nextSellingRemaining.eq(currentSellingRemaining)
    ? currentStockRemaining
    : decimal(
        sellingToStockQuantity(
          nextSellingRemaining.toString(),
          params.salesToStockFactor,
        ),
      );

  return {
    sellingRemainingQuantity: normalizeQuantity(nextSellingRemaining),
    stockRemainingQuantity: normalizeQuantity(nextStockRemaining),
    stockOrderedQuantity: normalizeQuantity(
      completedStock.plus(nextStockRemaining),
    ),
  };
}

export function sellingUnitPriceToStockUnitPrice(
  sellingUnitPrice: string | number,
  salesToStockFactor: string | number,
) {
  const factor = decimal(salesToStockFactor);
  if (factor.lte(0)) {
    throw new Error("Sales-to-stock factor must be greater than zero.");
  }
  const normalized = decimal(sellingUnitPrice)
    .dividedBy(factor)
    .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
    .toFixed(6)
    .replace(/\.?0+$/, "");
  return normalized === "-0" ? "0" : normalized;
}

export function stockUnitPriceToSellingUnitPrice(
  stockUnitPrice: string | number,
  salesToStockFactor: string | number,
) {
  const factor = decimal(salesToStockFactor);
  if (factor.lte(0)) {
    throw new Error("Sales-to-stock factor must be greater than zero.");
  }
  const normalized = decimal(stockUnitPrice)
    .times(factor)
    .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
    .toFixed(6)
    .replace(/\.?0+$/, "");
  return normalized === "-0" ? "0" : normalized;
}

export function convertedShipmentQuantities(params: {
  requestedBasis: "selling" | "stocking";
  requestedQuantity: string;
  salesToStockFactor: string;
  sellingRemainingQuantity: string;
  stockRemainingQuantity: string;
}) {
  const requested = decimal(params.requestedQuantity);
  const sellingRemaining = decimal(params.sellingRemainingQuantity);
  const stockRemaining = decimal(params.stockRemainingQuantity);

  if (params.requestedBasis === "selling") {
    const sellingAfterShipment = sellingRemaining.minus(requested);
    const stockAfterShipment = decimal(
      sellingToStockQuantity(
        sellingAfterShipment.toString(),
        params.salesToStockFactor,
      ),
    );
    return {
      sellingQuantity: normalizeQuantity(requested),
      stockQuantity: normalizeQuantity(stockRemaining.minus(stockAfterShipment)),
    };
  }

  const stockAfterShipment = stockRemaining.minus(requested);
  const sellingAfterShipment = decimal(
    stockToSellingQuantity(
      stockAfterShipment.toString(),
      params.salesToStockFactor,
    ),
  );
  return {
    sellingQuantity: normalizeQuantity(
      sellingRemaining.minus(sellingAfterShipment),
    ),
    stockQuantity: normalizeQuantity(requested),
  };
}

export function buildSalesLineQuantities(params: {
  sellingUnitName: string;
  stockingUnitName: string;
  salesToStockFactor: string;
  sellingOrderedQuantity: string;
  sellingShippedQuantity: string;
  sellingCancelledQuantity: string;
  stockOrderedQuantity: string;
  stockShippedQuantity: string;
  stockCancelledQuantity: string;
  stockPlannedQuantity?: string | number;
}): SalesLineQuantities {
  const stockPlannedQuantity = normalizeQuantity(
    params.stockPlannedQuantity ?? 0
  );
  const stockRemainingQuantity = normalizeQuantity(
    decimal(params.stockOrderedQuantity)
      .minus(params.stockShippedQuantity)
      .minus(params.stockCancelledQuantity)
  );
  const sellingRemainingQuantity = normalizeQuantity(
    decimal(params.sellingOrderedQuantity)
      .minus(params.sellingShippedQuantity)
      .minus(params.sellingCancelledQuantity)
  );
  const sellingPlannedQuantity = stockToSellingQuantity(
    stockPlannedQuantity,
    params.salesToStockFactor
  );

  return {
    contractVersion: 2,
    selling: {
      unitName: params.sellingUnitName,
      salesToStockFactor: normalizeQuantity(params.salesToStockFactor),
      orderedQuantity: normalizeQuantity(params.sellingOrderedQuantity),
      shippedQuantity: normalizeQuantity(params.sellingShippedQuantity),
      cancelledQuantity: normalizeQuantity(params.sellingCancelledQuantity),
      remainingQuantity: sellingRemainingQuantity,
      plannedQuantity: sellingPlannedQuantity,
      unplannedRemainingQuantity: normalizeQuantity(
        decimal(sellingRemainingQuantity).minus(sellingPlannedQuantity)
      ),
    },
    stocking: {
      unitName: params.stockingUnitName,
      orderedQuantity: normalizeQuantity(params.stockOrderedQuantity),
      shippedQuantity: normalizeQuantity(params.stockShippedQuantity),
      cancelledQuantity: normalizeQuantity(params.stockCancelledQuantity),
      remainingQuantity: stockRemainingQuantity,
      plannedQuantity: stockPlannedQuantity,
      unplannedRemainingQuantity: normalizeQuantity(
        decimal(stockRemainingQuantity).minus(stockPlannedQuantity)
      ),
    },
  };
}
