import { eq, sql } from "drizzle-orm";
import { lots } from "@/lib/db/schema";
import { seedOpeningBalanceInTx } from "@/lib/inventory/kernel";
import type { Tx } from "@/lib/db/with-org-context";
import { resolveSeedOpeningUnitCost } from "./seeds";
import type { ItemSeed, Report } from "./types";

function buildLotNumber(prefix: string, sku: string) {
  return `${prefix}-${sku}`;
}

export async function planStockSyncInTx(
  tx: Tx,
  seedByKey: Map<string, ItemSeed>,
  initialStockByKey: Record<string, string>,
  openingLotPrefix: string,
  report: Report
) {
  const existingInitLots = await tx
    .select({ lotNumber: lots.lotNumber })
    .from(lots)
    .where(sql`${lots.lotNumber} LIKE ${`${openingLotPrefix}-%`}`);
  const existingLotNumbers = new Set(existingInitLots.map((l) => l.lotNumber));

  for (const [key, qty] of Object.entries(initialStockByKey)) {
    const seed = seedByKey.get(key);
    if (!seed) continue;
    const lotNumber = buildLotNumber(openingLotPrefix, seed.sku);
    const openingUnitCost = resolveSeedOpeningUnitCost(seed);
    if (existingLotNumbers.has(lotNumber)) {
      report.stockLotsExisting.push(`${seed.name} (${lotNumber})`);
    } else if (openingUnitCost == null) {
      report.stockLotsSkippedMissingCost.push(
        `${seed.name}: missing current stock unit cost or default purchase price for opening stock`
      );
    } else {
      report.stockLotsCreated.push(`${seed.name}: ${qty}`);
    }
  }
}

export async function applyStockSyncInTx(
  tx: Tx,
  seedByKey: Map<string, ItemSeed>,
  initialStockByKey: Record<string, string>,
  openingLotPrefix: string,
  orgId: string,
  itemIdByKey: Map<string, string>,
  report: Report,
  actorUserId: string,
  idempotencyKeyPrefix: string
) {
  for (const [key, qty] of Object.entries(initialStockByKey)) {
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

    await seedOpeningBalanceInTx(tx, {
      organizationId: orgId,
      itemId,
      quantity: Number(qty),
      unitCost: openingUnitCost,
      actorUserId,
      idempotencyKey: `${idempotencyKeyPrefix}:${seed.sku}`,
      lotNumber,
      receivedAt: new Date(),
    });

    report.stockLotsCreated.push(`${seed.name}: ${qty}`);
  }
}
