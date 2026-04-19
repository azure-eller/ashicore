import { and, eq, inArray } from "drizzle-orm";
import {
  inventoryEvents,
  inventoryExpectedSummary,
  inventoryItemBalances,
  inventoryLotBalances,
  inventoryReservationsSummary,
  lots,
} from "@/lib/db/schema";
import { normalizeNumeric, roundQuantity } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";

const STOCK_INCREASE_TYPES = new Set([
  "opening_balance",
  "purchase_receipt",
  "manufacturing_output",
  "manual_adjustment_increase",
  "stocktake_gain",
  "manufacturing_variance_gain",
  "unpick_restock",
]);

const STOCK_DECREASE_TYPES = new Set([
  "manual_adjustment_decrease",
  "stocktake_loss",
  "sales_consumption",
  "manufacturing_ingredient_consumption",
  "manufacturing_variance_loss",
]);

const RESERVATION_INCREASE_TYPES = new Set(["reservation_increase"]);
const RESERVATION_RELEASE_TYPES = new Set(["reservation_release"]);
const EXPECTED_INCREASE_TYPES = new Set(["expected_increase"]);
const EXPECTED_RELEASE_TYPES = new Set(["expected_release"]);

type BalanceKey = string;

type ComputedItemBalance = {
  locationId: string;
  itemId: string;
  onHandQty: number;
  committedQty: number;
  expectedQty: number;
};

type ComputedLotBalance = {
  locationId: string;
  lotId: string;
  itemId: string;
  quantity: number;
};

type ComputedReferenceBalance = {
  locationId: string;
  itemId: string;
  referenceType: string;
  referenceId: string;
  quantity: number;
};

function balanceKey(parts: Array<string | null | undefined>) {
  return parts.map((value) => value ?? "").join(":");
}

function buildFilters(
  organizationId: string,
  itemIds?: string[],
  field?: {
    inventoryEvents?: typeof inventoryEvents.itemId;
    inventoryItemBalances?: typeof inventoryItemBalances.itemId;
    inventoryLotBalances?: typeof inventoryLotBalances.itemId;
    inventoryReservationsSummary?: typeof inventoryReservationsSummary.itemId;
    inventoryExpectedSummary?: typeof inventoryExpectedSummary.itemId;
  }
) {
  const filters = [eq(inventoryEvents.organizationId, organizationId)];

  if (itemIds && itemIds.length > 0 && field?.inventoryEvents) {
    filters.push(inArray(field.inventoryEvents, itemIds));
  }

  return filters;
}

export async function computeItemBalancesFromLedger(
  tx: Tx,
  organizationId: string,
  itemIds?: string[]
) {
  const filters = buildFilters(organizationId, itemIds, {
    inventoryEvents: inventoryEvents.itemId,
  });

  const rows = await tx
    .select({
      itemId: inventoryEvents.itemId,
      locationId: inventoryEvents.locationId,
      eventType: inventoryEvents.eventType,
      quantity: inventoryEvents.quantity,
    })
    .from(inventoryEvents)
    .where(and(...filters));

  const computed = new Map<
    BalanceKey,
    ComputedItemBalance
  >();

  for (const row of rows) {
    const key = balanceKey([row.locationId, row.itemId]);
    const current = computed.get(key) ?? {
      locationId: row.locationId,
      itemId: row.itemId,
      onHandQty: 0,
      committedQty: 0,
      expectedQty: 0,
    };
    const quantity = parseFloat(row.quantity);

    if (STOCK_INCREASE_TYPES.has(row.eventType)) {
      current.onHandQty = roundQuantity(current.onHandQty + quantity);
    } else if (STOCK_DECREASE_TYPES.has(row.eventType)) {
      current.onHandQty = roundQuantity(current.onHandQty - quantity);
    } else if (RESERVATION_INCREASE_TYPES.has(row.eventType)) {
      current.committedQty = roundQuantity(current.committedQty + quantity);
    } else if (RESERVATION_RELEASE_TYPES.has(row.eventType)) {
      current.committedQty = roundQuantity(current.committedQty - quantity);
    } else if (EXPECTED_INCREASE_TYPES.has(row.eventType)) {
      current.expectedQty = roundQuantity(current.expectedQty + quantity);
    } else if (EXPECTED_RELEASE_TYPES.has(row.eventType)) {
      current.expectedQty = roundQuantity(current.expectedQty - quantity);
    }

    computed.set(key, current);
  }

  return computed;
}

