import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { bomRevisionOperationCosts, bomRevisions } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import type { Tx } from "@/lib/db/with-org-context";

export async function getBomRevisionOperationCostsInTx(
  tx: Tx,
  bomRevisionId: string
) {
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
    .where(eq(bomRevisionOperationCosts.bomRevisionId, bomRevisionId))
    .orderBy(
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
