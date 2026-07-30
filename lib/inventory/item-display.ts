import { asc, eq, inArray } from "drizzle-orm";
import {
  itemFamilies,
  itemVariantValues,
  items,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { formatItemDisplayName } from "@/lib/inventory/display-name";

export { formatItemDisplayName } from "@/lib/inventory/display-name";

type ItemDisplayRow = {
  id: string;
  name: string;
  familyName: string | null;
  deletedAt: Date | null;
};

export type ItemDisplayMetadata = ItemDisplayRow & {
  displayName: string;
  masterName: string;
  optionLabels: string[];
};

export function formatItemDisplayMetadata(row: {
  id: string;
  name: string;
  familyName: string | null;
  optionLabels?: string[];
  deletedAt: Date | null;
}): ItemDisplayMetadata {
  const optionLabels = row.optionLabels ?? [];

  return {
    id: row.id,
    name: row.name,
    familyName: row.familyName,
    deletedAt: row.deletedAt,
    displayName: formatItemDisplayName({ ...row, optionLabels }),
    masterName: row.familyName ?? row.name,
    optionLabels,
  };
}

export async function getItemDisplayMetadataByIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)].filter(Boolean);
  if (uniqueItemIds.length === 0) return new Map<string, ItemDisplayMetadata>();

  const [itemRows, optionRows] = await Promise.all([
    tx
      .select({
        id: items.id,
        name: items.name,
        familyName: itemFamilies.name,
        deletedAt: items.deletedAt,
      })
      .from(items)
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(inArray(items.id, uniqueItemIds)),
    tx
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
      .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder)),
  ]);

  const optionLabelsByItemId = new Map<string, string[]>();
  for (const row of optionRows) {
    const bucket = optionLabelsByItemId.get(row.itemId) ?? [];
    bucket.push(row.label);
    optionLabelsByItemId.set(row.itemId, bucket);
  }

  return new Map(
    itemRows.map((row: ItemDisplayRow) => [
      row.id,
      formatItemDisplayMetadata({
        ...row,
        optionLabels: optionLabelsByItemId.get(row.id) ?? [],
      }),
    ])
  );
}

export async function getItemDisplayNamesByIdInTx(tx: Tx, itemIds: string[]) {
  const metadataById = await getItemDisplayMetadataByIdInTx(tx, itemIds);
  return new Map(
    [...metadataById.entries()].map(([itemId, metadata]) => [
      itemId,
      metadata.displayName,
    ])
  );
}
