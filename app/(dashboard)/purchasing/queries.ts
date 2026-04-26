import "server-only";

import { normalizeNumeric, summarizeItems } from "@/lib/format";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  items,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeStockUnitCost } from "@/lib/inventory/cost";
import {
  lockItemsInTx,
} from "@/lib/inventory/kernel/locking";
import {
  addExpectedFromPurchaseInTx,
  beginInventoryOperationInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  receivePurchaseStockInTx,
  releaseExpectedFromPurchaseInTx,
} from "@/lib/inventory/kernel";
import {
  DomainError,
  type DomainFieldErrors,
} from "@/lib/errors/domain-error";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type {
  InsertPurchaseOrder,
  PurchaseOrderStatus,
  ReceivePurchaseOrder,
  UpdatePurchaseOrder,
} from "@/lib/schemas/purchase-orders";
import type { InsertSupplier, UpdateSupplier } from "@/lib/schemas/suppliers";
import type {
  PurchaseOrderDetail,
  PurchaseOrderDetailLine,
  PurchaseOrderEditData,
  PurchaseOrderListRow,
  PurchaseOrderMaterialOption,
  SupplierRow,
} from "./types";

type PreparedPurchaseOrderLine = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  purchaseUnitName: string;
  stockingUnitName: string;
  purchaseToStockFactor: string;
  quantityOrdered: string;
  quantityReceived: string;
  stockQuantityOrdered: string;
  stockQuantityReceived: string;
  unitCost: string;
  stockUnitCost: string;
  lineTotal: string;
  sortOrder: number;
};

type MaterialValidationRow = {
  id: string;
  name: string;
  sku: string | null;
  stockingUnitName: string;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  defaultPurchasePrice: string | null;
  currentStockUnitCost: string | null;
};

export class PurchasingError extends DomainError {
  errors?: Record<string, string[]>;

  constructor(
    message: string,
    status = 400,
    options?: { errors?: Record<string, string[]> }
  ) {
    const errors: DomainFieldErrors | undefined = options?.errors;

    super(message, status, {
      name: "PurchasingError",
      errors,
    });

    this.errors = options?.errors;
  }
}

async function getLockedPurchaseOrderInTx(tx: Tx, id: string) {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

async function generateOrderNumber(tx: Tx) {
  const result = await tx.execute(
    sql`SELECT nextval('purchasing.order_number_seq') AS val`
  );
  const raw = (result.rows[0] as { val: string | number }).val;
  const sequenceValue = Number(raw);
  const year = new Date().getFullYear();
  return `PO-${year}-${String(sequenceValue).padStart(4, "0")}`;
}

async function getValidatedSupplierInTx(tx: Tx, supplierId: string) {
  const [supplier] = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
    })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)));

  if (!supplier) {
    throw new PurchasingError("Supplier not found", 404, {
      errors: {
        supplierId: ["Select an active supplier"],
      },
    });
  }

  return supplier;
}

async function getValidatedMaterialsInTx(tx: Tx, itemIds: string[]) {
  const uniqueIds = [...new Set(itemIds)];

  const rows = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      stockingUnitName: unitDefinitions.name,
      purchaseUnitName: sql<string | null>`(
        SELECT ${unitDefinitions.name}
        FROM ${unitDefinitions}
        WHERE ${unitDefinitions.id} = ${items.purchaseUnitDefinitionId}
      )`,
      purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
        "purchaseToStockFactor"
      ),
      defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
        "defaultPurchasePrice"
      ),
      currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
        "currentStockUnitCost"
      ),
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        inArray(items.id, uniqueIds),
        eq(items.itemType, "material"),
        isNull(items.deletedAt)
      )
    );

  const itemMap = new Map(rows.map((row) => [row.id, row as MaterialValidationRow]));

  if (itemMap.size !== uniqueIds.length) {
    throw new PurchasingError("Material not found", 404);
  }

  return itemMap;
}

