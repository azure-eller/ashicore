import "server-only";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";
import {
  type InventoryDisposition,
  inventoryEvents,
  inventoryLotBalances,
  lots,
  salesOrderLines,
} from "@/lib/db/schema";
import {
  trimScale,
  trimScaleNullable,
} from "@/lib/db/numeric";
import {
  normalizeNumeric,
} from "@/lib/format";
import {
  assertTrackedItemInTx,
  getItemLotTrackingModeInTx,
} from "@/lib/inventory/lot-tracking";
import {
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import {
  changeLotDispositionInTx,
  ledgerLotUnitCostByOrigin,
  projectedLotUnitCost,
  scrapLotDispositionInTx,
} from "@/lib/inventory/kernel";
import {
  calculateMarginMetrics,
} from "@/lib/margin";
import type {
  QualityDispositionAction,
} from "@/lib/schemas/inventory-disposition";

export async function getLots(
  itemId: string,
  options: { includeNegativeBalances?: boolean } = {}
) {
  return withAuthedOrgContext(async (tx) => {
    if ((await getItemLotTrackingModeInTx(tx, itemId)) === "untracked") {
      return [];
    }

    const allocationsByLotId = new Map<
      string,
      Array<{
        type: "sales_order" | "manufacturing_order";
        label: string;
        contextLabel: string | null;
        href: string;
        quantity: string;
      }>
    >();
    const realizedRows = await tx
      .select({
        lotId: inventoryEvents.lotId,
        soldQuantity: trimScale(sql`COALESCE(SUM(${inventoryEvents.quantity}), 0)`).as(
          "soldQuantity"
        ),
        revenue: trimScale(sql`
          COALESCE(SUM(${inventoryEvents.quantity} * ${salesOrderLines.unitPrice}), 0)
        `).as("revenue"),
        cogs: trimScale(sql`COALESCE(SUM(${inventoryEvents.extendedCost}), 0)`).as(
          "cogs"
        ),
      })
      .from(inventoryEvents)
      .innerJoin(
        salesOrderLines,
        sql`${salesOrderLines.id}::text = ${inventoryEvents.metadata}->>'salesOrderLineId'`
      )
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          eq(inventoryEvents.eventType, "sales_consumption"),
          isNotNull(inventoryEvents.lotId),
          sql`${inventoryEvents.metadata}->>'salesOrderLineId' IS NOT NULL`
        )
      )
      .groupBy(inventoryEvents.lotId);
    const realizedByLotId = new Map(
      realizedRows
        .filter((row): row is typeof row & { lotId: string } => row.lotId != null)
        .map((row) => {
          const margin = calculateMarginMetrics({
            revenue: row.revenue,
            cogs: row.cogs,
          });

          return [
            row.lotId,
            {
              soldQuantity: row.soldQuantity,
              realizedRevenue: margin?.revenue ?? null,
              realizedCogs: margin?.cogs ?? null,
              realizedGrossProfit: margin?.grossProfit ?? null,
              realizedMarginPercent: margin?.marginPercent ?? null,
            },
          ];
        })
    );

    const rows = await tx
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        balanceQuantity: trimScaleNullable(inventoryLotBalances.quantity).as(
          "balanceQuantity"
        ),
        disposition: inventoryLotBalances.disposition,
        costPerUnit: trimScaleNullable(sql`
          COALESCE(
            ${projectedLotUnitCost(lots.organizationId, lots.id)}::numeric,
            ${ledgerLotUnitCostByOrigin(lots.organizationId, lots.id)}::numeric
          )
        `).as("costPerUnit"),
        receivedAt: lots.receivedAt,
      })
      .from(lots)
      .innerJoin(
        inventoryLotBalances,
        and(
          eq(inventoryLotBalances.organizationId, lots.organizationId),
          eq(inventoryLotBalances.itemId, lots.itemId),
          eq(inventoryLotBalances.lotId, lots.id),
          options.includeNegativeBalances
            ? sql`${inventoryLotBalances.quantity} <> 0`
            : sql`${inventoryLotBalances.quantity} > 0`
        )
      )
      .where(eq(lots.itemId, itemId))
      .orderBy(lots.receivedAt);

    const byLot = new Map<
      string,
      {
        id: string;
        lotNumber: string;
        quantity: string;
        costPerUnit: string | null;
        soldQuantity: string | null;
        realizedRevenue: string | null;
        realizedCogs: string | null;
        realizedGrossProfit: string | null;
        realizedMarginPercent: string | null;
        receivedAt: Date;
        allocations: Array<{
          type: "sales_order" | "manufacturing_order";
          label: string;
          contextLabel: string | null;
          href: string;
          quantity: string;
        }>;
        dispositionBalances: Array<{
          disposition: InventoryDisposition;
          quantity: string;
        }>;
      }
    >();

    for (const row of rows) {
      const current = byLot.get(row.id) ?? {
        ...(realizedByLotId.get(row.id) ?? {
          soldQuantity: null,
          realizedRevenue: null,
          realizedCogs: null,
          realizedGrossProfit: null,
          realizedMarginPercent: null,
        }),
        id: row.id,
        lotNumber: row.lotNumber,
        quantity: "0",
        costPerUnit: row.costPerUnit,
        receivedAt: row.receivedAt,
        allocations: allocationsByLotId.get(row.id) ?? [],
        dispositionBalances: [],
      };

      if (row.disposition && row.balanceQuantity != null) {
        current.dispositionBalances.push({
          disposition: row.disposition as InventoryDisposition,
          quantity: row.balanceQuantity,
        });
        current.quantity = normalizeNumeric(
          parseFloat(current.quantity) + parseFloat(row.balanceQuantity)
        );
      }

      byLot.set(row.id, current);
    }

    return [...byLot.values()];
  });
}

