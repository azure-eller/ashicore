import { and, asc, eq, sql } from "drizzle-orm";
import {
  normalizeNumeric,
  normalizeNumericScale,
  roundQuantity,
} from "@/lib/format";
import { calculateAverageUnitConsumptionQuantity } from "@/lib/manufacturing/consumption";
import {
  type InventoryDisposition,
  inventoryEvents,
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  lots,
} from "@/lib/db/schema";
import { getCurrentActiveBomIngredientsInTx } from "@/lib/bom/active-ingredients";
import type { Tx } from "@/lib/db/with-org-context";
import {
  applyItemBalanceDeltasInTx,
  applyLotBalanceDeltasInTx,
} from "@/lib/inventory/kernel/projections";
import { insertInventoryEventsInTx } from "@/lib/inventory/kernel/events";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  InsufficientStockError,
  MissingCostBasisError,
} from "@/lib/inventory/kernel/errors";
import {
  getItemLotTrackingModeInTx,
  LotTrackingError,
} from "@/lib/inventory/lot-tracking";
import {
  normalizeStockUnitCost,
  resolveStockUnitCostFromDefaultPurchasePrice,
} from "@/lib/inventory/cost";
import { generateDateLotNumberInTx } from "@/lib/inventory/lot-numbers";

type PositiveStockEventType =
  | "opening_balance"
  | "purchase_receipt"
  | "manufacturing_output"
  | "manual_adjustment_increase"
  | "stocktake_gain"
  | "manufacturing_variance_gain";

type NegativeStockEventType =
  | "manual_adjustment_decrease"
  | "stocktake_loss"
  | "sales_consumption"
  | "manufacturing_ingredient_consumption"
  | "manufacturing_variance_loss";

type RestockEventType = "unpick_restock" | "manufacturing_variance_gain";

const DEFAULT_DISPOSITION: InventoryDisposition = "available";
// Lot master identity is per org+item; per-location debt lives in lot balances.
const NEGATIVE_STOCK_LOT_NUMBER = "UNBATCHED-NEGATIVE-STOCK";
const UNBATCHED_LOT_NUMBER = "UNBATCHED";
export const INTERNAL_UNTRACKED_LOT_NUMBER = "INTERNAL-UNTRACKED";

export type FifoAllocation = {
  lotId: string;
  lotNumber: string;
  quantity: number;
  unitCost: number;
  receivedAt: Date;
  requirementViolated?: boolean;
};

function decimalPlaces(value: string) {
  const [, fractional = ""] = value.split(".");
  return fractional.length;
}

function decimalDigits(value: string) {
  const normalized = value.trim();
  const sign = normalized.startsWith("-") ? BigInt(-1) : BigInt(1);
  const unsigned = normalized.replace(/^-/, "").replace(".", "");
  const digits = unsigned.replace(/^0+(?=\d)/, "") || "0";
  return {
    sign,
    digits: BigInt(digits),
    scale: decimalPlaces(normalized.replace(/^-/, "")),
  };
}

function pow10(exponent: number) {
  return BigInt(10) ** BigInt(exponent);
}

function stockEventMetadata(
  lotNumber: string,
  metadata: Record<string, unknown> | null | undefined
) {
  if (lotNumber === INTERNAL_UNTRACKED_LOT_NUMBER) {
    const safeMetadata = { ...(metadata ?? {}) };
    delete safeMetadata.lotNumber;
    delete safeMetadata.internalUntrackedLot;
    return {
      ...safeMetadata,
      internalUntrackedLot: true,
    };
  }

  return {
    lotNumber,
    ...(metadata ?? {}),
  };
}

export async function getOrCreateInternalUntrackedLotInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    occurredAt?: Date | null;
  }
) {
  const occurredAt = params.occurredAt ?? new Date();
  const [lot] = await tx
    .insert(lots)
    .values({
      organizationId: params.organizationId,
      itemId: params.itemId,
      lotNumber: INTERNAL_UNTRACKED_LOT_NUMBER,
      quantity: "0",
      receivedAt: occurredAt,
      updatedAt: occurredAt,
    })
    .onConflictDoUpdate({
      target: [lots.organizationId, lots.itemId, lots.lotNumber],
      set: { updatedAt: lots.updatedAt },
    })
    .returning({
      id: lots.id,
      lotNumber: lots.lotNumber,
      receivedAt: lots.receivedAt,
    });

  return lot;
}

function formatScaledDecimal(value: bigint, scale: number) {
  if (value === BigInt(0)) return "0";

  const sign = value < BigInt(0) ? "-" : "";
  const abs = value < BigInt(0) ? -value : value;

  if (scale === 0) {
    return `${sign}${abs.toString()}`;
  }

  const divisor = pow10(scale);
  const whole = abs / divisor;
  const fractional = (abs % divisor).toString().padStart(scale, "0").replace(/0+$/, "");

  return fractional ? `${sign}${whole.toString()}.${fractional}` : `${sign}${whole.toString()}`;
}