async function getPurchaseOrderLinesInTx(tx: Tx, purchaseOrderId: string) {
  return tx
    .select({
      id: purchaseOrderLines.id,
      itemId: purchaseOrderLines.itemId,
      itemName: purchaseOrderLines.itemName,
      itemSku: purchaseOrderLines.itemSku,
      purchaseUnitName: purchaseOrderLines.purchaseUnitName,
      stockingUnitName: purchaseOrderLines.stockingUnitName,
      purchaseToStockFactor: trimScale(purchaseOrderLines.purchaseToStockFactor).as(
        "purchaseToStockFactor"
      ),
      quantityOrdered: trimScale(purchaseOrderLines.quantityOrdered).as("quantityOrdered"),
      quantityReceived: trimScale(purchaseOrderLines.quantityReceived).as("quantityReceived"),
      stockQuantityOrdered: trimScale(purchaseOrderLines.stockQuantityOrdered).as(
        "stockQuantityOrdered"
      ),
      stockQuantityReceived: trimScale(purchaseOrderLines.stockQuantityReceived).as(
        "stockQuantityReceived"
      ),
      unitCost: trimScale(purchaseOrderLines.unitCost).as("unitCost"),
      stockUnitCost: trimScale(purchaseOrderLines.stockUnitCost).as("stockUnitCost"),
      lineTotal: trimScale(purchaseOrderLines.lineTotal).as("lineTotal"),
      sortOrder: purchaseOrderLines.sortOrder,
      createdAt: purchaseOrderLines.createdAt,
      updatedAt: purchaseOrderLines.updatedAt,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
    .orderBy(asc(purchaseOrderLines.sortOrder), asc(purchaseOrderLines.createdAt));
}

async function preparePurchaseOrderPayload(
  tx: Tx,
  payload: InsertPurchaseOrder | UpdatePurchaseOrder
): Promise<{
  supplierId: string;
  supplierName: string;
  expectedDate: string | null;
  notes: string | null;
  totalAmount: string;
  preparedLines: PreparedPurchaseOrderLine[];
  affectedItemIds: string[];
}> {
  const supplier = await getValidatedSupplierInTx(tx, payload.supplierId);
  const materials = await getValidatedMaterialsInTx(
    tx,
    payload.lines.map((line) => line.itemId)
  );

  const preparedLines = payload.lines.map((line, index) => {
    const material = materials.get(line.itemId);

    if (!material) {
      throw new PurchasingError("Material not found", 404);
    }

    const quantityOrdered = Number(line.quantityOrdered);
    const unitCost = Number(line.unitCost);
    const lineTotal = quantityOrdered * unitCost;
    const purchaseToStockFactor = Number(material.purchaseToStockFactor ?? "1");
    const stockQuantityOrdered = quantityOrdered * purchaseToStockFactor;
    const stockUnitCost = unitCost / purchaseToStockFactor;

    return {
      itemId: material.id,
      itemName: material.name,
      itemSku: material.sku,
      purchaseUnitName: material.purchaseUnitName ?? material.stockingUnitName,
      stockingUnitName: material.stockingUnitName,
      purchaseToStockFactor: normalizeNumeric(purchaseToStockFactor),
      quantityOrdered: normalizeNumeric(quantityOrdered),
      quantityReceived: "0",
      stockQuantityOrdered: normalizeNumeric(stockQuantityOrdered),
      stockQuantityReceived: "0",
      unitCost: normalizeNumeric(unitCost),
      stockUnitCost: normalizeStockUnitCost(stockUnitCost),
      lineTotal: normalizeNumeric(lineTotal),
      sortOrder: index,
    };
  });

  const totalAmount = preparedLines.reduce(
    (sum, line) => sum + parseFloat(line.lineTotal),
    0
  );

  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    expectedDate: payload.expectedDate,
    notes: payload.notes,
    totalAmount: normalizeNumeric(totalAmount),
    preparedLines,
    affectedItemIds: preparedLines.map((line) => line.itemId),
  };
}

async function ensureSuppliersDeletableInTx(tx: Tx, supplierIds: string[]) {
  const uniqueSupplierIds = [...new Set(supplierIds)];

  const [blockingOrder] = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        inArray(purchaseOrders.supplierId, uniqueSupplierIds),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrders.status, ["draft", "ordered", "partial"])
      )
    )
    .limit(1);

  if (blockingOrder) {
    throw new PurchasingError(
      "Cannot delete supplier with active draft, ordered, or partially received purchase orders.",
      400
    );
  }

  return uniqueSupplierIds;
}

