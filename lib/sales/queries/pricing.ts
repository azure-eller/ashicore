import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { formatQuantity, normalizeNumeric, normalizeMoney, parsePositive } from "@/lib/format";
import { customerCategories, itemFamilies, itemVariantValues, items, pricingScheduleBreaks, pricingScheduleItems, pricingSchedules, variantOptions, variantOptionValues } from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import type { Tx } from "@/lib/db/with-org-context";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type { InsertPricingSchedule, ResolveSalesLinePricingInput, UpdatePricingSchedule } from "@/lib/schemas/pricing-schedules";
import type { PricingScheduleEditData, PricingScheduleItemOption, PricingScheduleRow, SalesLinePricingResult } from "../types";
import { getEstimatedUnitCostsByItemIdInTx } from "@/lib/inventory/estimated-cost";
import { SalesError } from "./errors";
import { type SalesItemValidationRow, getValidatedCustomerInTx, getValidatedSalesItemsInTx } from "./validation";
import { ensureCustomerCategoryExistsInTx } from "./customer-categories";
import { getSalesOrderItemOptions } from "./orders-read";

type PricingScheduleRecord = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  itemScope: string;
  itemCategory: string | null;
  itemVariantOptionCode: string | null;
  itemVariantValueCode: string | null;
  itemId: string | null;
};

type PricingScheduleBreakRecord = {
  id: string;
  pricingScheduleId: string;
  minQuantity: string;
  maxQuantity: string | null;
  discountPercent: string;
  sortOrder: number;
};

type PricingScheduleLookup = {
  schedules: PricingScheduleRecord[];
  breaksByScheduleId: Map<string, PricingScheduleBreakRecord[]>;
};

function formatPricingBreakLabel(
  minQuantity: string,
  maxQuantity: string | null
) {
  const min = formatQuantity(minQuantity);
  if (maxQuantity == null) {
    return `${min}+`;
  }

  return `${min}-${formatQuantity(maxQuantity)}`;
}

function summarizePricingBreaks(
  breaks: Array<{
    minQuantity: string;
    maxQuantity: string | null;
    discountPercent: string;
  }>
) {
  return breaks
    .map((pricingBreak) => {
      const label = formatPricingBreakLabel(
        pricingBreak.minQuantity,
        pricingBreak.maxQuantity
      );
      return `${label} (${formatQuantity(pricingBreak.discountPercent)}%)`;
    })
    .join(", ");
}

