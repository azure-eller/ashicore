import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeNumeric, normalizeQuantityNumber, roundQuantity } from "@/lib/format";
import { customers, manufacturingOrderOutputs, manufacturingOrderIngredients, manufacturingOrders, salesOrderLines, salesOrders } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { lockSalesPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import { beginInventoryOperationInTx, consumeForSalesOrderShippingInTx, deriveInventoryIdempotencyKey, finishInventoryOperationInTx, getCurrentAvailableOnHandQtyAtLocationInTx, InsufficientStockError, LinkedManufacturingOutputUnavailableError, resolveInventoryLocationInTx } from "@/lib/inventory/kernel";
import { completeManufacturingOrder } from "@/lib/manufacturing/queries/completion";
import { ManufacturingError } from "@/lib/manufacturing/queries/errors";
import { recordManufacturingOutput } from "@/lib/manufacturing/queries/output";
import type { ShipSalesOrder } from "@/lib/schemas/sales-orders";
import type { NegativeStockWarningPayload } from "../types";
import { demandQueueCoverageKey, getDemandQueueInventoryLotClaimConflicts, getDemandQueueCoverageForItemsInTx } from "@/lib/inventory/allocation/demand-queue";
import { SalesError } from "./errors";
import { withSalesTransactionRetry, rerankOpenSalesOrdersInTx, getOrderLinesInTx, getLockedSalesOrderInTx, type SalesOrderLineShipState, normalizeShipQuantity, getSalesOrderLineShipStatesInTx } from "./shared";

function remainingToShip(line: SalesOrderLineShipState) {
  return normalizeShipQuantity(
    line.quantity - line.shippedQuantity - line.cancelledQuantity
  );
}

async function buildStockWarningPayloadInTx(
  _tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    itemName: string;
    available: number;
    requested: number;
    excludeSalesOrderLineIds: string[];
  }
): Promise<NegativeStockWarningPayload> {
  const shortage = Math.max(0, params.requested - params.available);

  return {
    itemId: params.itemId,
    itemName: params.itemName,
    available: params.available,
    requested: params.requested,
    shortage,
    reason: "negative_stock",
  };
}

async function resolveDemandQueueConflictsInTx(
  tx: Tx,
  candidates: Array<{
    demandType: "sales_order_line" | "manufacturing_order_ingredient";
    demandId: string;
    label: string;
    contextLabel: string | null;
    quantity: number;
    href: string | null;
  }>
): Promise<NonNullable<NegativeStockWarningPayload["conflicts"]>> {
  const salesDemandIds = candidates
    .filter((candidate) => candidate.demandType === "sales_order_line")
    .map((candidate) => candidate.demandId);
  const manufacturingDemandIds = candidates
    .filter((candidate) => candidate.demandType === "manufacturing_order_ingredient")
    .map((candidate) => candidate.demandId);

  const salesRows =
    salesDemandIds.length > 0
      ? await tx
          .select({
            demandId: salesOrderLines.id,
            orderId: salesOrders.id,
            orderNumber: salesOrders.orderNumber,
            customerName: salesOrders.customerName,
          })
          .from(salesOrderLines)
          .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
          .where(inArray(salesOrderLines.id, salesDemandIds))
      : [];
  const manufacturingRows =
    manufacturingDemandIds.length > 0
      ? await tx
          .select({
            demandId: manufacturingOrderIngredients.id,
            orderId: manufacturingOrders.id,
            orderNumber: manufacturingOrders.orderNumber,
            productName: manufacturingOrders.productName,
          })
          .from(manufacturingOrderIngredients)
          .innerJoin(
            manufacturingOrders,
            eq(manufacturingOrders.id, manufacturingOrderIngredients.manufacturingOrderId)
          )
          .where(inArray(manufacturingOrderIngredients.id, manufacturingDemandIds))
      : [];

  const salesByDemandId = new Map(salesRows.map((row) => [row.demandId, row]));
  const manufacturingByDemandId = new Map(
    manufacturingRows.map((row) => [row.demandId, row])
  );

  const conflicts: NonNullable<NegativeStockWarningPayload["conflicts"]> = [];
  for (const candidate of candidates) {
    if (candidate.demandType === "sales_order_line") {
      const row = salesByDemandId.get(candidate.demandId);
      if (!row) continue;
      conflicts.push({
        referenceType: "sales_order",
        referenceId: row.orderId,
        label: `${row.orderNumber} ${row.customerName}`,
        quantity: candidate.quantity,
        href: `/sales/orders/${row.orderId}`,
      });
      continue;
    }

    const row = manufacturingByDemandId.get(candidate.demandId);
    if (!row) continue;
    conflicts.push({
      referenceType: "manufacturing_order",
      referenceId: row.orderId,
      label: `${row.orderNumber} ${row.productName}`,
      quantity: candidate.quantity,
      href: `/manufacturing/orders/${row.orderId}`,
    });
  }

  return conflicts;
}

