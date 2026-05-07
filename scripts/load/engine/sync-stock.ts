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

const LOT_NUMBER_MAX_LENGTH = 20;
const LOT_NUMBER_HASH_LENGTH = 6;

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
  const maxSkuLength = LOT_NUMBER_MAX_LENGTH - effectivePrefix.length - 1;
  if (normalizedSku.length <= maxSkuLength) {
    return `${effectivePrefix}-${normalizedSku}`;
  }

  const hash = createHash("sha1")
    .update(sku)
    .digest("hex")
    .slice(0, LOT_NUMBER_HASH_LENGTH)
    .toUpperCase();
  const hashBudget = Math.max(0, LOT_NUMBER_MAX_LENGTH - effectivePrefix.length - 1);
  if (hashBudget <= 0) {
    const prefixBudget = LOT_NUMBER_MAX_LENGTH - hash.length - 1;
    const prefixPart = effectivePrefix.slice(0, prefixBudget).replace(/-+$/g, "");
    return `${prefixPart}-${hash}`;
  }
  if (hashBudget <= LOT_NUMBER_HASH_LENGTH) {
    return `${effectivePrefix}-${hash.slice(0, hashBudget)}`;
  }

  const skuPrefixLength = hashBudget - LOT_NUMBER_HASH_LENGTH - 1;
  const skuPrefix = normalizedSku.slice(0, skuPrefixLength).replace(/-+$/g, "");
  if (!skuPrefix) {
    return `${effectivePrefix}-${hash.slice(0, hashBudget)}`;
  }
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

function uniqueLotNumbers(candidates: string[]) {
  return Array.from(new Set(candidates));
}

function buildCurrentLotNumberCandidates(
  prefix: string,
  seed: ItemSeed,
  lotSuffix?: string | null
) {
  return uniqueLotNumbers(buildLotNumbers(prefix, seed, lotSuffix));
}

function buildLegacyLotNumberCandidates(
  prefix: string,
  seed: ItemSeed,
  lotSuffix?: string | null
) {
  return lotSuffix ? uniqueLotNumbers(buildLotNumbers(prefix, seed)) : [];
}

async function findExistingLotByNumberCandidates(tx: Tx, candidates: string[]) {
  if (candidates.length === 0) {
    return null;
  }

  const [existingLot] = await tx
    .select({ id: lots.id, lotNumber: lots.lotNumber })
    .from(lots)
    .where(inArray(lots.lotNumber, candidates))
    .limit(1);

  return existingLot ?? null;
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
    const claimedLegacyLotNumbers = new Set<string>();
    for (const lotEntry of resolveSeedOpeningLotEntries(entry)) {
      const lotSuffix = resolveLotSuffix(lotEntry);
      const currentCandidates = buildCurrentLotNumberCandidates(
        openingLotPrefix,
        seed,
        lotSuffix
      );
      const legacyCandidates = buildLegacyLotNumberCandidates(
        openingLotPrefix,
        seed,
        lotSuffix
      ).filter((candidate) => !claimedLegacyLotNumbers.has(candidate));
      const currentLotNumber = currentCandidates.find((candidate) =>
        existingLotNumbers.has(candidate)
      );
      const legacyLotNumber = currentLotNumber
        ? null
        : legacyCandidates.find((candidate) => existingLotNumbers.has(candidate));
      const existingLotNumber = currentLotNumber ?? legacyLotNumber;
      if (legacyLotNumber) {
        claimedLegacyLotNumbers.add(legacyLotNumber);
      }
      const openingUnitCost = resolveSeedOpeningUnitCost(seed, seedByKey);
      const { sourceLabel } = resolveSeedOpeningQuantity(seed, lotEntry);
      resolveSeedOpeningReceivedAt(lotEntry);
      if (existingLotNumber) {
        report.stockLotsExisting.push(`${seed.name} (${existingLotNumber})`);
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
    const claimedLegacyLotNumbers = new Set<string>();

    for (const lotEntry of resolveSeedOpeningLotEntries(entry)) {
      const lotSuffix = resolveLotSuffix(lotEntry);
      const [lotNumber] = buildLotNumbers(openingLotPrefix, seed, lotSuffix);
      const currentCandidates = buildCurrentLotNumberCandidates(
        openingLotPrefix,
        seed,
        lotSuffix
      );
      const existingCurrentLot = await findExistingLotByNumberCandidates(
        tx,
        currentCandidates
      );
      const legacyCandidates = buildLegacyLotNumberCandidates(
        openingLotPrefix,
        seed,
        lotSuffix
      ).filter((candidate) => !claimedLegacyLotNumbers.has(candidate));
      const existingLegacyLot = existingCurrentLot
        ? null
        : await findExistingLotByNumberCandidates(tx, legacyCandidates);
      const existingLot = existingCurrentLot ?? existingLegacyLot;

      if (existingLot) {
        if (existingLegacyLot) {
          claimedLegacyLotNumbers.add(existingLegacyLot.lotNumber);
        }
        report.stockLotsExisting.push(`${seed.name} (${existingLot.lotNumber})`);
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
