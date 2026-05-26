import { and, asc, eq, sql } from "drizzle-orm";
import { inventoryLotBalances, lots } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { trimScale } from "@/lib/db/numeric";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";

export type LotPickPlanKind = "allocated" | "fifo" | "picked" | "production";
export type LotPickPlanStatus = "ready" | "waiting" | "short";
export type LotPickPlanSourceType = "inventory_lot" | "manufacturing_order";

export type LotPickPlanEntry = {
  lotId: string | null;
  lotNumber: string | null;
  quantity: string;
  unitName: string | null;
  sourceType: LotPickPlanSourceType | null;
  sourceId: string | null;
  sourceLabel: string | null;
  kind: LotPickPlanKind;
  status: LotPickPlanStatus;
};

export async function buildFifoLotPickPlanInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    quantity: number;
    unitName: string | null;
    unavailableByLotId?: Map<string, number>;
  }
): Promise<LotPickPlanEntry[]> {
  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    return [];
  }

  const location = await getDefaultInventoryLocationInTx(tx, params.organizationId);
  let remaining = roundQuantity(params.quantity);
  const plan: LotPickPlanEntry[] = [];
  const lotRows = await tx
    .select({
      lotId: inventoryLotBalances.lotId,
      lotNumber: lots.lotNumber,
      quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(lots.id, inventoryLotBalances.lotId))
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.locationId, location.id),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));

  for (const row of lotRows) {
    if (remaining <= 0) break;

    const unavailable = params.unavailableByLotId?.get(row.lotId) ?? 0;
    const available = Math.max(0, roundQuantity(Number(row.quantity) - unavailable));
    if (available <= 0) continue;

    const quantity = roundQuantity(Math.min(available, remaining));
    plan.push({
      lotId: row.lotId,
      lotNumber: row.lotNumber,
      quantity: normalizeNumeric(quantity),
      unitName: params.unitName,
      sourceType: "inventory_lot",
      sourceId: row.lotId,
      sourceLabel: row.lotNumber,
      kind: "fifo",
      status: "ready",
    });
    remaining = roundQuantity(remaining - quantity);
  }

  if (remaining > 0) {
    plan.push({
      lotId: null,
      lotNumber: null,
      quantity: normalizeNumeric(remaining),
      unitName: params.unitName,
      sourceType: null,
      sourceId: null,
      sourceLabel: null,
      kind: "fifo",
      status: "short",
    });
  }

  return plan;
}
