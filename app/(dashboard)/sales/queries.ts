import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeNumeric, normalizeMoney } from "@/lib/format";
import {
  customers,
  items,
  lots,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
} from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  applyStockDeltaInTx,
  InsufficientStockError,
  lockItemsInTx,
} from "@/lib/inventory/stock";
import type { InsertCustomer, UpdateCustomer } from "@/lib/schemas/customers";
import type {
  InsertSalesOrder,
  UpdateSalesOrder,
} from "@/lib/schemas/sales-orders";
import type {
  CustomerRow,
  OversellWarningPayload,
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderEditData,
  SalesOrderListRow,
  SalesOrderProductOption,
} from "./types";

const stockSubquery = sql<string>`(
  SELECT COALESCE(SUM(${lots.quantity}), 0)
  FROM ${lots}
  WHERE ${lots.itemId} = ${items.id}
)`.as("stock");

type PreparedOrderLine = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  sortOrder: number;
};

type ProductValidationRow = {
  id: string;
  name: string;
  sku: string | null;
  unitName: string;
  defaultSellingPrice: string | null;
  stock: string;
  committedQty: string;
  expectedQty: string;
  safetyStock: string;
};

export class SalesError extends Error {
  status: number;
  errors?: Record<string, string[]>;
  oversell?: OversellWarningPayload;

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      oversell?: OversellWarningPayload;
    }
  ) {
    super(message);
    this.name = "SalesError";
    this.status = status;
    this.errors = options?.errors;
    this.oversell = options?.oversell;
  }

  toResponse() {
    const body = this.oversell
      ? { error: this.message, oversell: this.oversell }
      : this.errors
        ? { errors: this.errors }
        : { error: this.message };
    return NextResponse.json(body, { status: this.status });
  }
}

function roundQuantity(value: number) {
  return Math.round(value * 10000) / 10000;
}

function calcProjectedStock(values: {
  stock: string;
  committedQty: string;
  expectedQty: string;
  safetyStock: string;
}) {
  return roundQuantity(
    parseFloat(values.stock) -
      parseFloat(values.committedQty) +
      parseFloat(values.expectedQty) -
      parseFloat(values.safetyStock)
  );
}

function summarizeItems(lines: Array<{ itemName: string }>) {
  if (lines.length === 0) return "\u2014";
  if (lines.length === 1) return lines[0].itemName;
  return `${lines[0].itemName} + ${lines.length - 1} more`;
}

function isCancelPayload(
  payload: UpdateSalesOrder
): payload is Extract<UpdateSalesOrder, { status: "cancelled" }> {
  return payload.status === "cancelled" && !("lines" in payload);
}

async function generateOrderNumber(tx: Tx) {
  const result = await tx.execute(
    sql`SELECT nextval('sales.order_number_seq') AS val`
  );
  const raw = (result.rows[0] as { val: string | number }).val;
  const sequenceValue = Number(raw);
  const year = new Date().getFullYear();
  return `SO-${year}-${String(sequenceValue).padStart(4, "0")}`;
}

async function getOrderLinesInTx(tx: Tx, orderId: string) {
  return tx
    .select({
      id: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.unitName,
      quantity: salesOrderLines.quantity,
      unitPrice: salesOrderLines.unitPrice,
      lineTotal: salesOrderLines.lineTotal,
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
      updatedAt: salesOrderLines.updatedAt,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));
}