async function ensurePricingScheduleScopeAvailableInTx(
  tx: Tx,
  values: {
    customerCategoryId: string | null;
    itemScope: "all" | "category" | "variant" | "selected";
    itemCategory: string | null;
    itemVariantOptionCode: string | null;
    itemVariantValueCode: string | null;
    itemIds: string[];
  },
  options?: { excludeId?: string }
) {
  const itemIds = [...new Set(values.itemIds)];
  const scheduleConditions = [isNull(pricingSchedules.deletedAt)];

  if (values.customerCategoryId == null) {
    scheduleConditions.push(isNull(pricingSchedules.customerCategoryId));
  } else {
    scheduleConditions.push(eq(pricingSchedules.customerCategoryId, values.customerCategoryId));
  }

  if (options?.excludeId) {
    scheduleConditions.push(sql`${pricingSchedules.id} <> ${options.excludeId}`);
  }

  const [existingAllItemsSchedule] =
    values.itemScope === "all"
      ? await tx
          .select({ id: pricingSchedules.id })
          .from(pricingSchedules)
          .where(and(...scheduleConditions, eq(pricingSchedules.itemScope, "all")))
          .limit(1)
      : [];

  if (existingAllItemsSchedule) {
    throw new SalesError("A pricing schedule already exists for this scope.", 400, {
      errors: {
        itemIds: [
          "A pricing schedule already exists for this customer and all items.",
        ],
      },
    });
  }

  if (values.itemScope === "category") {
    if (values.itemCategory == null) {
      throw new SalesError("Item category is required", 400, {
        errors: {
          itemCategory: ["Item category is required"],
        },
      });
    }

    const [existingCategorySchedule] = await tx
      .select({ id: pricingSchedules.id })
      .from(pricingSchedules)
      .where(
        and(
          ...scheduleConditions,
          eq(pricingSchedules.itemScope, "category"),
          eq(pricingSchedules.itemCategory, values.itemCategory)
        )
      )
      .limit(1);

    if (existingCategorySchedule) {
      throw new SalesError("A pricing schedule already exists for this scope.", 400, {
        errors: {
          itemCategory: [
            "A pricing schedule already exists for this customer and item category.",
          ],
        },
      });
    }
  }

  if (values.itemScope === "variant") {
    if (values.itemVariantOptionCode == null || values.itemVariantValueCode == null) {
      throw new SalesError("Variant value is required", 400, {
        errors: {
          itemVariantValueCode: ["Choose a variant value."],
        },
      });
    }

    const [existingVariantSchedule] = await tx
      .select({ id: pricingSchedules.id })
      .from(pricingSchedules)
      .where(
        and(
          ...scheduleConditions,
          eq(pricingSchedules.itemScope, "variant"),
          eq(pricingSchedules.itemVariantOptionCode, values.itemVariantOptionCode),
          eq(pricingSchedules.itemVariantValueCode, values.itemVariantValueCode)
        )
      )
      .limit(1);

    if (existingVariantSchedule) {
      throw new SalesError("A pricing schedule already exists for this scope.", 400, {
        errors: {
          itemVariantValueCode: [
            "A pricing schedule already exists for this customer and variant value.",
          ],
        },
      });
    }
  }

  if (values.itemScope === "selected") {
    const [existingItemSchedule] = await tx
      .select({ id: pricingSchedules.id })
      .from(pricingSchedules)
      .innerJoin(
        pricingScheduleItems,
        eq(pricingScheduleItems.pricingScheduleId, pricingSchedules.id)
      )
      .where(and(...scheduleConditions, inArray(pricingScheduleItems.itemId, itemIds)))
      .limit(1);

    if (existingItemSchedule) {
      throw new SalesError("A pricing schedule already exists for this scope.", 400, {
        errors: {
          itemIds: [
            "One or more selected items already has a pricing schedule for this customer scope.",
          ],
        },
      });
    }
  }
}

async function ensurePricingScheduleVariantValueExistsInTx(
  tx: Tx,
  itemScope: "all" | "category" | "variant" | "selected",
  itemVariantOptionCode: string | null,
  itemVariantValueCode: string | null
) {
  if (itemScope !== "variant") return;
  if (itemVariantOptionCode == null || itemVariantValueCode == null) return;

  const [variantValue] = await tx
    .select({
      itemId: items.id,
    })
    .from(items)
    .innerJoin(itemVariantValues, eq(itemVariantValues.itemId, items.id))
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id)
    )
    .where(
      and(
        eq(items.itemType, "product"),
        eq(items.sellable, true),
        isNull(items.deletedAt),
        isNull(variantOptions.disabledAt),
        isNull(variantOptionValues.disabledAt),
        eq(variantOptions.code, itemVariantOptionCode),
        eq(variantOptionValues.code, itemVariantValueCode)
      )
    )
    .limit(1);

  if (!variantValue) {
    throw new SalesError("Variant value not found", 400, {
      errors: {
        itemVariantValueCode: ["Choose a variant value used by an active sellable product."],
      },
    });
  }
}