function multiplyNumericStrings(left: string, right: string, scale: number) {
  const parsedLeft = decimalDigits(left);
  const parsedRight = decimalDigits(right);
  const sign = parsedLeft.sign * parsedRight.sign;
  const raw = parsedLeft.digits * parsedRight.digits;
  const rawScale = parsedLeft.scale + parsedRight.scale;

  let scaled: bigint;
  if (rawScale > scale) {
    const divisor = pow10(rawScale - scale);
    scaled = raw / divisor;
    const remainder = raw % divisor;
    if (remainder * BigInt(2) >= divisor) {
      scaled += BigInt(1);
    }
  } else {
    scaled = raw * pow10(scale - rawScale);
  }

  return formatScaledDecimal(scaled * sign, scale);
}

function calculateExtendedCost(quantity: string, unitCost: string) {
  return multiplyNumericStrings(quantity, unitCost, 6);
}

export async function getCurrentOnHandQtyInTx(tx: Tx, itemId: string) {
  const [row] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryItemBalances.onHandQty}), 0)`,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, itemId));

  return parseFloat(row?.quantity ?? "0");
}

export async function getCurrentAvailableOnHandQtyInTx(tx: Tx, itemId: string) {
  const [positive] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
	    .where(
	      and(
	        eq(inventoryLotBalances.itemId, itemId),
	        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
	        sql`${inventoryLotBalances.quantity} > 0`
	      )
	    );
  const [debt] = await tx
    .select({
      quantity: sql<string>`COALESCE(ABS(SUM(${inventoryLotBalances.quantity})), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} < 0`
      )
    );

  return Math.max(
    0,
    roundQuantity(parseFloat(positive?.quantity ?? "0") - parseFloat(debt?.quantity ?? "0"))
  );
}

export async function getCurrentAvailableQtyInTx(tx: Tx, itemId: string) {
  const [positive] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
	    .where(
	      and(
	        eq(inventoryLotBalances.itemId, itemId),
	        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
	        sql`${inventoryLotBalances.quantity} > 0`
	      )
	    );
  const [debt] = await tx
    .select({
      quantity: sql<string>`COALESCE(ABS(SUM(${inventoryLotBalances.quantity})), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} < 0`
      )
    );
  const [reserved] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryItemBalances.committedQty}), 0)`,
    })
    .from(inventoryItemBalances)
    .where(eq(inventoryItemBalances.itemId, itemId));

  return Math.max(
    0,
    roundQuantity(
      parseFloat(positive?.quantity ?? "0") -
        parseFloat(debt?.quantity ?? "0") -
        parseFloat(reserved?.quantity ?? "0")
    )
  );
}

export async function getCurrentAvailableQtyAtLocationInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
  }
) {
  const [positive] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
	    .where(
	      and(
	        eq(inventoryLotBalances.organizationId, params.organizationId),
	        eq(inventoryLotBalances.locationId, params.locationId),
	        eq(inventoryLotBalances.itemId, params.itemId),
	        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
	        sql`${inventoryLotBalances.quantity} > 0`
	      )
	    );
  const [debt] = await tx
    .select({
      quantity: sql<string>`COALESCE(ABS(SUM(${inventoryLotBalances.quantity})), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} < 0`
      )
    );
  const [reserved] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryItemBalances.committedQty}), 0)`,
    })
    .from(inventoryItemBalances)
    .where(
      and(
        eq(inventoryItemBalances.organizationId, params.organizationId),
        eq(inventoryItemBalances.locationId, params.locationId),
        eq(inventoryItemBalances.itemId, params.itemId)
      )
    );

  return Math.max(
    0,
    roundQuantity(
      parseFloat(positive?.quantity ?? "0") -
        parseFloat(debt?.quantity ?? "0") -
        parseFloat(reserved?.quantity ?? "0")
    )
  );
}

export async function getCurrentAvailableLotBalanceQtyAtLocationInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
  }
) {
  const [positive] = await tx
    .select({
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );
  const [debt] = await tx
    .select({
      quantity: sql<string>`COALESCE(ABS(SUM(${inventoryLotBalances.quantity})), 0)`,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} < 0`
      )
    );

  return Math.max(
    0,
    roundQuantity(parseFloat(positive?.quantity ?? "0") - parseFloat(debt?.quantity ?? "0"))
  );
}

