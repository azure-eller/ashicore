import { withOrgContext } from "@/lib/db/with-org-context";
import { getUnitSignature } from "./org";
import { getManagedProductSeedsWithBom, loadCurrentBomRowsInTx, planBomsSync } from "./sync-boms";
import { applyCustomerPlansInTx } from "./sync-customers";
import {
  applySalesImportOrdersInTx,
  evaluateSalesImportInTx,
} from "./sync-sales-orders";
import { planStockSyncInTx } from "./sync-stock";
import { assertNoDuplicateUnits, loadExistingUnitsInTx, planUnitsSync } from "./sync-units";
import { assertNoDuplicateSkus, loadExistingItemsInTx, planItemsSync } from "./sync-items";
import {
  createEmptyReport,
  createEmptySalesImportReport,
} from "./types";
import type {
  ExistingBomRow,
  ExistingItem,
  ItemSeed,
  LoaderConfig,
  Report,
  SalesImportReport,
  UnitSeed,
} from "./types";

export async function planChanges(orgId: string, config: LoaderConfig): Promise<Report> {
  const seedByKey = new Map(config.seeds.map((seed) => [seed.key, seed]));
  const unitByKey = new Map(config.units.map((unit) => [unit.key, unit]));
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
    const existingItems = await loadExistingItemsInTx(tx);

    assertNoDuplicateUnits(existingUnits, managedUnitSignatures);
    assertNoDuplicateSkus(existingItems, managedItemSkus);

    const existingUnitsBySignature = new Map(
      existingUnits.map((row) => [getUnitSignature(row.name, row.size, row.uom), row])
    );
    const existingItemsBySku = new Map(
      existingItems
        .filter((row): row is ExistingItem & { sku: string } => row.sku != null)
        .map((row) => [row.sku, row])
    );
    const existingItemsByName = new Map(existingItems.map((row) => [row.name, row]));
    const matchedItemByKey = new Map<string, ExistingItem>();

    planUnitsSync(config.units, existingUnitsBySignature, report);
    planItemsSync(
      config.seeds,
      unitByKey,
      existingUnitsBySignature,
      existingItemsBySku,
      existingItemsByName,
      matchedItemByKey,
      report
    );

    const managedBomItemIds = getManagedProductSeedsWithBom(config.seeds)
      .map((product) => matchedItemByKey.get(product.key)?.id)
      .filter((id): id is string => id != null);
    const existingBomRows: ExistingBomRow[] =
      managedBomItemIds.length === 0
        ? []
        : await loadCurrentBomRowsInTx(tx, managedBomItemIds);

    const bomRowsByItemId = new Map<string, ExistingBomRow[]>();
    for (const row of existingBomRows) {
      const bucket = bomRowsByItemId.get(row.itemId) ?? [];
      bucket.push(row);
      bomRowsByItemId.set(row.itemId, bucket);
    }

    planBomsSync(config.seeds, seedByKey, matchedItemByKey, bomRowsByItemId, report);

    await planStockSyncInTx(
      tx,
      seedByKey,
      config.initialStockByKey,
      config.openingLotPrefix,
      report
    );

    return report;
  });
}

export async function planSalesImport(
  orgId: string,
  config: LoaderConfig,
  options: { customersOnly: boolean }
): Promise<SalesImportReport> {
  if (!config.salesImport) {
    throw new Error(`Loader config "${config.customerSlug}" has no sales import.`);
  }

  return runSalesImport(orgId, config, { apply: false, ...options });
}

export async function runSalesImport(
  orgId: string,
  config: LoaderConfig,
  options: { apply: boolean; customersOnly: boolean }
): Promise<SalesImportReport> {
  if (!config.salesImport) {
    throw new Error(`Loader config "${config.customerSlug}" has no sales import.`);
  }
  const salesImport = config.salesImport;
  const seedByKey = new Map(config.seeds.map((seed) => [seed.key, seed]));
  const managedItemSkus = new Set(
    config.seeds
      .flatMap((seed) => [seed.sku, ...(seed.legacySkus ?? [])])
      .filter((sku): sku is string => sku != null)
  );

  return withOrgContext(orgId, async (tx) => {
    const report = createEmptySalesImportReport();
    const evaluation = await evaluateSalesImportInTx(
      tx,
      salesImport,
      seedByKey,
      managedItemSkus
    );
    const customerIdByKey = new Map(evaluation.existingCustomerIdByKey);

    await applyCustomerPlansInTx(
      tx,
      orgId,
      evaluation.customerPlans,
      customerIdByKey,
      options.apply,
      report
    );

    if (options.customersOnly) {
      return report;
    }

    await applySalesImportOrdersInTx(
      tx,
      orgId,
      evaluation,
      customerIdByKey,
      options.apply,
      report
    );

    return report;
  });
}

// Help TypeScript with unused-import elision in some configurations.
export type { ItemSeed, UnitSeed };