async function softDeleteSuppliersInTx(tx: Tx, supplierIds: string[]) {
  if (supplierIds.length === 0) {
    return [];
  }

  return tx
    .update(suppliers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(inArray(suppliers.id, supplierIds), isNull(suppliers.deletedAt)))
    .returning({ id: suppliers.id });
}

const supplierRowSelect = {
  id: suppliers.id,
  name: suppliers.name,
  code: suppliers.code,
  contactName: suppliers.contactName,
  email: suppliers.email,
  phone: suppliers.phone,
  billingLine1: suppliers.billingLine1,
  billingLine2: suppliers.billingLine2,
  billingCity: suppliers.billingCity,
  billingRegion: suppliers.billingRegion,
  billingPostcode: suppliers.billingPostcode,
  billingCountry: suppliers.billingCountry,
  xeroContactId: suppliers.xeroContactId,
  paymentTerms: suppliers.paymentTerms,
  notes: suppliers.notes,
  deletedAt: suppliers.deletedAt,
  createdAt: suppliers.createdAt,
  updatedAt: suppliers.updatedAt,
} as const;

export async function getSuppliers(): Promise<SupplierRow[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select(supplierRowSelect)
      .from(suppliers)
      .where(isNull(suppliers.deletedAt))
      .orderBy(asc(suppliers.name));
  });
}

export async function getSupplier(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<SupplierRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [eq(suppliers.id, id)];

    if (!options?.includeDeleted) {
      conditions.push(isNull(suppliers.deletedAt));
    }

    const [supplier] = await tx
      .select(supplierRowSelect)
      .from(suppliers)
      .where(and(...conditions));

    return supplier ?? null;
  });
}

export async function createSupplier(data: InsertSupplier) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [supplier] = await tx
      .insert(suppliers)
      .values({
        organizationId: orgId,
        ...data,
      })
      .returning({ id: suppliers.id });

    return supplier;
  });
}

export async function updateSupplier(id: string, data: UpdateSupplier) {
  return withAuthedOrgContext(async (tx) => {
    const [supplier] = await tx
      .update(suppliers)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .returning({ id: suppliers.id });

    return supplier ?? null;
  });
}

export async function deleteSupplier(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const supplierIds = await ensureSuppliersDeletableInTx(tx, [id]);
    const [supplier] = await softDeleteSuppliersInTx(tx, supplierIds);
    return { deleted: supplier != null };
  });
}

export async function deleteSuppliers(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const supplierIds = await ensureSuppliersDeletableInTx(tx, ids);
    const deletedSuppliers = await softDeleteSuppliersInTx(tx, supplierIds);
    return { deletedCount: deletedSuppliers.length };
  });
}

export async function getPurchaseOrderMaterialOptions(): Promise<
  PurchaseOrderMaterialOption[]
> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        stockingUnitName: unitDefinitions.name,
        purchaseUnitName: sql<string | null>`(
          SELECT ${unitDefinitions.name}
          FROM ${unitDefinitions}
          WHERE ${unitDefinitions.id} = ${items.purchaseUnitDefinitionId}
        )`,
        purchaseToStockFactor: trimScaleNullable(items.purchaseToStockFactor).as(
          "purchaseToStockFactor"
        ),
        defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
          "defaultPurchasePrice"
        ),
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.itemType, "material"), isNull(items.deletedAt)))
      .orderBy(asc(items.name));
  });
}

