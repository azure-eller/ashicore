import { and, eq, inArray, isNull } from "drizzle-orm";
import { itemFamilies, items } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";

export const LOT_TRACKING_MODES = ["tracked", "untracked"] as const;
export type LotTrackingMode = (typeof LOT_TRACKING_MODES)[number];

export class LotTrackingError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "LotTrackingError" });
  }
}

export async function getItemLotTrackingModeInTx(
  tx: Tx,
  itemId: string
): Promise<LotTrackingMode> {
  const [row] = await tx
    .select({ lotTrackingMode: itemFamilies.lotTrackingMode })
    .from(items)
    .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(and(eq(items.id, itemId), isNull(itemFamilies.deletedAt)));

  if (!row) {
    console.warn("Lot tracking mode resolution failed; defaulting to tracked.", {
      itemId,
    });
  }

  return (row?.lotTrackingMode as LotTrackingMode | undefined) ?? "tracked";
}

export async function getItemLotTrackingModesByItemIdInTx(
  tx: Tx,
  itemIds: string[]
): Promise<Map<string, LotTrackingMode>> {
  const uniqueItemIds = [...new Set(itemIds)].filter(Boolean);
  const modes = new Map<string, LotTrackingMode>();
  if (uniqueItemIds.length === 0) return modes;

  const rows = await tx
    .select({
      itemId: items.id,
      lotTrackingMode: itemFamilies.lotTrackingMode,
    })
    .from(items)
    .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(and(inArray(items.id, uniqueItemIds), isNull(itemFamilies.deletedAt)));

  for (const row of rows) {
    modes.set(
      row.itemId,
      (row.lotTrackingMode as LotTrackingMode | undefined) ?? "tracked"
    );
  }

  for (const itemId of uniqueItemIds) {
    if (!modes.has(itemId)) {
      console.warn("Lot tracking mode resolution failed; defaulting to tracked.", {
        itemId,
      });
      modes.set(itemId, "tracked");
    }
  }

  return modes;
}

export async function assertTrackedItemInTx(
  tx: Tx,
  itemId: string,
  message = "This item is not lot tracked."
) {
  const mode = await getItemLotTrackingModeInTx(tx, itemId);
  if (mode === "untracked") {
    throw new LotTrackingError(message, 409);
  }
}
