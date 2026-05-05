import type { SalesOrderDetail, SalesOrderListRow } from "@/app/(dashboard)/sales/types";
import {
  createSalesOrder,
  getSalesOrder,
  getSalesOrders,
  updateSalesOrder,
} from "@/app/(dashboard)/sales/queries";
import type { InsertSalesOrder, UpdateSalesOrder } from "@/lib/schemas/sales-orders";
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

function toSalesOrderListItem(row: SalesOrderListRow): ErpListItem {
  return {
    id: row.id,
    title: row.orderNumber,
    subtitle: row.customerName,
    status: row.status,
    badges: [
      row.status,
      ...(row.hasManufacturableLines ? ["manufacturable"] : []),
    ],
    updatedAt: row.updatedAt.toISOString(),
    fields: {
      customerName: row.customerName,
      orderDate: row.orderDate,
      requestedDate: row.requestedDate,
      shippedAt: toIso(row.shippedAt),
      totalAmount: row.totalAmount,
      itemSummary: row.itemSummary,
      manufacturableLineCount: row.manufacturableLineCount,
      hasManufacturableLines: row.hasManufacturableLines,
    },
  };
}

function toSalesOrderRecord(row: SalesOrderDetail): ErpRecord {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    title: row.orderNumber,
    subtitle: row.customerName,
    status: row.status,
    badges: [
      row.status,
      ...(row.hasManufacturableLines ? ["manufacturable"] : []),
    ],
    fields: {
      customerId: row.customerId,
      customerName: row.customerName,
      orderDate: row.orderDate,
      requestedDate: row.requestedDate,
      notes: row.notes,
      shippedAt: toIso(row.shippedAt),
      totalAmount: row.totalAmount,
      xeroPushStatus: row.xeroPushStatus,
      xeroInvoiceNumber: row.xeroInvoiceNumber,
      lines: row.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        itemSku: line.itemSku,
        quantity: line.quantity,
        unitName: line.unitName,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      linkedManufacturingOrders: row.linkedManufacturingOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        productName: order.productName,
        status: order.status,
      })),
      createdAt: row.createdAt.toISOString(),
      deletedAt: toIso(row.deletedAt),
    },
  };
}

export async function listSalesOrdersForAgent(args: {
  limit: number;
  offset: number;
  search?: string;
  status?: string[];
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<ErpListOutput> {
  const rows = await getSalesOrders();
  const search = args.search?.trim().toLowerCase();

  const filtered = rows
    .filter((row) => row.deletedAt == null)
    .filter((row) => (args.status && args.status.length > 0 ? args.status.includes(row.status) : true))
    .filter((row) => {
      if (!args.dateFrom) {
        return true;
      }

      return row.requestedDate == null || row.requestedDate >= args.dateFrom;
    })
    .filter((row) => {
      if (!args.dateTo) {
        return true;
      }

      return row.requestedDate == null || row.requestedDate <= args.dateTo;
    })
    .filter((row) => {
      if (!search) {
        return true;
      }

      return [row.orderNumber, row.customerName, row.itemSummary]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    });

  const byCustomer = args.customerId
    ? (
        await Promise.all(
          filtered.map(async (row) => ({
            row,
            detail: await getSalesOrder(row.id),
          }))
        )
      )
        .filter((entry) => entry.detail?.customerId === args.customerId)
        .map((entry) => entry.row)
    : filtered;

  const paged = paginate(byCustomer.map(toSalesOrderListItem), args.limit, args.offset);

  return {
    entityType: "sales_order",
    ...paged,
  };
}

export async function getSalesOrderForAgent(id: string): Promise<ErpGetOutput | null> {
  const row = await getSalesOrder(id);
  if (!row) {
    return null;
  }

  return {
    entityType: "sales_order",
    record: toSalesOrderRecord(row),
  };
}

export async function createSalesOrderForAgent(values: InsertSalesOrder): Promise<ErpGetOutput> {
  const created = await createSalesOrder(values);
  const order = await getSalesOrderForAgent(created.id);
  if (!order) {
    throw new Error("Created sales order could not be reloaded.");
  }
  return order;
}

export async function updateSalesOrderForAgent(
  id: string,
  values: UpdateSalesOrder
): Promise<ErpGetOutput | null> {
  const updated = await updateSalesOrder(id, values);
  if (!updated) {
    return null;
  }

  return getSalesOrderForAgent(updated.id);
}
