import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jsonError, jsonNotFound } from "@/lib/api/responses";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  adjustItemStock,
  validateStockAdjustmentLotsInTx,
} from "@/lib/dal/stock-adjustments";
import { inventoryLotBalances, items, lots } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { roundQuantity } from "@/lib/format";
import { getExistingDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import type {
  InventoryReconciliationInput,
  InventoryReconciliationLineInput,
} from "@/lib/schemas/inventory-reconciliations";

export type InventoryReconciliationPreview = {
  source: InventoryReconciliationInput["source"];
  lines: InventoryReconciliationPreviewLine[];
};

export type InventoryReconciliationPreviewLine = {
  itemId: string;
  currentQty: string;
  countedQty: string;
  varianceQty: string;
  lots: InventoryReconciliationPreviewLot[];
};

export type InventoryReconciliationPreviewLot = {
  lotId: string | null;
  lotNumber: string;
  currentQty: string;
  countedQty: string;
  varianceQty: string;
  isFound: boolean;
};

export async function previewInventoryReconciliation(
  input: InventoryReconciliationInput
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const location = await getExistingDefaultInventoryLocationInTx(tx, orgId);
    if (!location) {
      return jsonError("Default inventory location not found.", 400);
    }
    const lines: InventoryReconciliationPreviewLine[] = [];

    for (const line of input.lines) {
      const [item] = await tx
        .select({ id: items.id, deletedAt: items.deletedAt })
        .from(items)
        .where(eq(items.id, line.itemId));

      if (!item || item.deletedAt != null) {
        return jsonNotFound("Item not found");
      }

      const lotTrackingMode = await getItemLotTrackingModeInTx(tx, line.itemId);
      if (lotTrackingMode === "tracked") {
        const preview = await previewTrackedLine(tx, {
          orgId,
          locationId: location.id,
          line,
        });
        if ("error" in preview) return preview.error;
        lines.push(preview.line);
      } else {
        if (line.newQuantity == null) {
          return jsonError("A new quantity is required.", 400);
        }
        const [current] = await tx
          .select({
            quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
          })
          .from(inventoryLotBalances)
          .where(
            and(
              eq(inventoryLotBalances.organizationId, orgId),
              eq(inventoryLotBalances.locationId, location.id),
              eq(inventoryLotBalances.itemId, line.itemId),
              eq(inventoryLotBalances.disposition, "available")
            )
          );
        const currentQty = String(roundQuantity(Number(current?.quantity ?? 0)));
        lines.push({
          itemId: line.itemId,
          currentQty,
          countedQty: line.newQuantity,
          varianceQty: String(roundQuantity(Number(line.newQuantity) - Number(currentQty))),
          lots: [],
        });
      }
    }

    return { source: input.source, lines } satisfies InventoryReconciliationPreview;
  });
}

export async function applyInventoryReconciliation(
  input: InventoryReconciliationInput,
  options: { idempotencyKey: string }
) {
  const line = input.lines[0]!;
  return adjustItemStock(line.itemId, line, {
    ...options,
    allowDefaultLocationCreate: false,
  });
}

async function previewTrackedLine(
  tx: Tx,
  params: {
    orgId: string;
    locationId: string;
    line: InventoryReconciliationLineInput;
  }
): Promise<{ line: InventoryReconciliationPreviewLine } | { error: NextResponse }> {
  const adjustLots = params.line.lots;
  const validationError = await validateStockAdjustmentLotsInTx(tx, {
    orgId: params.orgId,
    itemId: params.line.itemId,
    lots: adjustLots,
  });
  if (validationError) {
    return { error: validationError };
  }
  const validatedLots = adjustLots!;

  const balanceRows = await tx
    .select({
      lotId: inventoryLotBalances.lotId,
      lotNumber: lots.lotNumber,
      quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(lots.id, inventoryLotBalances.lotId))
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.orgId),
        eq(inventoryLotBalances.locationId, params.locationId),
        eq(inventoryLotBalances.itemId, params.line.itemId),
        eq(inventoryLotBalances.disposition, "available")
      )
    )
    .groupBy(inventoryLotBalances.lotId, lots.lotNumber);

  const balanceMap = new Map(balanceRows.map((row) => [row.lotId, row]));
  const zeroBalanceLotIds = validatedLots
    .map((lot) => lot.lotId)
    .filter((lotId): lotId is string => !!lotId && !balanceMap.has(lotId));
  const knownLotRows =
    zeroBalanceLotIds.length > 0
      ? await tx
          .select({ id: lots.id, lotNumber: lots.lotNumber })
          .from(lots)
          .where(
            and(
              eq(lots.organizationId, params.orgId),
              eq(lots.itemId, params.line.itemId),
              inArray(lots.id, zeroBalanceLotIds)
            )
          )
      : [];
  const knownLotNumberById = new Map(
    knownLotRows.map((lot) => [lot.id, lot.lotNumber])
  );
  const missingLotId = zeroBalanceLotIds.find((lotId) => !knownLotNumberById.has(lotId));
  if (missingLotId) {
    return { error: jsonNotFound("Lot not found for this item") };
  }

  const lotsPreview: InventoryReconciliationPreviewLot[] = [];

  for (const lot of validatedLots) {
    const current = lot.lotId ? balanceMap.get(lot.lotId) : null;
    const knownLotNumber = lot.lotId ? knownLotNumberById.get(lot.lotId) : null;
    const currentQty = String(roundQuantity(Number(current?.quantity ?? 0)));
    lotsPreview.push({
      lotId: lot.lotId ?? null,
      lotNumber: current?.lotNumber ?? knownLotNumber ?? lot.lotNumber ?? "New lot",
      currentQty,
      countedQty: lot.newQuantity,
      varianceQty: String(roundQuantity(Number(lot.newQuantity) - Number(currentQty))),
      isFound: !lot.lotId,
    });
  }

  const currentQty = roundQuantity(
    lotsPreview.reduce((sum, lot) => sum + Number(lot.currentQty), 0)
  );
  const varianceQty = roundQuantity(
    lotsPreview.reduce((sum, lot) => sum + Number(lot.varianceQty), 0)
  );
  const countedQty = roundQuantity(
    lotsPreview.reduce((sum, lot) => sum + Number(lot.countedQty), 0)
  );

  return {
    line: {
      itemId: params.line.itemId,
      currentQty: String(currentQty),
      countedQty: String(countedQty),
      varianceQty: String(varianceQty),
      lots: lotsPreview,
    },
  };
}
