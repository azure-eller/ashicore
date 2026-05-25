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

export async function getItemDisplayNamesByIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)].filter(Boolean);
  if (uniqueItemIds.length === 0) return new Map<string, string>();

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
      formatItemDisplayName({
        ...row,
        optionLabels: optionLabelsByItemId.get(row.id) ?? [],
      }),
    ])
  );
}
