import "server-only";

import {
  and,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";
import {
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { normalizeLandedMoney } from "@/lib/purchasing/landed-cost";
import { groupPurchaseOrderByResolvedSupplier, resolvedAdditionalCostSupplierGroupKey } from "@/lib/purchasing/resolved-supplier-groups";
import { PurchasingError } from "./errors";

function additionalCostOrderNumberCandidate(parentOrderNumber: string, index: number) {
  const suffix = index === 1 ? "-AC" : `-AC${index}`;
  return `${parentOrderNumber.slice(0, 32 - suffix.length)}${suffix}`;
}

async function resolveAdditionalCostOrderNumberInTx(
  tx: Tx,
  orgId: string,
  parentOrderNumber: string,
) {
  for (let index = 1; index < 100; index += 1) {
    const candidate = additionalCostOrderNumberCandidate(parentOrderNumber, index);
    const [existing] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.organizationId, orgId),
          eq(purchaseOrders.orderNumber, candidate),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) return candidate;
  }

  throw new PurchasingError("Unable to assign an additional-cost PO number.", 409);
}

export async function createLinkedAdditionalCostPurchaseOrders(parentOrderId: string) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        supplierId: purchaseOrders.supplierId,
        supplierName: purchaseOrders.supplierName,
        status: purchaseOrders.status,
        expectedDate: purchaseOrders.expectedDate,
        accountingPurchaseAccountCode: purchaseOrders.accountingPurchaseAccountCode,
        shipLine1: purchaseOrders.shipLine1,
        shipLine2: purchaseOrders.shipLine2,
        shipCity: purchaseOrders.shipCity,
        shipRegion: purchaseOrders.shipRegion,
        shipPostcode: purchaseOrders.shipPostcode,
        shipCountry: purchaseOrders.shipCountry,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, parentOrderId),
          eq(purchaseOrders.type, "standard"),
          isNull(purchaseOrders.deletedAt),
          inArray(purchaseOrders.status, ["not_received"]),
        ),
      )
      .for("update");

    if (!order) return null;

    const [lineRows, costRows] = await Promise.all([
      tx
        .select({ id: purchaseOrderLines.id })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, parentOrderId)),
      tx
        .select({
          id: purchaseOrderAdditionalCosts.id,
          amount: trimScale(purchaseOrderAdditionalCosts.amount).as("amount"),
          supplierId:
            purchaseOrderAdditionalCosts.supplierId,
        })
        .from(purchaseOrderAdditionalCosts)
        .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, parentOrderId)),
    ]);
    const overrideSupplierIds = [
      ...new Set(
        costRows
          .map((cost) => cost.supplierId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const supplierRows =
      overrideSupplierIds.length === 0
        ? []
        : await tx
            .select({
              id: suppliers.id,
              name: suppliers.name,
              email: suppliers.email,
            })
            .from(suppliers)
            .where(
              and(
                inArray(suppliers.id, overrideSupplierIds),
                isNull(suppliers.deletedAt),
              ),
            );
    const suppliersById = new Map(
      supplierRows.map((supplier) => [supplier.id, supplier]),
    );
    const groups = groupPurchaseOrderByResolvedSupplier({
      purchaseOrderSupplier: {
        id: order.supplierId,
        name: order.supplierName,
      },
      suppliersById,
      lines: lineRows,
      additionalCosts: costRows,
    }).filter((group) => !group.isPurchaseOrderSupplier);
    const materialized = [];
    const activeAdditionalCostOrders = await tx
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        supplierId: purchaseOrders.supplierId,
        supplierName: purchaseOrders.supplierName,
        orderedAt: purchaseOrders.orderedAt,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.parentPurchaseOrderId, parentOrderId),
          eq(purchaseOrders.type, "additional_cost"),
          isNull(purchaseOrders.deletedAt),
        ),
      );
    const additionalCostOrderBySupplierId = new Map(
      activeAdditionalCostOrders.map((additionalCostOrder) => [
        additionalCostOrder.supplierId,
        additionalCostOrder,
      ]),
    );
    const activeGroupSupplierIds = new Set(
      groups.map((group) => group.supplier.id),
    );

    for (const group of groups) {
      const amount = normalizeLandedMoney(
        group.additionalCosts.reduce((sum, cost) => sum + Number(cost.amount), 0),
      );
      const existing = additionalCostOrderBySupplierId.get(group.supplier.id);

      if (existing) {
        await tx
          .update(purchaseOrders)
          .set({
            supplierName: group.supplier.name,
            status: order.status,
            expectedDate: order.expectedDate,
            accountingPurchaseAccountCode: order.accountingPurchaseAccountCode,
            shipLine1: order.shipLine1,
            shipLine2: order.shipLine2,
            shipCity: order.shipCity,
            shipRegion: order.shipRegion,
            shipPostcode: order.shipPostcode,
            shipCountry: order.shipCountry,
            shippingCost: amount,
            subtotalAmount: amount,
            taxAmount: "0",
            totalAmount: amount,
            orderedAt: order.status === "not_received"
              ? existing.orderedAt ?? new Date()
              : null,
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, existing.id));
        materialized.push({
          ...existing,
          supplierName: group.supplier.name,
          groupKey: resolvedAdditionalCostSupplierGroupKey(group.supplier.id),
          created: false,
        });
        continue;
      }

      const orderNumber = await resolveAdditionalCostOrderNumberInTx(
        tx,
        orgId,
        order.orderNumber,
      );
      const [created] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId: orgId,
          parentPurchaseOrderId: parentOrderId,
          type: "additional_cost",
          orderNumber,
          supplierId: group.supplier.id,
          supplierName: group.supplier.name,
          status: order.status,
          expectedDate: order.expectedDate,
          notes: `Additional cost for ${order.orderNumber}`,
          accountingPurchaseAccountCode: order.accountingPurchaseAccountCode,
          shipLine1: order.shipLine1,
          shipLine2: order.shipLine2,
          shipCity: order.shipCity,
          shipRegion: order.shipRegion,
          shipPostcode: order.shipPostcode,
          shipCountry: order.shipCountry,
          shippingCost: amount,
          subtotalAmount: amount,
          taxAmount: "0",
          totalAmount: amount,
          orderedAt: ["not_received", "partial", "received"].includes(order.status)
            ? new Date()
            : null,
        })
        .returning({
          id: purchaseOrders.id,
          orderNumber: purchaseOrders.orderNumber,
          supplierId: purchaseOrders.supplierId,
          supplierName: purchaseOrders.supplierName,
        });

      materialized.push({
        ...created,
        groupKey: resolvedAdditionalCostSupplierGroupKey(group.supplier.id),
        created: true,
      });
    }

    const staleAdditionalCostOrderIds = activeAdditionalCostOrders
      .filter((additionalCostOrder) => !activeGroupSupplierIds.has(additionalCostOrder.supplierId))
      .map((additionalCostOrder) => additionalCostOrder.id);
    if (staleAdditionalCostOrderIds.length > 0) {
      await tx
        .update(purchaseOrders)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(purchaseOrders.id, staleAdditionalCostOrderIds));
    }

    return materialized;
  });
}

export async function softDeleteLinkedAdditionalCostPurchaseOrdersInTx(
  tx: Tx,
  orgId: string,
  parentOrderIds: string[],
  deletedAt = new Date(),
) {
  const uniqueParentIds = [...new Set(parentOrderIds)].filter(Boolean);
  if (uniqueParentIds.length === 0) return;

  await tx
    .update(purchaseOrders)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(
      and(
        eq(purchaseOrders.organizationId, orgId),
        eq(purchaseOrders.type, "additional_cost"),
        inArray(purchaseOrders.parentPurchaseOrderId, uniqueParentIds),
        isNull(purchaseOrders.deletedAt),
      ),
    );
}
