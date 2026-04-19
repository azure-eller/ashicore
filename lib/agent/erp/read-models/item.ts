import type { ItemRow } from "@/app/(dashboard)/inventory/types";
import { getItem, getItems } from "@/app/(dashboard)/inventory/queries";
import type { ErpGetOutput, ErpListItem, ErpListOutput, ErpRecord } from "@/lib/agent/erp/read-models/types";

function paginate<T>(items: T[], limit: number, offset: number) {
  const paged = items.slice(offset, offset + limit);
  const nextOffset = offset + paged.length;

  return {
    items: paged,
    truncated: nextOffset < items.length,
    nextOffset: nextOffset < items.length ? nextOffset : undefined,
  };
}

function toItemRecord(row: Awaited<ReturnType<typeof getItem>> extends infer T ? Exclude<T, null> : never): ErpRecord {
  return {
    id: row.id,
    updatedAt: row.bomLockedAt?.toISOString() ?? new Date(0).toISOString(),
    title: row.displayName,
    subtitle: row.sku ?? row.category ?? null,
    status: row.itemType,
    badges: [
      row.itemType,
      ...(row.sellable === false ? ["not_sellable"] : []),
      ...(row.bomLocked ? ["bom_locked"] : []),
    ],
    fields: {
      name: row.name,
      displayName: row.displayName,
      sku: row.sku,
      itemType: row.itemType,
      category: row.category,
      description: row.description,
      unitDefinitionId: row.unitDefinitionId,
      purchaseUnitDefinitionId: row.purchaseUnitDefinitionId,
      purchaseToStockFactor: row.purchaseToStockFactor,
      defaultPurchasePrice: row.defaultPurchasePrice,
      defaultSellingPrice: row.defaultSellingPrice,
      sellable: row.sellable,
      manufacturingMode: row.manufacturingMode,
      expectedBatchYield: row.expectedBatchYield,
      stock: row.stock,
      committedQty: row.committedQty,
      expectedQty: row.expectedQty,
      safetyStock: row.safetyStock,
      unitName: row.unitName,
      unitSize: row.unitSize,
      unitUom: row.unitUom,
      purchaseUnitName: row.purchaseUnitName,
      purchaseUnitSize: row.purchaseUnitSize,
      purchaseUnitUom: row.purchaseUnitUom,
      bomLocked: row.bomLocked,
      bomLockedAt: row.bomLockedAt?.toISOString() ?? null,
      currentBomRevisionId: row.currentBomRevision?.id ?? null,
      currentBomRevisionUpdatedAt: row.currentBomRevision?.updatedAt.toISOString() ?? null,
    },
  };
}

function toItemListItem(row: ItemRow): ErpListItem {
  return {
    id: row.id,
    title: row.displayName,
    subtitle: row.sku ?? row.category ?? null,
    status: row.itemType,
    badges: [
      row.itemType,
      ...(row.hasBom ? ["has_bom"] : []),
      ...(row.usedInBom ? ["used_in_bom"] : []),
    ],
    updatedAt: row.createdAt.toISOString(),
    fields: {
      name: row.name,
      sku: row.sku,
      itemType: row.itemType,
      category: row.category,
      stock: row.stock,
      committedQty: row.committedQty,
      expectedQty: row.expectedQty,
      safetyStock: row.safetyStock,
      unit: row.unit,
      priceRange: row.priceRange,
      hasBom: row.hasBom,
      usedInBom: row.usedInBom,
      usedInCount: row.usedInCount,
    },
  };
}

export async function listItemsForAgent(args: {
  limit: number;
  offset: number;
  search?: string;
  itemType?: "material" | "product";
  view?: "products" | "sub-assemblies";
}): Promise<ErpListOutput> {
  const items = await getItems({
    itemType: args.itemType,
    view: args.view,
  });
  const search = args.search?.trim().toLowerCase();

  const filtered = items
    .filter((item) => {
      if (!search) {
        return true;
      }

      return [item.displayName, item.name, item.sku, item.category]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    })
    .map(toItemListItem);

  const paged = paginate(filtered, args.limit, args.offset);

  return {
    entityType: "item",
    ...paged,
  };
}

export async function getItemForAgent(id: string): Promise<ErpGetOutput | null> {
  const item = await getItem(id);
  if (!item) {
    return null;
  }

  return {
    entityType: "item",
    record: toItemRecord(item),
  };
}
