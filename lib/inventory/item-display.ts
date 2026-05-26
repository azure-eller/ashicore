import { asc, eq, inArray } from "drizzle-orm";
import {
  itemFamilies,
  itemVariantValues,
  items,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

type ItemDisplayRow = {
  id: string;
  name: string;
  familyName: string | null;
};

export type ItemDisplayMetadata = ItemDisplayRow & {
  displayName: string;
  masterName: string;
  optionLabels: string[];
};

export function formatItemDisplayName(row: {
  name: string;
  familyName: string | null;
  optionLabels?: string[];
}) {
  const optionLabels = row.optionLabels ?? [];
  if (row.familyName && optionLabels.length > 0) {
    return `${row.familyName} / ${optionLabels.join(" / ")}`;
  }
  return row.familyName ?? row.name;
}

export function formatItemDisplayMetadata(row: {
  id: string;
  name: string;
  familyName: string | null;
  optionLabels?: string[];
}): ItemDisplayMetadata {
  const optionLabels = row.optionLabels ?? [];

  return {
    id: row.id,
    name: row.name,
    familyName: row.familyName,
    displayName: formatItemDisplayName({ ...row, optionLabels }),
    masterName: row.familyName ?? row.name,
    optionLabels,
  };
}

function activeOptionLabels(
  rows: Array<{ label: string; optionDisabledAt: Date | null; valueDisabledAt: Date | null }>,
) {
  return rows
    .filter((row) => row.optionDisabledAt == null && row.valueDisabledAt == null)
    .map((row) => row.label);
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
      })
      .from(items)
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(inArray(items.id, uniqueItemIds)),
    tx
      .select({
        itemId: itemVariantValues.itemId,
        label: variantOptionValues.label,
        optionDisabledAt: variantOptions.disabledAt,
        valueDisabledAt: variantOptionValues.disabledAt,
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

  const optionLabelsByItemId = new Map<
    string,
    Array<{ label: string; optionDisabledAt: Date | null; valueDisabledAt: Date | null }>
  >();
  for (const row of optionRows) {
    const bucket = optionLabelsByItemId.get(row.itemId) ?? [];
    bucket.push({
      label: row.label,
      optionDisabledAt: row.optionDisabledAt,
      valueDisabledAt: row.valueDisabledAt,
    });
    optionLabelsByItemId.set(row.itemId, bucket);
  }

  return new Map(
    itemRows.map((row: ItemDisplayRow) => [
      row.id,
      formatItemDisplayMetadata({
        ...row,
        optionLabels: activeOptionLabels(optionLabelsByItemId.get(row.id) ?? []),
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
