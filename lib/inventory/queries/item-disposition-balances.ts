import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type InventoryDisposition,
  inventoryLotBalances,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";
import { defaultLocationIdSubquery } from "@/lib/inventory/kernel";

export type ItemDispositionBalance = {
  disposition: InventoryDisposition;
  quantity: string;
};

export async function getDispositionBalancesByItemIdInTx(
  tx: Tx,
  itemIds: string[],
  locationId: string | null = null,
) {
  if (itemIds.length === 0) {
    return new Map<string, ItemDispositionBalance[]>();
  }

  const rows = await tx
    .select({
      itemId: inventoryLotBalances.itemId,
      disposition: inventoryLotBalances.disposition,
      quantity: trimScale(sql`SUM(${inventoryLotBalances.quantity})`).as("quantity"),
    })
    .from(inventoryLotBalances)
    .where(
      and(
        inArray(inventoryLotBalances.itemId, itemIds),
        locationId
          ? eq(inventoryLotBalances.locationId, locationId)
          : sql`${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
              inventoryLotBalances.organizationId,
            )}`,
        sql`${inventoryLotBalances.quantity} > 0`,
      ),
    )
    .groupBy(inventoryLotBalances.itemId, inventoryLotBalances.disposition);

  const balancesByItemId = new Map<string, ItemDispositionBalance[]>();
  for (const row of rows) {
    const balances = balancesByItemId.get(row.itemId) ?? [];
    balances.push({
      disposition: row.disposition as InventoryDisposition,
      quantity: row.quantity,
    });
    balancesByItemId.set(row.itemId, balances);
  }

  return balancesByItemId;
}