export async function resolvePositiveStockUnitCostInTx(
  tx: Tx,
  params: {
    itemId: string;
    explicitUnitCost?: string | null;
	    reason:
	      | "opening_cost_required"
	      | "material_default_price"
	      | "product_bom_cost"
	      | "stocktake_cost_policy"
	      | "negative_stock_cost_policy";
  }
): Promise<string> {
  async function deriveCost(currentItemId: string, visited = new Set<string>()): Promise<string> {
    if (visited.has(currentItemId)) {
      throw new MissingCostBasisError(
        currentItemId,
        "product_bom_cost",
        "Cannot resolve cost because the BOM contains a cycle."
      );
    }

    const [item] = await tx
      .select({
        id: items.id,
        name: items.name,
        itemType: items.itemType,
        currentStockUnitCost: items.currentStockUnitCost,
        defaultPurchasePrice: items.defaultPurchasePrice,
        purchaseToStockFactor: items.purchaseToStockFactor,
      })
      .from(items)
      .where(eq(items.id, currentItemId));

    if (!item) {
      throw new MissingCostBasisError(
        currentItemId,
        params.reason,
        "Cannot resolve cost because the item no longer exists."
      );
    }

    if (item.itemType === "material") {
      const currentStockUnitCost =
        item.currentStockUnitCost != null
          ? Number.parseFloat(item.currentStockUnitCost)
          : Number.NaN;

      if (Number.isFinite(currentStockUnitCost)) {
        return normalizeStockUnitCost(currentStockUnitCost);
      }

      const stockUnitCost = resolveStockUnitCostFromDefaultPurchasePrice({
        defaultPurchasePrice: item.defaultPurchasePrice,
        purchaseToStockFactor: item.purchaseToStockFactor,
      });

      if (stockUnitCost != null) {
        return stockUnitCost;
      }

      if (item.defaultPurchasePrice != null) {
        throw new MissingCostBasisError(
          currentItemId,
          "material_default_price",
          `Cannot resolve cost for ${item.name} because its current stock unit cost is blank and its purchase conversion is invalid.`
        );
      }

      throw new MissingCostBasisError(
        currentItemId,
        "material_default_price",
        `Cannot resolve cost for ${item.name} without a current stock unit cost or default purchase price.`
      );
    }

    const bomRows = await getCurrentActiveBomIngredientsInTx(tx, currentItemId);
    if (bomRows.length === 0) {
      throw new MissingCostBasisError(
        currentItemId,
        "product_bom_cost",
        `Cannot resolve cost for ${item.name} without an active BOM.`
      );
    }

    const nextVisited = new Set(visited);
    nextVisited.add(currentItemId);

    let total = 0;
    for (const component of bomRows) {
      const componentUnitCost = parseFloat(
        await deriveCost(component.itemId, nextVisited)
      );
      const averageUnitQuantity = calculateAverageUnitConsumptionQuantity({
        quantity: component.quantityPerUnit ?? "0",
        recipeBasis: component.recipeBasis,
        outputQuantity: component.bomOutputQuantity,
      });
      total += parseFloat(averageUnitQuantity) * componentUnitCost;
    }

    return normalizeNumericScale(total, 6);
  }

  if (params.explicitUnitCost != null) {
    return normalizeNumericScale(parseFloat(params.explicitUnitCost), 6);
  }

  if (params.reason === "opening_cost_required") {
    throw new MissingCostBasisError(
      params.itemId,
      "opening_cost_required",
      "Opening stock requires an explicit unit cost."
    );
  }

  return deriveCost(params.itemId);
}

export async function updateMaterialCurrentStockUnitCostInTx(
  tx: Tx,
  params: {
    itemId: string;
    currentStockUnitCost: string | null;
  }
) {
  const normalizedCurrentStockUnitCost =
    params.currentStockUnitCost == null
      ? null
      : normalizeStockUnitCost(Number.parseFloat(params.currentStockUnitCost));

  const [item] = await tx
    .update(items)
    .set({
      currentStockUnitCost: normalizedCurrentStockUnitCost,
      updatedAt: new Date(),
    })
    .where(and(eq(items.id, params.itemId), eq(items.itemType, "material")))
    .returning({
      id: items.id,
      itemType: items.itemType,
      currentStockUnitCost: items.currentStockUnitCost,
    });

  if (!item || item.itemType !== "material") {
    return null;
  }

  return item.currentStockUnitCost;
}

export async function createPositiveStockEventInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    quantity: number;
    unitCost: string;
    eventType: PositiveStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    lotNumber?: string | null;
    occurredAt?: Date;
    receivedAt?: Date;
    expiresOn?: string | null;
    metadata?: Record<string, unknown> | null;
    disposition?: InventoryDisposition;
  }
) {
  await lockItemsInTx(tx, [params.itemId]);

  const quantity = normalizeNumeric(params.quantity);
  const unitCost = normalizeNumericScale(parseFloat(params.unitCost), 6);
  const extendedCost = calculateExtendedCost(quantity, unitCost);
  const disposition = params.disposition ?? DEFAULT_DISPOSITION;
  const receivedAt = params.receivedAt ?? params.occurredAt ?? new Date();
  const lotTrackingMode = await getItemLotTrackingModeInTx(tx, params.itemId);

  if (lotTrackingMode === "untracked") {
    if (disposition !== DEFAULT_DISPOSITION) {
      throw new LotTrackingError("Untracked items can only use available stock.", 409);
    }

    const internalLot = await getOrCreateInternalUntrackedLotInTx(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      occurredAt: receivedAt,
    });

    return appendPositiveStockToExistingLotInTx(tx, {
      ...params,
      disposition,
      lotId: internalLot.id,
      metadata: {
        internalUntrackedLot: true,
        ...(params.metadata ?? {}),
      },
    });
  }

  const lotNumber =
    params.lotNumber?.trim() ||
    (await generateDateLotNumberInTx(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      receivedAt,
    }));

  const [lot] = await tx
    .insert(lots)
    .values({
      organizationId: params.organizationId,
      itemId: params.itemId,
      lotNumber,
      quantity,
      receivedAt,
      expiresOn: params.expiresOn ?? null,
    })
    .returning({
      id: lots.id,
      lotNumber: lots.lotNumber,
      receivedAt: lots.receivedAt,
      expiresOn: lots.expiresOn,
    });

  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: lot.id,
      quantity,
      unitCost,
      extendedCost,
      disposition,
      toDisposition: disposition,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt: params.occurredAt,
      metadata: stockEventMetadata(lotNumber, params.metadata),
    },
  ]);

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      lotId: lot.id,
      itemId: params.itemId,
      disposition,
      quantityDelta: parseFloat(quantity),
      unitCost,
      receivedAt: lot.receivedAt,
      originEventId: event.id,
    },
  ]);

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: parseFloat(quantity),
    },
  ]);

  return {
    eventId: event.id,
    lotId: lot.id,
    lotNumber: lot.lotNumber,
  };
}

export async function appendPositiveStockToExistingLotInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    lotId: string;
    quantity: number;
    unitCost: string;
    eventType: PositiveStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
    disposition?: InventoryDisposition;
  }
) {
  await lockItemsInTx(tx, [params.itemId]);

  const disposition = params.disposition ?? DEFAULT_DISPOSITION;
  const lotTrackingMode = await getItemLotTrackingModeInTx(tx, params.itemId);
  if (lotTrackingMode === "untracked" && disposition !== DEFAULT_DISPOSITION) {
    throw new LotTrackingError("Untracked items can only use available stock.", 409);
  }
  const effectiveLotId =
    lotTrackingMode === "untracked"
      ? (
          await getOrCreateInternalUntrackedLotInTx(tx, {
            organizationId: params.organizationId,
            itemId: params.itemId,
            occurredAt: params.occurredAt,
          })
        ).id
      : params.lotId;
  const quantity = normalizeNumeric(params.quantity);
  const [lot] = await tx
    .select({
      id: lots.id,
      lotNumber: lots.lotNumber,
      receivedAt: lots.receivedAt,
    })
    .from(lots)
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        eq(lots.id, effectiveLotId)
      )
    )
    .for("update");

  if (!lot) {
    throw new Error(`Lot ${effectiveLotId} was not found.`);
  }

  const unitCost = normalizeNumericScale(parseFloat(params.unitCost), 6);
  const extendedCost = calculateExtendedCost(quantity, unitCost);

  const [currentBalance] = await tx
    .select({
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.lotId, effectiveLotId),
        eq(inventoryLotBalances.disposition, disposition)
      )
    )
    .for("update");

  const currentQuantity = parseFloat(currentBalance?.quantity ?? "0");
  const currentUnitCost = parseFloat(currentBalance?.unitCost ?? unitCost);
  const addedQuantity = parseFloat(quantity);
  const nextQuantity = currentQuantity + addedQuantity;
  const nextUnitCost =
    currentQuantity <= 0
      ? unitCost
      : nextQuantity > 0
      ? normalizeNumericScale(
          (currentQuantity * currentUnitCost + addedQuantity * parseFloat(unitCost)) /
            nextQuantity,
          6
        )
      : unitCost;

  await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} + ${quantity}`,
      updatedAt: new Date(),
    })
    .where(eq(lots.id, effectiveLotId));

  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: effectiveLotId,
      quantity,
      unitCost,
      extendedCost,
      disposition,
      toDisposition: disposition,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt: params.occurredAt,
      metadata: stockEventMetadata(lot.lotNumber, params.metadata),
    },
  ]);

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      lotId: effectiveLotId,
      itemId: params.itemId,
      disposition,
      quantityDelta: addedQuantity,
      unitCost: nextUnitCost,
      receivedAt: lot.receivedAt,
      originEventId: event.id,
    },
  ]);

  await tx
    .update(inventoryLotBalances)
    .set({
      unitCost: nextUnitCost,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.lotId, effectiveLotId),
        eq(inventoryLotBalances.disposition, disposition)
      )
    );

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: addedQuantity,
    },
  ]);

  return {
    eventId: event.id,
    lotId: lot.id,
    lotNumber: lot.lotNumber,
  };
}

async function consumeInternalUntrackedStockInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    quantity: number;
    eventType: NegativeStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
    allowNegativeStock?: boolean;
    unavailableByLotId?: Map<string, number>;
  }
) {
  const occurredAt = params.occurredAt ?? new Date();
  const lot = await getOrCreateInternalUntrackedLotInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
    occurredAt,
  });
  const protectedQty = params.unavailableByLotId?.get(lot.id) ?? 0;
  const [currentBalance] = await tx
    .select({
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.lotId, lot.id),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION)
      )
    )
    .for("update");

  const available = roundQuantity(
    parseFloat(currentBalance?.quantity ?? "0") - protectedQty
  );
  if (available < params.quantity && !params.allowNegativeStock) {
    throw new InsufficientStockError({
      itemId: params.itemId,
      available,
      requested: params.quantity,
    });
  }

  const unitCost = currentBalance?.unitCost
    ? normalizeNumericScale(parseFloat(currentBalance.unitCost), 6)
    : await resolvePositiveStockUnitCostInTx(tx, {
        itemId: params.itemId,
        reason: "negative_stock_cost_policy",
      });
  const quantity = normalizeNumeric(params.quantity);
  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: lot.id,
      quantity,
      unitCost,
      extendedCost: calculateExtendedCost(quantity, unitCost),
      disposition: DEFAULT_DISPOSITION,
      fromDisposition: DEFAULT_DISPOSITION,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt,
      metadata: stockEventMetadata(lot.lotNumber, {
        ...(params.metadata ?? {}),
        ...(available < params.quantity
          ? {
              negativeStock: true,
              requestedQuantity: roundQuantity(params.quantity),
              availableQuantity: roundQuantity(Math.max(0, available)),
              shortageQuantity: roundQuantity(params.quantity - Math.max(0, available)),
            }
          : {}),
      }),
    },
  ]);

  await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} - ${quantity}`,
      updatedAt: occurredAt,
    })
    .where(eq(lots.id, lot.id));

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      lotId: lot.id,
      quantityDelta: -parseFloat(quantity),
      unitCost,
      receivedAt: currentBalance?.receivedAt ?? lot.receivedAt,
      originEventId: event.id,
      disposition: DEFAULT_DISPOSITION,
    },
  ]);

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: -parseFloat(quantity),
    },
  ]);

  return {
    allocations: [
      {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        quantity: parseFloat(quantity),
        unitCost: parseFloat(unitCost),
        receivedAt: currentBalance?.receivedAt ?? lot.receivedAt,
      },
    ],
    eventIds: [event.id],
  };
}

