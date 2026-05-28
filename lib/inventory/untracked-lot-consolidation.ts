import { and, eq, isNull, sql } from "drizzle-orm";
import { inventoryLotBalances, itemFamilies, items, lots } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { generateDateLotNumberInTx } from "@/lib/inventory/lot-numbers";
import {
  INTERNAL_UNTRACKED_LOT_NUMBER,
  appendPositiveStockToExistingLotInTx,
  decrementExistingLotStockInTx,
  getOrCreateInternalUntrackedLotInTx,
} from "@/lib/inventory/kernel/operations/stock-core";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import { LotTrackingError } from "@/lib/inventory/lot-tracking";

export type UntrackedLotConsolidationResult = {
  itemId: string;
  canonicalLotId: string;
  movedLotCount: number;
  deletedLotCount: number;
};

async function deleteEmptySupersededUntrackedLotsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    oldLotIds: string[];
    oldLotIdArray: ReturnType<typeof sql>;
  }
) {
  const [nonZeroBalance] = await tx
    .select({ lotId: inventoryLotBalances.lotId })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        sql`${inventoryLotBalances.lotId} = ANY(${params.oldLotIdArray})`,
        sql`${inventoryLotBalances.quantity} <> 0`
      )
    )
    .limit(1);
  if (nonZeroBalance) {
    throw new LotTrackingError("Superseded untracked lots still have stock balances.", 409);
  }

  await tx.execute(sql`
    DELETE FROM inventory.lots
    WHERE organization_id = ${params.organizationId}
      AND item_id = ${params.itemId}
      AND id = ANY(${params.oldLotIdArray})
  `);

  const remaining = await tx
    .select({ id: lots.id })
    .from(lots)
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        sql`${lots.id} = ANY(${params.oldLotIdArray})`
      )
    );
  if (remaining.length > 0) {
    throw new LotTrackingError("Superseded untracked lots were not fully deleted.", 409);
  }

  return params.oldLotIds.length;
}

async function collapseHistoricalLotReferencesInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    canonicalLotId: string;
  }
) {
  // Disabling tracking intentionally removes all operator-visible lot identity
  // for the item; stock economics stay on the inventory events.
  const oldLots = await tx
    .select({ id: lots.id })
    .from(lots)
    .where(
      and(
        eq(lots.organizationId, params.organizationId),
        eq(lots.itemId, params.itemId),
        sql`${lots.id} <> ${params.canonicalLotId}`
      )
    )
    .for("update");
  const oldLotIds = oldLots.map((lot) => lot.id);
  if (oldLotIds.length === 0) return 0;
  const oldLotIdArray = sql`ARRAY[${sql.join(
    oldLotIds.map((id) => sql`${id}`),
    sql`, `
  )}]::uuid[]`;

  await tx.execute(sql`
    UPDATE inventory.inventory_events
    SET lot_id = ${params.canonicalLotId},
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb) - 'lotNumber',
          '{internalUntrackedLot}',
          'true'::jsonb,
          true
        )
    WHERE organization_id = ${params.organizationId}
      AND item_id = ${params.itemId}
      AND lot_id = ANY(${oldLotIdArray})
  `);
  await tx.execute(sql`
    UPDATE inventory.quality_disposition_events
    SET lot_id = ${params.canonicalLotId},
        updated_at = now()
    WHERE organization_id = ${params.organizationId}
      AND item_id = ${params.itemId}
      AND lot_id = ANY(${oldLotIdArray})
  `);
  await tx.execute(sql`
    UPDATE inventory.stock_allocations
    SET source_id = ${params.canonicalLotId},
        source_label_snapshot = ${INTERNAL_UNTRACKED_LOT_NUMBER},
        updated_at = now()
    WHERE organization_id = ${params.organizationId}
      AND item_id = ${params.itemId}
      AND source_type = 'inventory_lot'
      AND source_id = ANY(${oldLotIdArray})
  `);
  await tx.execute(sql`
    UPDATE manufacturing.manufacturing_order_batches b
    SET lot_id = ${params.canonicalLotId},
        updated_at = now()
    FROM manufacturing.manufacturing_orders mo
    WHERE mo.id = b.manufacturing_order_id
      AND mo.organization_id = ${params.organizationId}
      AND mo.product_id = ${params.itemId}
      AND b.lot_id = ANY(${oldLotIdArray})
  `);
  await tx.execute(sql`
    UPDATE manufacturing.manufacturing_pick_allocations p
    SET lot_id = ${params.canonicalLotId}
    FROM manufacturing.manufacturing_order_ingredients i
    INNER JOIN manufacturing.manufacturing_orders mo
      ON mo.id = i.manufacturing_order_id
    WHERE p.manufacturing_order_ingredient_id = i.id
      AND mo.organization_id = ${params.organizationId}
      AND i.item_id = ${params.itemId}
      AND p.lot_id = ANY(${oldLotIdArray})
  `);
  await tx.execute(sql`
    UPDATE manufacturing.manufacturing_order_outputs o
    SET lot_id = ${params.canonicalLotId}
    FROM manufacturing.manufacturing_orders mo
    WHERE mo.id = o.manufacturing_order_id
      AND mo.organization_id = ${params.organizationId}
      AND mo.product_id = ${params.itemId}
      AND o.lot_id = ANY(${oldLotIdArray})
  `);
  await tx.execute(sql`
    UPDATE manufacturing.manufacturing_order_output_consumptions c
    SET lot_id = ${params.canonicalLotId}
    FROM manufacturing.manufacturing_order_ingredients i
    INNER JOIN manufacturing.manufacturing_orders mo
      ON mo.id = i.manufacturing_order_id
    WHERE c.manufacturing_order_ingredient_id = i.id
      AND mo.organization_id = ${params.organizationId}
      AND i.item_id = ${params.itemId}
      AND c.lot_id = ANY(${oldLotIdArray})
  `);
  await tx.execute(sql`
    WITH old_rows AS (
      SELECT sli.stocktake_item_id,
             SUM(COALESCE(sli.expected_qty, 0)) AS expected_qty,
             SUM(COALESCE(sli.counted_qty, 0)) AS counted_qty,
             SUM(COALESCE(sli.variance_qty, 0)) AS variance_qty,
             SUM(COALESCE(sli.applied_delta_qty, 0)) AS applied_delta_qty,
             MIN(sli.received_at) AS received_at,
             MIN(sli.sort_order) AS sort_order
      FROM inventory.stocktake_lot_items sli
      INNER JOIN inventory.stocktake_items si ON si.id = sli.stocktake_item_id
      INNER JOIN inventory.stocktakes s ON s.id = si.stocktake_id
      WHERE s.organization_id = ${params.organizationId}
        AND si.item_id = ${params.itemId}
        AND sli.lot_id = ANY(${oldLotIdArray})
      GROUP BY sli.stocktake_item_id
    ),
    deleted AS (
      DELETE FROM inventory.stocktake_lot_items sli
      USING inventory.stocktake_items si, inventory.stocktakes s
      WHERE si.id = sli.stocktake_item_id
        AND s.id = si.stocktake_id
        AND s.organization_id = ${params.organizationId}
        AND si.item_id = ${params.itemId}
        AND sli.lot_id = ANY(${oldLotIdArray})
      RETURNING sli.id
    )
    INSERT INTO inventory.stocktake_lot_items (
      stocktake_item_id,
      lot_id,
      lot_number,
      expected_qty,
      counted_qty,
      variance_qty,
      applied_delta_qty,
      received_at,
      sort_order
    )
    SELECT stocktake_item_id,
           ${params.canonicalLotId},
           ${INTERNAL_UNTRACKED_LOT_NUMBER},
           expected_qty,
           counted_qty,
           variance_qty,
           applied_delta_qty,
           received_at,
           sort_order
    FROM old_rows
    ON CONFLICT (stocktake_item_id, lot_id)
    DO UPDATE SET
      expected_qty = inventory.stocktake_lot_items.expected_qty + EXCLUDED.expected_qty,
      counted_qty = COALESCE(inventory.stocktake_lot_items.counted_qty, 0) + EXCLUDED.counted_qty,
      variance_qty = COALESCE(inventory.stocktake_lot_items.variance_qty, 0) + EXCLUDED.variance_qty,
      applied_delta_qty = COALESCE(inventory.stocktake_lot_items.applied_delta_qty, 0) + EXCLUDED.applied_delta_qty,
      lot_number = ${INTERNAL_UNTRACKED_LOT_NUMBER},
      updated_at = now()
  `);

  return deleteEmptySupersededUntrackedLotsInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
    oldLotIds,
    oldLotIdArray,
  });
}

export async function consolidateUntrackedItemLotsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    actorUserId?: string | null;
    occurredAt?: Date | null;
  }
): Promise<UntrackedLotConsolidationResult> {
  await lockItemsInTx(tx, [params.itemId]);

  const canonical = await getOrCreateInternalUntrackedLotInTx(tx, {
    organizationId: params.organizationId,
    itemId: params.itemId,
    occurredAt: params.occurredAt,
  });

  const oldBalances = await tx
    .select({
      lotId: inventoryLotBalances.lotId,
      locationId: inventoryLotBalances.locationId,
      quantity: inventoryLotBalances.quantity,
      unitCost: inventoryLotBalances.unitCost,
    })
    .from(inventoryLotBalances)
    .innerJoin(lots, eq(lots.id, inventoryLotBalances.lotId))
    .where(
      and(
        eq(inventoryLotBalances.organizationId, params.organizationId),
        eq(inventoryLotBalances.itemId, params.itemId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} <> 0`,
        sql`${inventoryLotBalances.lotId} <> ${canonical.id}`
      )
    )
    .orderBy(
      inventoryLotBalances.locationId,
      inventoryLotBalances.receivedAt,
      inventoryLotBalances.lotId
    )
    .for("update");

  let movedLotCount = 0;
  for (const balance of oldBalances) {
    const quantity = Number(balance.quantity);
    if (quantity < 0) {
      throw new Error(
        "Lot tracking cannot be turned off while negative tracked lot stock exists."
      );
    }
    if (quantity === 0) continue;

    await decrementExistingLotStockInTx(tx, {
      organizationId: params.organizationId,
      locationId: balance.locationId,
      itemId: params.itemId,
      lotId: balance.lotId,
      quantity,
      unitCost: balance.unitCost,
      eventType: "manual_adjustment_decrease",
      eventSubtype: "lot_tracking_consolidation",
      referenceType: "item",
      referenceId: params.itemId,
      actorUserId: params.actorUserId ?? null,
      occurredAt: params.occurredAt ?? undefined,
      metadata: { internalUntrackedLotConsolidation: true },
    });
    await appendPositiveStockToExistingLotInTx(tx, {
      organizationId: params.organizationId,
      locationId: balance.locationId,
      itemId: params.itemId,
      lotId: canonical.id,
      quantity,
      unitCost: balance.unitCost ?? "0",
      eventType: "manual_adjustment_increase",
      eventSubtype: "lot_tracking_consolidation",
      referenceType: "item",
      referenceId: params.itemId,
      actorUserId: params.actorUserId ?? null,
      occurredAt: params.occurredAt ?? undefined,
      metadata: { internalUntrackedLotConsolidation: true },
    });
    movedLotCount += 1;
  }

  return {
    itemId: params.itemId,
    canonicalLotId: canonical.id,
    movedLotCount,
    deletedLotCount: await collapseHistoricalLotReferencesInTx(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      canonicalLotId: canonical.id,
    }),
  };
}

export async function consolidateUntrackedFamilyLotsInTx(
  tx: Tx,
  params: {
    organizationId: string;
    familyId: string;
    actorUserId?: string | null;
    occurredAt?: Date | null;
  }
) {
  const variantRows = await tx
    .select({ id: items.id })
    .from(items)
    .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(
      and(
        eq(itemFamilies.id, params.familyId),
        eq(items.organizationId, params.organizationId),
        isNull(items.deletedAt)
      )
    );

  const results: UntrackedLotConsolidationResult[] = [];
  for (const row of variantRows) {
    results.push(
      await consolidateUntrackedItemLotsInTx(tx, {
        organizationId: params.organizationId,
        itemId: row.id,
        actorUserId: params.actorUserId ?? null,
        occurredAt: params.occurredAt,
      })
    );
  }

  return results;
}

export async function convertUntrackedFamilyLotsToTrackedInTx(
  tx: Tx,
  params: {
    organizationId: string;
    familyId: string;
  }
) {
  const variantRows = await tx
    .select({ id: items.id })
    .from(items)
    .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(
      and(
        eq(itemFamilies.id, params.familyId),
        eq(items.organizationId, params.organizationId),
        isNull(items.deletedAt)
      )
    );

  for (const row of variantRows) {
    await lockItemsInTx(tx, [row.id]);
    const [canonical] = await tx
      .select({
        id: lots.id,
        receivedAt: lots.receivedAt,
      })
      .from(lots)
      .where(
        and(
          eq(lots.organizationId, params.organizationId),
          eq(lots.itemId, row.id),
          eq(lots.lotNumber, INTERNAL_UNTRACKED_LOT_NUMBER)
        )
      )
      .for("update");

    if (!canonical) continue;

    const [unsafeBalance] = await tx
      .select({ lotId: inventoryLotBalances.lotId })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, params.organizationId),
          eq(inventoryLotBalances.itemId, row.id),
          eq(inventoryLotBalances.lotId, canonical.id),
          sql`(
            (${inventoryLotBalances.disposition} <> 'available'
              AND ${inventoryLotBalances.quantity} <> 0)
            OR ${inventoryLotBalances.quantity} < 0
          )`
        )
      )
      .limit(1);
    if (unsafeBalance) {
      throw new LotTrackingError(
        "Lot tracking cannot be turned on while untracked stock is negative, blocked, or rejected.",
        409
      );
    }

    const lotNumber = await generateDateLotNumberInTx(tx, {
      organizationId: params.organizationId,
      itemId: row.id,
      receivedAt: canonical.receivedAt,
    });
    await tx
      .update(lots)
      .set({ lotNumber, updatedAt: new Date() })
      .where(eq(lots.id, canonical.id));
    await tx.execute(sql`
      UPDATE inventory.inventory_events
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb) - 'internalUntrackedLot',
            '{lotNumber}',
            to_jsonb(${lotNumber}::text),
            true
          )
      WHERE organization_id = ${params.organizationId}
        AND item_id = ${row.id}
        AND lot_id = ${canonical.id}
    `);
    await tx.execute(sql`
      UPDATE inventory.stock_allocations
      SET source_label_snapshot = ${lotNumber},
          updated_at = now()
      WHERE organization_id = ${params.organizationId}
        AND item_id = ${row.id}
        AND source_type = 'inventory_lot'
        AND source_id = ${canonical.id}
    `);
    await tx.execute(sql`
      UPDATE inventory.stocktake_lot_items sli
      SET lot_number = ${lotNumber},
          updated_at = now()
      FROM inventory.stocktake_items si, inventory.stocktakes s
      WHERE si.id = sli.stocktake_item_id
        AND s.id = si.stocktake_id
        AND s.organization_id = ${params.organizationId}
        AND si.item_id = ${row.id}
        AND sli.lot_id = ${canonical.id}
    `);
  }
}