export async function computeReservationSummaryFromLedger(
  tx: Tx,
  organizationId: string,
  itemIds?: string[]
) {
  const filters = buildFilters(organizationId, itemIds, {
    inventoryEvents: inventoryEvents.itemId,
  });

  const rows = await tx
    .select({
      locationId: inventoryEvents.locationId,
      itemId: inventoryEvents.itemId,
      referenceType: inventoryEvents.referenceType,
      referenceId: inventoryEvents.referenceId,
      eventType: inventoryEvents.eventType,
      quantity: inventoryEvents.quantity,
    })
    .from(inventoryEvents)
    .where(and(...filters));

  const computed = new Map<BalanceKey, ComputedReferenceBalance>();

  for (const row of rows) {
    if (
      !row.referenceType ||
      !row.referenceId ||
      (!RESERVATION_INCREASE_TYPES.has(row.eventType) &&
        !RESERVATION_RELEASE_TYPES.has(row.eventType))
    ) {
      continue;
    }

    const key = balanceKey([
      row.locationId,
      row.itemId,
      row.referenceType,
      row.referenceId,
    ]);
    const current = computed.get(key) ?? {
      locationId: row.locationId,
      itemId: row.itemId,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      quantity: 0,
    };
    const quantity = parseFloat(row.quantity);

    if (RESERVATION_INCREASE_TYPES.has(row.eventType)) {
      current.quantity = roundQuantity(current.quantity + quantity);
    } else {
      current.quantity = roundQuantity(current.quantity - quantity);
    }

    computed.set(key, current);
  }

  return computed;
}

export async function computeExpectedSummaryFromLedger(
  tx: Tx,
  organizationId: string,
  itemIds?: string[]
) {
  const filters = buildFilters(organizationId, itemIds, {
    inventoryEvents: inventoryEvents.itemId,
  });

  const rows = await tx
    .select({
      locationId: inventoryEvents.locationId,
      itemId: inventoryEvents.itemId,
      referenceType: inventoryEvents.referenceType,
      referenceId: inventoryEvents.referenceId,
      eventType: inventoryEvents.eventType,
      quantity: inventoryEvents.quantity,
    })
    .from(inventoryEvents)
    .where(and(...filters));

  const computed = new Map<BalanceKey, ComputedReferenceBalance>();

  for (const row of rows) {
    if (
      !row.referenceType ||
      !row.referenceId ||
      (!EXPECTED_INCREASE_TYPES.has(row.eventType) &&
        !EXPECTED_RELEASE_TYPES.has(row.eventType))
    ) {
      continue;
    }

    const key = balanceKey([
      row.locationId,
      row.itemId,
      row.referenceType,
      row.referenceId,
    ]);
    const current = computed.get(key) ?? {
      locationId: row.locationId,
      itemId: row.itemId,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      quantity: 0,
    };
    const quantity = parseFloat(row.quantity);

    if (EXPECTED_INCREASE_TYPES.has(row.eventType)) {
      current.quantity = roundQuantity(current.quantity + quantity);
    } else {
      current.quantity = roundQuantity(current.quantity - quantity);
    }

    computed.set(key, current);
  }

  return computed;
}

export async function computeLotBalancesFromLedger(
  tx: Tx,
  organizationId: string,
  itemIds?: string[]
) {
  const filters = buildFilters(organizationId, itemIds, {
    inventoryEvents: inventoryEvents.itemId,
  });

  const rows = await tx
    .select({
      lotId: inventoryEvents.lotId,
      locationId: inventoryEvents.locationId,
      itemId: inventoryEvents.itemId,
      eventType: inventoryEvents.eventType,
      quantity: inventoryEvents.quantity,
    })
    .from(inventoryEvents)
    .where(and(...filters));

  const computed = new Map<BalanceKey, ComputedLotBalance>();

  for (const row of rows) {
    if (!row.lotId) {
      continue;
    }

    const key = balanceKey([row.locationId, row.lotId]);
    const current = computed.get(key) ?? {
      locationId: row.locationId,
      lotId: row.lotId,
      quantity: 0,
      itemId: row.itemId,
    };
    const quantity = parseFloat(row.quantity);

    if (STOCK_INCREASE_TYPES.has(row.eventType)) {
      current.quantity = roundQuantity(current.quantity + quantity);
    } else if (STOCK_DECREASE_TYPES.has(row.eventType)) {
      current.quantity = roundQuantity(current.quantity - quantity);
    }

    computed.set(key, current);
  }

  return computed;
}

