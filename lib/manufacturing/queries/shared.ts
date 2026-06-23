import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { items, manufacturingOrders, unitDefinitions } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { normalizeQuantityNumber } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import { lockManufacturingPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { documentNumberSortSql } from "@/lib/document-numbers";
import {
  getItemDisplayMetadataByIdInTx,
  getItemDisplayNamesByIdInTx,
} from "@/lib/inventory/item-display";
import type { ManufacturingPickProgressStatus } from "../types";
import type { ManufacturingIngredientSiblingVariant } from "../types";
import { ManufacturingError } from "./errors";

type ActiveSiblingVariant = Omit<ManufacturingIngredientSiblingVariant, "isCurrent">;

export function effectiveManufacturingPriorityRankSql() {
  return sql<number | null>`${manufacturingOrders.priorityRank}`;
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export async function getManufacturingItemDisplayMetadataInTx(
  tx: Tx,
  itemIds: Array<string | null | undefined>
) {
  return getItemDisplayMetadataByIdInTx(tx, uniqueIds(itemIds));
}

export function canonicalItemName(
  displayByItemId: Awaited<ReturnType<typeof getManufacturingItemDisplayMetadataInTx>>,
  itemId: string | null | undefined,
  fallbackName: string
) {
  return (itemId ? displayByItemId.get(itemId)?.displayName : null) ?? fallbackName;
}

export async function getActiveSiblingVariantsByItemIdInTx(
  tx: Tx,
  itemIds: Array<string | null | undefined>
) {
  const uniqueItemIds = uniqueIds(itemIds);
  const empty = new Map<string, ActiveSiblingVariant[]>();
  if (uniqueItemIds.length === 0) return empty;

  const sourceRows = await tx
    .select({
      id: items.id,
      familyId: items.familyId,
    })
    .from(items)
    .where(inArray(items.id, uniqueItemIds));

  const familyIds = [
    ...new Set(
      sourceRows
        .map((row) => row.familyId)
        .filter((familyId): familyId is string => Boolean(familyId)),
    ),
  ];
  if (familyIds.length === 0) return empty;

  const siblingRows = await tx
    .select({
      id: items.id,
      familyId: items.familyId,
      name: items.name,
      sku: items.sku,
      itemType: items.itemType,
      unitName: unitDefinitions.name,
      sortOrder: items.sortOrder,
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(and(inArray(items.familyId, familyIds), isNull(items.deletedAt)))
    .orderBy(asc(items.sortOrder), asc(items.name));

  const displayNamesByItemId = await getItemDisplayNamesByIdInTx(
    tx,
    siblingRows.map((row) => row.id)
  );

  const siblingsByFamilyId = new Map<string, ActiveSiblingVariant[]>();
  for (const row of siblingRows) {
    if (!row.familyId) continue;
    const bucket = siblingsByFamilyId.get(row.familyId) ?? [];
    bucket.push({
      itemId: row.id,
      itemName: displayNamesByItemId.get(row.id) ?? row.name,
      itemSku: row.sku,
      itemType: row.itemType,
      unitName: row.unitName,
    });
    siblingsByFamilyId.set(row.familyId, bucket);
  }

  const siblingsByItemId = new Map<string, ActiveSiblingVariant[]>();
  for (const row of sourceRows) {
    const siblings = row.familyId ? siblingsByFamilyId.get(row.familyId) ?? [] : [];
    siblingsByItemId.set(row.id, siblings);
  }

  return siblingsByItemId;
}

export type LockedManufacturingOrder = {
  id: string;
  productId: string;
  productName: string;
  productSku: string | null;
  unitName: string;
  status: (typeof manufacturingOrders.$inferSelect)["status"];
  manufacturingMode: string;
  numberOfBatches: number | null;
  expectedBatchYield: string | null;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  salesOrderNumber: string | null;
  salesCustomerName: string | null;
  requestedQuantity: string;
  plannedQuantity: string;
  actualQuantity: string | null;
  plannedDate: string | null;
  priorityRank: number | null;
  bomRevisionId: string | null;
  startedAt: Date | null;
  version: number;
};

export function isOpenManufacturingOrder(
  order: Pick<LockedManufacturingOrder, "status">
) {
  return order.status === "open";
}

export type IngredientProgressRow = {
  plannedQuantity: string;
  pickedQuantity: string;
};

export function sumNumericStrings(values: Array<string | null | undefined>) {
  return values.reduce((sum, value) => sum + parseFloat(value ?? "0"), 0);
}

export function getRemainingQuantityNumber(plannedQuantity: string, pickedQuantity: string) {
  return Math.max(
    0,
    normalizeQuantityNumber(parseFloat(plannedQuantity) - parseFloat(pickedQuantity))
  );
}

export function getPickProgressStatus(
  rows: IngredientProgressRow[]
): ManufacturingPickProgressStatus {
  if (rows.length === 0) {
    return "not_started";
  }

  const pickedRows = rows.filter((row) => parseFloat(row.pickedQuantity) > 0);
  if (pickedRows.length === 0) {
    return "not_started";
  }

  const fullyPicked = rows.every(
    (row) => getRemainingQuantityNumber(row.plannedQuantity, row.pickedQuantity) <= 0
  );

  return fullyPicked ? "picked" : "in_progress";
}

export async function getLockedManufacturingOrderInTx(
  tx: Tx,
  id: string
): Promise<LockedManufacturingOrder | null> {
  const [order] = await tx
    .select({
      id: manufacturingOrders.id,
      productId: manufacturingOrders.productId,
      productName: manufacturingOrders.productName,
      productSku: manufacturingOrders.productSku,
      unitName: manufacturingOrders.unitName,
      bomRevisionId: manufacturingOrders.bomRevisionId,
      status: manufacturingOrders.status,
      manufacturingMode: manufacturingOrders.manufacturingMode,
      numberOfBatches: manufacturingOrders.numberOfBatches,
      expectedBatchYield: trimScaleNullable(manufacturingOrders.expectedBatchYield).as(
        "expectedBatchYield"
      ),
      salesOrderId: manufacturingOrders.salesOrderId,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      salesOrderNumber: manufacturingOrders.salesOrderNumber,
      salesCustomerName: manufacturingOrders.salesCustomerName,
      version: manufacturingOrders.version,
      requestedQuantity: trimScale(manufacturingOrders.requestedQuantity).as(
        "requestedQuantity"
      ),
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as("plannedQuantity"),
      actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
        "actualQuantity"
      ),
      plannedDate: manufacturingOrders.plannedDate,
      priorityRank: manufacturingOrders.priorityRank,
      startedAt: manufacturingOrders.startedAt,
    })
    .from(manufacturingOrders)
    .where(and(eq(manufacturingOrders.id, id), isNull(manufacturingOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

export function assertSameStringSet(
  actual: string[],
  expected: string[],
  message: string
) {
  if (actual.length !== expected.length) {
    throw new ManufacturingError(message, 400);
  }

  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) {
    throw new ManufacturingError(message, 400);
  }

  const expectedSet = new Set(expected);
  if (actual.some((value) => !expectedSet.has(value))) {
    throw new ManufacturingError(message, 400);
  }
}

export async function rerankOpenManufacturingOrdersInTx(tx: Tx, orgId: string) {
  await lockManufacturingPriorityQueueInTx(tx, orgId);

  const rows = await tx
    .select({
      id: manufacturingOrders.id,
    })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.organizationId, orgId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .orderBy(
      sql`${manufacturingOrders.priorityRank} IS NULL`,
      asc(manufacturingOrders.priorityRank),
      asc(documentNumberSortSql(manufacturingOrders.orderNumber, "MO")),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrders.id)
    )
    .for("update");

  if (rows.length === 0) {
    return;
  }

  const now = new Date();
  await tx
    .update(manufacturingOrders)
    .set({
      priorityRank: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(manufacturingOrders.organizationId, orgId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    );

  for (const [index, row] of rows.entries()) {
    await tx
      .update(manufacturingOrders)
      .set({
        priorityRank: index + 1,
        updatedAt: now,
      })
      .where(eq(manufacturingOrders.id, row.id));
  }
}

export async function validateActiveIngredientItemsInTx(
  tx: Tx,
  ingredientIds: string[]
) {
  const uniqueIds = [...new Set(ingredientIds)];
  if (uniqueIds.length === 0) return;

  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(inArray(items.id, uniqueIds), isNull(items.deletedAt)));

  if (rows.length !== uniqueIds.length) {
    throw new ManufacturingError(
      "One or more ingredients are no longer active. Update the order before releasing it.",
      400
    );
  }
}
