import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  items,
  itemFamilies,
  accountingClassifications,
  purchaseOrderAdditionalCosts,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/sync-state";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import {
  getItemDisplayMetadataByIdInTx,
} from "@/lib/inventory/item-display";
import { formatItemSnapshotDisplayName } from "@/lib/inventory/display-name";
import { alias } from "drizzle-orm/pg-core";
import { PurchasingError } from "./errors";

const additionalCostSuppliers = alias(
  suppliers,
  "additional_cost_suppliers",
);

type MaterialValidationRow = {
  id: string;
  itemType: string;
  name: string;
  displayName: string;
  sku: string | null;
  stockingUnitName: string;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  defaultPurchasePrice: string | null;
  currentStockUnitCost: string | null;
  accountingPurchaseAccountCode: string | null;
};

export async function getLockedPurchaseOrderInTx(tx: Tx, id: string) {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
      type: purchaseOrders.type,
      version: purchaseOrders.version,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

export async function getValidatedPurchasableItemsInTx(tx: Tx, itemIds: string[]) {
  const uniqueIds = [...new Set(itemIds)];

  const rows = await tx
    .select({
      id: items.id,
      itemType: sql<"material" | "product">`${items.itemType}`,
      name: items.name,
      sku: items.sku,
      stockingUnitName: unitDefinitions.name,
      purchaseUnitName: sql<string | null>`(
        SELECT ${unitDefinitions.name}
        FROM ${unitDefinitions}
        WHERE ${unitDefinitions.id} = COALESCE(${itemFamilies.purchaseUnitDefinitionId}, ${items.purchaseUnitDefinitionId})
      )`,
      purchaseToStockFactor: trimScaleNullable(
        sql`COALESCE(${itemFamilies.purchaseToStockFactor}, ${items.purchaseToStockFactor})`,
      ).as("purchaseToStockFactor"),
      defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
        "defaultPurchasePrice",
      ),
      currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
        "currentStockUnitCost",
      ),
      accountingPurchaseAccountCode: sql<string | null>`(
        SELECT ${accountingClassifications.accountCode}
        FROM ${accountingClassifications}
        WHERE ${accountingClassifications.provider} = ${ACCOUNTING_PROVIDER_XERO}
          AND ${accountingClassifications.entityType} = 'item'
          AND ${accountingClassifications.localRecordId} = ${items.id}
        LIMIT 1
      )`,
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        inArray(items.id, uniqueIds),
        inArray(items.itemType, ["material", "product"]),
        isNull(items.deletedAt),
      ),
    );

  const displayByItemId = await getItemDisplayMetadataByIdInTx(
    tx,
    rows.map((row) => row.id),
  );
  const itemMap = new Map(
    rows.map((row) => {
      const display = displayByItemId.get(row.id);
      return [
        row.id,
        {
          ...row,
          name: display?.masterName ?? row.name,
          displayName: display?.displayName ?? row.name,
        } as MaterialValidationRow,
      ];
    }),
  );

  if (itemMap.size !== uniqueIds.length) {
    throw new PurchasingError("Item not found", 404);
  }

  return itemMap;
}

