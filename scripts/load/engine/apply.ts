import { eq, inArray, isNotNull } from "drizzle-orm";
import { items, salesOrderLines } from "@/lib/db/schema";
import { formatVariantDisplay } from "@/lib/format";
import { withOrgContext } from "@/lib/db/with-org-context";
import { getUnitSignature } from "./org";
import { applyBomsSyncInTx } from "./sync-boms";
import { applyItemsSyncInTx, assertNoDuplicateSkus, loadExistingItemsInTx } from "./sync-items";
import { applyStockSyncInTx } from "./sync-stock";
import { applySuppliersSyncInTx } from "./sync-suppliers";
import { applyUnitsSyncInTx, assertNoDuplicateUnits, loadExistingUnitsInTx } from "./sync-units";
import { createEmptyReport } from "./types";
import type { ExistingItem, LoaderConfig, Report } from "./types";

export async function applyChanges(
  orgId: string,
  config: LoaderConfig,
  actorUserId: string,
  idempotencyKeyPrefix: string
): Promise<Report> {
  const seedByKey = new Map(config.seeds.map((seed) => [seed.key, seed]));
  const managedUnitSignatures = new Set(
    config.units.map((unit) => getUnitSignature(unit.name, unit.size, unit.uom))
  );
  const managedItemSkus = new Set(
    config.seeds
      .flatMap((seed) => [seed.sku, ...(seed.legacySkus ?? [])])
      .filter((sku): sku is string => sku != null)
  );

  return withOrgContext(orgId, async (tx) => {
    const report = createEmptyReport();

    const existingUnits = await loadExistingUnitsInTx(tx);
    assertNoDuplicateUnits(existingUnits, managedUnitSignatures);

    const unitsBySignature = new Map(
      existingUnits.map((row) => [getUnitSignature(row.name, row.size, row.uom), row])
    );
    const unitIdByKey = new Map<string, string>();

    await applyUnitsSyncInTx(tx, config.units, orgId, unitsBySignature, unitIdByKey, report);

    const existingItems = await loadExistingItemsInTx(tx);
    assertNoDuplicateSkus(existingItems, managedItemSkus);

    const itemBySku = new Map(
      existingItems
        .filter((row): row is ExistingItem & { sku: string } => row.sku != null)
        .map((row) => [row.sku, row])
    );
    const itemByName = new Map(existingItems.map((row) => [row.name, row]));
    const itemIdByKey = new Map<string, string>();

    await applyItemsSyncInTx(
      tx,
      config.seeds,
      orgId,
      unitIdByKey,
      itemBySku,
      itemByName,
      itemIdByKey,
      report,
      config.internalOnlyProductCategories
    );

    await applyBomsSyncInTx(
      tx,
      config.seeds,
      orgId,
      itemIdByKey,
      report,
      actorUserId,
      config.bomRevisionNote ?? "Managed by data loader"
    );

    await applyStockSyncInTx(
      tx,
      seedByKey,
      config.initialStockByKey,
      config.openingLotPrefix,
      orgId,
      itemIdByKey,
      report,
      actorUserId,
      idempotencyKeyPrefix
    );

    await applySuppliersSyncInTx(tx, config.suppliers, orgId, report);

    // Repair historical SO line snapshots for variant items.
    // Snapshots used to be "Raised Bed Mix 2 Cubic Foot Bag" (old format).
    // New format is "Raised Bed Mix / 2 Cubic Foot Bag" — master name + attrs via formatVariantDisplay.
    const variantLineItems = await tx
      .select({
        lineId: salesOrderLines.id,
        parentId: items.parentId,
        variantAttrs: items.variantAttrs,
      })
      .from(salesOrderLines)
      .innerJoin(items, eq(salesOrderLines.itemId, items.id))
      .where(isNotNull(items.parentId));

    if (variantLineItems.length > 0) {
      const masterIds = [...new Set(variantLineItems.map((l) => l.parentId!))];
      const masterRows = await tx
        .select({ id: items.id, name: items.name, variantAxes: items.variantAxes })
        .from(items)
        .where(inArray(items.id, masterIds));
      const masterById = new Map(masterRows.map((m) => [m.id, m]));

      for (const line of variantLineItems) {
        const master = masterById.get(line.parentId!);
        if (!master) continue;
        const axes = master.variantAxes ?? [];
        const attrs = line.variantAttrs ?? {};
        const displayName = formatVariantDisplay(master.name, attrs, axes);
        await tx
          .update(salesOrderLines)
          .set({ itemName: displayName })
          .where(eq(salesOrderLines.id, line.lineId));
        report.repairedSoSnapshots++;
      }
    }

    return report;
  });
}