export async function getPurchaseOrders(): Promise<PurchaseOrderListRow[]> {
  return measureObservedOperation(
    "purchasing.get_orders",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const orderRows = await tx
          .select({
            id: purchaseOrders.id,
            orderNumber: purchaseOrders.orderNumber,
            supplierName: purchaseOrders.supplierName,
            status: purchaseOrders.status,
            expectedDate: purchaseOrders.expectedDate,
            totalAmount: trimScale(purchaseOrders.totalAmount).as("totalAmount"),
            deletedAt: purchaseOrders.deletedAt,
            createdAt: purchaseOrders.createdAt,
            updatedAt: purchaseOrders.updatedAt,
            receivedAt: purchaseOrders.receivedAt,
          })
          .from(purchaseOrders)
          .where(isNull(purchaseOrders.deletedAt))
          .orderBy(desc(purchaseOrders.createdAt));

        if (orderRows.length === 0) {
          return [];
        }

        const orderIds = orderRows.map((order) => order.id);
        const lines = await tx
          .select({
            purchaseOrderId: purchaseOrderLines.purchaseOrderId,
            itemName: purchaseOrderLines.itemName,
            quantity: trimScale(purchaseOrderLines.quantityOrdered).as("quantity"),
            sortOrder: purchaseOrderLines.sortOrder,
          })
          .from(purchaseOrderLines)
          .where(inArray(purchaseOrderLines.purchaseOrderId, orderIds))
          .orderBy(asc(purchaseOrderLines.sortOrder), asc(purchaseOrderLines.createdAt));

        const linesByOrderId = new Map<
          string,
          Array<{ itemName: string; quantity: string }>
        >();
        lines.forEach((line) => {
          const bucket = linesByOrderId.get(line.purchaseOrderId) ?? [];
          bucket.push({ itemName: line.itemName, quantity: line.quantity });
          linesByOrderId.set(line.purchaseOrderId, bucket);
        });

        return orderRows.map((order) => ({
          ...order,
          status: order.status as PurchaseOrderStatus,
          itemSummary: summarizeItems(linesByOrderId.get(order.id) ?? []),
        }));
      });
    },
    {
      successData: (orders) => ({
        rowCount: orders.length,
      }),
    }
  );
}

export async function getPurchaseOrder(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<PurchaseOrderDetail | null> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [eq(purchaseOrders.id, id)];

    if (!options?.includeDeleted) {
      conditions.push(isNull(purchaseOrders.deletedAt));
    }

    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        supplierId: purchaseOrders.supplierId,
        supplierName: purchaseOrders.supplierName,
        orderNumber: purchaseOrders.orderNumber,
        status: purchaseOrders.status,
        expectedDate: purchaseOrders.expectedDate,
        notes: purchaseOrders.notes,
        totalAmount: trimScale(purchaseOrders.totalAmount).as("totalAmount"),
        orderedAt: purchaseOrders.orderedAt,
        receivedAt: purchaseOrders.receivedAt,
        cancelledAt: purchaseOrders.cancelledAt,
        xeroPurchaseOrderId: purchaseOrders.xeroPurchaseOrderId,
        xeroPurchaseOrderNumber: purchaseOrders.xeroPurchaseOrderNumber,
        xeroPushStatus: purchaseOrders.xeroPushStatus,
        xeroPushError: purchaseOrders.xeroPushError,
        xeroPushedAt: purchaseOrders.xeroPushedAt,
        xeroPushPayloadHash: purchaseOrders.xeroPushPayloadHash,
        xeroLastPushAttemptAt: purchaseOrders.xeroLastPushAttemptAt,
        xeroRetryCount: purchaseOrders.xeroRetryCount,
        xeroPoEmailStatus: purchaseOrders.xeroPoEmailStatus,
        xeroPoEmailError: purchaseOrders.xeroPoEmailError,
        xeroPoEmailedAt: purchaseOrders.xeroPoEmailedAt,
        deletedAt: purchaseOrders.deletedAt,
        createdAt: purchaseOrders.createdAt,
        updatedAt: purchaseOrders.updatedAt,
      })
      .from(purchaseOrders)
      .where(and(...conditions));

    if (!order) {
      return null;
    }

    const lines = await getPurchaseOrderLinesInTx(tx, id);

    return {
      ...order,
      status: order.status as PurchaseOrderStatus,
      xeroPushStatus:
        order.xeroPushStatus as PurchaseOrderDetail["xeroPushStatus"],
      xeroPoEmailStatus:
        order.xeroPoEmailStatus as PurchaseOrderDetail["xeroPoEmailStatus"],
      lines: lines.map((line) => ({
        ...line,
        quantityRemaining: normalizeNumeric(
          parseFloat(line.quantityOrdered) - parseFloat(line.quantityReceived)
        ),
        stockQuantityRemaining: normalizeNumeric(
          parseFloat(line.stockQuantityOrdered) - parseFloat(line.stockQuantityReceived)
        ),
      })) as PurchaseOrderDetailLine[],
    };
  });
}

