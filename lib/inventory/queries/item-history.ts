import "server-only";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
} from "drizzle-orm";
import {
  type InventoryEventType,
  inventoryEvents,
  items,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  trimScale,
} from "@/lib/db/numeric";
import {
  normalizeNumericScale,
} from "@/lib/format";
import {
  withAuthedOrgContext,
} from "@/lib/dal/auth";
import type {
  ItemType,
} from "../types";

const MATERIAL_USAGE_CONSUMPTION_EVENT_TYPES = [
  "sales_consumption",
  "manufacturing_ingredient_consumption",
] as const satisfies readonly InventoryEventType[];
const MATERIAL_USAGE_REVERSAL_EVENT_TYPES = [
  "unpick_restock",
] as const satisfies readonly InventoryEventType[];
const MATERIAL_USAGE_EVENT_TYPES = [
  ...MATERIAL_USAGE_CONSUMPTION_EVENT_TYPES,
  ...MATERIAL_USAGE_REVERSAL_EVENT_TYPES,
] as const satisfies readonly InventoryEventType[];
const PRODUCT_PRODUCTION_EVENT_TYPES = [
  "manufacturing_output",
] as const satisfies readonly InventoryEventType[];

export type ItemHistoryMode = "usage" | "production";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type ItemUsageHistoryBucket = {
  periodStart: string;
  periodEnd: string;
  quantity: string;
};

export type ItemUsageHistory = {
  itemId: string;
  itemName: string;
  itemType: ItemType;
  mode: ItemHistoryMode;
  unitName: string | null;
  days: number;
  bucket: "week";
  totals: {
    last30Days: string;
    last90Days: string;
    last180Days: string;
    averageWeekly90Days: string;
  };
  buckets: ItemUsageHistoryBucket[];
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addUtcDays(startOfUtcDay(date), mondayOffset);
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function usageEventSign(eventType: InventoryEventType) {
  return MATERIAL_USAGE_REVERSAL_EVENT_TYPES.includes(
    eventType as (typeof MATERIAL_USAGE_REVERSAL_EVENT_TYPES)[number]
  )
    ? -1
    : 1;
}

function historyEventTypes(mode: ItemHistoryMode) {
  return mode === "production"
    ? PRODUCT_PRODUCTION_EVENT_TYPES
    : MATERIAL_USAGE_EVENT_TYPES;
}

function historyEventSign(mode: ItemHistoryMode, eventType: InventoryEventType) {
  return mode === "usage" ? usageEventSign(eventType) : 1;
}

function normalizeUsageQuantity(value: number) {
  return normalizeNumericScale(Math.max(0, value), 4);
}

export async function getItemUsageHistory(
  itemId: string,
  options: { days?: number; bucket?: "week"; mode?: ItemHistoryMode } = {}
): Promise<ItemUsageHistory | null> {
  const days = options.days ?? 180;
  const bucket = options.bucket ?? "week";
  const mode = options.mode ?? "usage";
  const eventTypes = historyEventTypes(mode);

  return withAuthedOrgContext(async (tx) => {
    const [item] = await tx
      .select({
        id: items.id,
        name: items.name,
        itemType: items.itemType,
        unitName: unitDefinitions.name,
      })
      .from(items)
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .limit(1);

    if (!item) return null;

    const today = startOfUtcDay(new Date());
    const currentWeekStart = startOfUtcWeek(today);
    const bucketCount = Math.ceil(days / 7);
    const firstBucketStart = addUtcDays(currentWeekStart, -(bucketCount - 1) * 7);
    const historyStart = addUtcDays(today, -(days - 1));
    const queryStart =
      firstBucketStart.getTime() < historyStart.getTime()
        ? firstBucketStart
        : historyStart;
    const last30Start = addUtcDays(today, -29);
    const last90Start = addUtcDays(today, -89);
    const last180Start = addUtcDays(today, -179);

    const events = await tx
      .select({
        eventType: inventoryEvents.eventType,
        quantity: trimScale(inventoryEvents.quantity).as("quantity"),
        occurredAt: inventoryEvents.occurredAt,
      })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, itemId),
          inArray(inventoryEvents.eventType, eventTypes),
          gte(inventoryEvents.occurredAt, queryStart)
        )
      )
      .orderBy(asc(inventoryEvents.occurredAt));

    const bucketTotals = Array.from({ length: bucketCount }, () => 0);
    let last30Days = 0;
    let last90Days = 0;
    let last180Days = 0;

    for (const event of events) {
      const eventType = event.eventType as InventoryEventType;
      const quantity = Number.parseFloat(event.quantity);
      if (!Number.isFinite(quantity)) continue;

      const signedQuantity = historyEventSign(mode, eventType) * quantity;
      const occurredAt = event.occurredAt;

      if (occurredAt >= last30Start) last30Days += signedQuantity;
      if (occurredAt >= last90Start) last90Days += signedQuantity;
      if (occurredAt >= last180Start) last180Days += signedQuantity;

      if (occurredAt >= firstBucketStart) {
        const bucketIndex = Math.floor(
          (startOfUtcDay(occurredAt).getTime() - firstBucketStart.getTime()) /
            WEEK_MS
        );
        if (bucketIndex >= 0 && bucketIndex < bucketTotals.length) {
          bucketTotals[bucketIndex] += signedQuantity;
        }
      }
    }

    return {
      itemId: item.id,
      itemName: item.name,
      itemType: item.itemType as ItemType,
      mode,
      unitName: item.unitName,
      days,
      bucket,
      totals: {
        last30Days: normalizeUsageQuantity(last30Days),
        last90Days: normalizeUsageQuantity(last90Days),
        last180Days: normalizeUsageQuantity(last180Days),
        averageWeekly90Days: normalizeUsageQuantity((last90Days / 90) * 7),
      },
      buckets: bucketTotals.map((quantity, index) => {
        const periodStart = addUtcDays(firstBucketStart, index * 7);
        const periodEnd = addUtcDays(periodStart, 6);
        return {
          periodStart: isoDate(periodStart),
          periodEnd: isoDate(periodEnd > today ? today : periodEnd),
          quantity: normalizeUsageQuantity(quantity),
        };
      }),
    };
  });
}

// Update item metadata and optionally adjust stock in a single transaction.
// If stock adjustment fails (e.g. insufficient stock), the entire update rolls back.