async function ensurePricingScheduleItemCategoryExistsInTx(
  tx: Tx,
  itemScope: "all" | "category" | "variant" | "selected",
  itemCategory: string | null
) {
  if (itemScope !== "category") return;

  const [category] = await tx
    .select({
      category: sql<string | null>`COALESCE(${itemFamilies.category}, ${items.category})`,
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(
      and(
        eq(items.itemType, "product"),
        eq(items.sellable, true),
        isNull(items.deletedAt),
        eq(sql`COALESCE(${itemFamilies.category}, ${items.category})`, itemCategory)
      )
    )
    .limit(1);

  if (!category) {
    throw new SalesError("Item category not found", 400, {
      errors: {
        itemCategory: ["Choose an active sellable product category."],
      },
    });
  }
}

async function ensurePricingScheduleItemsExistInTx(tx: Tx, itemIds: string[]) {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) return;

  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        inArray(items.id, uniqueIds),
        eq(items.itemType, "product"),
        eq(items.sellable, true),
        isNull(items.deletedAt)
      )
    );

  if (rows.length !== uniqueIds.length) {
    throw new SalesError("One or more selected items are not sellable.", 400, {
      errors: {
        itemIds: ["Only active sellable products can be selected."],
      },
    });
  }
}

async function getPricingScheduleBreaksInTx(
  tx: Tx,
  pricingScheduleId: string
): Promise<PricingScheduleBreakRecord[]> {
  return tx
    .select({
      id: pricingScheduleBreaks.id,
      pricingScheduleId: pricingScheduleBreaks.pricingScheduleId,
      minQuantity: trimScale(pricingScheduleBreaks.minQuantity).as("minQuantity"),
      maxQuantity: trimScaleNullable(pricingScheduleBreaks.maxQuantity).as("maxQuantity"),
      discountPercent: trimScale(pricingScheduleBreaks.discountPercent).as(
        "discountPercent"
      ),
      sortOrder: pricingScheduleBreaks.sortOrder,
    })
    .from(pricingScheduleBreaks)
    .where(eq(pricingScheduleBreaks.pricingScheduleId, pricingScheduleId))
    .orderBy(
      asc(pricingScheduleBreaks.sortOrder),
      asc(pricingScheduleBreaks.minQuantity)
    );
}

export async function getPricingScheduleLookupForProductsInTx(
  tx: Tx,
  products: Array<
    Pick<
      SalesItemValidationRow,
      "id" | "category" | "variantValues" | "defaultSellingPrice"
    >
  >,
  customerCategoryId: string | null
): Promise<PricingScheduleLookup> {
  const itemIds = [
    ...new Set(
      products
        .filter((product) => product.defaultSellingPrice != null)
        .map((product) => product.id)
    ),
  ];
  const variantKeys = new Set(
    products
      .filter((product) => product.defaultSellingPrice != null)
      .flatMap((product) =>
        product.variantValues.map(
          (value) => `${value.optionCode}\u0000${value.valueCode}`
        )
      )
  );
  const itemCategories = [
    ...new Set(
      products
        .filter((product) => product.defaultSellingPrice != null && product.category != null)
        .map((product) => product.category)
        .filter((category): category is string => category != null)
    ),
  ];
  const schedules: PricingScheduleRecord[] = [];
  const breaksByScheduleId = new Map<string, PricingScheduleBreakRecord[]>();

  if (products.every((product) => product.defaultSellingPrice == null)) {
    return { schedules, breaksByScheduleId };
  }

  const scheduleRows = await tx
    .select({
      id: pricingSchedules.id,
      name: pricingSchedules.name,
      customerCategoryId: pricingSchedules.customerCategoryId,
      itemScope: pricingSchedules.itemScope,
      itemCategory: pricingSchedules.itemCategory,
      itemVariantOptionCode: pricingSchedules.itemVariantOptionCode,
      itemVariantValueCode: pricingSchedules.itemVariantValueCode,
      itemId: pricingScheduleItems.itemId,
    })
    .from(pricingSchedules)
    .leftJoin(
      pricingScheduleItems,
      eq(pricingScheduleItems.pricingScheduleId, pricingSchedules.id)
    )
    .where(
      and(
        itemIds.length === 0
          ? eq(pricingSchedules.itemScope, "all")
          : or(
              inArray(pricingScheduleItems.itemId, itemIds),
              eq(pricingSchedules.itemScope, "all"),
              itemCategories.length > 0
                ? and(
                    eq(pricingSchedules.itemScope, "category"),
                    inArray(pricingSchedules.itemCategory, itemCategories)
                  )
                : undefined,
              eq(pricingSchedules.itemScope, "variant")
            ),
        customerCategoryId == null
          ? isNull(pricingSchedules.customerCategoryId)
          : or(
              eq(pricingSchedules.customerCategoryId, customerCategoryId),
              isNull(pricingSchedules.customerCategoryId)
            ),
        isNull(pricingSchedules.deletedAt)
      )
    );

  schedules.push(
    ...scheduleRows.filter((schedule) => {
      if (schedule.itemScope !== "variant") return true;
      if (
        schedule.itemVariantOptionCode == null ||
        schedule.itemVariantValueCode == null
      ) {
        return false;
      }
      return variantKeys.has(
        `${schedule.itemVariantOptionCode}\u0000${schedule.itemVariantValueCode}`
      );
    })
  );

  const scheduleIds = schedules.map((schedule) => schedule.id);
  if (scheduleIds.length === 0) {
    return { schedules, breaksByScheduleId };
  }

  const breakRows = await tx
    .select({
      id: pricingScheduleBreaks.id,
      pricingScheduleId: pricingScheduleBreaks.pricingScheduleId,
      minQuantity: trimScale(pricingScheduleBreaks.minQuantity).as("minQuantity"),
      maxQuantity: trimScaleNullable(pricingScheduleBreaks.maxQuantity).as("maxQuantity"),
      discountPercent: trimScale(pricingScheduleBreaks.discountPercent).as(
        "discountPercent"
      ),
      sortOrder: pricingScheduleBreaks.sortOrder,
    })
    .from(pricingScheduleBreaks)
    .where(inArray(pricingScheduleBreaks.pricingScheduleId, scheduleIds))
    .orderBy(
      asc(pricingScheduleBreaks.sortOrder),
      asc(pricingScheduleBreaks.minQuantity)
    );

  for (const pricingBreak of breakRows) {
    const bucket = breaksByScheduleId.get(pricingBreak.pricingScheduleId) ?? [];
    bucket.push(pricingBreak);
    breaksByScheduleId.set(pricingBreak.pricingScheduleId, bucket);
  }

  return { schedules, breaksByScheduleId };
}

