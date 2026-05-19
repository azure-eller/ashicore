import { withOrgContext } from "@/lib/db/with-org-context";
import { getUnitSignature } from "./org";
import { applyBomsSyncInTx } from "./sync-boms";
import {
  applyItemsSyncInTx,
  assertNoDuplicateSkus,
  buildExistingItemsByName,
  loadExistingItemsInTx,
} from "./sync-items";
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
  const logProgress = config.onProgress ?? (() => {});
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

    logProgress("loading units");
    const existingUnits = await loadExistingUnitsInTx(tx);
    assertNoDuplicateUnits(existingUnits, managedUnitSignatures);

    const unitsBySignature = new Map(
      existingUnits.map((row) => [getUnitSignature(row.name, row.size, row.uom), row])
    );
    const unitIdByKey = new Map<string, string>();

    await applyUnitsSyncInTx(tx, config.units, orgId, unitsBySignature, unitIdByKey, report);

    logProgress("loading items");
    const existingItems = await loadExistingItemsInTx(tx);
    assertNoDuplicateSkus(existingItems, managedItemSkus);

    const itemBySku = new Map(
      existingItems
        .filter((row): row is ExistingItem & { sku: string } => row.sku != null)
        .map((row) => [row.sku, row])
    );
    const itemByName = buildExistingItemsByName(existingItems);
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

    logProgress("loading BOMs");
    await applyBomsSyncInTx(
      tx,
      config.seeds,
      orgId,
      itemIdByKey,
      report,
      actorUserId,
      config.bomRevisionNote ?? "Managed by data loader"
    );

    logProgress("loading opening stock");
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

    logProgress("loading suppliers");
    await applySuppliersSyncInTx(tx, config.suppliers, orgId, report);

    logProgress("catalog load transaction complete");
    return report;
  });
}