async function buildDemandQueueShippingWarningInTx(
  tx: Tx,
  params: {
    organizationId: string;
    lines: Array<{
      salesOrderLineId: string;
      itemId: string;
      itemName: string;
      quantity: number;
    }>;
  }
): Promise<NegativeStockWarningPayload | null> {
  const coverageByItem = new Map(
    (
      await getDemandQueueCoverageForItemsInTx(tx, {
        organizationId: params.organizationId,
        itemIds: params.lines.map((line) => line.itemId),
        includeManufacturingDetail: true,
      })
    ).map((coverage) => [coverage.itemId, coverage])
  );

  for (const line of params.lines) {
    const itemCoverage = coverageByItem.get(line.itemId);
    const lineCoverage = itemCoverage?.demands.find(
      (demand) =>
        demandQueueCoverageKey(demand) ===
        demandQueueCoverageKey({
          demandType: "sales_order_line",
          demandId: line.salesOrderLineId,
        })
    );
    const available = roundQuantity(Number(lineCoverage?.inStockQty ?? 0));
    if (available >= line.quantity) continue;

    const conflictCandidates = getDemandQueueInventoryLotClaimConflicts({
      coverage: itemCoverage,
      excludeDemand: {
        demandType: "sales_order_line",
        demandId: line.salesOrderLineId,
      },
      quantity: roundQuantity(line.quantity - available),
    });
    const conflicts = await resolveDemandQueueConflictsInTx(
      tx,
      conflictCandidates
    );
    const claimedByHigherPriority = roundQuantity(
      conflicts.reduce((sum, conflict) => sum + conflict.quantity, 0)
    );
    const shortage = roundQuantity(line.quantity - available);
    const reason =
      claimedByHigherPriority <= 0
        ? "negative_stock"
        : claimedByHigherPriority >= shortage
          ? "queue_conflict"
          : "queue_conflict_and_negative_stock";

    return {
      itemId: line.itemId,
      itemName: line.itemName,
      available,
      requested: line.quantity,
      shortage,
      reason,
      claimedByHigherPriority,
      conflicts: conflicts.slice(0, 5),
    };
  }

  return null;
}

