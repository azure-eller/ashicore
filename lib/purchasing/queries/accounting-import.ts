import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import {
  accountingDocumentSyncs,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import { ACCOUNTING_DOCUMENT_PURCHASE_ORDER, persistAccountingDocumentPushSuccess } from "@/lib/accounting/sync-state";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import { addExpectedFromPurchaseInTx, editExpectedFromPurchaseInTx } from "@/lib/inventory/kernel";
import { createPurchaseOrderInTx, preparePurchaseOrderPayload } from "./order-write";
import type { PurchaseOrderPayload } from "./order-write";
import { getPurchaseOrderLinesInTx } from "./shared";

export type ImportedAccountingPurchaseOrder = PurchaseOrderPayload & {
  accountingProvider: string;
  orderNumber: string;
  externalPurchaseOrderId: string;
  externalPurchaseOrderNumber: string;
  orderedAt?: Date | null;
};

export async function upsertImportedAccountingPurchaseOrderInTx(
  tx: Tx,
  orgId: string,
  data: ImportedAccountingPurchaseOrder,
  options: { actorUserId?: string | null } = {},
) {
  const prepared = await preparePurchaseOrderPayload(tx, orgId, data);
  const [existingByExternal] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
    })
    .from(accountingDocumentSyncs)
    .innerJoin(
      purchaseOrders,
      eq(accountingDocumentSyncs.documentId, purchaseOrders.id),
    )
    .where(
      and(
        eq(accountingDocumentSyncs.organizationId, orgId),
        eq(accountingDocumentSyncs.provider, data.accountingProvider),
        eq(
          accountingDocumentSyncs.documentType,
          ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
        ),
        eq(
          accountingDocumentSyncs.externalDocumentId,
          data.externalPurchaseOrderId,
        ),
        eq(purchaseOrders.type, "standard"),
        isNull(purchaseOrders.deletedAt),
      ),
    )
    .limit(1);
  const [existingByNumber] = existingByExternal
    ? [null]
    : await tx
        .select({
          id: purchaseOrders.id,
          status: purchaseOrders.status,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.organizationId, orgId),
            eq(purchaseOrders.orderNumber, data.orderNumber),
            eq(purchaseOrders.type, "standard"),
            isNull(purchaseOrders.deletedAt),
          ),
        )
        .limit(1);
  const existing = existingByExternal ?? existingByNumber;

  if (!existing) {
    const created = await createPurchaseOrderInTx(tx, orgId, data, {
      orderNumber: data.orderNumber,
      externalPurchaseOrderId: data.externalPurchaseOrderId,
      externalPurchaseOrderNumber: data.externalPurchaseOrderNumber,
      accountingPushStatus: "pushed",
      accountingProvider: data.accountingProvider,
    });
    await tx
      .update(purchaseOrders)
      .set({
        status: "ordered",
        orderedAt: data.orderedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, created.id));
    const lines = await getPurchaseOrderLinesInTx(tx, created.id);
    await addExpectedFromPurchaseInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: created.id,
      actorUserId: options.actorUserId ?? null,
      idempotencyKey: null,
      lines: lines.map((line) => ({
        purchaseOrderLineId: line.id,
        itemId: line.itemId,
        quantity: parseFloat(line.stockQuantityOrdered),
      })),
    });
    return { action: "created" as const, id: created.id, protected: false };
  }

  const [locked] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, existing.id))
    .for("update");
  if (!locked)
    return { action: "skipped" as const, id: existing.id, protected: true };

  const existingLines = await getPurchaseOrderLinesInTx(tx, existing.id);
  const hasReceivedLines = existingLines.some(
    (line) =>
      parseFloat(line.quantityReceived) > 0 ||
      parseFloat(line.stockQuantityReceived) > 0,
  );

  await lockItemsInTx(tx, [
    ...new Set([
      ...existingLines.map((line) => line.itemId),
      ...prepared.affectedItemIds,
    ]),
  ]);

  await tx
    .update(purchaseOrders)
    .set({
      supplierId: prepared.supplierId,
      supplierName: prepared.supplierName,
      expectedDate: prepared.expectedDate,
      notes: prepared.notes,
      accountingPurchaseAccountCode: prepared.accountingPurchaseAccountCode,
      shipLine1: prepared.shipLine1,
      shipLine2: prepared.shipLine2,
      shipCity: prepared.shipCity,
      shipRegion: prepared.shipRegion,
      shipPostcode: prepared.shipPostcode,
      shipCountry: prepared.shipCountry,
      shippingCost: hasReceivedLines ? undefined : prepared.shippingCost,
      subtotalAmount: hasReceivedLines ? undefined : prepared.subtotalAmount,
      taxAmount: hasReceivedLines ? undefined : prepared.taxAmount,
      totalAmount: hasReceivedLines ? undefined : prepared.totalAmount,
      status: locked.status === "draft" ? "ordered" : undefined,
      orderedAt:
        locked.status === "draft" ? (data.orderedAt ?? new Date()) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, existing.id));

  if (!hasReceivedLines) {
    await tx
      .delete(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, existing.id));
    const insertedLines =
      prepared.preparedLines.length > 0
        ? await tx
            .insert(purchaseOrderLines)
            .values(
              prepared.preparedLines.map((line) => ({
                purchaseOrderId: existing.id,
                ...line,
              })),
            )
            .returning({
              id: purchaseOrderLines.id,
              itemId: purchaseOrderLines.itemId,
              stockQuantityOrdered: trimScale(
                purchaseOrderLines.stockQuantityOrdered,
              ).as("stockQuantityOrdered"),
            })
        : [];

    const nextLines = insertedLines.map((line) => ({
      purchaseOrderLineId: line.id,
      itemId: line.itemId,
      quantity: parseFloat(line.stockQuantityOrdered),
    }));

    if (locked.status === "draft") {
      await addExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: existing.id,
        actorUserId: options.actorUserId ?? null,
        idempotencyKey: null,
        lines: nextLines,
      });
    } else if (["ordered", "partial", "received"].includes(locked.status)) {
      await editExpectedFromPurchaseInTx(tx, {
        organizationId: orgId,
        purchaseOrderId: existing.id,
        actorUserId: options.actorUserId ?? null,
        idempotencyKey: null,
        previousPurchaseOrderLineIds: existingLines.map((line) => line.id),
        nextLines,
      });
    }

    await tx
      .delete(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, existing.id));
    if (prepared.preparedAdditionalCosts.length > 0) {
      await tx.insert(purchaseOrderAdditionalCosts).values(
        prepared.preparedAdditionalCosts.map((cost) => ({
          purchaseOrderId: existing.id,
          ...cost,
        })),
      );
    }
  }

  await persistAccountingDocumentPushSuccess(tx, {
    organizationId: orgId,
    provider: data.accountingProvider,
    documentType: ACCOUNTING_DOCUMENT_PURCHASE_ORDER,
    documentId: existing.id,
    externalDocumentId: data.externalPurchaseOrderId,
    externalDocumentNumber: data.externalPurchaseOrderNumber,
    payloadHash: "",
  });

  return {
    action: "updated" as const,
    id: existing.id,
    protected: hasReceivedLines,
  };
}
