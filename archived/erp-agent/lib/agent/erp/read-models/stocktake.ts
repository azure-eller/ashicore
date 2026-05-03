import type { StocktakeDetail, StocktakeListRow } from "@/app/(dashboard)/inventory/stocktakes/types";
import {
  getStocktake,
  getStocktakes,
} from "@/app/(dashboard)/inventory/stocktakes/queries";
import type { ErpGetOutput, ErpListItem, ErpListOutput, ErpRecord } from "@/lib/agent/erp/read-models/types";

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function paginate<T>(items: T[], limit: number, offset: number) {
  const paged = items.slice(offset, offset + limit);
  const nextOffset = offset + paged.length;

  return {
    items: paged,
    truncated: nextOffset < items.length,
    nextOffset: nextOffset < items.length ? nextOffset : undefined,
  };
}

function toStocktakeListItem(row: StocktakeListRow): ErpListItem {
  return {
    id: row.id,
    title: row.name,
    subtitle: row.scope,
    status: row.status,
    badges: [row.status],
    updatedAt: row.updatedAt.toISOString(),
    fields: {
      scope: row.scope,
      notes: row.notes,
      itemCount: row.itemCount,
      countedCount: row.countedCount,
      varianceCount: row.varianceCount,
      completedAt: toIso(row.completedAt),
      cancelledAt: toIso(row.cancelledAt),
    },
  };
}

function toStocktakeRecord(row: StocktakeDetail): ErpRecord {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    title: row.name,
    subtitle: row.scope,
    status: row.status,
    badges: [row.status],
    fields: {
      scope: row.scope,
      notes: row.notes,
      completedAt: toIso(row.completedAt),
      cancelledAt: toIso(row.cancelledAt),
      lines: row.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        itemSku: line.itemSku,
        itemType: line.itemType,
        unitName: line.unitName,
        expectedQty: line.expectedQty,
        countedQty: line.countedQty,
        varianceQty: line.varianceQty,
        appliedDeltaQty: line.appliedDeltaQty,
      })),
      createdAt: row.createdAt.toISOString(),
    },
  };
}

export async function listStocktakesForAgent(args: {
  limit: number;
  offset: number;
  search?: string;
  status?: string[];
}): Promise<ErpListOutput> {
  const rows = await getStocktakes();
  const search = args.search?.trim().toLowerCase();

  const filtered = rows
    .filter((row) => (args.status && args.status.length > 0 ? args.status.includes(row.status) : true))
    .filter((row) => {
      if (!search) {
        return true;
      }

      return [row.name, row.scope, row.notes]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    })
    .map(toStocktakeListItem);

  const paged = paginate(filtered, args.limit, args.offset);

  return {
    entityType: "stocktake",
    ...paged,
  };
}

export async function getStocktakeForAgent(id: string): Promise<ErpGetOutput | null> {
  const row = await getStocktake(id);
  if (!row) {
    return null;
  }

  return {
    entityType: "stocktake",
    record: toStocktakeRecord(row),
  };
}