function findMatchingPricingBreak(
  breaks: PricingScheduleBreakRecord[],
  quantity: string | null
) {
  const parsedQuantity = parsePositive(quantity);
  if (parsedQuantity == null) {
    return null;
  }

  return (
    breaks.find((pricingBreak) => {
      const minQuantity = parseFloat(pricingBreak.minQuantity);
      const maxQuantity =
        pricingBreak.maxQuantity == null
          ? null
          : parseFloat(pricingBreak.maxQuantity);

      return (
        parsedQuantity >= minQuantity &&
        (maxQuantity == null || parsedQuantity <= maxQuantity)
      );
    }) ?? null
  );
}

export function resolvePricingForProduct(
  values: {
    customerCategoryId: string | null;
    customerCategoryName: string | null;
    product: Pick<
      SalesItemValidationRow,
      "id" | "category" | "variantValues" | "defaultSellingPrice"
    >;
    quantity: string | null;
  },
  lookup: PricingScheduleLookup
): Omit<SalesLinePricingResult, "estimatedUnitCost"> {
  const baseUnitPrice = values.product.defaultSellingPrice;

  if (baseUnitPrice == null) {
    return {
      baseUnitPrice: null,
      suggestedUnitPrice: null,
      pricingSourceType: "base_price",
      pricingScheduleName: null,
      pricingBreakLabel: null,
      customerCategoryName: values.customerCategoryName,
    };
  }

  const candidates = lookup.schedules
    .filter((pricingSchedule) => {
      if (pricingSchedule.itemScope === "all") return true;
      if (pricingSchedule.itemScope === "selected") {
        return pricingSchedule.itemId === values.product.id;
      }
      if (pricingSchedule.itemScope === "category") {
        return (
          values.product.category != null &&
          pricingSchedule.itemCategory === values.product.category
        );
      }
      if (pricingSchedule.itemScope === "variant") {
        return values.product.variantValues.some(
          (variantValue) =>
            variantValue.optionCode === pricingSchedule.itemVariantOptionCode &&
            variantValue.valueCode === pricingSchedule.itemVariantValueCode
        );
      }
      return false;
    })
    .map((pricingSchedule) => {
      const pricingBreaks = lookup.breaksByScheduleId.get(pricingSchedule.id) ?? [];
      const matchingBreak = findMatchingPricingBreak(pricingBreaks, values.quantity);
      if (!matchingBreak) return null;

      const suggestedUnitPrice = normalizeMoney(
        Number(baseUnitPrice) *
          (1 - Number(matchingBreak.discountPercent) / 100)
      );

      return {
        pricingSchedule,
        matchingBreak,
        suggestedUnitPrice,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null);

  const best = candidates.reduce<(typeof candidates)[number] | null>(
    (current, candidate) => {
      if (!current) return candidate;
      return Number(candidate.suggestedUnitPrice) < Number(current.suggestedUnitPrice)
        ? candidate
        : current;
    },
    null
  );

  if (!best) {
    return {
      baseUnitPrice,
      suggestedUnitPrice: baseUnitPrice,
      pricingSourceType: "base_price",
      pricingScheduleName: null,
      pricingBreakLabel: null,
      customerCategoryName: values.customerCategoryName,
    };
  }

  return {
    baseUnitPrice,
    suggestedUnitPrice: best.suggestedUnitPrice,
    pricingSourceType: "schedule_break",
    pricingScheduleName: best.pricingSchedule.name,
    pricingBreakLabel: formatPricingBreakLabel(
      best.matchingBreak.minQuantity,
      best.matchingBreak.maxQuantity
    ),
    customerCategoryName: values.customerCategoryName,
  };
}

async function resolvePricingForProductInTx(
  tx: Tx,
  values: {
    customerCategoryId: string | null;
    customerCategoryName: string | null;
    product: Pick<
      SalesItemValidationRow,
      "id" | "category" | "variantValues" | "defaultSellingPrice"
    >;
    quantity: string | null;
  }
): Promise<Omit<SalesLinePricingResult, "estimatedUnitCost">> {
  const lookup = await getPricingScheduleLookupForProductsInTx(
    tx,
    [values.product],
    values.customerCategoryId
  );
  return resolvePricingForProduct(values, lookup);
}

export async function getPricingScheduleItemOptions(): Promise<PricingScheduleItemOption[]> {
  const options = await getSalesOrderItemOptions();
  return options
    .filter((option) => option.itemType === "product")
    .map(({ id, name, displayName, sku, category, unitName, itemType, variantValues }) => ({
      id,
      name,
      displayName,
      sku,
      category,
      unitName,
      itemType,
      variantValues,
    }));
}

export async function getPricingSchedules(): Promise<PricingScheduleRow[]> {
  return measureObservedOperation(
    "sales.get_pricing_schedules",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const rows = await tx
          .select({
            id: pricingSchedules.id,
            name: pricingSchedules.name,
            customerCategoryId: pricingSchedules.customerCategoryId,
            customerCategoryName: customerCategories.name,
            itemScope: pricingSchedules.itemScope,
            itemCategory: pricingSchedules.itemCategory,
            itemVariantOptionCode: pricingSchedules.itemVariantOptionCode,
            itemVariantValueCode: pricingSchedules.itemVariantValueCode,
            notes: pricingSchedules.notes,
            updatedAt: pricingSchedules.updatedAt,
          })
          .from(pricingSchedules)
          .leftJoin(
            customerCategories,
            eq(pricingSchedules.customerCategoryId, customerCategories.id)
          )
          .where(isNull(pricingSchedules.deletedAt))
          .orderBy(
            asc(customerCategories.name),
            asc(pricingSchedules.name)
          );

        if (rows.length === 0) {
          return [];
        }

        const scheduleIds = rows.map((row) => row.id);
        const [breaks, scheduleItemRows] = await Promise.all([
          tx
          .select({
            pricingScheduleId: pricingScheduleBreaks.pricingScheduleId,
            minQuantity: trimScale(pricingScheduleBreaks.minQuantity).as("minQuantity"),
            maxQuantity: trimScaleNullable(pricingScheduleBreaks.maxQuantity).as("maxQuantity"),
            discountPercent: trimScale(pricingScheduleBreaks.discountPercent).as(
              "discountPercent"
            ),
            sortOrder: pricingScheduleBreaks.sortOrder,
          })
          .from(pricingScheduleBreaks)
          .where(inArray(pricingScheduleBreaks.pricingScheduleId, scheduleIds))
          .orderBy(
            asc(pricingScheduleBreaks.sortOrder),
            asc(pricingScheduleBreaks.minQuantity)
          ),
          tx
            .select({
              pricingScheduleId: pricingScheduleItems.pricingScheduleId,
              itemId: pricingScheduleItems.itemId,
              itemName: items.name,
              familyName: itemFamilies.name,
            })
            .from(pricingScheduleItems)
            .innerJoin(items, eq(pricingScheduleItems.itemId, items.id))
            .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
            .where(inArray(pricingScheduleItems.pricingScheduleId, scheduleIds))
            .orderBy(asc(itemFamilies.name), asc(items.name)),
        ]);

        const breaksByScheduleId = new Map<
          string,
          Array<{
            minQuantity: string;
            maxQuantity: string | null;
            discountPercent: string;
          }>
        >();

        for (const pricingBreak of breaks) {
          const bucket =
            breaksByScheduleId.get(pricingBreak.pricingScheduleId) ?? [];
          bucket.push({
            minQuantity: pricingBreak.minQuantity,
            maxQuantity: pricingBreak.maxQuantity,
            discountPercent: pricingBreak.discountPercent,
          });
          breaksByScheduleId.set(pricingBreak.pricingScheduleId, bucket);
        }

        const itemsByScheduleId = new Map<
          string,
          Array<{ id: string; label: string }>
        >();
        for (const item of scheduleItemRows) {
          const bucket = itemsByScheduleId.get(item.pricingScheduleId) ?? [];
          bucket.push({
            id: item.itemId,
            label: item.familyName ? `${item.familyName} - ${item.itemName}` : item.itemName,
          });
          itemsByScheduleId.set(item.pricingScheduleId, bucket);
        }

        return rows.map((row) => {
          const scheduleBreaks = breaksByScheduleId.get(row.id) ?? [];
          return {
            id: row.id,
            name: row.name,
            customerCategoryId: row.customerCategoryId,
            customerScopeLabel: row.customerCategoryName ?? "Everyone",
            itemScope: row.itemScope as PricingScheduleRow["itemScope"],
            itemCategory: row.itemCategory,
            itemVariantOptionCode: row.itemVariantOptionCode,
            itemVariantValueCode: row.itemVariantValueCode,
            itemIds: (itemsByScheduleId.get(row.id) ?? []).map((item) => item.id),
            itemScopeLabel:
              row.itemScope === "all"
                ? "All items"
                : row.itemScope === "category"
                  ? row.itemCategory ?? "Item category"
                  : row.itemScope === "variant"
                  ? row.itemVariantOptionCode && row.itemVariantValueCode
                    ? `${row.itemVariantOptionCode}: ${row.itemVariantValueCode}`
                    : "Variant value"
                  : (itemsByScheduleId.get(row.id) ?? []).map((item) => item.label).join(", "),
            notes: row.notes,
            breakCount: scheduleBreaks.length,
            breakSummary: summarizePricingBreaks(scheduleBreaks),
            updatedAt: row.updatedAt,
          };
        });
      });
    },
    {
      successData: (schedules) => ({
        rowCount: schedules.length,
      }),
    }
  );
}