export async function decrementExistingLotStockInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    lotId: string;
    quantity: number;
    unitCost?: string | null;
    eventType: NegativeStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
    disposition?: InventoryDisposition;
  }
) {
  await lockItemsInTx(tx, [params.itemId]);

  const disposition = params.disposition ?? DEFAULT_DISPOSITION;
  const lotTrackingMode = await getItemLotTrackingModeInTx(tx, params.itemId);
  if (lotTrackingMode === "untracked") {
    if (disposition !== DEFAULT_DISPOSITION) {
      throw new LotTrackingError("Untracked items can only use available stock.", 409);
    }
    const consumed = await consumeInternalUntrackedStockInTx(tx, {
      ...params,
      allowNegativeStock: false,
    });
    return {
      eventId: consumed.eventIds[0],
      lotId: consumed.allocations[0]?.lotId ?? params.lotId,
      lotNumber: consumed.allocations[0]?.lotNumber ?? INTERNAL_UNTRACKED_LOT_NUMBER,
    };
  }

  const quantity = normalizeNumeric(params.quantity);
  const [lot] = await tx
    .select({
      id: lots.id,
      lotNumber: lots.lotNumber,
    })
    .from(lots)
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        eq(lots.id, params.lotId)
      )
    )
    .for("update");

  if (!lot) {
    throw new Error(`Lot ${params.lotId} was not found.`);
  }

  const [currentBalance] = await tx
    .select({
      unitCost: inventoryLotBalances.unitCost,
    })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.lotId, params.lotId),
        eq(inventoryLotBalances.disposition, disposition)
      )
    )
    .for("update");

  const unitCost = normalizeNumericScale(
    parseFloat(params.unitCost ?? currentBalance?.unitCost ?? "0"),
    6
  );
  const extendedCost = calculateExtendedCost(quantity, unitCost);

  const [updatedBalance] = await tx
    .update(inventoryLotBalances)
    .set({
      quantity: sql`${inventoryLotBalances.quantity} - ${quantity}`,
      stillActive: sql`(${inventoryLotBalances.quantity} - ${quantity}) > 0`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.lotId, params.lotId),
        eq(inventoryLotBalances.disposition, disposition),
        sql`${inventoryLotBalances.quantity} >= ${quantity}`
      )
    )
    .returning({
      lotId: inventoryLotBalances.lotId,
      quantity: inventoryLotBalances.quantity,
    });

  if (!updatedBalance) {
    throw new InsufficientStockError({
      itemId: params.itemId,
      available: 0,
      requested: params.quantity,
    });
  }

  await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(and(eq(lots.id, params.lotId), sql`${lots.quantity} >= ${quantity}`));

  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: params.lotId,
      quantity,
      unitCost,
      extendedCost,
      disposition,
      fromDisposition: disposition,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt: params.occurredAt,
      metadata: {
        lotNumber: lot.lotNumber,
        ...(params.metadata ?? {}),
      },
    },
  ]);

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: -parseFloat(quantity),
    },
  ]);

  return {
    eventId: event.id,
    lotId: lot.id,
    lotNumber: lot.lotNumber,
  };
}