export async function shipSalesOrder(
  id: string,
  options?: {
    idempotencyKey?: string;
  } & ShipSalesOrder
) {
  if (options?.completeLinkedManufacturing === true) {
    await completeLinkedManufacturingForFullOrderShip(id, options);
  }

  const result = await withSalesTransactionRetry(() => withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{
      id: string;
      status: string;
    } | null>(tx, {
      organizationId: orgId,
      operationName: "shipSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: {
        id,
        locationId: options?.locationId ?? null,
        syncAccounting: options?.syncAccounting ?? true,
        confirmNegativeStock: options?.confirmNegativeStock ?? false,
        completeLinkedManufacturing: options?.completeLinkedManufacturing ?? false,
        lines: options?.lines ?? null,
      },
    });

    if (replay.replayed) {
      return {
        replayed: true as const,
        shipped: replay.result,
        orgId,
      };
    }

    await lockSalesPriorityQueueInTx(tx, orgId);
    const order = await getLockedSalesOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return {
        replayed: false as const,
        shipped: null,
        orgId,
      };
    }

    if (order.status === "done") {
      throw new SalesError("Order is already shipped.", 400);
    }

    if (order.status !== "open") {
      throw new SalesError("Only open orders can be shipped.", 400);
    }

    const lines = await getOrderLinesInTx(tx, id);
    const states = await getSalesOrderLineShipStatesInTx(tx, id);
    const orderLinesById = new Map(lines.map((line) => [line.id, line]));
    const linesToShip = (() => {
      if (options?.lines) {
        return options.lines.map((input) => {
          const state = states.get(input.salesOrderLineId);
          const orderLine = orderLinesById.get(input.salesOrderLineId);
          if (!state || !orderLine) {
            throw new SalesError("Sales order line not found.", 404, {
              errors: { lines: ["Sales order line not found."] },
            });
          }
          const quantity = normalizeShipQuantity(Number(input.quantity));
          const remaining = remainingToShip(state);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new SalesError("Quantity must be greater than 0.", 400, {
              errors: { lines: ["Quantity must be greater than 0."] },
            });
          }
          if (quantity > remaining) {
            throw new SalesError("Cannot ship more than the remaining quantity.", 400, {
              errors: { lines: ["Cannot ship more than the remaining quantity."] },
            });
          }
          return {
            salesOrderLineId: state.id,
            itemId: state.itemId,
            itemName: state.itemName,
            itemSku: state.itemSku,
            unitName: state.unitName,
            sortOrder: state.sortOrder,
            quantity,
          };
        });
      }

      return [...states.values()].flatMap((state) => {
        const quantity = remainingToShip(state);
        if (quantity <= 0) return [];
        return [
          {
            salesOrderLineId: state.id,
            itemId: state.itemId,
            itemName: state.itemName,
            itemSku: state.itemSku,
            unitName: state.unitName,
            sortOrder: state.sortOrder,
            quantity,
          },
        ];
      });
    })();

    if (linesToShip.length === 0) {
      throw new SalesError("No remaining quantity to ship.", 400);
    }

    if (options?.confirmNegativeStock !== true) {
      // The demand queue models the default location only (planning is
      // default-pinned in v1), so an explicit shipping location gets a
      // direct availability check at that location instead.
      let warning = null;
      if (options?.locationId) {
        const location = await resolveInventoryLocationInTx(tx, orgId, options.locationId);
        // Aggregate per item so two lines of the same item are checked
        // against the location's availability combined, not independently.
        const requestedByItem = new Map<
          string,
          { itemName: string; quantity: number; salesOrderLineIds: string[] }
        >();
        for (const line of linesToShip) {
          const entry = requestedByItem.get(line.itemId) ?? {
            itemName: line.itemName,
            quantity: 0,
            salesOrderLineIds: [],
          };
          entry.quantity += line.quantity;
          entry.salesOrderLineIds.push(line.salesOrderLineId);
          requestedByItem.set(line.itemId, entry);
        }
        for (const [itemId, requested] of requestedByItem) {
          const available = await getCurrentAvailableOnHandQtyAtLocationInTx(
            tx,
            itemId,
            location.id
          );
          if (available >= requested.quantity) continue;
          warning = await buildStockWarningPayloadInTx(tx, {
            organizationId: orgId,
            itemId,
            itemName: requested.itemName,
            available,
            requested: requested.quantity,
            excludeSalesOrderLineIds: requested.salesOrderLineIds,
          });
          break;
        }
      } else {
        warning = await buildDemandQueueShippingWarningInTx(tx, {
          organizationId: orgId,
          lines: linesToShip.map((line) => ({
            salesOrderLineId: line.salesOrderLineId,
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: line.quantity,
          })),
        });
      }
      if (warning) {
        throw new SalesError(
          `Cannot ship order. Insufficient stock for ${warning.itemName}.`,
          409,
          { negativeStock: warning }
        );
      }
    }

    const shippedAt = new Date();

    try {
      await consumeForSalesOrderShippingInTx(tx, {
        organizationId: orgId,
        salesOrderId: id,
        locationId: options?.locationId,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "ship-order"
        ),
        shippedAt,
        allowNegativeStock: options?.confirmNegativeStock === true,
        lines: linesToShip.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          itemId: line.itemId,
          quantity: line.quantity,
        })),
      });
    } catch (error) {
      if (error instanceof LinkedManufacturingOutputUnavailableError) {
        const blockingLine = linesToShip.find((line) => line.itemId === error.itemId);
        throw new SalesError(
          `Cannot ship order. Linked make-to-order output is not available for ${blockingLine?.itemName ?? "one item"}.`,
          409
        );
      }

      if (error instanceof InsufficientStockError) {
        const blockingLine = linesToShip.find((line) => line.itemId === error.itemId);
        const warning = await buildStockWarningPayloadInTx(tx, {
          organizationId: orgId,
          itemId: error.itemId,
          itemName: blockingLine?.itemName ?? "one item",
          available: error.available,
          requested: error.requested,
          excludeSalesOrderLineIds: linesToShip.map((line) => line.salesOrderLineId),
        });
        throw new SalesError(
          `Cannot ship order. Insufficient stock for ${blockingLine?.itemName ?? "one item"}.`,
          409,
          {
            negativeStock: warning,
          }
        );
      }

      throw error;
    }

    for (const line of linesToShip) {
      await tx
        .update(salesOrderLines)
        .set({
          shippedQuantity: sql`${salesOrderLines.shippedQuantity} + ${normalizeNumeric(line.quantity)}`,
          updatedAt: shippedAt,
        })
        .where(eq(salesOrderLines.id, line.salesOrderLineId));
    }

    const [currentOrder] = await tx
      .select({
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
        customerId: salesOrders.customerId,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, id));

    const orderHasShipAddress =
      currentOrder &&
      (currentOrder.shipLine1 != null ||
        currentOrder.shipLine2 != null ||
        currentOrder.shipCity != null ||
        currentOrder.shipRegion != null ||
        currentOrder.shipPostcode != null ||
        currentOrder.shipCountry != null);

    let shipLine1 = currentOrder?.shipLine1 ?? null;
    let shipLine2 = currentOrder?.shipLine2 ?? null;
    let shipCity = currentOrder?.shipCity ?? null;
    let shipRegion = currentOrder?.shipRegion ?? null;
    let shipPostcode = currentOrder?.shipPostcode ?? null;
    let shipCountry = currentOrder?.shipCountry ?? null;

    if (!orderHasShipAddress && currentOrder) {
      const [customer] = await tx
        .select({
          shipLine1: customers.shipLine1,
          shipLine2: customers.shipLine2,
          shipCity: customers.shipCity,
          shipRegion: customers.shipRegion,
          shipPostcode: customers.shipPostcode,
          shipCountry: customers.shipCountry,
          billingLine1: customers.billingLine1,
          billingLine2: customers.billingLine2,
          billingCity: customers.billingCity,
          billingRegion: customers.billingRegion,
          billingPostcode: customers.billingPostcode,
          billingCountry: customers.billingCountry,
        })
        .from(customers)
        .where(eq(customers.id, currentOrder.customerId));

      if (customer) {
        const customerHasShip =
          customer.shipLine1 != null ||
          customer.shipLine2 != null ||
          customer.shipCity != null ||
          customer.shipRegion != null ||
          customer.shipPostcode != null ||
          customer.shipCountry != null;

        if (customerHasShip) {
          shipLine1 = customer.shipLine1;
          shipLine2 = customer.shipLine2;
          shipCity = customer.shipCity;
          shipRegion = customer.shipRegion;
          shipPostcode = customer.shipPostcode;
          shipCountry = customer.shipCountry;
        } else {
          shipLine1 = customer.billingLine1;
          shipLine2 = customer.billingLine2;
          shipCity = customer.billingCity;
          shipRegion = customer.billingRegion;
          shipPostcode = customer.billingPostcode;
          shipCountry = customer.billingCountry;
        }
      }
    }

    const finalStates = await getSalesOrderLineShipStatesInTx(tx, id);
    const allClosed = [...finalStates.values()].every(
      (line) => remainingToShip(line) <= 0
    );
    const [shipped] = await tx
      .update(salesOrders)
      .set({
        status: allClosed ? "done" : "open",
        ...(allClosed ? { priorityRank: null } : {}),
        shippedAt: allClosed ? shippedAt : null,
        shipLine1,
        shipLine2,
        shipCity,
        shipRegion,
        shipPostcode,
        shipCountry,
        updatedAt: shippedAt,
      })
      .where(eq(salesOrders.id, id))
      .returning({ id: salesOrders.id, status: salesOrders.status });

    if (allClosed) {
      await rerankOpenSalesOrdersInTx(tx, orgId);
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: shipped,
    });

    return {
      replayed: false as const,
      shipped,
      orgId,
    };
  }));

  if (!result || !result.shipped) {
    return null;
  }

  if (result.replayed) {
    return result.shipped;
  }

  if (options?.syncAccounting === false || result.shipped.status !== "done") {
    return result.shipped;
  }

  const { getXeroAutomationSettingsForOrg } = await import("@/lib/dal/xero");
  const automation = await getXeroAutomationSettingsForOrg(result.orgId);
  if (!automation?.autoPushSalesInvoices) {
    return result.shipped;
  }

  // Stock tx has committed. Attempt the Xero push; a failure must NOT roll
  // back the ship — the order is shipped regardless of accounting state.
  const { pushSalesOrderToXero, markXeroPushFailed } = await import(
    "@/lib/xero/push-invoice"
  );
  const { XeroError } = await import("@/lib/xero/errors");

  try {
    await pushSalesOrderToXero(result.orgId, id);
  } catch (error) {
    if (
      error instanceof XeroError &&
      (error.message.includes("not connected") ||
        error.status === 409 ||
        error.status === 500)
    ) {
      // Xero isn't set up for this org — leave push_status null rather than
      // flagging a failure that the user can't act on.
      if (!error.message.includes("not connected")) {
        await markXeroPushFailed(result.orgId, id, error);
      }
    } else {
      await markXeroPushFailed(result.orgId, id, error);
    }
  }

  return result.shipped;
}

