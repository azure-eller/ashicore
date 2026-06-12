import "server-only";

import { normalizeNumeric } from "@/lib/format";
import { and, eq, isNull } from "drizzle-orm";
import { purchaseOrderLines, purchaseOrders } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import { calculatePurchaseOrderLandedCosts, normalizeLandedMoney, normalizeLandedStockUnitCost } from "@/lib/purchasing/landed-cost";
import { calculateTaxAmount, calculateTaxedLineTotal } from "@/lib/tax/calc";
import {
  beginInventoryOperationInTx,
  deriveInventoryIdempotencyKey,
  editExpectedFromPurchaseInTx,
  finishInventoryOperationInTx,
  receivePurchaseStockInTx,
} from "@/lib/inventory/kernel";
import type { PurchaseOrderStatus, ReceivePurchaseOrder } from "@/lib/schemas/purchase-orders";
import { PurchasingError } from "./errors";
import { getPurchaseOrderAdditionalCostsInTx, getPurchaseOrderLinesInTx, getValidatedPurchasableItemsInTx } from "./shared";

export async function receivePurchaseOrder(
  id: string,
  data: ReceivePurchaseOrder,
  options?: { idempotencyKey?: string },
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{
      id: string;
      status: PurchaseOrderStatus;
    } | null>(
      tx,
      {
        organizationId: orgId,
        operationName: "receivePurchaseOrder",
        idempotencyKey: options?.idempotencyKey ?? null,
        payload: { id, data },
      },
    );

    if (replay.replayed) {
      return replay.result;
    }

    // Lock the PO row first to prevent concurrent receipts from
    // reading stale quantityReceived values on the lines.
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        type: purchaseOrders.type,
        shippingCost: trimScale(purchaseOrders.shippingCost).as("shippingCost"),
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
        400,
      );
    }
    if (order.type === "additional_cost") {
      throw new PurchasingError("Additional-cost purchase orders cannot be received.", 409);
    }

    const [existingLines, additionalCosts] = await Promise.all([
      getPurchaseOrderLinesInTx(tx, id),
      getPurchaseOrderAdditionalCostsInTx(tx, id),
    ]);
    const lineMap = new Map(existingLines.map((line) => [line.id, line]));
    const seenLineIds = new Set<string>();
    const overReceiptWarnings: Array<{
      lineId: string;
      itemName: string;
      remaining: string;
      requested: string;
      overage: string;
    }> = [];
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
            [`lines.${index}.quantityReceived`]: [
              "Select a valid purchase order line",
            ],
          },
        });
      }

      const quantityReceived = Number(line.quantityReceived);
      const remaining =
        parseFloat(existingLine.quantityOrdered) -
        parseFloat(existingLine.quantityReceived);

      if (quantityReceived > remaining && !data.confirmOverReceipt) {
        overReceiptWarnings.push({
          lineId: line.lineId,
          itemName: existingLine.itemName,
          remaining: normalizeNumeric(remaining),
          requested: normalizeNumeric(quantityReceived),
          overage: normalizeNumeric(quantityReceived - remaining),
        });
      } else if (quantityReceived > remaining && remaining < 0) {
        throw new PurchasingError(
          "Cannot receive more than remaining quantity.",
          400,
          {
            errors: {
              [`lines.${index}.quantityReceived`]: [
                `Must be ${normalizeNumeric(remaining)} or less`,
              ],
            },
          },
        );
      }

      const stockQuantityReceived = parseFloat(
        normalizeNumeric(
          quantityReceived * parseFloat(existingLine.purchaseToStockFactor),
        ),
      );

      return {
        line: existingLine,
        quantityReceived,
        stockQuantityReceived,
        disposition: line.disposition,
        overReceiptQuantity: Math.max(
          0,
          quantityReceived - Math.max(remaining, 0),
        ),
      };
    });

    if (overReceiptWarnings.length > 0) {
      throw new PurchasingError(
        "This receipt is above the ordered quantity.",
        409,
        {
          overReceipt: { lines: overReceiptWarnings },
        },
      );
    }

    await getValidatedPurchasableItemsInTx(
      tx,
      receiveEntries.map((entry) => entry.line.itemId),
    );

    await lockItemsInTx(
      tx,
      existingLines.map((line) => line.itemId),
    );

    for (const [index, entry] of receiveEntries.entries()) {
      if (
        entry.disposition !== "available" &&
        (await getItemLotTrackingModeInTx(tx, entry.line.itemId)) === "untracked"
      ) {
        throw new PurchasingError("Untracked items can only be received as available.", 400, {
          errors: {
            [`lines.${index}.disposition`]: [
              "Untracked items can only be received as available.",
            ],
          },
        });
      }
    }

    const updatedLines = new Map(
      existingLines.map((line) => [line.id, { ...line }]),
    );

    for (const entry of receiveEntries) {
      const currentLine = updatedLines.get(entry.line.id);

      if (!currentLine) {
        continue;
      }

      const newQuantityReceived =
        parseFloat(currentLine.quantityReceived) + entry.quantityReceived;
      const newStockQuantityReceived =
        parseFloat(currentLine.stockQuantityReceived) +
        entry.stockQuantityReceived;
      const newQuantityOrdered = Math.max(
        parseFloat(currentLine.quantityOrdered),
        newQuantityReceived,
      );
      const newStockQuantityOrdered = Math.max(
        parseFloat(currentLine.stockQuantityOrdered),
        newStockQuantityReceived,
      );

      const normalizedReceived = normalizeNumeric(newQuantityReceived);
      const normalizedStockReceived = normalizeNumeric(
        newStockQuantityReceived,
      );
      const normalizedOrdered = normalizeNumeric(newQuantityOrdered);
      const normalizedStockOrdered = normalizeNumeric(newStockQuantityOrdered);
      const lineSubtotal = newQuantityOrdered * parseFloat(currentLine.unitCost);
      const normalizedLineSubtotal = normalizeLandedMoney(lineSubtotal);
      const normalizedLineTaxAmount = calculateTaxAmount(
        lineSubtotal,
        currentLine.taxRatePercent,
        4,
      );
      const normalizedLineTotal = calculateTaxedLineTotal(
        lineSubtotal,
        normalizedLineTaxAmount,
        4,
      );

      await tx
        .update(purchaseOrderLines)
        .set({
          quantityOrdered: normalizedOrdered,
          stockQuantityOrdered: normalizedStockOrdered,
          quantityReceived: normalizedReceived,
          stockQuantityReceived: normalizedStockReceived,
          lineSubtotal: normalizedLineSubtotal,
          lineTaxAmount: normalizedLineTaxAmount,
          lineTotal: normalizedLineTotal,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrderLines.id, currentLine.id));

      updatedLines.set(currentLine.id, {
        ...currentLine,
        quantityReceived: normalizedReceived,
        stockQuantityReceived: normalizedStockReceived,
        quantityOrdered: normalizedOrdered,
        stockQuantityOrdered: normalizedStockOrdered,
        lineSubtotal: normalizedLineSubtotal,
        lineTaxAmount: normalizedLineTaxAmount,
        lineTotal: normalizedLineTotal,
        updatedAt: new Date(),
      });
    }

    const overReceiptExpectedLines = existingLines.map((line) => {
      const currentLine = updatedLines.get(line.id);
      return {
        purchaseOrderLineId: line.id,
        itemId: line.itemId,
        quantity: Math.max(
          parseFloat(
            currentLine?.stockQuantityOrdered ?? line.stockQuantityOrdered,
          ) - parseFloat(line.stockQuantityReceived),
          0,
        ),
      };
    });

    if (receiveEntries.some((entry) => entry.overReceiptQuantity > 0)) {
      await editExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "over-receipt-expected",
        ),
        nextLines: overReceiptExpectedLines,
      });
    }

    const finalLines = existingLines.map(
      (line) => updatedLines.get(line.id) ?? line,
    );
    const finalLandedCosts = calculatePurchaseOrderLandedCosts({
      lines: finalLines.map((line) => ({
        quantityOrdered: line.quantityOrdered,
        unitCost: line.unitCost,
        purchaseToStockFactor: line.purchaseToStockFactor,
      })),
      additionalCosts,
    });
    const landedStockUnitCostByLineId = new Map(
      finalLines.map((line, index) => [
        line.id,
        normalizeLandedStockUnitCost(
          finalLandedCosts.lines[index]?.landedStockUnitCost ?? null,
        ),
      ]),
    );

    if (receiveEntries.some((entry) => entry.overReceiptQuantity > 0)) {
      await Promise.all(
        finalLines.map((line) =>
          tx
            .update(purchaseOrderLines)
            .set({
              stockUnitCost:
                landedStockUnitCostByLineId.get(line.id) ?? line.stockUnitCost,
              updatedAt: new Date(),
            })
            .where(eq(purchaseOrderLines.id, line.id)),
        ),
      );
    }

    await receivePurchaseStockInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      locationId: data.locationId,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "receive-stock",
      ),
      lines: receiveEntries.map((entry) => ({
        purchaseOrderLineId: entry.line.id,
        itemId: entry.line.itemId,
        quantity: entry.stockQuantityReceived,
        unitCost:
          landedStockUnitCostByLineId.get(entry.line.id) ??
          entry.line.stockUnitCost,
        disposition: entry.disposition,
      })),
    });

    const allReceived = [...updatedLines.values()].every(
      (line) =>
        parseFloat(line.quantityReceived) >= parseFloat(line.quantityOrdered),
    );
    const finalTaxAmount = finalLines.reduce(
      (sum, line) => sum + Number(line.lineTaxAmount),
      0,
    );

    await tx
      .update(purchaseOrders)
      .set({
        status: allReceived ? "received" : "partial",
        receivedAt: allReceived ? new Date() : null,
        subtotalAmount: normalizeLandedMoney(finalLandedCosts.orderTotal),
        taxAmount: normalizeLandedMoney(finalTaxAmount),
        totalAmount: normalizeLandedMoney(
          finalLandedCosts.orderTotal + finalTaxAmount,
        ),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));

    const result = { id, status: allReceived ? "received" : "partial" };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}
