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
import { editExpectedFromPurchaseInTx } from "@/lib/inventory/kernel";
import { createPurchaseOrderInTx, preparePurchaseOrderPayload } from "./order-write";
import type { PurchaseOrderPayload } from "./order-write";
import { getPurchaseOrderLinesInTx } from "./shared";

type CarryableCost = {
  costType: string;
  reference: string | null;
  amount: string;
  supplierId: string | null;
};

// Match reinserted costs to the rows they replace and keep the local supplier
// assignment: exact (type, reference, amount) first, then a same-type pair when
// both sides have exactly one unmatched row of that type (amount edited in the
// provider). Each old row is consumed at most once.
export function carryCostSupplierAssignments<
  TCost extends {
    costType: string;
    reference: string | null;
    amount: string;
    supplierId: string | null;
  },
>(previous: CarryableCost[], next: TCost[]): TCost[] {
  if (!previous.some((cost) => cost.supplierId)) return next;

  const exactKey = (cost: CarryableCost) =>
    JSON.stringify([
      cost.costType,
      cost.reference?.trim() ?? "",
      Number(cost.amount),
    ]);
  const groupIndexes = <TCostValue extends CarryableCost>(
    costs: TCostValue[],
    available: boolean[],
    keyFor: (cost: TCostValue) => string,
  ) => {
    const groups = new Map<string, number[]>();
    costs.forEach((cost, index) => {
      if (!available[index]) return;
      const key = keyFor(cost);
      groups.set(key, [...(groups.get(key) ?? []), index]);
    });
    return groups;
  };

  const carried = [...next];
  const previousAvailable = previous.map(() => true);
  const nextAvailable = next.map(() => true);
  const previousExactGroups = groupIndexes(
    previous,
    previousAvailable,
    exactKey,
  );
  const nextExactGroups = groupIndexes(carried, nextAvailable, exactKey);

  for (const [key, previousIndexes] of previousExactGroups) {
    const nextIndexes = nextExactGroups.get(key);
    if (previousIndexes.length !== 1 || nextIndexes?.length !== 1) continue;
    const previousIndex = previousIndexes[0];
    const nextIndex = nextIndexes[0];
    previousAvailable[previousIndex] = false;
    nextAvailable[nextIndex] = false;
    if (!carried[nextIndex].supplierId && previous[previousIndex].supplierId) {
      carried[nextIndex] = {
        ...carried[nextIndex],
        supplierId: previous[previousIndex].supplierId,
      };
    }
  }

  const previousTypeGroups = groupIndexes(
    previous,
    previousAvailable,
    (cost) => cost.costType,
  );
  const nextTypeGroups = groupIndexes(
    carried,
    nextAvailable,
    (cost) => cost.costType,
  );
  for (const [costType, previousIndexes] of previousTypeGroups) {
    const nextIndexes = nextTypeGroups.get(costType);
    if (previousIndexes.length !== 1 || nextIndexes?.length !== 1) continue;
    const previousCost = previous[previousIndexes[0]];
    const nextIndex = nextIndexes[0];
    if (!carried[nextIndex].supplierId && previousCost.supplierId) {
      carried[nextIndex] = {
        ...carried[nextIndex],
        supplierId: previousCost.supplierId,
      };
    }
  }

  return carried;
}

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
      actorUserId: options.actorUserId ?? null,
    });
    if (data.orderedAt) {
      await tx
        .update(purchaseOrders)
        .set({
          orderedAt: data.orderedAt,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, created.id));
    }
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
      status: locked.status === "draft" ? "not_received" : undefined,
      orderedAt:
        locked.status === "draft"
          ? (data.orderedAt ?? new Date())
          : data.orderedAt ?? undefined,
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

    await editExpectedFromPurchaseInTx(tx, {
      organizationId: orgId,
      purchaseOrderId: existing.id,
      actorUserId: options.actorUserId ?? null,
      idempotencyKey: null,
      previousPurchaseOrderLineIds: existingLines.map((line) => line.id),
      nextLines,
    });

    // The provider document has no per-cost supplier, so the reinsert below
    // would wipe locally assigned cost suppliers; carry them over instead.
    const existingCosts = await tx
      .select({
        costType: purchaseOrderAdditionalCosts.costType,
        reference: purchaseOrderAdditionalCosts.reference,
        amount: purchaseOrderAdditionalCosts.amount,
        supplierId: purchaseOrderAdditionalCosts.supplierId,
      })
      .from(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, existing.id));
    await tx
      .delete(purchaseOrderAdditionalCosts)
      .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, existing.id));
    if (prepared.preparedAdditionalCosts.length > 0) {
      const nextCosts = carryCostSupplierAssignments(
        existingCosts,
        prepared.preparedAdditionalCosts,
      );
      await tx.insert(purchaseOrderAdditionalCosts).values(
        nextCosts.map((cost) => ({
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