export async function getEditablePurchaseOrder(
  id: string
): Promise<PurchaseOrderEditData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        supplierId: purchaseOrders.supplierId,
        status: purchaseOrders.status,
        expectedDate: purchaseOrders.expectedDate,
        notes: purchaseOrders.notes,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          isNull(purchaseOrders.deletedAt),
          eq(purchaseOrders.status, "draft")
        )
      );

    if (!order) {
      return null;
    }

    const lines = await getPurchaseOrderLinesInTx(tx, id);

    return {
      ...order,
      status: "draft",
      lines: lines.map((line) => ({
        itemId: line.itemId,
        quantityOrdered: line.quantityOrdered,
        unitCost: line.unitCost,
      })),
    };
  });
}

export async function createPurchaseOrder(data: InsertPurchaseOrder) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const prepared = await preparePurchaseOrderPayload(tx, data);
    const orderNumber = await generateOrderNumber(tx);

    const [order] = await tx
      .insert(purchaseOrders)
      .values({
        organizationId: orgId,
        orderNumber,
        supplierId: prepared.supplierId,
        supplierName: prepared.supplierName,
        status: "draft",
        expectedDate: prepared.expectedDate,
        notes: prepared.notes,
        totalAmount: prepared.totalAmount,
      })
      .returning({ id: purchaseOrders.id });

    await tx.insert(purchaseOrderLines).values(
      prepared.preparedLines.map((line) => ({
        purchaseOrderId: order.id,
        ...line,
      }))
    );

    return order;
  });
}

export async function updatePurchaseOrder(id: string, data: UpdatePurchaseOrder) {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      return null;
    }

    if (order.status !== "draft") {
      throw new PurchasingError("Only draft purchase orders can be edited.", 400);
    }

    const prepared = await preparePurchaseOrderPayload(tx, data);

    await tx
      .delete(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, id));

    await tx.insert(purchaseOrderLines).values(
      prepared.preparedLines.map((line) => ({
        purchaseOrderId: id,
        ...line,
      }))
    );

    await tx
      .update(purchaseOrders)
      .set({
        supplierId: prepared.supplierId,
        supplierName: prepared.supplierName,
        expectedDate: prepared.expectedDate,
        notes: prepared.notes,
        totalAmount: prepared.totalAmount,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    return { id };
  });
}

