import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { customerCategories, customerProjects, customers, itemFamilies, itemVariantValues, items, unitDefinitions, variantOptions, variantOptionValues } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { projectedAvailableQty, projectedDemandQty, projectedExpectedQty, projectedOnHandQty } from "@/lib/inventory/kernel";
import { SalesError } from "./errors";

export const stockSubquery = projectedOnHandQty(items.organizationId, items.id).as("stock");
export const demandQtySubquery = projectedDemandQty(
  items.organizationId,
  items.id
).as("demandQty");
export const availableQtySubquery = projectedAvailableQty(
  items.organizationId,
  items.id
).as("availableQty");
export const expectedQtySubquery = projectedExpectedQty(
  items.organizationId,
  items.id
).as("expectedQty");

export async function getSalesOptionLabelsByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, string[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      label: variantOptionValues.label,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id)
    )
    .where(inArray(itemVariantValues.itemId, uniqueItemIds))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, string[]>();
  for (const row of rows) {
    const labels = byItemId.get(row.itemId) ?? [];
    labels.push(row.label);
    byItemId.set(row.itemId, labels);
  }
  return byItemId;
}

type SalesVariantValue = {
  optionName: string;
  optionCode: string;
  valueLabel: string;
  valueCode: string;
};

export async function getSalesVariantValuesByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, SalesVariantValue[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      optionName: variantOptions.name,
      optionCode: variantOptions.code,
      valueLabel: variantOptionValues.label,
      valueCode: variantOptionValues.code,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id)
    )
    .where(
      and(
        inArray(itemVariantValues.itemId, uniqueItemIds),
        isNull(variantOptions.disabledAt),
        isNull(variantOptionValues.disabledAt)
      )
    )
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, SalesVariantValue[]>();
  for (const row of rows) {
    const values = byItemId.get(row.itemId) ?? [];
    values.push({
      optionName: row.optionName,
      optionCode: row.optionCode,
      valueLabel: row.valueLabel,
      valueCode: row.valueCode,
    });
    byItemId.set(row.itemId, values);
  }
  return byItemId;
}

export function formatSalesItemDisplayName(
  itemName: string,
  familyName: string | null,
  optionLabels: string[]
) {
  if (!familyName) return itemName;
  return optionLabels.length > 0 ? `${familyName} / ${optionLabels.join(" / ")}` : familyName;
}

export type SalesItemValidationRow = {
  id: string;
  itemType: string;
  name: string;
  familyName: string | null;
  sku: string | null;
  sellable: boolean | null;
  category: string | null;
  unitDefinitionId: string;
  unitName: string;
  variantValues: SalesVariantValue[];
  defaultSellingPrice: string | null;
  stock: string;
  demandQty: string;
  availableQty: string;
  expectedQty: string;
  safetyStock: string;
  displayName: string;
};

type ValidatedCustomerRow = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  customerCategoryName: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
};

export async function getValidatedCustomerInTx(tx: Tx, customerId: string) {
  const [customer] = await tx
    .select({
      id: customers.id,
      name: customers.name,
      customerCategoryId: customers.customerCategoryId,
      customerCategoryName: customerCategories.name,
      billingLine1: customers.billingLine1,
      billingLine2: customers.billingLine2,
      billingCity: customers.billingCity,
      billingRegion: customers.billingRegion,
      billingPostcode: customers.billingPostcode,
      billingCountry: customers.billingCountry,
      shipLine1: customers.shipLine1,
      shipLine2: customers.shipLine2,
      shipCity: customers.shipCity,
      shipRegion: customers.shipRegion,
      shipPostcode: customers.shipPostcode,
      shipCountry: customers.shipCountry,
    })
    .from(customers)
    .leftJoin(
      customerCategories,
      and(
        eq(customers.customerCategoryId, customerCategories.id),
        isNull(customerCategories.deletedAt)
      )
    )
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));

  if (!customer) {
    throw new SalesError("Customer not found", 404);
  }

  return customer satisfies ValidatedCustomerRow;
}

export async function getValidatedCustomerProjectInTx(
  tx: Tx,
  customerId: string,
  customerProjectId: string | null | undefined
) {
  if (customerProjectId == null) return null;

  const [project] = await tx
    .select({
      id: customerProjects.id,
      name: customerProjects.name,
    })
    .from(customerProjects)
    .where(
      and(
        eq(customerProjects.id, customerProjectId),
        eq(customerProjects.customerId, customerId),
        isNull(customerProjects.deletedAt)
      )
    );

  if (!project) {
    throw new SalesError("Project not found for this customer.", 400);
  }

  return project;
}

export async function getValidatedSalesItemsInTx(
  tx: Tx,
  itemIds: string[]
) {
  const uniqueIds = [...new Set(itemIds)];

  const rows = await tx
    .select({
      id: items.id,
      itemType: items.itemType,
      name: items.name,
      familyName: itemFamilies.name,
      sku: items.sku,
      sellable: items.sellable,
      category: sql<string | null>`COALESCE(${itemFamilies.category}, ${items.category})`,
      unitDefinitionId: items.unitDefinitionId,
      unitName: unitDefinitions.name,
      defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
        "defaultSellingPrice"
      ),
      stock: stockSubquery,
      demandQty: demandQtySubquery,
      availableQty: availableQtySubquery,
      expectedQty: expectedQtySubquery,
      safetyStock: trimScale(items.safetyStock).as("safetyStock"),
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(
      and(
        inArray(items.id, uniqueIds),
        inArray(items.itemType, ["product", "material"]),
        isNull(items.deletedAt)
      )
    );

  const [optionLabelsByItemId, variantValuesByItemId] = await Promise.all([
    getSalesOptionLabelsByItemIdInTx(tx, uniqueIds),
    getSalesVariantValuesByItemIdInTx(tx, uniqueIds),
  ]);

  const itemMap = new Map(
    rows.map((row) => {
      if (row.sellable !== true) {
        throw new SalesError("Only sellable items can be added to sales orders.", 400);
      }

      const displayName = formatSalesItemDisplayName(
        row.name,
        row.familyName,
        optionLabelsByItemId.get(row.id) ?? []
      );

      return [
        row.id,
        {
          ...row,
          displayName,
          variantValues: variantValuesByItemId.get(row.id) ?? [],
        } as SalesItemValidationRow & { displayName: string },
      ];
    })
  );

  if (itemMap.size !== uniqueIds.length) {
    throw new SalesError("Item not found", 404);
  }

  return itemMap;
}