export async function getPurchaseOrderLinesInTx(tx: Tx, purchaseOrderId: string) {
  const rows = await tx
    .select({
      id: purchaseOrderLines.id,
      itemId: purchaseOrderLines.itemId,
      itemName: purchaseOrderLines.itemName,
      itemSku: purchaseOrderLines.itemSku,
      supplierItemCode: items.supplierItemCode,
      internalBarcode: items.internalBarcode,
      lotTrackingMode: sql<"tracked" | "untracked">`COALESCE(${itemFamilies.lotTrackingMode}, 'tracked')`,
      purchaseUnitName: purchaseOrderLines.purchaseUnitName,
      stockingUnitName: purchaseOrderLines.stockingUnitName,
      purchaseToStockFactor: trimScale(
        purchaseOrderLines.purchaseToStockFactor,
      ).as("purchaseToStockFactor"),
      quantityOrdered: trimScale(purchaseOrderLines.quantityOrdered).as(
        "quantityOrdered",
      ),
      quantityReceived: trimScale(purchaseOrderLines.quantityReceived).as(
        "quantityReceived",
      ),
      stockQuantityOrdered: trimScale(
        purchaseOrderLines.stockQuantityOrdered,
      ).as("stockQuantityOrdered"),
      stockQuantityReceived: trimScale(
        purchaseOrderLines.stockQuantityReceived,
      ).as("stockQuantityReceived"),
      unitCost: trimScale(purchaseOrderLines.unitCost).as("unitCost"),
      stockUnitCost: trimScale(purchaseOrderLines.stockUnitCost).as(
        "stockUnitCost",
      ),
      taxRateId: purchaseOrderLines.taxRateId,
      taxRateName: purchaseOrderLines.taxRateName,
      taxRatePercent: trimScale(purchaseOrderLines.taxRatePercent).as(
        "taxRatePercent",
      ),
      accountingPurchaseAccountCode:
        purchaseOrderLines.accountingPurchaseAccountCode,
      shipAddressEntryId: purchaseOrderLines.shipAddressEntryId,
      shipContactName: purchaseOrderLines.shipContactName,
      shipContactPhone: purchaseOrderLines.shipContactPhone,
      shipLine1: purchaseOrderLines.shipLine1,
      shipLine2: purchaseOrderLines.shipLine2,
      shipCity: purchaseOrderLines.shipCity,
      shipRegion: purchaseOrderLines.shipRegion,
      shipPostcode: purchaseOrderLines.shipPostcode,
      shipCountry: purchaseOrderLines.shipCountry,
      shipDeliveryInstructions: purchaseOrderLines.shipDeliveryInstructions,
      lineSubtotal: trimScale(purchaseOrderLines.lineSubtotal).as(
        "lineSubtotal",
      ),
      lineTaxAmount: trimScale(purchaseOrderLines.lineTaxAmount).as(
        "lineTaxAmount",
      ),
      lineTotal: trimScale(purchaseOrderLines.lineTotal).as("lineTotal"),
      sortOrder: purchaseOrderLines.sortOrder,
      createdAt: purchaseOrderLines.createdAt,
      updatedAt: purchaseOrderLines.updatedAt,
    })
    .from(purchaseOrderLines)
    .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .leftJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
    .orderBy(
      asc(purchaseOrderLines.sortOrder),
      asc(purchaseOrderLines.createdAt),
    );

  const displayByItemId = await getItemDisplayMetadataByIdInTx(
    tx,
    rows.map((row) => row.itemId),
  );

  return rows.map((row) => {
    const display = displayByItemId.get(row.itemId);
    return {
      ...row,
      itemName: formatItemSnapshotDisplayName(
        row.itemName,
        display?.optionLabels ?? [],
        [display?.masterName, display?.name],
      ),
    };
  });
}

export async function getPurchaseOrderAdditionalCostsInTx(
  tx: Tx,
  purchaseOrderId: string,
) {
  return tx
    .select({
      id: purchaseOrderAdditionalCosts.id,
      costType: purchaseOrderAdditionalCosts.costType,
      reference: purchaseOrderAdditionalCosts.reference,
      supplierId:
        purchaseOrderAdditionalCosts.supplierId,
      supplierName: additionalCostSuppliers.name,
      supplierEmail: additionalCostSuppliers.email,
      distributionMethod: purchaseOrderAdditionalCosts.distributionMethod,
      accountingPurchaseAccountCode:
        purchaseOrderAdditionalCosts.accountingPurchaseAccountCode,
      amount: trimScale(purchaseOrderAdditionalCosts.amount).as("amount"),
      sortOrder: purchaseOrderAdditionalCosts.sortOrder,
      createdAt: purchaseOrderAdditionalCosts.createdAt,
      updatedAt: purchaseOrderAdditionalCosts.updatedAt,
    })
    .from(purchaseOrderAdditionalCosts)
    .leftJoin(
      additionalCostSuppliers,
      eq(additionalCostSuppliers.id, purchaseOrderAdditionalCosts.supplierId),
    )
    .where(eq(purchaseOrderAdditionalCosts.purchaseOrderId, purchaseOrderId))
    .orderBy(
      asc(purchaseOrderAdditionalCosts.sortOrder),
      asc(purchaseOrderAdditionalCosts.createdAt),
    );
}