export async function getPricingSchedule(
  id: string
): Promise<PricingScheduleEditData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [schedule] = await tx
      .select({
        id: pricingSchedules.id,
        name: pricingSchedules.name,
        customerCategoryId: pricingSchedules.customerCategoryId,
        itemScope: pricingSchedules.itemScope,
        itemCategory: pricingSchedules.itemCategory,
        itemVariantOptionCode: pricingSchedules.itemVariantOptionCode,
        itemVariantValueCode: pricingSchedules.itemVariantValueCode,
        notes: pricingSchedules.notes,
      })
      .from(pricingSchedules)
      .where(and(eq(pricingSchedules.id, id), isNull(pricingSchedules.deletedAt)));

    if (!schedule) {
      return null;
    }

    const [breaks, scheduleItems] = await Promise.all([
      getPricingScheduleBreaksInTx(tx, id),
      tx
        .select({ itemId: pricingScheduleItems.itemId })
        .from(pricingScheduleItems)
        .where(eq(pricingScheduleItems.pricingScheduleId, id)),
    ]);

    return {
      ...schedule,
      itemScope: schedule.itemScope as PricingScheduleEditData["itemScope"],
      itemIds: scheduleItems.map((item) => item.itemId),
      breaks: breaks.map((pricingBreak) => ({
        minQuantity: pricingBreak.minQuantity,
        maxQuantity: pricingBreak.maxQuantity,
        discountPercent: pricingBreak.discountPercent,
      })),
    };
  });
}

