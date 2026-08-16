import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  accountingDocumentSyncs,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import {
  ACCOUNTING_DOCUMENT_PURCHASE_BILL,
  ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
} from "@/lib/accounting/sync-state";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import {
  beginInventoryOperationInTx,
  collectPurchaseReceiptRemainderInTx,
  correctPurchaseReceiptQuantityInTx,
  deriveInventoryIdempotencyKey,
  editExpectedFromPurchaseInTx,
  finishInventoryOperationInTx,
  revaluePurchaseLandedCostInTx,
} from "@/lib/inventory/kernel";
import {
  calculatePurchaseOrderLandedCosts,
  normalizeLandedMoney,
  normalizeLandedStockUnitCost,
  resolveLandedCostAllocationBasis,
} from "@/lib/purchasing/landed-cost";
import { calculateTaxAmount, calculateTaxedLineTotal } from "@/lib/tax/calc";
import type { PurchaseOrderQuantityCorrection } from "@/lib/schemas/purchase-orders";
import type {
  PurchaseOrderDetail,
  PurchaseOrderQuantityCorrectionImpact,
} from "@/lib/purchasing/types";
import {
  isNumeric12Scale4Representable,
  positiveQuantityString,
} from "@/lib/schemas/shared";
import { PurchasingError } from "./errors";
import { getPurchaseOrder } from "./orders-read";
import {
  getLockedPurchaseOrderInTx,
  getPurchaseOrderAdditionalCostsInTx,
  getPurchaseOrderLinesInTx,
} from "./shared";

async function billWasSyncedInTx(tx: Parameters<Parameters<typeof withAuthedOrgContext>[0]>[0], id: string) {
  const rows = await tx
    .select({
      pushStatus: accountingDocumentSyncs.pushStatus,
      externalDocumentId: accountingDocumentSyncs.externalDocumentId,
    })
    .from(accountingDocumentSyncs)
    .where(
      and(
        eq(accountingDocumentSyncs.documentId, id),
        eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_PURCHASE_BILL),
      ),
    );
  return rows.some((row) => row.pushStatus === "pushed" || row.externalDocumentId != null);
}

function removableStockForItem(
  remainder: Awaited<ReturnType<typeof collectPurchaseReceiptRemainderInTx>>,
) {
  return roundQuantity(
    remainder.tracked.reduce((sum, row) => sum + row.quantity, 0) +
      remainder.untracked.reduce((sum, row) => sum + row.onHandQty, 0),
  );
}

export async function getPurchaseOrderQuantityCorrectionImpact(
  id: string,
  lineId: string,
  quantityOrderedInput: string,
): Promise<PurchaseOrderQuantityCorrectionImpact | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.type, "standard"),
          isNull(purchaseOrders.deletedAt),
        ),
      );
    if (!order) return null;
    const [line] = await tx
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.id, lineId),
          eq(purchaseOrderLines.purchaseOrderId, id),
        ),
      );
    if (!line) throw new PurchasingError("Purchase order line not found.", 404);
    const parsedQuantity = positiveQuantityString("Quantity").safeParse(
      quantityOrderedInput,
    );
    if (!parsedQuantity.success) {
      const message =
        parsedQuantity.error.issues[0]?.message ?? "Quantity is invalid";
      throw new PurchasingError(message, 400, {
        errors: { quantityOrdered: [message] },
      });
    }
    const quantityOrdered = Number(parsedQuantity.data);
    const quantityReceived = Number(line.quantityReceived);
    if (quantityOrdered >= quantityReceived) {
      throw new PurchasingError(
        "Use the normal quantity edit when the new quantity is not below received.",
        400,
      );
    }
    const factor = Number(line.purchaseToStockFactor);
    const correctedStockQuantity = roundQuantity(quantityOrdered * factor);
    if (
      correctedStockQuantity <= 0 ||
      !isNumeric12Scale4Representable(correctedStockQuantity)
    ) {
      const message =
        "Converted stock quantity must be between 0.0001 and 99,999,999.9999";
      throw new PurchasingError(
        `This quantity must convert to between 0.0001 and 99,999,999.9999 ${line.stockingUnitName}. Adjust the quantity or stocking unit.`,
        400,
        { errors: { quantityOrdered: [message] } },
      );
    }
    const stockQuantityToCorrect = roundQuantity(
      (quantityReceived - quantityOrdered) * factor,
    );
    const remainder = await collectPurchaseReceiptRemainderInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      itemId: line.itemId,
      purchaseOrderLineId: lineId,
    });
    const stockQuantityToRemove = Math.min(
      stockQuantityToCorrect,
      removableStockForItem(remainder),
    );
    return {
      purchaseOrderId: id,
      lineId,
      itemName: line.itemName,
      purchaseUnitName: line.purchaseUnitName,
      stockingUnitName: line.stockingUnitName,
      quantityOrderedBefore: normalizeNumeric(Number(line.quantityOrdered)),
      quantityReceivedBefore: normalizeNumeric(quantityReceived),
      quantityOrdered: normalizeNumeric(quantityOrdered),
      stockQuantityToCorrect: normalizeNumeric(stockQuantityToCorrect),
      stockQuantityToRemove: normalizeNumeric(stockQuantityToRemove),
      stockQuantityKeptInHistory: normalizeNumeric(
        stockQuantityToCorrect - stockQuantityToRemove,
      ),
      billSynced: await billWasSyncedInTx(tx, id),
    };
  });
}