async function getLockedFifoLotsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    minimumReceivedDate?: string | null;
    allowIneligibleLots?: boolean;
    trackedLotDefault?: "unbatched";
  }
) {
  const eligibilityCondition = params.minimumReceivedDate
    ? sql`${inventoryLotBalances.receivedAt}::date <= ${params.minimumReceivedDate}`
    : undefined;

  return tx
    .select({
      lotId: lots.id,
      lotNumber: lots.lotNumber,
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
      receivedAt: inventoryLotBalances.receivedAt,
      expiresOn: lots.expiresOn,
    })
    .from(inventoryLotBalances)
    .innerJoin(
      lots,
      eq(lots.id, inventoryLotBalances.lotId)
    )
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} > 0`,
        params.trackedLotDefault === "unbatched"
          ? eq(lots.lotNumber, UNBATCHED_LOT_NUMBER)
          : undefined,
        sql`(${lots.expiresOn} IS NULL OR ${lots.expiresOn} >= CURRENT_DATE)`,
        params.minimumReceivedDate && !params.allowIneligibleLots
          ? eligibilityCondition
          : undefined
      )
    )
    .orderBy(
      params.minimumReceivedDate && params.allowIneligibleLots
        ? sql`CASE WHEN ${eligibilityCondition} THEN 0 ELSE 1 END`
        : sql`CASE
            WHEN ${lots.lotNumber} = ${UNBATCHED_LOT_NUMBER} THEN 0
            WHEN ${lots.expiresOn} IS NULL THEN 2
            ELSE 1
          END`,
      asc(lots.expiresOn),
      asc(inventoryLotBalances.receivedAt),
      asc(inventoryLotBalances.lotId)
    )
    .for("update");
}

export async function consumeStockFifoInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    quantity: number;
    eventType: NegativeStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
    minimumReceivedDate?: string | null;
    allowIneligibleLots?: boolean;
    allowNegativeStock?: boolean;
    unavailableByLotId?: Map<string, number>;
    trackedLotDefault?: "unbatched";
  }
) {
  await lockItemsInTx(tx, [params.itemId]);

  const lotTrackingMode = await getItemLotTrackingModeInTx(tx, params.itemId);
  if (lotTrackingMode === "untracked") {
    return consumeInternalUntrackedStockInTx(tx, params);
  }

  const lotsForUpdate = await getLockedFifoLotsInTx(tx, params);
  const totalAvailable = lotsForUpdate.reduce((sum, lot) => {
    const protectedQty = params.unavailableByLotId?.get(lot.lotId) ?? 0;
    return sum + Math.max(0, roundQuantity(parseFloat(lot.quantity) - protectedQty));
  }, 0);
  const protectedQuantity = Array.from(params.unavailableByLotId?.values() ?? []).reduce(
    (sum, quantity) => roundQuantity(sum + quantity),
    0
  );
  const netAvailable =
    params.trackedLotDefault === "unbatched"
      ? roundQuantity(totalAvailable)
      : roundQuantity(
          (await getCurrentAvailableLotBalanceQtyAtLocationInTx(tx, params)) -
            protectedQuantity
        );

  if (netAvailable < params.quantity && !params.allowNegativeStock) {
    throw new InsufficientStockError({
      itemId: params.itemId,
      available: netAvailable,
      requested: params.quantity,
    });
  }

  let remaining = roundQuantity(params.quantity);
  const allocations: FifoAllocation[] = [];

  for (const lot of lotsForUpdate) {
    if (remaining <= 0) {
      break;
    }

    const currentQty = parseFloat(lot.quantity);
    const protectedQty = params.unavailableByLotId?.get(lot.lotId) ?? 0;
    const usableQty = Math.max(0, roundQuantity(currentQty - protectedQty));
    if (usableQty <= 0) continue;
    const unitCost = parseFloat(lot.unitCost ?? "0");
    const receivedAt = lot.receivedAt ?? new Date();
    const deduction = roundQuantity(Math.min(usableQty, remaining));

    const [updatedBalance] = await tx
      .update(inventoryLotBalances)
      .set({
        quantity: sql`${inventoryLotBalances.quantity} - ${deduction}`,
        stillActive: sql`(${inventoryLotBalances.quantity} - ${deduction}) > 0`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryLotBalances.organizationId, params.organizationId),
          eq(inventoryLotBalances.itemId, params.itemId),
          eq(inventoryLotBalances.locationId, params.locationId),
          eq(inventoryLotBalances.lotId, lot.lotId),
          eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
          sql`${inventoryLotBalances.quantity} >= ${roundQuantity(protectedQty + deduction)}`
        )
      )
      .returning({ lotId: inventoryLotBalances.lotId });

    if (!updatedBalance) {
      throw new InsufficientStockError({
        itemId: params.itemId,
        available: totalAvailable,
        requested: params.quantity,
      });
    }

    await tx
      .update(lots)
      .set({
        quantity: sql`${lots.quantity} - ${deduction}`,
        updatedAt: new Date(),
      })
      .where(eq(lots.id, lot.lotId));

    allocations.push({
      lotId: lot.lotId,
      lotNumber: lot.lotNumber,
      quantity: deduction,
      unitCost,
      receivedAt,
      requirementViolated:
        params.minimumReceivedDate != null
          ? receivedAt.toISOString().slice(0, 10) > params.minimumReceivedDate
          : false,
    });
    remaining = roundQuantity(remaining - deduction);
  }

  const negativeEventIds: string[] = [];
  const negativeAllocations: FifoAllocation[] = [];
  if (remaining > 0) {
    if (!params.allowNegativeStock) {
      throw new InsufficientStockError({
        itemId: params.itemId,
        available: totalAvailable,
        requested: params.quantity,
      });
    }

    const negative = await createNegativeStockEventInTx(tx, {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      quantity: remaining,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: allocations.length === 0 ? params.idempotencyKey ?? null : null,
      occurredAt: params.occurredAt,
      metadata: {
        ...(params.metadata ?? {}),
        negativeStock: true,
        requestedQuantity: roundQuantity(params.quantity),
        availableQuantity: roundQuantity(totalAvailable),
        shortageQuantity: remaining,
      },
    });
    negativeAllocations.push(negative.allocation);
    negativeEventIds.push(negative.eventId);
    remaining = 0;
  }

  const inserted = await insertInventoryEventsInTx(
    tx,
    allocations.map((allocation, index) => ({
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: allocation.lotId,
      quantity: normalizeNumeric(allocation.quantity),
      unitCost: normalizeNumericScale(allocation.unitCost, 6),
      extendedCost: calculateExtendedCost(
        normalizeNumeric(allocation.quantity),
        normalizeNumericScale(allocation.unitCost, 6)
      ),
      disposition: DEFAULT_DISPOSITION,
      fromDisposition: DEFAULT_DISPOSITION,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey:
        index === 0 && negativeEventIds.length === 0
          ? params.idempotencyKey ?? null
          : null,
      occurredAt: params.occurredAt,
      metadata: params.metadata ?? null,
    }))
  );

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: -roundQuantity(params.quantity),
    },
  ]);

  return {
    allocations: [...allocations, ...negativeAllocations],
    eventIds: [...inserted.map((row) => row.id), ...negativeEventIds],
  };
}

async function createNegativeStockEventInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    quantity: number;
    eventType: NegativeStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
  }
) {
  const unitCost = await resolvePositiveStockUnitCostInTx(tx, {
    itemId: params.itemId,
    reason: "negative_stock_cost_policy",
  });
  const quantity = roundQuantity(params.quantity);
  const occurredAt = params.occurredAt ?? new Date();
  const lot = await getOrCreateNegativeStockLotInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
    occurredAt,
  });

  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? "negative_stock",
      itemId: params.itemId,
      lotId: lot.id,
      quantity: normalizeNumeric(quantity),
      unitCost,
      extendedCost: calculateExtendedCost(normalizeNumeric(quantity), unitCost),
      disposition: DEFAULT_DISPOSITION,
      fromDisposition: DEFAULT_DISPOSITION,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt,
      metadata: {
        ...(params.metadata ?? {}),
        lotNumber: lot.lotNumber,
        negativeStockLot: true,
      },
    },
  ]);

  await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} - ${quantity}`,
      updatedAt: occurredAt,
    })
    .where(eq(lots.id, lot.id));

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      lotId: lot.id,
      quantityDelta: -quantity,
      unitCost,
      receivedAt: occurredAt,
      originEventId: event.id,
      disposition: DEFAULT_DISPOSITION,
    },
  ]);

  return {
    allocation: {
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      quantity,
      unitCost: parseFloat(unitCost),
      receivedAt: occurredAt,
    },
    eventId: event.id,
  };
}

