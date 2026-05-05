import type {
  ManufacturingOrderDetail,
  ManufacturingOrderListRow,
} from "@/app/(dashboard)/manufacturing/types";
import {
  createManufacturingOrder,
  getManufacturingOrder,
  getManufacturingOrders,
  updateManufacturingOrder,
} from "@/app/(dashboard)/manufacturing/queries";
import type {
  InsertManufacturingOrder,
  UpdateManufacturingOrder,
} from "@/lib/schemas/manufacturing-orders";
import type { ErpGetOutput, ErpListItem, ErpListOutput, ErpRecord } from "@/lib/agent/erp/read-models/types";

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function paginate<T>(items: T[], limit: number, offset: number) {
  const paged = items.slice(offset, offset + limit);
  const nextOffset = offset + paged.length;

  return {
    items: paged,
    truncated: nextOffset < items.length,
    nextOffset: nextOffset < items.length ? nextOffset : undefined,
  };
}

function toManufacturingOrderListItem(row: ManufacturingOrderListRow): ErpListItem {
  return {
    id: row.id,
    title: row.orderNumber,
    subtitle: row.productName,
    status: row.status,
    badges: [row.status, row.manufacturingMode, row.pickProgressStatus],
    updatedAt: row.updatedAt.toISOString(),
    fields: {
      productSku: row.productSku,
      salesOrderNumber: row.salesOrderNumber,
      salesCustomerName: row.salesCustomerName,
      requestedQuantity: row.requestedQuantity,
      plannedQuantity: row.plannedQuantity,
      actualQuantity: row.actualQuantity,
      unitName: row.unitName,
      plannedDate: row.plannedDate,
      numberOfBatches: row.numberOfBatches,
      completedBatchCount: row.completedBatchCount,
      actionableBatchCount: row.actionableBatchCount,
    },
  };
}

function toManufacturingOrderRecord(row: ManufacturingOrderDetail): ErpRecord {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    title: row.orderNumber,
    subtitle: row.productName,
    status: row.status,
    badges: [row.status, row.manufacturingMode, row.pickProgressStatus],
    fields: {
      productId: row.productId,
      productName: row.productName,
      productSku: row.productSku,
      salesOrderId: row.salesOrderId,
      salesOrderNumber: row.salesOrderNumber,
      salesCustomerName: row.salesCustomerName,
      requestedQuantity: row.requestedQuantity,
      plannedQuantity: row.plannedQuantity,
      actualQuantity: row.actualQuantity,
      plannedDate: row.plannedDate,
      notes: row.notes,
      expectedBatchYield: row.expectedBatchYield,
      actualMaterialCost: row.actualMaterialCost,
      actualCostPerUnit: row.actualCostPerUnit,
      releasedAt: toIso(row.releasedAt),
      completedAt: toIso(row.completedAt),
      cancelledAt: toIso(row.cancelledAt),
      ingredients: row.ingredients.map((ingredient) => ({
        id: ingredient.id,
        itemId: ingredient.itemId,
        itemName: ingredient.itemName,
        itemSku: ingredient.itemSku,
        unitName: ingredient.unitName,
        plannedQuantity: ingredient.plannedQuantity,
        pickedQuantity: ingredient.pickedQuantity,
        remainingQuantity: ingredient.remainingQuantity,
        pickStatus: ingredient.pickStatus,
      })),
      batches: row.batches.map((batch) => ({
        id: batch.id,
        batchNumber: batch.batchNumber,
        status: batch.status,
        plannedQuantity: batch.plannedQuantity,
        actualQuantity: batch.actualQuantity,
      })),
      producedLots: row.producedLots.map((lot) => ({
        lotId: lot.lotId,
        lotNumber: lot.lotNumber,
        quantity: lot.quantity,
        costPerUnit: lot.costPerUnit,
      })),
      createdAt: row.createdAt.toISOString(),
      deletedAt: toIso(row.deletedAt),
    },
  };
}

export async function listManufacturingOrdersForAgent(args: {
  limit: number;
  offset: number;
  search?: string;
  status?: string[];
  productId?: string;
}): Promise<ErpListOutput> {
  const rows = await getManufacturingOrders();
  const search = args.search?.trim().toLowerCase();

  const filtered = rows
    .filter((row) => row.deletedAt == null)
    .filter((row) => (args.status && args.status.length > 0 ? args.status.includes(row.status) : true))
    .filter((row) => {
      if (!search) {
        return true;
      }

      return [
        row.orderNumber,
        row.productName,
        row.productSku,
        row.salesOrderNumber,
        row.salesCustomerName,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    });

  const byProduct = args.productId
    ? (
        await Promise.all(
          filtered.map(async (row) => ({
            row,
            detail: await getManufacturingOrder(row.id),
          }))
        )
      )
        .filter((entry) => entry.detail?.productId === args.productId)
        .map((entry) => entry.row)
    : filtered;

  const paged = paginate(byProduct.map(toManufacturingOrderListItem), args.limit, args.offset);

  return {
    entityType: "manufacturing_order",
    ...paged,
  };
}

export async function getManufacturingOrderForAgent(id: string): Promise<ErpGetOutput | null> {
  const row = await getManufacturingOrder(id);
  if (!row) {
    return null;
  }

  return {
    entityType: "manufacturing_order",
    record: toManufacturingOrderRecord(row),
  };
}

export async function createManufacturingOrderForAgent(
  values: InsertManufacturingOrder
): Promise<ErpGetOutput> {
  const created = await createManufacturingOrder(values);
  const order = await getManufacturingOrderForAgent(created.id);
  if (!order) {
    throw new Error("Created manufacturing order could not be reloaded.");
  }
  return order;
}

export async function updateManufacturingOrderForAgent(
  id: string,
  values: UpdateManufacturingOrder
): Promise<ErpGetOutput | null> {
  const updated = await updateManufacturingOrder(id, values);
  if (!updated) {
    return null;
  }

  return getManufacturingOrderForAgent(updated.id);
}
