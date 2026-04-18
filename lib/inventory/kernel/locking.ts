import { asc, eq, inArray } from "drizzle-orm";
import { items, manufacturingOrders, purchaseOrders, salesOrders, stocktakes } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import type { InventoryOperationName } from "./types";

type SourceLockSpec = {
  table:
    | "sales_orders"
    | "purchase_orders"
    | "manufacturing_orders"
    | "stocktakes";
  required: boolean;
};

const INVENTORY_LOCK_SPECS: Record<InventoryOperationName, SourceLockSpec | null> = {
  seedOpeningBalance: null,
  addExpectedFromPurchase: { table: "purchase_orders", required: true },
  editExpectedFromPurchase: { table: "purchase_orders", required: true },
  releaseExpectedFromPurchase: { table: "purchase_orders", required: true },
  receivePurchaseStock: { table: "purchase_orders", required: true },
  reserveForSales: { table: "sales_orders", required: true },
  releaseReservationForSalesLine: { table: "sales_orders", required: true },
  consumeForShipment: { table: "sales_orders", required: true },
  addExpectedFromManufacturing: { table: "manufacturing_orders", required: true },
  editExpectedFromManufacturing: { table: "manufacturing_orders", required: true },
  reserveIngredientsForManufacturing: { table: "manufacturing_orders", required: true },
  releaseIngredientReservationForManufacturing: {
    table: "manufacturing_orders",
    required: true,
  },
  pickManufacturingIngredient: { table: "manufacturing_orders", required: true },
  unpickManufacturingIngredient: { table: "manufacturing_orders", required: true },
  produceManufacturedStock: { table: "manufacturing_orders", required: true },
  cancelManufacturingOrder: { table: "manufacturing_orders", required: true },
  manualIncreaseStock: null,
  manualDecreaseStock: null,
  reconcileStocktakeCount: { table: "stocktakes", required: true },
  recordCostBasisChange: null,
  repairProjections: null,
};

function getStableItemIds(itemIds: string[]) {
  return [...new Set(itemIds)].sort();
}

export async function lockItemsInTx(tx: Tx, itemIds: string[]) {
  const stableItemIds = getStableItemIds(itemIds);

  if (stableItemIds.length === 0) {
    return;
  }

  await tx
    .select({ id: items.id })
    .from(items)
    .where(inArray(items.id, stableItemIds))
    .orderBy(asc(items.id))
    .for("update");
}

export async function lockSourceDocumentInTx(
  tx: Tx,
  operationName: InventoryOperationName,
  id: string | null | undefined
) {
  const spec = INVENTORY_LOCK_SPECS[operationName];

  if (!spec || !spec.required || !id) {
    return;
  }

  if (spec.table === "sales_orders") {
    await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(eq(salesOrders.id, id))
      .for("update");
    return;
  }

  if (spec.table === "purchase_orders") {
    await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .for("update");
    return;
  }

  if (spec.table === "manufacturing_orders") {
    await tx
      .select({ id: manufacturingOrders.id })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, id))
      .for("update");
    return;
  }

  await tx
    .select({ id: stocktakes.id })
    .from(stocktakes)
    .where(eq(stocktakes.id, id))
    .for("update");
}