async function getLockedSalesOrderInTx(tx: Tx, id: string) {
  const [order] = await tx
    .select({
      id: salesOrders.id,
      status: salesOrders.status,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

async function recomputeCommittedQty(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];

  if (uniqueItemIds.length === 0) {
    return;
  }

  await lockItemsInTx(tx, uniqueItemIds);

  const totals = await tx
    .select({
      itemId: salesOrderLines.itemId,
      total: sql<string>`COALESCE(SUM(${salesOrderLines.quantity}), 0)`,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        inArray(salesOrderLines.itemId, uniqueItemIds),
        isNull(salesOrders.deletedAt),
        eq(salesOrders.status, "confirmed")
      )
    )
    .groupBy(salesOrderLines.itemId);

  const totalsByItem = new Map(totals.map((row) => [row.itemId, row.total]));

  for (const itemId of uniqueItemIds) {
    await tx
      .update(items)
      .set({
        committedQty: totalsByItem.get(itemId) ?? "0",
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
  }
}

async function getValidatedCustomerInTx(tx: Tx, customerId: string) {
  const [customer] = await tx
    .select({
      id: customers.id,
      name: customers.name,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));

  if (!customer) {
    throw new SalesError("Customer not found", 404);
  }

  return customer;
}

async function getValidatedProductsInTx(
  tx: Tx,
  productIds: string[]
) {
  const uniqueIds = [...new Set(productIds)];

  const rows = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      unitName: unitDefinitions.name,
      defaultSellingPrice: items.defaultSellingPrice,
      stock: stockSubquery,
      committedQty: items.committedQty,
      expectedQty: items.expectedQty,
      safetyStock: items.safetyStock,
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        inArray(items.id, uniqueIds),
        eq(items.itemType, "product"),
        isNull(items.deletedAt)
      )
    );

  const productMap = new Map(rows.map((row) => [row.id, row as ProductValidationRow]));

  if (productMap.size !== uniqueIds.length) {
    throw new SalesError("Product not found", 404);
  }

  return productMap;
}

async function prepareOrderPayload(
  tx: Tx,
  payload: InsertSalesOrder,
  options?: { lockProducts?: boolean }
): Promise<{
  customerId: string;
  customerName: string;
  requestedDate: string | null;
  notes: string | null;
  totalAmount: string;
  preparedLines: PreparedOrderLine[];
  affectedProductIds: string[];
  products: Map<string, ProductValidationRow>;
}> {
  const customer = await getValidatedCustomerInTx(tx, payload.customerId);
  const productIds = payload.lines.map((line) => line.itemId);

  if (options?.lockProducts) {
    await lockItemsInTx(tx, productIds);
  }

  const products = await getValidatedProductsInTx(tx, productIds);

  const preparedLines = payload.lines.map((line, index) => {
    const product = products.get(line.itemId);

    if (!product) {
      throw new SalesError("Product not found", 404);
    }

    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const lineTotal = quantity * unitPrice;

    return {
      itemId: product.id,
      itemName: product.name,
      itemSku: product.sku,
      unitName: product.unitName,
      quantity: normalizeNumeric(quantity),
      unitPrice: normalizeMoney(unitPrice),
      lineTotal: normalizeMoney(lineTotal),
      sortOrder: index,
    };
  });

  const totalAmount = preparedLines.reduce(
    (sum, line) => sum + parseFloat(line.lineTotal),
    0
  );

  return {
    customerId: customer.id,
    customerName: customer.name,
    requestedDate: payload.requestedDate ?? null,
    notes: payload.notes ?? null,
    totalAmount: normalizeMoney(totalAmount),
    preparedLines,
    affectedProductIds: preparedLines.map((line) => line.itemId),
    products,
  };
}

async function buildOversellWarning(
  preparedLines: PreparedOrderLine[],
  products: Map<string, ProductValidationRow>
) {
  const quantityByProduct = new Map<string, number>();

  for (const line of preparedLines) {
    quantityByProduct.set(
      line.itemId,
      roundQuantity(
        (quantityByProduct.get(line.itemId) ?? 0) + parseFloat(line.quantity)
      )
    );
  }

  const warningProducts = [...quantityByProduct.entries()]
    .map(([itemId, addedQty]) => {
      const product = products.get(itemId);
      if (!product) return null;

      const currentCommittedQty = parseFloat(product.committedQty);
      const projectedCommittedQty = roundQuantity(currentCommittedQty + addedQty);
      const calculatedStock = calcProjectedStock(product);
      const projectedCalculatedStock = roundQuantity(calculatedStock - addedQty);

      if (projectedCalculatedStock >= 0) {
        return null;
      }

      return {
        itemId: product.id,
        itemName: product.name,
        itemSku: product.sku,
        unitName: product.unitName,
        inStock: roundQuantity(parseFloat(product.stock)),
        committedQty: roundQuantity(currentCommittedQty),
        expectedQty: roundQuantity(parseFloat(product.expectedQty)),
        safetyStock: roundQuantity(parseFloat(product.safetyStock)),
        calculatedStock,
        addedQty: roundQuantity(addedQty),
        projectedCommittedQty,
        projectedCalculatedStock,
      };
    })
    .filter((product) => product != null);

  if (warningProducts.length === 0) {
    return null;
  }

  return { products: warningProducts };
}

export async function getCustomers(): Promise<CustomerRow[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        address: customers.address,
        notes: customers.notes,
        deletedAt: customers.deletedAt,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
      })
      .from(customers)
      .where(isNull(customers.deletedAt))
      .orderBy(asc(customers.name));
  });
}