// Caller must hold the item lock so concurrent shortages serialize per item.
async function getOrCreateNegativeStockLotInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    occurredAt: Date;
  }
) {
  const [lot] = await tx
    .insert(lots)
    .values({
      organizationId: params.organizationId,
      itemId: params.itemId,
      lotNumber: NEGATIVE_STOCK_LOT_NUMBER,
      quantity: "0",
      receivedAt: params.occurredAt,
      updatedAt: params.occurredAt,
    })
    .onConflictDoUpdate({
      target: [lots.organizationId, lots.itemId, lots.lotNumber],
      set: { updatedAt: lots.updatedAt },
    })
    .returning({
      id: lots.id,
      lotNumber: lots.lotNumber,
      quantity: lots.quantity,
    });

  const [usage] = await tx
    .select({
      eventCount: sql<string>`COUNT(*)`,
      debtEventCount: sql<string>`COUNT(*) FILTER (
        WHERE ${inventoryEvents.metadata}->>'negativeStockLot' = 'true'
          OR ${inventoryEvents.eventSubtype} = 'negative_stock_debt_consolidation'
      )`,
    })
    .from(inventoryEvents)
    .where(eq(inventoryEvents.lotId, lot.id));

  if (
    parseFloat(lot.quantity) > 0 ||
    (Number(usage?.eventCount ?? 0) > 0 && Number(usage?.debtEventCount ?? 0) === 0)
  ) {
    throw new Error(
      `Lot number ${NEGATIVE_STOCK_LOT_NUMBER} is reserved for synthetic negative stock debt.`
    );
  }

  return lot;
}