export async function submitPurchaseOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "submitPurchaseOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
    });

    if (replay.replayed) {
      return {
        replayed: true as const,
        submitted: replay.result,
        orgId,
      };
    }

    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return {
        replayed: false as const,
        submitted: null,
        orgId,
      };
    }

    if (order.status !== "draft") {
      throw new PurchasingError("Only draft purchase orders can be submitted.", 400);
    }

    const lines = await getPurchaseOrderLinesInTx(tx, id);

    await tx
      .update(purchaseOrders)
      .set({
        status: "ordered",
        orderedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await addExpectedFromPurchaseInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "submit-order"
      ),
      lines: lines.map((line) => ({
        purchaseOrderLineId: line.id,
        itemId: line.itemId,
        quantity: parseFloat(line.stockQuantityOrdered),
      })),
    });

    const submitted = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: submitted,
    });

    return {
      replayed: false as const,
      submitted,
      orgId,
    };
  });

  if (!result.submitted) {
    return null;
  }

  if (result.replayed) {
    return result.submitted;
  }

  // Stock + expected-supply tx has committed. Attempt the Xero PO push;
  // a failure must NOT roll back the submit — the order is ordered
  // regardless of accounting state.
  const { pushPurchaseOrderToXero, markXeroPurchaseOrderPushFailed } =
    await import("@/lib/xero/push-purchase-order");
  const { XeroError } = await import("@/lib/xero/errors");

  try {
    await pushPurchaseOrderToXero(result.orgId, id);
  } catch (error) {
    if (
      error instanceof XeroError &&
      (error.message.includes("not connected") ||
        error.status === 409 ||
        error.status === 500)
    ) {
      if (!error.message.includes("not connected")) {
        await markXeroPurchaseOrderPushFailed(result.orgId, id, error);
      }
    } else {
      await markXeroPurchaseOrderPushFailed(result.orgId, id, error);
    }
  }

  return result.submitted;
}

export async function retryXeroPushForPurchaseOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { pushPurchaseOrderToXero, markXeroPurchaseOrderPushFailed } =
      await import("@/lib/xero/push-purchase-order");
    const { XeroError } = await import("@/lib/xero/errors");

    try {
      const result = await pushPurchaseOrderToXero(orgId, id);
      return { ok: true as const, result };
    } catch (error) {
      if (error instanceof XeroError && (error.status === 404 || error.status === 409)) {
        throw error;
      }

      await markXeroPurchaseOrderPushFailed(orgId, id, error);
      throw error;
    }
  });
}

export async function retryXeroEmailForPurchaseOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { emailPurchaseOrderForOrder } = await import(
      "@/lib/xero/push-purchase-order"
    );
    const result = await emailPurchaseOrderForOrder(orgId, id);
    return { ok: true as const, result };
  });
}