export async function getCustomer(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<CustomerRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [eq(customers.id, id)];
    if (!options?.includeDeleted) {
      conditions.push(isNull(customers.deletedAt));
    }

    const [customer] = await tx
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        address: customers.address,
        notes: customers.notes,
        deletedAt: customers.deletedAt,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
      })
      .from(customers)
      .where(and(...conditions));

    return customer ?? null;
  });
}

export async function createCustomer(data: InsertCustomer) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: orgId,
        ...data,
      })
      .returning({ id: customers.id });

    return customer;
  });
}

export async function updateCustomer(id: string, data: UpdateCustomer) {
  return withAuthedOrgContext(async (tx) => {
    const [customer] = await tx
      .update(customers)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
      .returning({ id: customers.id });

    return customer ?? null;
  });
}

async function ensureCustomersDeletableInTx(tx: Tx, customerIds: string[]) {
  const uniqueCustomerIds = [...new Set(customerIds)];

  const [blockingOrder] = await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(
      and(
        inArray(salesOrders.customerId, uniqueCustomerIds),
        isNull(salesOrders.deletedAt),
        inArray(salesOrders.status, ["draft", "confirmed"])
      )
    )
    .limit(1);

  if (blockingOrder) {
    throw new SalesError(
      "Cannot delete customer with active draft or confirmed orders.",
      400
    );
  }

  return uniqueCustomerIds;
}

async function softDeleteCustomersInTx(tx: Tx, customerIds: string[]) {
  if (customerIds.length === 0) {
    return [];
  }

  return tx
    .update(customers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(customers.id, customerIds),
        isNull(customers.deletedAt)
      )
    )
    .returning({ id: customers.id });
}

export async function deleteCustomer(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const customerIds = await ensureCustomersDeletableInTx(tx, [id]);
    const [customer] = await softDeleteCustomersInTx(tx, customerIds);

    return { deleted: customer != null };
  });
}

export async function deleteCustomers(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const customerIds = await ensureCustomersDeletableInTx(tx, ids);
    const deletedCustomers = await softDeleteCustomersInTx(tx, customerIds);

    return { deletedCount: deletedCustomers.length };
  });
}

export async function getSalesOrderProductOptions(): Promise<SalesOrderProductOption[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        unitName: unitDefinitions.name,
        defaultSellingPrice: items.defaultSellingPrice,
        stock: stockSubquery,
        committedQty: items.committedQty,
        expectedQty: items.expectedQty,
        safetyStock: items.safetyStock,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(
        and(eq(items.itemType, "product"), isNull(items.deletedAt))
      )
      .orderBy(asc(items.name));
  });
}

export async function getSalesOrders(): Promise<SalesOrderListRow[]> {
  return withAuthedOrgContext(async (tx) => {
    const orderRows = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        customerName: salesOrders.customerName,
        status: salesOrders.status,
        requestedDate: salesOrders.requestedDate,
        fulfilledAt: salesOrders.fulfilledAt,
        totalAmount: salesOrders.totalAmount,
        deletedAt: salesOrders.deletedAt,
        createdAt: salesOrders.createdAt,
        updatedAt: salesOrders.updatedAt,
      })
      .from(salesOrders)
      .where(isNull(salesOrders.deletedAt))
      .orderBy(desc(salesOrders.createdAt));

    if (orderRows.length === 0) {
      return [];
    }

    const orderIds = orderRows.map((order) => order.id);
    const lines = await tx
      .select({
        salesOrderId: salesOrderLines.salesOrderId,
        itemName: salesOrderLines.itemName,
        sortOrder: salesOrderLines.sortOrder,
      })
      .from(salesOrderLines)
      .where(inArray(salesOrderLines.salesOrderId, orderIds))
      .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

    const linesByOrderId = new Map<string, Array<{ itemName: string }>>();
    lines.forEach((line) => {
      const bucket = linesByOrderId.get(line.salesOrderId) ?? [];
      bucket.push({ itemName: line.itemName });
      linesByOrderId.set(line.salesOrderId, bucket);
    });

    return orderRows.map((order) => {
      const orderLines = linesByOrderId.get(order.id) ?? [];
      return {
        ...order,
        status: order.status as SalesOrderListRow["status"],
        itemSummary: summarizeItems(orderLines),
      };
    });
  });
}