export async function consumeSpecificLotInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    lotId: string;
    quantity: number;
    eventType: NegativeStockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    metadata?: Record<string, unknown> | null;
  }
) {
  await lockItemsInTx(tx, [params.itemId]);

  const lotTrackingMode = await getItemLotTrackingModeInTx(tx, params.itemId);
  if (lotTrackingMode === "untracked") {
    return consumeInternalUntrackedStockInTx(tx, {
      ...params,
      allowNegativeStock: false,
    });
  }

  const [lot] = await tx
    .select({
      lotId: inventoryLotBalances.lotId,
      lotNumber: lots.lotNumber,
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(inventoryLotBalances.lotId, lots.id))
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.lotId, params.lotId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .for("update");

  const available = parseFloat(lot?.quantity ?? "0");
  if (!lot || available < params.quantity) {
    throw new InsufficientStockError({
      itemId: params.itemId,
      available,
      requested: params.quantity,
    });
  }

  const unitCost = parseFloat(lot.unitCost ?? "0");
  const deduction = roundQuantity(params.quantity);
  const [updatedBalance] = await tx
    .update(inventoryLotBalances)
    .set({
      quantity: sql`${inventoryLotBalances.quantity} - ${deduction}`,
      stillActive: sql`(${inventoryLotBalances.quantity} - ${deduction}) > 0`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.lotId, params.lotId),
        eq(inventoryLotBalances.disposition, DEFAULT_DISPOSITION),
        sql`${inventoryLotBalances.quantity} >= ${deduction}`
      )
    )
    .returning({ lotId: inventoryLotBalances.lotId });

  if (!updatedBalance) {
    throw new InsufficientStockError({
      itemId: params.itemId,
      available,
      requested: params.quantity,
    });
  }

  await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} - ${deduction}`,
      updatedAt: new Date(),
    })
    .where(eq(lots.id, params.lotId));

  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType,
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: params.lotId,
      quantity: normalizeNumeric(deduction),
      unitCost: normalizeNumericScale(unitCost, 6),
      extendedCost: calculateExtendedCost(
        normalizeNumeric(deduction),
        normalizeNumericScale(unitCost, 6)
      ),
      disposition: DEFAULT_DISPOSITION,
      fromDisposition: DEFAULT_DISPOSITION,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt: params.occurredAt,
      metadata: params.metadata ?? null,
    },
  ]);

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: -deduction,
    },
  ]);

  return {
    allocations: [
      {
        lotId: params.lotId,
        lotNumber: lot.lotNumber,
        quantity: deduction,
        unitCost,
        receivedAt: lot.receivedAt,
      },
    ],
    eventIds: event ? [event.id] : [],
  };
}

export async function restockExistingLotInTx(
  tx: Tx,
  params: {
    organizationId: string;
    locationId: string;
    itemId: string;
    lotId: string;
    quantity: number;
    unitCost: string;
    eventType?: RestockEventType;
    eventSubtype?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    occurredAt?: Date;
    parentEventId?: string | null;
    metadata?: Record<string, unknown> | null;
    disposition?: InventoryDisposition;
  }
) {
  await lockItemsInTx(tx, [params.itemId]);
  const disposition = params.disposition ?? DEFAULT_DISPOSITION;
  const lotTrackingMode = await getItemLotTrackingModeInTx(tx, params.itemId);
  if (lotTrackingMode === "untracked" && disposition !== DEFAULT_DISPOSITION) {
    throw new LotTrackingError("Untracked items can only use available stock.", 409);
  }
  const effectiveLot =
    lotTrackingMode === "untracked"
      ? await getOrCreateInternalUntrackedLotInTx(tx, {
          organizationId: params.organizationId,
          itemId: params.itemId,
          occurredAt: params.occurredAt,
        })
      : null;
  const effectiveLotId = effectiveLot?.id ?? params.lotId;
  const effectiveLotNumber = effectiveLot?.lotNumber ?? null;

  await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} + ${params.quantity}`,
      updatedAt: new Date(),
    })
    .where(eq(lots.id, effectiveLotId));

  const [event] = await insertInventoryEventsInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      eventType: params.eventType ?? "unpick_restock",
      eventSubtype: params.eventSubtype ?? null,
      itemId: params.itemId,
      lotId: effectiveLotId,
      quantity: normalizeNumeric(params.quantity),
      unitCost: normalizeNumericScale(parseFloat(params.unitCost), 6),
      extendedCost: calculateExtendedCost(
        normalizeNumeric(params.quantity),
        normalizeNumericScale(parseFloat(params.unitCost), 6)
      ),
      disposition,
      toDisposition: disposition,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      parentEventId: params.parentEventId ?? null,
      actorUserId: params.actorUserId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt: params.occurredAt,
      metadata:
        effectiveLotNumber === INTERNAL_UNTRACKED_LOT_NUMBER
          ? stockEventMetadata(effectiveLotNumber, params.metadata)
          : params.metadata ?? null,
    },
  ]);

  await applyLotBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      lotId: effectiveLotId,
      itemId: params.itemId,
      disposition,
      quantityDelta: params.quantity,
      unitCost: normalizeNumericScale(parseFloat(params.unitCost), 6),
      receivedAt: effectiveLot?.receivedAt ?? params.occurredAt ?? new Date(),
      originEventId: event.id,
    },
  ]);

  await applyItemBalanceDeltasInTx(tx, [
    {
      organizationId: params.organizationId,
      locationId: params.locationId,
      itemId: params.itemId,
      onHandDelta: params.quantity,
    },
  ]);

  return { eventId: event.id };
}

export async function decrementPhysicalLotQuantityInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    lotId: string;
    quantity: number;
  }
) {
  const lotTrackingMode = await getItemLotTrackingModeInTx(tx, params.itemId);
  if (lotTrackingMode === "untracked") {
    const canonical = await getOrCreateInternalUntrackedLotInTx(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      occurredAt: new Date(),
    });
    if (canonical.id !== params.lotId) return false;
  }

  const [updated] = await tx
    .update(lots)
    .set({
      quantity: sql`${lots.quantity} - ${params.quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        eq(lots.id, params.lotId),
        sql`${lots.quantity} >= ${params.quantity}`
      )
    )
    .returning({ id: lots.id });

  return updated != null;
}
