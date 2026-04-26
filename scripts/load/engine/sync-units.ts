import { eq } from "drizzle-orm";
import { unitDefinitions } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { getUnitSignature } from "./org";
import type { ExistingUnit, Report, UnitSeed } from "./types";

export function assertNoDuplicateUnits(
  rows: ExistingUnit[],
  relevantSignatures?: Set<string>
) {
  const seen = new Set<string>();
  for (const row of rows) {
    const signature = getUnitSignature(row.name, row.size, row.uom);
    if (relevantSignatures && !relevantSignatures.has(signature)) {
      continue;
    }
    if (seen.has(signature)) {
      throw new Error(`Duplicate unit definition found for signature ${signature}.`);
    }
    seen.add(signature);
  }
}

export async function loadExistingUnitsInTx(tx: Tx): Promise<ExistingUnit[]> {
  return tx
    .select({
      id: unitDefinitions.id,
      name: unitDefinitions.name,
      size: unitDefinitions.size,
      uom: unitDefinitions.uom,
      deletedAt: unitDefinitions.deletedAt,
    })
    .from(unitDefinitions);
}

export function planUnitsSync(
  units: UnitSeed[],
  existingUnitsBySignature: Map<string, ExistingUnit>,
  report: Report
) {
  for (const unit of units) {
    const existing = existingUnitsBySignature.get(
      getUnitSignature(unit.name, unit.size, unit.uom)
    );
    if (!existing) {
      report.createdUnits.push(unit.name);
      continue;
    }
    if (existing.deletedAt) {
      report.reactivatedUnits.push(unit.name);
      continue;
    }
    report.unchangedUnits.push(unit.name);
  }
}

export async function applyUnitsSyncInTx(
  tx: Tx,
  units: UnitSeed[],
  orgId: string,
  unitsBySignature: Map<string, ExistingUnit>,
  unitIdByKey: Map<string, string>,
  report: Report
) {
  for (const unit of units) {
    const signature = getUnitSignature(unit.name, unit.size, unit.uom);
    const existing = unitsBySignature.get(signature);

    if (!existing) {
      const [created] = await tx
        .insert(unitDefinitions)
        .values({
          organizationId: orgId,
          name: unit.name,
          size: unit.size,
          uom: unit.uom,
        })
        .returning({
          id: unitDefinitions.id,
          name: unitDefinitions.name,
          size: unitDefinitions.size,
          uom: unitDefinitions.uom,
          deletedAt: unitDefinitions.deletedAt,
        });
      unitsBySignature.set(signature, created);
      unitIdByKey.set(unit.key, created.id);
      report.createdUnits.push(unit.name);
      continue;
    }

    if (existing.deletedAt) {
      await tx
        .update(unitDefinitions)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(unitDefinitions.id, existing.id));
      report.reactivatedUnits.push(unit.name);
    } else {
      report.unchangedUnits.push(unit.name);
    }

    unitIdByKey.set(unit.key, existing.id);
  }
}