export async function getSalesOrder(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<SalesOrderDetail | null> {
  return withAuthedOrgContext(async (tx) => {
    const orderConditions = [eq(salesOrders.id, id)];
    if (!options?.includeDeleted) {
      orderConditions.push(isNull(salesOrders.deletedAt));
    }

    const [order] = await tx
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
        requestedDate: salesOrders.requestedDate,
        notes: salesOrders.notes,
        fulfilledAt: salesOrders.fulfilledAt,
        totalAmount: salesOrders.totalAmount,
        deletedAt: salesOrders.deletedAt,
        createdAt: salesOrders.createdAt,
        updatedAt: salesOrders.updatedAt,
      })
      .from(salesOrders)
      .where(and(...orderConditions));

    if (!order) {
      return null;
    }

    const lines = await tx
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        unitName: salesOrderLines.unitName,
        quantity: salesOrderLines.quantity,
        unitPrice: salesOrderLines.unitPrice,
        lineTotal: salesOrderLines.lineTotal,
        sortOrder: salesOrderLines.sortOrder,
        createdAt: salesOrderLines.createdAt,
        updatedAt: salesOrderLines.updatedAt,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, id))
      .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

    return {
      ...order,
      status: order.status as SalesOrderDetail["status"],
      lines: lines as SalesOrderDetailLine[],
    };
  });
}

export async function getEditableSalesOrder(id: string): Promise<SalesOrderEditData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        status: salesOrders.status,
        requestedDate: salesOrders.requestedDate,
        notes: salesOrders.notes,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "draft")
        )
      );

    if (!order) {
      return null;
    }

    const lines = await getOrderLinesInTx(tx, id);

    return {
      ...order,
      status: "draft",
      lines: lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    };
  });
}

export async function createSalesOrder(data: InsertSalesOrder) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const shouldCheckOversell =
      data.status === "confirmed" && data.confirmOversell !== true;
    const prepared = await prepareOrderPayload(tx, data, {
      lockProducts: shouldCheckOversell,
    });

    if (shouldCheckOversell) {
      const oversell = await buildOversellWarning(
        prepared.preparedLines,
        prepared.products
      );

      if (oversell) {
        throw new SalesError(
          "This confirmation would oversell one or more products.",
          409,
          { oversell }
        );
      }
    }

    const orderNumber = await generateOrderNumber(tx);
    const [order] = await tx
      .insert(salesOrders)
      .values({
        organizationId: orgId,
        orderNumber,
        customerId: prepared.customerId,
        customerName: prepared.customerName,
        status: data.status,
        requestedDate: prepared.requestedDate,
        notes: prepared.notes,
        totalAmount: prepared.totalAmount,
      })
      .returning({ id: salesOrders.id });

    await tx.insert(salesOrderLines).values(
      prepared.preparedLines.map((line) => ({
        salesOrderId: order.id,
        ...line,
      }))
    );

    await recomputeCommittedQty(tx, prepared.affectedProductIds);

    return order;
  });
}