export async function receivePurchaseOrder(
  id: string,
  data: ReceivePurchaseOrder,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "receivePurchaseOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, data },
    });

    if (replay.replayed) {
      return replay.result;
    }

    // Lock the PO row first to prevent concurrent receipts from
    // reading stale quantityReceived values on the lines.
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .for("update");

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (!["ordered", "partial"].includes(order.status)) {
      throw new PurchasingError(
        "Only ordered or partially received purchase orders can be received.",
        400
      );
    }

    const existingLines = await getPurchaseOrderLinesInTx(tx, id);
    const lineMap = new Map(existingLines.map((line) => [line.id, line]));
    const seenLineIds = new Set<string>();

    const receiveEntries = data.lines.map((line, index) => {
      if (seenLineIds.has(line.lineId)) {
        throw new PurchasingError("Duplicate receipt line", 400, {
          errors: {
            [`lines.${index}.quantityReceived`]: [
              "Each line can only be received once per submission",
            ],
          },
        });
      }
      seenLineIds.add(line.lineId);

      const existingLine = lineMap.get(line.lineId);

      if (!existingLine) {
        throw new PurchasingError("Purchase order line not found", 404, {
          errors: {
            [`lines.${index}.quantityReceived`]: ["Select a valid purchase order line"],
          },
        });
      }

      const quantityReceived = Number(line.quantityReceived);
      const remaining =
        parseFloat(existingLine.quantityOrdered) -
        parseFloat(existingLine.quantityReceived);

      if (quantityReceived > remaining) {
        throw new PurchasingError("Cannot receive more than remaining quantity.", 400, {
          errors: {
            [`lines.${index}.quantityReceived`]: [
              `Must be ${normalizeNumeric(remaining)} or less`,
            ],
          },
        });
      }

      const stockQuantityReceived = parseFloat(
        normalizeNumeric(quantityReceived * parseFloat(existingLine.purchaseToStockFactor))
      );

      return {
        line: existingLine,
        quantityReceived,
        stockQuantityReceived,
        disposition: line.disposition,
      };
    });

    await getValidatedMaterialsInTx(
      tx,
      receiveEntries.map((entry) => entry.line.itemId)
    );

    await lockItemsInTx(
      tx,
      existingLines.map((line) => line.itemId)
    );

    const updatedLines = new Map(
      existingLines.map((line) => [line.id, { ...line }])
    );

    for (const entry of receiveEntries) {
      const currentLine = updatedLines.get(entry.line.id);

      if (!currentLine) {
        continue;
      }

      const newQuantityReceived =
        parseFloat(currentLine.quantityReceived) + entry.quantityReceived;
      const newStockQuantityReceived =
        parseFloat(currentLine.stockQuantityReceived) + entry.stockQuantityReceived;

      const normalizedReceived = normalizeNumeric(newQuantityReceived);
      const normalizedStockReceived = normalizeNumeric(newStockQuantityReceived);

      await tx
        .update(purchaseOrderLines)
        .set({
          quantityReceived: normalizedReceived,
          stockQuantityReceived: normalizedStockReceived,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrderLines.id, currentLine.id));

      updatedLines.set(currentLine.id, {
        ...currentLine,
        quantityReceived: normalizedReceived,
        stockQuantityReceived: normalizedStockReceived,
        updatedAt: new Date(),
      });
    }

    await receivePurchaseStockInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "receive-stock"
      ),
      lines: receiveEntries.map((entry) => ({
        purchaseOrderLineId: entry.line.id,
        itemId: entry.line.itemId,
        quantity: entry.stockQuantityReceived,
        unitCost: entry.line.stockUnitCost,
        disposition: entry.disposition,
      })),
    });

    const allReceived = [...updatedLines.values()].every(
      (line) => parseFloat(line.quantityReceived) >= parseFloat(line.quantityOrdered)
    );

    await tx
      .update(purchaseOrders)
      .set({
        status: allReceived ? "received" : "partial",
        receivedAt: allReceived ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    const result = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function cancelPurchaseOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "cancelPurchaseOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    if (!["ordered", "partial"].includes(order.status)) {
      throw new PurchasingError(
        "Only ordered or partially received purchase orders can be cancelled.",
        400
      );
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    await releaseExpectedFromPurchaseInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "cancel-order"
      ),
      reason: "cancelled",
    });

    const result = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function deletePurchaseOrder(
  id: string
): Promise<{ deleted: boolean; error?: string }> {
  return withAuthedOrgContext(async (tx) => {
    const order = await getLockedPurchaseOrderInTx(tx, id);

    if (!order) {
      return { deleted: false };
    }

    if (["ordered", "partial"].includes(order.status)) {
      return {
        deleted: false,
        error:
          "Ordered or partially received purchase orders must be cancelled or fully received before deleting.",
      };
    }

    await tx
      .update(purchaseOrders)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    return { deleted: true };
  });
}

export async function deletePurchaseOrders(
  ids: string[]
): Promise<{ deletedCount: number; error?: string }> {
  return withAuthedOrgContext(async (tx) => {
    const uniqueIds = [...new Set(ids)];

    // Lock all candidate rows so status can't change between check and delete
    const orders = await tx
      .select({ id: purchaseOrders.id, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(
        and(
          inArray(purchaseOrders.id, uniqueIds),
          isNull(purchaseOrders.deletedAt)
        )
      )
      .for("update");

    const activeOrder = orders.find((o) =>
      ["ordered", "partial"].includes(o.status)
    );

    if (activeOrder) {
      return {
        deletedCount: 0,
        error:
          "Ordered or partially received purchase orders must be cancelled or fully received before deleting.",
      };
    }

    if (orders.length === 0) {
      return { deletedCount: 0 };
    }

    const orderIds = orders.map((o) => o.id);
    const deletedAt = new Date();

    const deleted = await tx
      .update(purchaseOrders)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(inArray(purchaseOrders.id, orderIds))
      .returning({ id: purchaseOrders.id });

    return { deletedCount: deleted.length };
  });
}
