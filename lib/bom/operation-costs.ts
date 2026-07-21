import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { bomRevisionOperationCosts, bomRevisions } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";

export async function getBomRevisionOperationCostsInTx(
  tx: Tx,
  bomRevisionId: string
) {
  return (await getBomRevisionOperationCostsByRevisionIdInTx(tx, [bomRevisionId])).get(
    bomRevisionId
  ) ?? [];
}

/**
 * Batch-load operation-cost snapshots, keyed by revision ID.
 * Revisions without operation costs are omitted from the returned map.
 */
export async function getBomRevisionOperationCostsByRevisionIdInTx(
  tx: Tx,
  bomRevisionIds: string[]
) {
  const uniqueRevisionIds = [...new Set(bomRevisionIds)];
  if (uniqueRevisionIds.length === 0) {
    return new Map<
      string,
      Awaited<ReturnType<typeof readBomRevisionOperationCostsInTx>>
    >();
  }

  const rows = await readBomRevisionOperationCostsInTx(tx, uniqueRevisionIds);
  const rowsByRevisionId = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = rowsByRevisionId.get(row.bomRevisionId) ?? [];
    bucket.push(row);
    rowsByRevisionId.set(row.bomRevisionId, bucket);
  }

  return rowsByRevisionId;
}

function readBomRevisionOperationCostsInTx(tx: Tx, bomRevisionIds: string[]) {
  return tx
    .select({
      id: bomRevisionOperationCosts.id,
      bomRevisionId: bomRevisionOperationCosts.bomRevisionId,
      resourceId: bomRevisionOperationCosts.resourceId,
      operationName: bomRevisionOperationCosts.operationName,
      resourceName: bomRevisionOperationCosts.resourceName,
      resourceType: bomRevisionOperationCosts.resourceType,
      costScalingMode: bomRevisionOperationCosts.costScalingMode,
      crewSize: trimScale(bomRevisionOperationCosts.crewSize).as("crewSize"),
      plannedMinutes: trimScale(bomRevisionOperationCosts.plannedMinutes).as(
        "plannedMinutes"
      ),
      loadedCostPerHour: trimScale(
        bomRevisionOperationCosts.loadedCostPerHour
      ).as("loadedCostPerHour"),
      plannedCostTotal: trimScale(
        bomRevisionOperationCosts.plannedCostTotal
      ).as("plannedCostTotal"),
      sortOrder: bomRevisionOperationCosts.sortOrder,
    })
    .from(bomRevisionOperationCosts)
    .where(inArray(bomRevisionOperationCosts.bomRevisionId, bomRevisionIds))
    .orderBy(
      asc(bomRevisionOperationCosts.bomRevisionId),
      asc(bomRevisionOperationCosts.sortOrder),
      asc(bomRevisionOperationCosts.createdAt)
    );
}

export async function getCurrentBomOperationCostsInTx(tx: Tx, productId: string) {
  const [revision] = await tx
    .select({ id: bomRevisions.id })
    .from(bomRevisions)
    .where(and(eq(bomRevisions.productId, productId), eq(bomRevisions.isCurrent, true)));

  return revision ? getBomRevisionOperationCostsInTx(tx, revision.id) : [];
}