export async function diffProjections(
  tx: Tx,
  organizationId: string,
  itemIds?: string[]
) {
  const itemBalanceFilters = [eq(inventoryItemBalances.organizationId, organizationId)];
  const lotBalanceFilters = [eq(inventoryLotBalances.organizationId, organizationId)];
  const reservationFilters = [eq(inventoryReservationsSummary.organizationId, organizationId)];
  const expectedFilters = [eq(inventoryExpectedSummary.organizationId, organizationId)];
  const legacyLotFilters = [eq(lots.organizationId, organizationId)];

  if (itemIds && itemIds.length > 0) {
    itemBalanceFilters.push(inArray(inventoryItemBalances.itemId, itemIds));
    lotBalanceFilters.push(inArray(inventoryLotBalances.itemId, itemIds));
    reservationFilters.push(inArray(inventoryReservationsSummary.itemId, itemIds));
    expectedFilters.push(inArray(inventoryExpectedSummary.itemId, itemIds));
    legacyLotFilters.push(inArray(lots.itemId, itemIds));
  }

  const computedItems = await computeItemBalancesFromLedger(
    tx,
    organizationId,
    itemIds
  );
  const computedLots = await computeLotBalancesFromLedger(
    tx,
    organizationId,
    itemIds
  );
  const computedReservations = await computeReservationSummaryFromLedger(
    tx,
    organizationId,
    itemIds
  );
  const computedExpected = await computeExpectedSummaryFromLedger(
    tx,
    organizationId,
    itemIds
  );
  const storedItems = await tx
    .select()
    .from(inventoryItemBalances)
    .where(and(...itemBalanceFilters));
  const storedLots = await tx
    .select()
    .from(inventoryLotBalances)
    .where(and(...lotBalanceFilters));
  const storedReservations = await tx
    .select()
    .from(inventoryReservationsSummary)
    .where(and(...reservationFilters));
  const storedExpected = await tx
    .select()
    .from(inventoryExpectedSummary)
    .where(and(...expectedFilters));
  const storedLegacyLots = await tx
    .select({
      lotId: lots.id,
      itemId: lots.itemId,
      quantity: lots.quantity,
    })
    .from(lots)
    .where(and(...legacyLotFilters));

  const storedItemsByKey = new Map(
    storedItems.map((row) => [balanceKey([row.locationId, row.itemId]), row])
  );
  const storedLotsByKey = new Map(
    storedLots.map((row) => [balanceKey([row.locationId, row.lotId]), row])
  );
  const storedReservationsByKey = new Map(
    storedReservations.map((row) => [
      balanceKey([row.locationId, row.itemId, row.referenceType, row.referenceId]),
      row,
    ])
  );
  const storedExpectedByKey = new Map(
    storedExpected.map((row) => [
      balanceKey([row.locationId, row.itemId, row.referenceType, row.referenceId]),
      row,
    ])
  );
  const storedLegacyLotsByKey = new Map(
    storedLegacyLots.map((row) => [row.lotId, row])
  );
  const computedLotsByLotId = new Map(
    [...computedLots.values()].map((row) => [row.lotId, row])
  );

  const itemKeys = new Set([
    ...computedItems.keys(),
    ...storedItemsByKey.keys(),
  ]);
  const lotKeys = new Set([
    ...computedLots.keys(),
    ...storedLotsByKey.keys(),
  ]);
  const reservationKeys = new Set([
    ...computedReservations.keys(),
    ...storedReservationsByKey.keys(),
  ]);
  const expectedKeys = new Set([
    ...computedExpected.keys(),
    ...storedExpectedByKey.keys(),
  ]);
  const legacyLotKeys = new Set(computedLotsByLotId.keys());

  for (const lotId of storedLegacyLotsByKey.keys()) {
    legacyLotKeys.add(lotId);
  }

  const itemDeltas = Array.from(itemKeys)
    .map((key) => {
      const row = storedItemsByKey.get(key);
      const computed = computedItems.get(key) ?? {
        locationId: row?.locationId ?? "",
        itemId: row?.itemId ?? "",
        onHandQty: 0,
        committedQty: 0,
        expectedQty: 0,
      };

      const actual = {
        onHandQty: normalizeNumeric(parseFloat(row?.onHandQty ?? "0")),
        committedQty: normalizeNumeric(parseFloat(row?.committedQty ?? "0")),
        expectedQty: normalizeNumeric(parseFloat(row?.expectedQty ?? "0")),
        availableToPromise: normalizeNumeric(parseFloat(row?.availableToPromise ?? "0")),
      };

      const expected = {
        onHandQty: normalizeNumeric(computed.onHandQty),
        committedQty: normalizeNumeric(computed.committedQty),
        expectedQty: normalizeNumeric(computed.expectedQty),
        availableToPromise: normalizeNumeric(
          roundQuantity(
            computed.onHandQty - computed.committedQty + computed.expectedQty
          )
        ),
      };

      if (
        actual.onHandQty === expected.onHandQty &&
        actual.committedQty === expected.committedQty &&
        actual.expectedQty === expected.expectedQty &&
        actual.availableToPromise === expected.availableToPromise
      ) {
        return null;
      }

      return {
        locationId: row?.locationId ?? computed.locationId,
        itemId: row?.itemId ?? computed.itemId,
        actual,
        expected,
      };
    })
    .filter(Boolean);

  const lotDeltas = Array.from(lotKeys)
    .map((key) => {
      const row = storedLotsByKey.get(key);
      const computed = computedLots.get(key) ?? {
        locationId: row?.locationId ?? "",
        lotId: row?.lotId ?? "",
        itemId: row?.itemId ?? "",
        quantity: 0,
      };
      const actual = normalizeNumeric(parseFloat(row?.quantity ?? "0"));
      const expected = normalizeNumeric(computed.quantity);

      if (actual === expected) {
        return null;
      }

      return {
        locationId: row?.locationId ?? computed.locationId,
        lotId: row?.lotId ?? computed.lotId,
        itemId: row?.itemId ?? computed.itemId,
        actual,
        expected,
      };
    })
    .filter(Boolean);

  return {
    itemDeltas,
    lotDeltas,
    reservationDeltas: Array.from(reservationKeys)
      .map((key) => {
        const row = storedReservationsByKey.get(key);
        const computed = computedReservations.get(key) ?? {
          locationId: row?.locationId ?? "",
          itemId: row?.itemId ?? "",
          referenceType: row?.referenceType ?? "",
          referenceId: row?.referenceId ?? "",
          quantity: 0,
        };
        const actual = normalizeNumeric(parseFloat(row?.quantity ?? "0"));
        const expected = normalizeNumeric(computed.quantity);

        if (actual === expected) {
          return null;
        }

        return {
          locationId: row?.locationId ?? computed.locationId,
          itemId: row?.itemId ?? computed.itemId,
          referenceType: row?.referenceType ?? computed.referenceType,
          referenceId: row?.referenceId ?? computed.referenceId,
          actual,
          expected,
        };
      })
      .filter(Boolean),
    expectedDeltas: Array.from(expectedKeys)
      .map((key) => {
        const row = storedExpectedByKey.get(key);
        const computed = computedExpected.get(key) ?? {
          locationId: row?.locationId ?? "",
          itemId: row?.itemId ?? "",
          referenceType: row?.referenceType ?? "",
          referenceId: row?.referenceId ?? "",
          quantity: 0,
        };
        const actual = normalizeNumeric(parseFloat(row?.quantity ?? "0"));
        const expected = normalizeNumeric(computed.quantity);

        if (actual === expected) {
          return null;
        }

        return {
          locationId: row?.locationId ?? computed.locationId,
          itemId: row?.itemId ?? computed.itemId,
          referenceType: row?.referenceType ?? computed.referenceType,
          referenceId: row?.referenceId ?? computed.referenceId,
          actual,
          expected,
        };
      })
      .filter(Boolean),
    legacyLotDeltas: Array.from(legacyLotKeys)
      .map((lotId) => {
        const row = storedLegacyLotsByKey.get(lotId);
        const computed = computedLotsByLotId.get(lotId) ?? {
          locationId: "",
          lotId,
          itemId: row?.itemId ?? "",
          quantity: 0,
        };
        const actual = normalizeNumeric(parseFloat(row?.quantity ?? "0"));
        const expected = normalizeNumeric(computed.quantity);

        if (actual === expected) {
          return null;
        }

        return {
          lotId,
          itemId: row?.itemId ?? computed.itemId,
          actual,
          expected,
        };
      })
      .filter(Boolean),
  };
}