export async function createPricingSchedule(data: InsertPricingSchedule) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertFeatureAccessInTx(tx, orgId, "wholesale_pricing", {
      route: "POST /api/pricing-schedules",
    });
    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);
    await ensurePricingScheduleItemCategoryExistsInTx(
      tx,
      data.itemScope,
      data.itemCategory
    );
    await ensurePricingScheduleVariantValueExistsInTx(
      tx,
      data.itemScope,
      data.itemVariantOptionCode,
      data.itemVariantValueCode
    );
    await ensurePricingScheduleItemsExistInTx(
      tx,
      data.itemScope === "selected" ? data.itemIds : []
    );
    await ensurePricingScheduleScopeAvailableInTx(tx, data);

    const [schedule] = await tx
      .insert(pricingSchedules)
      .values({
        organizationId: orgId,
        name: data.name,
        customerCategoryId: data.customerCategoryId,
        itemScope: data.itemScope,
        itemCategory: data.itemScope === "category" ? data.itemCategory : null,
        itemVariantOptionCode:
          data.itemScope === "variant" ? data.itemVariantOptionCode : null,
        itemVariantValueCode:
          data.itemScope === "variant" ? data.itemVariantValueCode : null,
        notes: data.notes,
      })
      .returning({ id: pricingSchedules.id });

    if (data.itemScope === "selected" && data.itemIds.length > 0) {
      await tx.insert(pricingScheduleItems).values(
        [...new Set(data.itemIds)].map((itemId) => ({
          organizationId: orgId,
          pricingScheduleId: schedule.id,
          customerCategoryId: data.customerCategoryId,
          itemId,
        }))
      );
    }

    await tx.insert(pricingScheduleBreaks).values(
      data.breaks.map((pricingBreak, index) => ({
        pricingScheduleId: schedule.id,
        minQuantity: normalizeNumeric(Number(pricingBreak.minQuantity)),
        maxQuantity:
          pricingBreak.maxQuantity == null
            ? null
            : normalizeNumeric(Number(pricingBreak.maxQuantity)),
        discountPercent: normalizeMoney(Number(pricingBreak.discountPercent)),
        sortOrder: index,
      }))
    );

    return schedule;
  });
}

