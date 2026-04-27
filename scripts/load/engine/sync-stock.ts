import { eq, sql } from "drizzle-orm";
import { lots } from "@/lib/db/schema";
import { seedOpeningBalanceInTx } from "@/lib/inventory/kernel";
import type { Tx } from "@/lib/db/with-org-context";
import { resolveSeedOpeningQuantity, resolveSeedOpeningUnitCost } from "./seeds";
import type { InitialStockEntry, ItemSeed, Report } from "./types";

function buildLotNumber(prefix: string, sku: string) {
  return `${prefix}-${sku}`;
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
    const lotNumber = buildLotNumber(openingLotPrefix, seed.sku);
    const openingUnitCost = resolveSeedOpeningUnitCost(seed);
    const { sourceLabel } = resolveSeedOpeningQuantity(seed, entry);
    if (existingLotNumbers.has(lotNumber)) {
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

    const lotNumber = buildLotNumber(openingLotPrefix, seed.sku);
    const [existingLot] = await tx
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.lotNumber, lotNumber))
      .limit(1);

    if (existingLot) {
      report.stockLotsExisting.push(`${seed.name} (${lotNumber})`);
      continue;
    }

    const openingUnitCost = resolveSeedOpeningUnitCost(seed);

    if (openingUnitCost == null) {
      report.stockLotsSkippedMissingCost.push(
        `${seed.name}: missing current stock unit cost or default purchase price for opening stock`
      );
      continue;
    }

    const { stockQuantity, sourceLabel } = resolveSeedOpeningQuantity(seed, entry);

    await seedOpeningBalanceInTx(tx, {
      organizationId: orgId,
      itemId,
      quantity: stockQuantity,
      unitCost: openingUnitCost,
      actorUserId,
      idempotencyKey: `${idempotencyKeyPrefix}:${seed.sku}`,
      lotNumber,
      receivedAt: new Date(),
    });

    report.stockLotsCreated.push(`${seed.name}: ${sourceLabel}`);
  }
}
