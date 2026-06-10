import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import {
  itemFamilies,
  items,
  accountingClassifications,
  integrationExternalRecords,
  supplierItems,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  trimScale,
  trimScaleNullable,
} from "@/lib/db/numeric";
import {
  getCurrentBomRevisionInTx,
} from "@/lib/bom/revisions";
import {
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import { stockSubquery, demandQtySubquery, availableQtySubquery, expectedQtySubquery, getVariantOptionValuesByItemIdInTx, formatNormalizedVariantDisplay, buildDuplicateCombinationWarnings } from "./shared";

export async function getItem(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .select({
        id: items.id,
        familyId: items.familyId,
        familyName: itemFamilies.name,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        category: sql<string | null>`COALESCE(${itemFamilies.category}, ${items.category})`,
        description: sql<string | null>`COALESCE(${itemFamilies.description}, ${items.description})`,
        unitDefinitionId: sql<string | null>`COALESCE(${items.unitDefinitionId}, ${itemFamilies.unitDefinitionId})`,
        purchaseUnitDefinitionId: sql<string | null>`COALESCE(${itemFamilies.purchaseUnitDefinitionId}, ${items.purchaseUnitDefinitionId})`,
        purchaseToStockFactor: trimScaleNullable(
          sql`COALESCE(${itemFamilies.purchaseToStockFactor}, ${items.purchaseToStockFactor})`
        ).as("purchaseToStockFactor"),
        defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
          "defaultPurchasePrice"
        ),
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
          "defaultSellingPrice"
        ),
        sellable: items.sellable,
        expectedBatchYield: trimScaleNullable(items.expectedBatchYield).as(
          "expectedBatchYield"
        ),
        typicalBatchSize: trimScaleNullable(items.typicalBatchSize).as(
          "typicalBatchSize"
        ),
        standardCostQuantity: trimScaleNullable(items.standardCostQuantity).as(
          "standardCostQuantity"
        ),
        optionCombinationKey: items.optionCombinationKey,
        registeredBarcode: items.registeredBarcode,
        internalBarcode: items.internalBarcode,
        supplierItemCode: items.supplierItemCode,
        defaultLeadTimeDays: items.defaultLeadTimeDays,
        minimumOrderQuantity: trimScaleNullable(items.minimumOrderQuantity).as(
          "minimumOrderQuantity"
        ),
        bomLocked: items.bomLocked,
        bomLockedAt: items.bomLockedAt,
        bomLockedByUserId: items.bomLockedByUserId,
        stock: stockSubquery,
        demandQty: demandQtySubquery,
        availableQty: availableQtySubquery,
        expectedQty: expectedQtySubquery,
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
        unitName: unitDefinitions.name,
        unitSize: trimScale(unitDefinitions.size).as("unitSize"),
        unitUom: unitDefinitions.uom,
      })
      .from(items)
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.id, id), isNull(items.deletedAt)));

    if (!row) {
      return null;
    }

    const purchaseUnit = row.purchaseUnitDefinitionId
      ? await tx
          .select({
            id: unitDefinitions.id,
            name: unitDefinitions.name,
            size: trimScale(unitDefinitions.size).as("size"),
            uom: unitDefinitions.uom,
          })
          .from(unitDefinitions)
          .where(eq(unitDefinitions.id, row.purchaseUnitDefinitionId))
          .then((rows) => rows[0] ?? null)
      : null;
    const currentBomRevision = await getCurrentBomRevisionInTx(tx, id);

    const [externalItemRecord] = await tx
      .select({
        externalCode: integrationExternalRecords.externalCode,
        externalName: integrationExternalRecords.externalName,
        externalDescription: integrationExternalRecords.externalDescription,
        externalUpdatedAt: integrationExternalRecords.externalUpdatedAt,
      })
      .from(integrationExternalRecords)
      .where(
        and(
          eq(integrationExternalRecords.provider, "xero"),
          eq(integrationExternalRecords.entityType, "item"),
          eq(integrationExternalRecords.localRecordId, id)
        )
      );

    const [accountingClassification] = await tx
      .select({
        accountCode: accountingClassifications.accountCode,
        taxType: accountingClassifications.taxType,
      })
      .from(accountingClassifications)
      .where(
        and(
          eq(accountingClassifications.provider, "xero"),
          eq(accountingClassifications.entityType, "item"),
          eq(accountingClassifications.localRecordId, id)
        )
      );

    const optionValuesByItemId = await getVariantOptionValuesByItemIdInTx(tx, [id]);
    const optionValues = optionValuesByItemId.get(id) ?? [];
    const familyVariants = row.familyId
      ? await tx
          .select({
            id: items.id,
            optionCombinationKey: items.optionCombinationKey,
          })
          .from(items)
          .where(and(eq(items.familyId, row.familyId), isNull(items.deletedAt)))
      : [{ id: row.id, optionCombinationKey: row.optionCombinationKey }];
    const duplicateWarningsByItemId =
      buildDuplicateCombinationWarnings(familyVariants);

    const supplierSources = await tx
      .select({
        id: supplierItems.id,
        supplierName: suppliers.name,
        supplierSku: supplierItems.supplierSku,
        unitCost: trimScaleNullable(supplierItems.unitCost).as("unitCost"),
        isPreferred: supplierItems.isPreferred,
      })
      .from(supplierItems)
      .innerJoin(suppliers, eq(supplierItems.supplierId, suppliers.id))
      .where(
        and(
          eq(supplierItems.itemId, id),
          isNull(supplierItems.deletedAt),
          isNull(suppliers.deletedAt)
        )
      )
      .orderBy(desc(supplierItems.isPreferred), asc(suppliers.name));

    return {
      ...row,
      xeroItemCode: externalItemRecord?.externalCode ?? null,
      xeroItemName: externalItemRecord?.externalName ?? null,
      xeroPurchaseDescription: externalItemRecord?.externalDescription ?? null,
      accountingPurchaseAccountCode: accountingClassification?.accountCode ?? null,
      xeroPurchaseTaxType: accountingClassification?.taxType ?? null,
      xeroUpdatedAt: externalItemRecord?.externalUpdatedAt ?? null,
      parentName: null,
      optionValues,
      duplicateCombinationWarnings:
        duplicateWarningsByItemId.get(row.id) ?? [],
      displayName: optionValues.length > 0
        ? formatNormalizedVariantDisplay(row.familyName, row.name, optionValues)
        : row.familyName ?? row.name,
      purchaseUnitName: purchaseUnit?.name ?? null,
      purchaseUnitSize: purchaseUnit?.size ?? null,
      purchaseUnitUom: purchaseUnit?.uom ?? null,
      currentBomRevision,
      supplierSources,
    };
  });
}
