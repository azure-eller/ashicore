import "server-only";

import { and, eq, isNull, ne } from "drizzle-orm";
import {
  items,
  supplierItems,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { DomainError } from "@/lib/errors/domain-error";
import type { Tx } from "@/lib/db/with-org-context";
import type { UpdatePlanningRules } from "@/lib/schemas/planning";

export class PlanningRulesError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "PlanningRulesError" });
  }
}

function setDefined<T extends Record<string, unknown>, K extends string>(
  target: T,
  key: K,
  value: unknown
) {
  if (value !== undefined) {
    target[key as keyof T] = value as T[keyof T];
  }
}

async function assertActivePlanningItemInTx(tx: Tx, itemId: string) {
  const [item] = await tx
    .select({
      id: items.id,
      itemType: items.itemType,
      isMaster: items.isMaster,
    })
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
    .limit(1);

  if (!item || item.isMaster) {
    throw new PlanningRulesError("Item not found.", 404);
  }

  return item;
}

async function assertActiveSupplierInTx(tx: Tx, supplierId: string) {
  const [supplier] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)))
    .limit(1);

  if (!supplier) {
    throw new PlanningRulesError("Supplier not found.", 404);
  }
}

async function assertUnitDefinitionInTx(
  tx: Tx,
  unitDefinitionId: string | null | undefined
) {
  if (unitDefinitionId == null) return;

  const [unit] = await tx
    .select({ id: unitDefinitions.id })
    .from(unitDefinitions)
    .where(eq(unitDefinitions.id, unitDefinitionId))
    .limit(1);

  if (!unit) {
    throw new PlanningRulesError("Purchase unit not found.", 404);
  }
}

async function updatePreferredSupplierItemInTx(
  tx: Tx,
  orgId: string,
  itemId: string,
  data: UpdatePlanningRules["preferredSupplierItem"]
) {
  if (data == null || data.supplierId == null) {
    await tx
      .update(supplierItems)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supplierItems.itemId, itemId),
          eq(supplierItems.isPreferred, true),
          isNull(supplierItems.deletedAt)
        )
      );
    return;
  }

  await assertActiveSupplierInTx(tx, data.supplierId);
  await assertUnitDefinitionInTx(tx, data.purchaseUnitDefinitionId);

  await tx
    .update(supplierItems)
    .set({
      isPreferred: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(supplierItems.itemId, itemId),
        ne(supplierItems.supplierId, data.supplierId),
        eq(supplierItems.isPreferred, true),
        isNull(supplierItems.deletedAt)
      )
    );

  const values = {
    supplierSku: data.supplierSku ?? null,
    unitCost: data.unitCost ?? null,
    purchaseUnitDefinitionId: data.purchaseUnitDefinitionId ?? null,
    purchaseToStockFactor: data.purchaseToStockFactor ?? null,
    leadTimeDaysOverride: data.leadTimeDaysOverride ?? null,
    minimumOrderQuantity: data.minimumOrderQuantity ?? null,
    orderMultiple: data.orderMultiple ?? null,
    isPreferred: data.isPreferred ?? true,
    updatedAt: new Date(),
  };

  const [existing] = await tx
    .select({ id: supplierItems.id })
    .from(supplierItems)
    .where(
      and(
        eq(supplierItems.itemId, itemId),
        eq(supplierItems.supplierId, data.supplierId),
        isNull(supplierItems.deletedAt)
      )
    )
    .limit(1);

  if (existing) {
    await tx
      .update(supplierItems)
      .set(values)
      .where(eq(supplierItems.id, existing.id));
    return;
  }

  await tx.insert(supplierItems).values({
    organizationId: orgId,
    supplierId: data.supplierId,
    itemId,
    ...values,
  });
}

export async function updatePlanningRules(itemId: string, data: UpdatePlanningRules) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertActivePlanningItemInTx(tx, itemId);

    const itemUpdates: Record<string, unknown> = { updatedAt: new Date() };
    setDefined(itemUpdates, "planningEnabled", data.planningEnabled);
    setDefined(itemUpdates, "reorderPoint", data.reorderPoint);
    setDefined(itemUpdates, "targetCoverDays", data.targetCoverDays);
    setDefined(itemUpdates, "leadTimeDaysOverride", data.leadTimeDaysOverride);
    setDefined(itemUpdates, "productionLeadTimeDays", data.productionLeadTimeDays);

    if (Object.keys(itemUpdates).length > 1) {
      await tx.update(items).set(itemUpdates).where(eq(items.id, itemId));
    }

    if (data.preferredSupplierItem !== undefined) {
      await updatePreferredSupplierItemInTx(
        tx,
        orgId,
        itemId,
        data.preferredSupplierItem
      );
    }

    return { id: itemId };
  });
}
