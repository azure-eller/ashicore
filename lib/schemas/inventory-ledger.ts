import { z } from "zod";
import { ITEM_TYPES } from "@/app/(dashboard)/inventory/types";
import { INVENTORY_EVENT_TYPES } from "@/lib/db/schema";
import {
  INVENTORY_LEDGER_EVENT_CLASSES,
  INVENTORY_LEDGER_SCOPE_VALUES,
  INVENTORY_LEDGER_SOURCE_TYPES,
} from "@/lib/inventory/ledger";
import { isValidIsoDate, isValidTimeZone } from "@/lib/schemas/shared";

const optionalTrimmedString = z
  .string()
  .optional()
  .transform((value) => {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  });

export const inventoryLedgerFiltersSchema = z
  .object({
    q: optionalTrimmedString,
    lot: optionalTrimmedString,
    itemId: optionalTrimmedString,
    itemType: z.enum(ITEM_TYPES).optional(),
    scope: z.enum(INVENTORY_LEDGER_SCOPE_VALUES).optional(),
    eventClass: z.enum(INVENTORY_LEDGER_EVENT_CLASSES).optional(),
    eventType: z.enum(INVENTORY_EVENT_TYPES).optional(),
    documentType: z.enum(INVENTORY_LEDGER_SOURCE_TYPES).optional(),
    documentId: optionalTrimmedString,
    actorUserId: optionalTrimmedString,
    dateFrom: optionalTrimmedString.refine(
      (value) => value == null || isValidIsoDate(value),
      "dateFrom must be a real date in YYYY-MM-DD format"
    ),
    dateTo: optionalTrimmedString.refine(
      (value) => value == null || isValidIsoDate(value),
      "dateTo must be a real date in YYYY-MM-DD format"
    ),
    timeZone: optionalTrimmedString.refine(
      (value) => value == null || isValidTimeZone(value),
      "timeZone must be a valid IANA time zone"
    ),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(10).max(100).optional(),
  })
  .transform((value) => {
    const hasExactScopeFilter = Boolean(value.itemId || value.documentId);
    const eventClass = value.eventClass;

    return {
      ...value,
      scope:
        eventClass && eventClass !== "stock"
          ? "all"
          : value.scope ?? (hasExactScopeFilter ? "all" : "stock"),
      page: value.page ?? 1,
      pageSize: value.pageSize ?? 50,
    };
  });

export type InventoryLedgerFilters = z.infer<typeof inventoryLedgerFiltersSchema>;