export async function updatePricingSchedule(
  id: string,
  data: UpdatePricingSchedule
) {
  return withAuthedOrgContext(async (tx) => {
    const [existingSchedule] = await tx
      .select({
        id: pricingSchedules.id,
        organizationId: pricingSchedules.organizationId,
      })
      .from(pricingSchedules)
      .where(and(eq(pricingSchedules.id, id), isNull(pricingSchedules.deletedAt)));

    if (!existingSchedule) {
      return null;
    }

    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);
    await ensurePricingScheduleItemCategoryExistsInTx(
      tx,
      data.itemScope,
      data.itemCategory
    );
    await ensurePricingScheduleVariantValueExistsInTx(
      tx,
      data.itemScope,
      data.itemVariantOptionCode,
      data.itemVariantValueCode
    );
    await ensurePricingScheduleItemsExistInTx(
      tx,
      data.itemScope === "selected" ? data.itemIds : []
    );
    await ensurePricingScheduleScopeAvailableInTx(tx, data, {
      excludeId: id,
    });

    await tx
      .update(pricingSchedules)
      .set({
        name: data.name,
        customerCategoryId: data.customerCategoryId,
        itemScope: data.itemScope,
        itemCategory: data.itemScope === "category" ? data.itemCategory : null,
        itemVariantOptionCode:
          data.itemScope === "variant" ? data.itemVariantOptionCode : null,
        itemVariantValueCode:
          data.itemScope === "variant" ? data.itemVariantValueCode : null,
        notes: data.notes,
        updatedAt: new Date(),
      })
      .where(eq(pricingSchedules.id, id));

    await tx
      .delete(pricingScheduleItems)
      .where(eq(pricingScheduleItems.pricingScheduleId, id));

    if (data.itemScope === "selected" && data.itemIds.length > 0) {
      await tx.insert(pricingScheduleItems).values(
        [...new Set(data.itemIds)].map((itemId) => ({
          organizationId: existingSchedule.organizationId,
          pricingScheduleId: id,
          customerCategoryId: data.customerCategoryId,
          itemId,
        }))
      );
    }

    await tx
      .delete(pricingScheduleBreaks)
      .where(eq(pricingScheduleBreaks.pricingScheduleId, id));

    await tx.insert(pricingScheduleBreaks).values(
      data.breaks.map((pricingBreak, index) => ({
        pricingScheduleId: id,
        minQuantity: normalizeNumeric(Number(pricingBreak.minQuantity)),
        maxQuantity:
          pricingBreak.maxQuantity == null
            ? null
            : normalizeNumeric(Number(pricingBreak.maxQuantity)),
        discountPercent: normalizeMoney(Number(pricingBreak.discountPercent)),
        sortOrder: index,
      }))
    );

    return { id };
  });
}

