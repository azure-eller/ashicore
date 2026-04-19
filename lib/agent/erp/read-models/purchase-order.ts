import type { PurchaseOrderDetail, PurchaseOrderListRow } from "@/app/(dashboard)/purchasing/types";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  getPurchaseOrders,
  updatePurchaseOrder,
} from "@/app/(dashboard)/purchasing/queries";
import type { InsertPurchaseOrder, UpdatePurchaseOrder } from "@/lib/schemas/purchase-orders";
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

function toPurchaseOrderListItem(row: PurchaseOrderListRow): ErpListItem {
  return {
    id: row.id,
    title: row.orderNumber,
    subtitle: row.supplierName,
    status: row.status,
    badges: [row.status],
    updatedAt: row.updatedAt.toISOString(),
    fields: {
      supplierName: row.supplierName,
      expectedDate: row.expectedDate,
      totalAmount: row.totalAmount,
      itemSummary: row.itemSummary,
      receivedAt: toIso(row.receivedAt),
    },
  };
}

function toPurchaseOrderRecord(row: PurchaseOrderDetail): ErpRecord {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    title: row.orderNumber,
    subtitle: row.supplierName,
    status: row.status,
    badges: [row.status],
    fields: {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      expectedDate: row.expectedDate,
      notes: row.notes,
      totalAmount: row.totalAmount,
      orderedAt: toIso(row.orderedAt),
      receivedAt: toIso(row.receivedAt),
      cancelledAt: toIso(row.cancelledAt),
      lines: row.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        itemSku: line.itemSku,
        quantityOrdered: line.quantityOrdered,
        quantityReceived: line.quantityReceived,
        quantityRemaining: line.quantityRemaining,
        unitCost: line.unitCost,
        lineTotal: line.lineTotal,
      })),
      createdAt: row.createdAt.toISOString(),
      deletedAt: toIso(row.deletedAt),
    },
  };
}

export async function listPurchaseOrdersForAgent(args: {
  limit: number;
  offset: number;
  search?: string;
  status?: string[];
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<ErpListOutput> {
  const rows = await getPurchaseOrders();
  const search = args.search?.trim().toLowerCase();

  const filtered = rows
    .filter((row) => row.deletedAt == null)
    .filter((row) => (args.status && args.status.length > 0 ? args.status.includes(row.status) : true))
    .filter((row) => {
      if (!args.dateFrom) {
        return true;
      }

      return row.expectedDate == null || row.expectedDate >= args.dateFrom;
    })
    .filter((row) => {
      if (!args.dateTo) {
        return true;
      }

      return row.expectedDate == null || row.expectedDate <= args.dateTo;
    })
    .filter((row) => {
      if (!search) {
        return true;
      }

      return [row.orderNumber, row.supplierName, row.itemSummary]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    });

  const bySupplier = args.supplierId
    ? (
        await Promise.all(
          filtered.map(async (row) => ({
            row,
            detail: await getPurchaseOrder(row.id),
          }))
        )
      )
        .filter((entry) => entry.detail?.supplierId === args.supplierId)
        .map((entry) => entry.row)
    : filtered;

  const paged = paginate(bySupplier.map(toPurchaseOrderListItem), args.limit, args.offset);

  return {
    entityType: "purchase_order",
    ...paged,
  };
}

export async function getPurchaseOrderForAgent(id: string): Promise<ErpGetOutput | null> {
  const row = await getPurchaseOrder(id);
  if (!row) {
    return null;
  }

  return {
    entityType: "purchase_order",
    record: toPurchaseOrderRecord(row),
  };
}

export async function createPurchaseOrderForAgent(
  values: InsertPurchaseOrder
): Promise<ErpGetOutput> {
  const created = await createPurchaseOrder(values);
  const order = await getPurchaseOrderForAgent(created.id);
  if (!order) {
    throw new Error("Created purchase order could not be reloaded.");
  }
  return order;
}

export async function updatePurchaseOrderForAgent(
  id: string,
  values: UpdatePurchaseOrder
): Promise<ErpGetOutput | null> {
  const updated = await updatePurchaseOrder(id, values);
  if (!updated) {
    return null;
  }

  return getPurchaseOrderForAgent(updated.id);
}
