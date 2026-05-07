import { createHash } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { lots } from "@/lib/db/schema";
import { seedOpeningBalanceInTx } from "@/lib/inventory/kernel";
import type { Tx } from "@/lib/db/with-org-context";
import {
  resolveSeedOpeningLotEntries,
  resolveSeedOpeningQuantity,
  resolveSeedOpeningReceivedAt,
  resolveSeedOpeningUnitCost,
} from "./seeds";
import type { InitialStockEntry, InitialStockLotEntry, ItemSeed, Report } from "./types";

function normalizeLotSegment(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function resolveLotSuffix(entry: InitialStockLotEntry) {
  return typeof entry === "string" ? null : entry.lotSuffix ?? null;
}

function buildLotNumber(prefix: string, sku: string, lotSuffix?: string | null) {
  const effectivePrefix = lotSuffix
    ? `${prefix}-${normalizeLotSegment(lotSuffix)}`
    : prefix;
  const normalizedSku = sku
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  const maxSkuLength = 20 - effectivePrefix.length - 1;
  if (normalizedSku.length <= maxSkuLength) {
    return `${effectivePrefix}-${normalizedSku}`;
  }

  const hash = createHash("sha1").update(sku).digest("hex").slice(0, 6).toUpperCase();
  const hashSuffixLength = hash.length + 1;
  const skuPrefix = normalizedSku
    .slice(0, maxSkuLength - hashSuffixLength)
    .replace(/-+$/g, "");
  return `${effectivePrefix}-${skuPrefix}-${hash}`;
}

function buildLotNumbers(
  prefix: string,
  seed: ItemSeed,
  lotSuffix?: string | null
) {
  if (!seed.sku) {
    throw new Error(`Opening stock seed "${seed.key}" has no SKU.`);
  }

  return [seed.sku, ...(seed.legacySkus ?? [])].map((sku) =>
    buildLotNumber(prefix, sku, lotSuffix)
  );
}

export async function planStockSyncInTx(
  tx: Tx,
  seedByKey: Map<string, ItemSeed>,
  initialStockByKey: Record<string, InitialStockEntry>,
  openingLotPrefix: string,
  report: Report
) {
  const existingInitLots = await tx
    .select({ lotNumber: lots.lotNumber })
    .from(lots)
    .where(sql`${lots.lotNumber} LIKE ${`${openingLotPrefix}-%`}`);
  const existingLotNumbers = new Set(existingInitLots.map((l) => l.lotNumber));

  for (const [key, entry] of Object.entries(initialStockByKey)) {
    const seed = seedByKey.get(key);
    if (!seed) continue;
    for (const lotEntry of resolveSeedOpeningLotEntries(entry)) {
      const [lotNumber, ...legacyLotNumbers] = buildLotNumbers(
        openingLotPrefix,
        seed,
        resolveLotSuffix(lotEntry)
      );
      const hasExistingLot = [lotNumber, ...legacyLotNumbers].some((candidate) =>
        existingLotNumbers.has(candidate)
      );
      const openingUnitCost = resolveSeedOpeningUnitCost(seed, seedByKey);
      const { sourceLabel } = resolveSeedOpeningQuantity(seed, lotEntry);
      resolveSeedOpeningReceivedAt(lotEntry);
      if (hasExistingLot) {
        report.stockLotsExisting.push(`${seed.name} (${lotNumber})`);
      } else if (openingUnitCost == null) {
        report.stockLotsSkippedMissingCost.push(
          `${seed.name}: missing current stock unit cost or default purchase price for opening stock`
        );
      } else {
        report.stockLotsCreated.push(`${seed.name}: ${sourceLabel}`);
      }
    }
  }
}

export async function applyStockSyncInTx(
  tx: Tx,
  seedByKey: Map<string, ItemSeed>,
  initialStockByKey: Record<string, InitialStockEntry>,
  openingLotPrefix: string,
  orgId: string,
  itemIdByKey: Map<string, string>,
  report: Report,
  actorUserId: string,
  idempotencyKeyPrefix: string
) {
  for (const [key, entry] of Object.entries(initialStockByKey)) {
    const itemId = itemIdByKey.get(key);
    const seed = seedByKey.get(key);
    if (!itemId || !seed) continue;

    for (const lotEntry of resolveSeedOpeningLotEntries(entry)) {
      const [lotNumber, ...legacyLotNumbers] = buildLotNumbers(
        openingLotPrefix,
        seed,
        resolveLotSuffix(lotEntry)
      );
      const [existingLot] = await tx
        .select({ id: lots.id })
        .from(lots)
        .where(inArray(lots.lotNumber, [lotNumber, ...legacyLotNumbers]))
        .limit(1);

      if (existingLot) {
        report.stockLotsExisting.push(`${seed.name} (${lotNumber})`);
        continue;
      }

      const openingUnitCost = resolveSeedOpeningUnitCost(seed, seedByKey);

      if (openingUnitCost == null) {
        report.stockLotsSkippedMissingCost.push(
          `${seed.name}: missing current stock unit cost or default purchase price for opening stock`
        );
        continue;
      }

      const { stockQuantity, sourceLabel } = resolveSeedOpeningQuantity(seed, lotEntry);
      const receivedAt = resolveSeedOpeningReceivedAt(lotEntry);

      await seedOpeningBalanceInTx(tx, {
        organizationId: orgId,
        itemId,
        quantity: stockQuantity,
        unitCost: openingUnitCost,
        actorUserId,
        idempotencyKey: `${idempotencyKeyPrefix}:${lotNumber}`,
        lotNumber,
        receivedAt,
      });

      report.stockLotsCreated.push(`${seed.name}: ${sourceLabel}`);
    }
  }
}
