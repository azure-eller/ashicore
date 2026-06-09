import { asc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { diffProjections } from "./reconcile";

export type InventoryProjectionDiff = Awaited<ReturnType<typeof diffProjections>>;

export type InventoryProjectionDiffSummary = {
  itemDeltas: number;
  lotDeltas: number;
  demandDeltas: number;
  expectedDeltas: number;
  legacyLotDeltas: number;
};

export type InventoryProjectionDiffResult = {
  orgId: string;
  ok: boolean;
  summary: InventoryProjectionDiffSummary;
  diff: InventoryProjectionDiff;
};

export function summarizeProjectionDiff(
  diff: InventoryProjectionDiff
): InventoryProjectionDiffSummary {
  return {
    itemDeltas: diff.itemDeltas.length,
    lotDeltas: diff.lotDeltas.length,
    demandDeltas: diff.demandDeltas.length,
    expectedDeltas: diff.expectedDeltas.length,
    legacyLotDeltas: diff.legacyLotDeltas.length,
  };
}

export async function diffInventoryStateForOrg(
  orgId: string,
  itemIds?: string[]
): Promise<InventoryProjectionDiffResult> {
  const diff = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return diffProjections(tx, orgId, itemIds);
  });
  const summary = summarizeProjectionDiff(diff);

  return {
    orgId,
    ok: !Object.values(summary).some((count) => count > 0),
    summary,
    diff,
  };
}

export async function listOrganizationIds(orgIds?: string[]) {
  const query = db
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.createdAt));

  const rows =
    orgIds && orgIds.length > 0
      ? await query.where(inArray(organization.id, orgIds))
      : await query;

  return rows.map((row) => row.id);
}

export async function diffInventoryStateForOrganizations(orgIds?: string[]) {
  const ids = await listOrganizationIds(orgIds);
  const results: InventoryProjectionDiffResult[] = [];

  for (const orgId of ids) {
    results.push(await diffInventoryStateForOrg(orgId));
  }

  return results;
}