function dispositionForAction(
  action: QualityDispositionAction["action"]
): InventoryDisposition | null {
  if (action === "release") return "available";
  if (action === "block") return "blocked";
  if (action === "reject") return "rejected";
  return null;
}

export async function applyLotDispositionAction(
  itemId: string,
  lotId: string,
  action: QualityDispositionAction,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await assertTrackedItemInTx(
      tx,
      itemId,
      "Lot disposition changes are not available for untracked items."
    );
    const quantity = Number(action.quantity);
    const toDisposition = dispositionForAction(action.action);

    if (toDisposition == null) {
      return scrapLotDispositionInTx(tx, {
        organizationId: orgId,
        itemId,
        lotId,
        fromDisposition: action.fromDisposition,
        quantity,
        actorUserId: userId,
        idempotencyKey: options?.idempotencyKey ?? null,
        notes: action.notes,
      });
    }

    return changeLotDispositionInTx(tx, {
      organizationId: orgId,
      itemId,
      lotId,
      fromDisposition: action.fromDisposition,
      toDisposition,
      quantity,
      actorUserId: userId,
      idempotencyKey: options?.idempotencyKey ?? null,
      notes: action.notes,
    });
  });
}

export async function getStockMovements(itemId: string) {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: inventoryEvents.id,
        quantity: trimScale(inventoryEvents.quantity).as("quantity"),
        movementType: sql<string>`CASE
          WHEN ${inventoryEvents.eventType} = 'purchase_receipt' THEN 'purchase_received'
          WHEN ${inventoryEvents.eventType} = 'manufacturing_output' THEN 'manufacturing_produced'
          WHEN ${inventoryEvents.eventType} = 'sales_consumption' THEN 'sales_shipped'
          WHEN ${inventoryEvents.eventType} = 'manufacturing_ingredient_consumption' THEN 'manufacturing_picked'
          WHEN ${inventoryEvents.eventType} IN ('manufacturing_variance_loss', 'manufacturing_variance_gain') THEN 'manufacturing_variance'
          WHEN ${inventoryEvents.eventType} IN ('stocktake_gain', 'stocktake_loss', 'stocktake_verification') THEN 'stocktake_adjustment'
          WHEN ${inventoryEvents.eventType} = 'quality_disposition_change' THEN 'quality_disposition'
          WHEN ${inventoryEvents.eventType} = 'quality_scrap' THEN 'quality_scrap'
          ELSE 'manual_adjustment'
        END`.as("movementType"),
        referenceType: sql<string | null>`CASE
          WHEN ${inventoryEvents.referenceType} = 'stocktake_line'
            THEN 'stocktake'
          ELSE ${inventoryEvents.referenceType}
        END`.as("referenceType"),
        referenceId: sql<string | null>`CASE
          WHEN ${inventoryEvents.referenceType} = 'stocktake_line'
            THEN COALESCE(${inventoryEvents.metadata}->>'stocktakeId', ${inventoryEvents.referenceId}::text)
          ELSE ${inventoryEvents.referenceId}::text
        END`.as("referenceId"),
        createdBy: inventoryEvents.actorUserId,
        createdAt: inventoryEvents.occurredAt,
        lotNumber: lots.lotNumber,
      })
      .from(inventoryEvents)
      .leftJoin(lots, eq(inventoryEvents.lotId, lots.id))
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          inArray(inventoryEvents.eventType, [
            "opening_balance",
            "purchase_receipt",
            "manufacturing_output",
            "manual_adjustment_increase",
            "stocktake_gain",
            "manufacturing_variance_gain",
            "manual_adjustment_decrease",
            "stocktake_loss",
            "sales_consumption",
            "manufacturing_ingredient_consumption",
            "manufacturing_variance_loss",
            "unpick_restock",
            "stocktake_verification",
            "quality_disposition_change",
            "quality_scrap",
          ])
        )
      )
      .orderBy(desc(inventoryEvents.occurredAt));
  });
}