async function softDeletePricingSchedulesInTx(tx: Tx, scheduleIds: string[]) {
  if (scheduleIds.length === 0) {
    return [];
  }

  const deletedSchedules = await tx
    .update(pricingSchedules)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(pricingSchedules.id, scheduleIds),
        isNull(pricingSchedules.deletedAt)
      )
    )
    .returning({ id: pricingSchedules.id });

  const deletedIds = deletedSchedules.map((schedule) => schedule.id);
  if (deletedIds.length > 0) {
    await tx
      .delete(pricingScheduleItems)
      .where(inArray(pricingScheduleItems.pricingScheduleId, deletedIds));
  }

  return deletedSchedules;
}

export async function deletePricingSchedule(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [schedule] = await softDeletePricingSchedulesInTx(tx, [id]);
    return { deleted: schedule != null };
  });
}

export async function deletePricingSchedules(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const deletedSchedules = await softDeletePricingSchedulesInTx(
      tx,
      [...new Set(ids)]
    );
    return { deletedCount: deletedSchedules.length };
  });
}

export async function resolveSalesLinePricing(
  values: ResolveSalesLinePricingInput
): Promise<SalesLinePricingResult> {
  return withAuthedOrgContext(async (tx) => {
    const customer = await getValidatedCustomerInTx(tx, values.customerId);
    const itemsById = await getValidatedSalesItemsInTx(tx, [values.itemId]);
    const item = itemsById.get(values.itemId);

    if (!item) {
      throw new SalesError("Item not found", 404);
    }

    const [pricing, estimatedUnitCosts] = await Promise.all([
      resolvePricingForProductInTx(tx, {
        customerCategoryId: customer.customerCategoryId,
        customerCategoryName: customer.customerCategoryName,
        product: item,
        quantity: values.quantity,
      }),
      getEstimatedUnitCostsByItemIdInTx(tx, [values.itemId]),
    ]);

    return {
      ...pricing,
      estimatedUnitCost: estimatedUnitCosts.get(values.itemId) ?? null,
    };
  });
}