async function completeLinkedManufacturingForFullOrderShip(
  salesOrderId: string,
  options: ShipSalesOrder & { idempotencyKey?: string }
) {
  if (options.lines != null) {
    throw new SalesError(
      "Linked manufacturing can only be completed automatically when shipping the full order.",
      400
    );
  }

  const linkedRows = await withAuthedOrgContext(async (tx, orgId) => {
    return await tx
      .select({
        id: manufacturingOrders.id,
        plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
          "plannedQuantity"
        ),
        outputQuantity: trimScale(
          sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`
        ).as("outputQuantity"),
      })
      .from(manufacturingOrders)
      .leftJoin(
        manufacturingOrderOutputs,
        eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
      )
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          eq(manufacturingOrders.salesOrderId, salesOrderId),
          eq(manufacturingOrders.status, "open"),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .groupBy(manufacturingOrders.id);
  });

  for (const row of linkedRows) {
    const plannedQuantity = Number(row.plannedQuantity);
    const outputQuantity = Number(row.outputQuantity);
    const remainingOutputQuantity = normalizeQuantityNumber(
      plannedQuantity - outputQuantity
    );

    try {
      if (remainingOutputQuantity > 0) {
        if (outputQuantity > 0) {
          await recordManufacturingOutput(
            row.id,
            {
              // The linked output must land where the shipment consumes.
              locationId: options.locationId,
              quantity: normalizeNumeric(remainingOutputQuantity),
              outputDisposition: "available",
              notes: null,
              confirmNegativeStock: options.confirmNegativeStock,
            },
            {
              idempotencyKey:
                deriveInventoryIdempotencyKey(
                  options.idempotencyKey,
                  `complete-linked-manufacturing-output:${row.id}`
                ) ?? undefined,
            }
          );
          await completeManufacturingOrder(
            row.id,
            {
              locationId: options.locationId,
              outputDisposition: "available",
              ingredientActuals: [],
              confirmNegativeStock: options.confirmNegativeStock,
            },
            {
              idempotencyKey:
                deriveInventoryIdempotencyKey(
                  options.idempotencyKey,
                  `complete-linked-manufacturing:${row.id}`
                ) ?? undefined,
              ingredientTrackedLotDefault: "unbatched",
            }
          );
        } else {
          await completeManufacturingOrder(
            row.id,
            {
              locationId: options.locationId,
              actualQuantity: row.plannedQuantity,
              outputDisposition: "available",
              ingredientActuals: [],
              confirmNegativeStock: options.confirmNegativeStock,
            },
            {
              idempotencyKey:
                deriveInventoryIdempotencyKey(
                  options.idempotencyKey,
                  `complete-linked-manufacturing:${row.id}`
                ) ?? undefined,
              ingredientTrackedLotDefault: "unbatched",
            }
          );
        }
      } else {
        await completeManufacturingOrder(
          row.id,
          {
            locationId: options.locationId,
            outputDisposition: "available",
            ingredientActuals: [],
            confirmNegativeStock: options.confirmNegativeStock,
          },
          {
            idempotencyKey:
              deriveInventoryIdempotencyKey(
                options.idempotencyKey,
                `complete-linked-manufacturing:${row.id}`
              ) ?? undefined,
            ingredientTrackedLotDefault: "unbatched",
          }
        );
      }
    } catch (error) {
      if (error instanceof ManufacturingError) {
        throw new SalesError(error.message, error.status);
      }
      throw error;
    }
  }
}