export async function correctPurchaseOrderQuantity(
  id: string,
  data: PurchaseOrderQuantityCorrection,
  options: { idempotencyKey: string },
): Promise<
  | { kind: "corrected"; order: PurchaseOrderDetail; impact: PurchaseOrderQuantityCorrectionImpact }
  | { kind: "conflict"; order: PurchaseOrderDetail }
  | null
> {
  const transactionResult = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<
      | { kind: "corrected"; impact: PurchaseOrderQuantityCorrectionImpact }
      | { kind: "conflict" }
      | null
    >(tx, {
      organizationId: orgId,
      operationName: "correctPurchaseOrderQuantity",
      idempotencyKey: options.idempotencyKey,
      payload: { id, data },
    });
    if (replay.replayed) return replay.result;

    const order = await getLockedPurchaseOrderInTx(tx, id);
    if (!order || order.type !== "standard") {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options.idempotencyKey,
        result: null,
      });
      return null;
    }
    if (data.expectedVersion != null && order.version !== data.expectedVersion) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options.idempotencyKey,
        result: { kind: "conflict" },
      });
      return { kind: "conflict" as const };
    }
    const [lines, additionalCosts] = await Promise.all([
      getPurchaseOrderLinesInTx(tx, id),
      getPurchaseOrderAdditionalCostsInTx(tx, id),
    ]);
    const target = lines.find((line) => line.id === data.lineId);
    if (!target) throw new PurchasingError("Purchase order line not found.", 404);
    const correctedQuantity = Number(data.quantityOrdered);
    const receivedBefore = Number(target.quantityReceived);
    if (correctedQuantity >= receivedBefore) {
      throw new PurchasingError(
        "Use the normal quantity edit when the new quantity is not below received.",
        400,
      );
    }
    const factor = Number(target.purchaseToStockFactor);
    const correctedStockQuantity = roundQuantity(correctedQuantity * factor);
    if (
      correctedStockQuantity <= 0 ||
      !isNumeric12Scale4Representable(correctedStockQuantity)
    ) {
      throw new PurchasingError(
        `This quantity must convert to between 0.0001 and 99,999,999.9999 ${target.stockingUnitName}. Adjust the quantity or stocking unit.`,
        400,
        {
          errors: {
            quantityOrdered: [
              "Converted stock quantity must be between 0.0001 and 99,999,999.9999",
            ],
          },
        },
      );
    }
    const stockQuantityToCorrect = roundQuantity(
      Number(target.stockQuantityReceived) - correctedStockQuantity,
    );
    const kernelResult = await correctPurchaseReceiptQuantityInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      purchaseOrderLineId: target.id,
      itemId: target.itemId,
      stockQuantityToCorrect,
      quantityOrderedBefore: target.quantityOrdered,
      quantityReceivedBefore: target.quantityReceived,
      quantityCorrected: normalizeNumeric(correctedQuantity),
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options.idempotencyKey,
        "inventory",
      ),
    });

    const nextLines = lines.map((line) =>
      line.id === target.id
        ? {
            ...line,
            quantityOrdered: normalizeNumeric(correctedQuantity),
            quantityReceived: normalizeNumeric(correctedQuantity),
            stockQuantityOrdered: normalizeNumeric(correctedStockQuantity),
            stockQuantityReceived: normalizeNumeric(correctedStockQuantity),
            // A correction restates ordered as what actually arrived, so there
            // is no shortfall left to write off. Carrying the old closure
            // forward would keep suppressing supply the next time the line is
            // ordered back up, leaving it stuck at zero receivable.
            quantityClosed: "0",
            stockQuantityClosed: "0",
          }
        : line,
    );
    const landed = calculatePurchaseOrderLandedCosts({
      lines: nextLines,
      additionalCosts,
    });
    const revaluationLines: Array<{
      purchaseOrderLineId: string;
      itemId: string;
      unitCost: string;
    }> = [];
    let taxAmount = 0;
    for (const [index, line] of nextLines.entries()) {
      const lineCost = landed.lines[index];
      const stockUnitCost = normalizeLandedStockUnitCost(
        lineCost.landedStockUnitCost,
      );
      if (stockUnitCost == null) continue;
      const subtotal = normalizeLandedMoney(lineCost.lineSubtotal);
      const lineTax = calculateTaxAmount(
        lineCost.lineSubtotal,
        line.taxRatePercent,
        4,
      );
      const total = calculateTaxedLineTotal(lineCost.lineSubtotal, lineTax, 4);
      taxAmount += Number(lineTax);
      if (
        Number(line.stockQuantityReceived) > 0 &&
        Math.abs(Number(line.stockUnitCost) - Number(stockUnitCost)) >= 0.000001
      ) {
        revaluationLines.push({
          purchaseOrderLineId: line.id,
          itemId: line.itemId,
          unitCost: stockUnitCost,
        });
      }
      await tx
        .update(purchaseOrderLines)
        .set({
          quantityOrdered: line.quantityOrdered,
          quantityReceived: line.quantityReceived,
          stockQuantityOrdered: line.stockQuantityOrdered,
          stockQuantityReceived: line.stockQuantityReceived,
          quantityClosed: line.quantityClosed,
          stockQuantityClosed: line.stockQuantityClosed,
          stockUnitCost,
          lineSubtotal: subtotal,
          lineTaxAmount: lineTax,
          lineTotal: total,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrderLines.id, line.id));
    }

    await editExpectedFromPurchaseInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options.idempotencyKey,
        "expected",
      ),
      nextLines: nextLines.map((line) => ({
        purchaseOrderLineId: line.id,
        itemId: line.itemId,
        quantity: Math.max(
          Number(line.stockQuantityOrdered) -
            Number(line.stockQuantityReceived) -
            Number(line.stockQuantityClosed),
          0,
        ),
      })),
    });
    if (revaluationLines.length > 0) {
      await revaluePurchaseLandedCostInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options.idempotencyKey,
          "revaluation",
        ),
        allocationBasis: resolveLandedCostAllocationBasis(additionalCosts),
        lines: revaluationLines,
      });
    }
    const allReceived = nextLines.every(
      (line) =>
        Number(line.quantityReceived) + Number(line.quantityClosed) >=
        Number(line.quantityOrdered),
    );
    const anyReceived = nextLines.some((line) => Number(line.quantityReceived) > 0);
    const status = allReceived ? "received" : anyReceived ? "partial" : "not_received";
    await tx
      .update(purchaseOrders)
      .set({
        status,
        receivedAt:
          status === "received"
            ? order.receivedAt ?? new Date()
            : null,
        subtotalAmount: normalizeLandedMoney(landed.orderTotal),
        taxAmount: normalizeLandedMoney(taxAmount),
        totalAmount: normalizeLandedMoney(landed.orderTotal + taxAmount),
        version: sql`${purchaseOrders.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));
    await tx
      .update(accountingDocumentSyncs)
      .set({ pushStatus: "pending", pushError: null, updatedAt: new Date() })
      .where(
        and(
          eq(accountingDocumentSyncs.documentId, id),
          isNotNull(accountingDocumentSyncs.externalDocumentId),
          inArray(accountingDocumentSyncs.documentType, [
            ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
            ACCOUNTING_DOCUMENT_PURCHASE_BILL,
          ]),
        ),
      );

    const impact: PurchaseOrderQuantityCorrectionImpact = {
      purchaseOrderId: id,
      lineId: target.id,
      itemName: target.itemName,
      purchaseUnitName: target.purchaseUnitName,
      stockingUnitName: target.stockingUnitName,
      quantityOrderedBefore: normalizeNumeric(Number(target.quantityOrdered)),
      quantityReceivedBefore: normalizeNumeric(receivedBefore),
      quantityOrdered: normalizeNumeric(correctedQuantity),
      stockQuantityToCorrect: normalizeNumeric(stockQuantityToCorrect),
      stockQuantityToRemove: kernelResult.stockQuantityRemoved,
      stockQuantityKeptInHistory: kernelResult.stockQuantityKeptInHistory,
      billSynced: await billWasSyncedInTx(tx, id),
    };
    const result = { kind: "corrected" as const, impact };
    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options.idempotencyKey,
      firstEventId: kernelResult.auditEventId,
      result,
    });
    return result;
  });

  if (!transactionResult) return null;
  const order = await getPurchaseOrder(id);
  if (!order) return null;
  if (transactionResult.kind === "conflict") {
    return { kind: "conflict", order };
  }
  return { kind: "corrected", order, impact: transactionResult.impact };
}