export async function updateSalesOrder(id: string, data: UpdateSalesOrder) {
  return withAuthedOrgContext(async (tx) => {
    const existingOrder = await getLockedSalesOrderInTx(tx, id);

    if (!existingOrder) {
      return null;
    }

    const existingLines = await getOrderLinesInTx(tx, id);
    const existingProductIds = existingLines.map((line) => line.itemId);

    if (existingOrder.status === "confirmed") {
      if (!isCancelPayload(data)) {
        throw new SalesError("Confirmed orders cannot be edited.", 400);
      }

      await tx
        .update(salesOrders)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(salesOrders.id, id));

      await recomputeCommittedQty(tx, existingProductIds);
      return { id };
    }

    if (existingOrder.status === "cancelled") {
      throw new SalesError("Cancelled orders cannot be changed.", 400);
    }

    if (existingOrder.status === "fulfilled") {
      throw new SalesError("Fulfilled orders cannot be changed.", 400);
    }

    if (isCancelPayload(data)) {
      throw new SalesError("Draft orders cannot be cancelled.", 400);
    }

    const shouldCheckOversell =
      data.status === "confirmed" && data.confirmOversell !== true;
    const prepared = await prepareOrderPayload(tx, data, {
      lockProducts: shouldCheckOversell,
    });

    if (shouldCheckOversell) {
      const oversell = await buildOversellWarning(
        prepared.preparedLines,
        prepared.products
      );

      if (oversell) {
        throw new SalesError(
          "This confirmation would oversell one or more products.",
          409,
          { oversell }
        );
      }
    }

    await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));

    await tx.insert(salesOrderLines).values(
      prepared.preparedLines.map((line) => ({
        salesOrderId: id,
        ...line,
      }))
    );

    await tx
      .update(salesOrders)
      .set({
        customerId: prepared.customerId,
        customerName: prepared.customerName,
        status: data.status,
        requestedDate: prepared.requestedDate,
        notes: prepared.notes,
        totalAmount: prepared.totalAmount,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, id));

    await recomputeCommittedQty(tx, [
      ...existingProductIds,
      ...prepared.affectedProductIds,
    ]);

    return { id };
  });
}

export async function fulfillSalesOrder(id: string) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const order = await getLockedSalesOrderInTx(tx, id);

    if (!order) {
      return null;
    }

    if (order.status === "draft") {
      throw new SalesError("Only confirmed orders can be fulfilled.", 400);
    }

    if (order.status === "cancelled") {
      throw new SalesError("Cancelled orders cannot be fulfilled.", 400);
    }

    if (order.status === "fulfilled") {
      throw new SalesError("Order is already fulfilled.", 400);
    }

    const lines = await getOrderLinesInTx(tx, id);
    const affectedItemIds = lines.map((line) => line.itemId);

    await lockItemsInTx(tx, affectedItemIds);

    for (const line of lines) {
      try {
        await applyStockDeltaInTx(tx, {
          orgId,
          userId,
          itemId: line.itemId,
          delta: -parseFloat(line.quantity),
          movementType: "sales_fulfilled",
          referenceType: "sales_order",
          referenceId: id,
        });
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          throw new SalesError(
            `Cannot fulfill order. Insufficient stock for ${line.itemName}.`,
            409
          );
        }

        throw error;
      }
    }

    const fulfilledAt = new Date();
    const [fulfilled] = await tx
      .update(salesOrders)
      .set({
        status: "fulfilled",
        fulfilledAt,
        updatedAt: fulfilledAt,
      })
      .where(eq(salesOrders.id, id))
      .returning({ id: salesOrders.id });

    await recomputeCommittedQty(tx, affectedItemIds);

    return fulfilled;
  });
}

export async function deleteSalesOrder(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedSalesOrderInTx(tx, id);

    if (!order) {
      return { deleted: false };
    }

    const existingLines = await getOrderLinesInTx(tx, id);
    const deletedAt = new Date();

    await tx
      .update(salesOrders)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(eq(salesOrders.id, id));

    await recomputeCommittedQty(
      tx,
      existingLines.map((line) => line.itemId)
    );

    return { deleted: true };
  });
}

export async function deleteSalesOrders(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const uniqueIds = [...new Set(ids)];

    const orders = await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(
        and(
          inArray(salesOrders.id, uniqueIds),
          isNull(salesOrders.deletedAt)
        )
      );

    if (orders.length === 0) {
      return { deletedCount: 0 };
    }

    const orderIds = orders.map((o) => o.id);

    const lines = await tx
      .select({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(inArray(salesOrderLines.salesOrderId, orderIds));

    const affectedItemIds = lines.map((l) => l.itemId);
    const deletedAt = new Date();

    await tx
      .update(salesOrders)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(inArray(salesOrders.id, orderIds));

    await recomputeCommittedQty(tx, affectedItemIds);

    return { deletedCount: orders.length };
  });
}
