import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  formatQuantity,
  normalizeNumericScale,
  normalizeNumeric,
  normalizeQuantityNumber,
  normalizeMoney,
  parsePositive,
  roundQuantity,
  summarizeItems,
} from "@/lib/format";
import {
  customerCategories,
  customerContacts,
  customerCorrespondence,
  customerCorrespondenceAttendees,
  customerProjectFiles,
  customerProjects,
  accountingDocumentSyncs,
  customers,
  inventoryEvents,
  inventoryReservationsSummary,
  integrationExternalRecords,
  itemFamilies,
  itemVariantValues,
  items,
  lots,
  manufacturingOrderBatches,
  manufacturingOrderOutputs,
  manufacturingOrderIngredients,
  manufacturingOrders,
  pricingScheduleBreaks,
  pricingScheduleItems,
  pricingSchedules,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import {
  ACCOUNTING_DOCUMENT_SALES_ORDER,
  ACCOUNTING_PROVIDER_XERO,
} from "@/lib/accounting/sync-state";
import type { AccountingProvider } from "@/lib/accounting/constants";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import {
  getTaxSettingsInTx,
  getTaxRatesByIdInTx,
} from "@/lib/dal/tax-settings";
import type { Tx } from "@/lib/db/with-org-context";
import { lockSalesPriorityQueueInTx } from "@/lib/manufacturing-priority-lock";
import {
  beginInventoryOperationInTx,
  consumeForSalesOrderShippingInTx,
  deriveInventoryIdempotencyKey,
  finishInventoryOperationInTx,
  InsufficientStockError,
  LinkedManufacturingOutputUnavailableError,
  lockItemsInTx,
  releaseReservationForSalesLineInTx,
  projectedAvailableQty,
  projectedCommittedQty,
  projectedDemandQty,
  projectedExpectedQty,
  projectedOnHandQty,
  projectedOnHandQtyExpr,
  projectedPotentialQty,
  projectedShortageQty,
  recordSalesDemandAndReservationsInTx,
  reserveForSalesInTx,
  releaseReservationForSalesQuantitiesInTx,
} from "@/lib/inventory/kernel";
import {
  DomainError,
} from "@/lib/errors/domain-error";
import {
  calculateMarginMetrics,
  calculateUnitMarginMetrics,
} from "@/lib/margin";
import {
  calculateDiscountPercentString,
  calculateSalesLineAmounts,
} from "@/lib/sales/order-calculations";
import { measureObservedOperation } from "@/lib/observability/request-log";
import {
  buildFifoLotPickPlanInTx,
  type LotPickPlanEntry,
} from "@/lib/inventory/lot-pick-plan";
import { getItemDisplayNamesByIdInTx } from "@/lib/inventory/item-display";
import {
  completeManufacturingOrder,
  deleteManufacturingOrdersInTx,
  ManufacturingError,
  recordManufacturingOutput,
} from "@/app/(dashboard)/manufacturing/queries";
import type {
  InsertCustomer,
  PatchCustomer,
  UpdateCustomer,
} from "@/lib/schemas/customers";
import type {
  CustomerContactInput,
  CustomerCorrespondenceInput,
  CustomerProjectFileRenameInput,
  CustomerProjectInput,
} from "@/lib/schemas/customer-crm";
import type {
  InsertCustomerCategory,
  UpdateCustomerCategory,
} from "@/lib/schemas/customer-categories";
import type {
  InsertPricingSchedule,
  ResolveSalesLinePricingInput,
  UpdatePricingSchedule,
} from "@/lib/schemas/pricing-schedules";
import type {
  BulkConfirmSalesOrders,
  InsertSalesOrder,
  PatchSalesOrderHeader,
  PatchSalesOrderLine,
  ReorderSalesOrderPriorityRanks,
  ShipSalesOrder,
  UpdateSalesOrder,
} from "@/lib/schemas/sales-orders";
import type {
  CustomerContactRole,
  CustomerContactRow,
  CustomerCorrespondenceRow,
  CustomerCategoryOption,
  CustomerCategoryRow,
  CustomerDetailData,
  CustomerProjectFileRow,
  CustomerProjectRow,
  CustomerOption,
  CustomerRow,
  NegativeStockWarningPayload,
  PricingScheduleEditData,
  PricingScheduleItemOption,
  PricingScheduleRow,
  PricingSourceType,
  SalesAllocationLineSummary,
  SalesOrderFulfillmentSummary,
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderEditData,
  SalesLinkedManufacturingOrder,
  SalesLinePricingResult,
  SalesOrderListRow,
  SalesShippingQueueRow,
  SalesOrderItemOption,
  SalesShippingReadiness,
  SalesMarginSummary,
} from "./types";
import {
  getSalesOrderManufacturingSummariesInTx,
  type SalesOrderManufacturingLineSummary,
} from "@/lib/manufacturing/sales-order-manufacturability";
import {
  getSalesFulfillmentReadModelsInTx,
  getAvailabilityLabel,
  type SalesFulfillmentDemandLine,
  type SalesIngredientShortageSummary,
} from "@/lib/sales/fulfillment-read-model";
import {
  demandQueueCoverageKey,
  getDemandQueueInventoryLotClaimConflicts,
  getDemandQueueCoverageForItemsInTx,
  getDemandQueueCoverageByDemandKeyForItemsInTx,
  type DemandQueueCoverageDemand,
} from "@/lib/inventory/allocation/demand-queue";
import { getEstimatedUnitCostsByItemIdInTx } from "@/lib/inventory/estimated-cost";
import { getAddressEntryInTx } from "@/lib/dal/addresses";

const stockSubquery = projectedOnHandQty(items.organizationId, items.id).as("stock");
const committedQtySubquery = projectedCommittedQty(
  items.organizationId,
  items.id
).as("committedQty");
const demandQtySubquery = projectedDemandQty(
  items.organizationId,
  items.id
).as("demandQty");
const shortageQtySubquery = projectedShortageQty(
  items.organizationId,
  items.id
).as("shortageQty");
const availableQtySubquery = projectedAvailableQty(
  items.organizationId,
  items.id
).as("availableQty");
const expectedQtySubquery = projectedExpectedQty(
  items.organizationId,
  items.id
).as("expectedQty");

/**
 * `availableQty` is derived here in the data layer so components never do
 * quantity arithmetic (which leaks float artifacts to the screen).
 */
function serializeIngredientShortage(shortage: SalesIngredientShortageSummary) {
  return {
    ...shortage,
    requiredQty: normalizeNumeric(roundQuantity(shortage.requiredQty)),
    shortQty: normalizeNumeric(roundQuantity(shortage.shortQty)),
    availableQty: normalizeNumeric(roundQuantity(shortage.availableQty)),
    expectedQty: normalizeNumeric(roundQuantity(shortage.expectedQty)),
    missingQty: normalizeNumeric(roundQuantity(shortage.missingQty)),
  };
}

async function getSalesOptionLabelsByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, string[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      label: variantOptionValues.label,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id)
    )
    .where(inArray(itemVariantValues.itemId, uniqueItemIds))
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, string[]>();
  for (const row of rows) {
    const labels = byItemId.get(row.itemId) ?? [];
    labels.push(row.label);
    byItemId.set(row.itemId, labels);
  }
  return byItemId;
}

type SalesVariantValue = {
  optionName: string;
  optionCode: string;
  valueLabel: string;
  valueCode: string;
};

async function getSalesVariantValuesByItemIdInTx(tx: Tx, itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map<string, SalesVariantValue[]>();
  }

  const rows = await tx
    .select({
      itemId: itemVariantValues.itemId,
      optionName: variantOptions.name,
      optionCode: variantOptions.code,
      valueLabel: variantOptionValues.label,
      valueCode: variantOptionValues.code,
    })
    .from(itemVariantValues)
    .innerJoin(variantOptions, eq(itemVariantValues.optionId, variantOptions.id))
    .innerJoin(
      variantOptionValues,
      eq(itemVariantValues.optionValueId, variantOptionValues.id)
    )
    .where(
      and(
        inArray(itemVariantValues.itemId, uniqueItemIds),
        isNull(variantOptions.disabledAt),
        isNull(variantOptionValues.disabledAt)
      )
    )
    .orderBy(asc(variantOptions.sortOrder), asc(variantOptionValues.sortOrder));

  const byItemId = new Map<string, SalesVariantValue[]>();
  for (const row of rows) {
    const values = byItemId.get(row.itemId) ?? [];
    values.push({
      optionName: row.optionName,
      optionCode: row.optionCode,
      valueLabel: row.valueLabel,
      valueCode: row.valueCode,
    });
    byItemId.set(row.itemId, values);
  }
  return byItemId;
}

function formatSalesItemDisplayName(
  itemName: string,
  familyName: string | null,
  optionLabels: string[]
) {
  if (!familyName) return itemName;
  return optionLabels.length > 0 ? `${familyName} / ${optionLabels.join(" / ")}` : familyName;
}

function parseMoneyValue(value: string | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSalesMarginSummary(params: {
  productRevenue: number;
  freightRecovery: number;
  productCogs: number | null;
  fulfillmentCosts: number;
  costStatus: SalesMarginSummary["costStatus"];
}): SalesMarginSummary {
  const revenue = params.productRevenue + params.freightRecovery;
  const totalCosts =
    params.productCogs == null ? null : params.productCogs + params.fulfillmentCosts;
  const metrics =
    totalCosts == null
      ? null
      : calculateMarginMetrics({
          revenue,
          cogs: totalCosts,
        });

  return {
    productRevenue: normalizeMoney(params.productRevenue),
    freightRecovery: normalizeMoney(params.freightRecovery),
    productCogs: params.productCogs == null ? null : normalizeMoney(params.productCogs),
    fulfillmentCosts: normalizeMoney(params.fulfillmentCosts),
    contributionMargin: metrics?.grossProfit ?? null,
    marginPercent: metrics?.marginPercent ?? null,
    costStatus: params.costStatus,
  };
}

async function getActualSalesLineCostsByLineIdInTx(tx: Tx, salesOrderId: string) {
  const salesOrderLineIdExpr = sql<string>`(${inventoryEvents.metadata}->>'salesOrderLineId')`;
  const rows = await tx
    .select({
      salesOrderLineId: salesOrderLineIdExpr.as("salesOrderLineId"),
      quantity: trimScale(sql`COALESCE(SUM(${inventoryEvents.quantity}), 0)`).as(
        "quantity"
      ),
      cogs: trimScale(sql`COALESCE(SUM(${inventoryEvents.extendedCost}), 0)`).as(
        "cogs"
      ),
    })
    .from(inventoryEvents)
    .where(
      and(
        eq(inventoryEvents.eventType, "sales_consumption"),
        sql`${inventoryEvents.metadata}->>'salesOrderLineId' IS NOT NULL`,
        sql`(
          (${inventoryEvents.referenceType} = 'sales_order' AND ${inventoryEvents.referenceId} = ${salesOrderId})
          OR ${inventoryEvents.metadata}->>'salesOrderId' = ${salesOrderId}
        )`
      )
    )
    .groupBy(salesOrderLineIdExpr);

  return new Map(rows.map((row) => [row.salesOrderLineId, row]));
}

type PreparedOrderLineBase = {
  salesOrderLineId?: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: string;
  listUnitPrice: string | null;
  unitPrice: string;
  taxRateId: string | null;
  taxRateName: string | null;
  taxRatePercent: string;
  discountPercent: string;
  lineSubtotal: string;
  lineTaxAmount: string;
  lineTotal: string;
  sortOrder: number;
  allocationManagedAt?: Date | null;
};

type PreparedOrderLine = PreparedOrderLineBase & {
  suggestedUnitPrice: string | null;
  pricingSourceType: PricingSourceType;
  pricingScheduleName: string | null;
  pricingBreakLabel: string | null;
  isPriceOverridden: boolean;
};

type SalesItemValidationRow = {
  id: string;
  itemType: string;
  name: string;
  familyName: string | null;
  sku: string | null;
  sellable: boolean | null;
  category: string | null;
  unitDefinitionId: string;
  unitName: string;
  variantValues: SalesVariantValue[];
  defaultSellingPrice: string | null;
  stock: string;
  committedQty: string;
  demandQty: string;
  shortageQty: string;
  availableQty: string;
  expectedQty: string;
  safetyStock: string;
  displayName: string;
};

type ValidatedCustomerRow = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  customerCategoryName: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
};

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

function normalizeOptionalLineMoney(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? normalizeMoney(parsed) : null;
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

async function ensureCustomerCategoryExistsInTx(
  tx: Tx,
  customerCategoryId: string | null
) {
  if (customerCategoryId == null) {
    return;
  }

  const [existingCategory] = await tx
    .select({ id: customerCategories.id })
    .from(customerCategories)
    .where(
      and(
        eq(customerCategories.id, customerCategoryId),
        isNull(customerCategories.deletedAt)
      )
    );

  if (!existingCategory) {
    throw new SalesError("Customer category not found.", 404);
  }
}

async function ensureCustomerCategoryNameAvailableInTx(
  tx: Tx,
  name: string,
  options?: { excludeId?: string }
) {
  const conditions = [
    eq(customerCategories.name, name),
    isNull(customerCategories.deletedAt),
  ];

  if (options?.excludeId) {
    conditions.push(sql`${customerCategories.id} <> ${options.excludeId}`);
  }

  const [existingCategory] = await tx
    .select({ id: customerCategories.id })
    .from(customerCategories)
    .where(and(...conditions))
    .limit(1);

  if (existingCategory) {
    throw new SalesError("A customer category with this name already exists.", 400, {
      errors: {
        name: ["A customer category with this name already exists."],
      },
    });
  }
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

async function getPricingScheduleLookupForProductsInTx(
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

function resolvePricingForProduct(
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

export class SalesError extends DomainError<{
  negativeStock: NegativeStockWarningPayload;
}> {
  negativeStock?: NegativeStockWarningPayload;

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      negativeStock?: NegativeStockWarningPayload;
    }
  ) {
    super(message, status, {
      name: "SalesError",
      errors: options?.errors,
      extra: options?.negativeStock
        ? { negativeStock: options.negativeStock }
        : undefined,
    });

    this.negativeStock = options?.negativeStock;
  }
}

function getPgErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string") {
    return record.code;
  }

  return getPgErrorCode(record.cause);
}

function isRetryableTransactionError(error: unknown) {
  const code = getPgErrorCode(error);
  return code === "40P01" || code === "40001";
}

async function withSalesTransactionRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === 2) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  throw lastError;
}

type LinkedManufacturingStatus = Pick<
  SalesOrderDetail["linkedManufacturingOrders"][number],
  "orderNumber" | "status" | "productionStatus"
>;

type LinkedManufacturingOrderRead = SalesLinkedManufacturingOrder & {
  salesOrderId: string;
  salesOrderLineId: string | null;
  createdAt: Date;
};

function mergeManufacturingLinkSource(
  current: SalesLinkedManufacturingOrder["linkSource"] | undefined,
  next: SalesLinkedManufacturingOrder["linkSource"]
): SalesLinkedManufacturingOrder["linkSource"] {
  if (!current || current === next) return next;
  return "both";
}

async function getLinkedManufacturingOrdersBySalesOrderIdInTx(
  tx: Tx,
  salesOrderIds: string[]
) {
  const uniqueSalesOrderIds = [...new Set(salesOrderIds)];
  const bySalesOrderId = new Map<string, LinkedManufacturingOrderRead[]>();

  if (uniqueSalesOrderIds.length === 0) {
    return bySalesOrderId;
  }

  const productionStatusExpression = sql<SalesLinkedManufacturingOrder["productionStatus"]>`
    CASE
      WHEN ${manufacturingOrders.status} = 'done' THEN 'done'
      WHEN ${manufacturingOrders.isBlocked} THEN 'blocked'
      WHEN ${manufacturingOrders.startedAt} IS NOT NULL THEN 'in_progress'
      WHEN COALESCE(${manufacturingOrders.actualQuantity}, 0) > 0 THEN 'in_progress'
      WHEN EXISTS (
        SELECT 1
        FROM ${manufacturingOrderBatches}
        WHERE ${manufacturingOrderBatches.manufacturingOrderId} = ${manufacturingOrders.id}
          AND ${manufacturingOrderBatches.status} IN ('in_progress', 'completed')
      ) THEN 'in_progress'
      WHEN EXISTS (
        SELECT 1
        FROM ${manufacturingOrderIngredients}
        WHERE ${manufacturingOrderIngredients.manufacturingOrderId} = ${manufacturingOrders.id}
          AND (
            ${manufacturingOrderIngredients.pickStatus} <> 'not_picked'
            OR ${manufacturingOrderIngredients.pickedQuantity} > 0
          )
      ) THEN 'in_progress'
      ELSE 'not_started'
    END
  `;
  const completedBatchCountExpression = sql<number>`(
    SELECT COUNT(*)::int
    FROM ${manufacturingOrderBatches}
    WHERE ${manufacturingOrderBatches.manufacturingOrderId} = ${manufacturingOrders.id}
      AND ${manufacturingOrderBatches.status} = 'completed'
  )`;

  const headerRows = await tx
    .select({
      salesOrderId: manufacturingOrders.salesOrderId,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      productId: manufacturingOrders.productId,
      productName: manufacturingOrders.productName,
      productSku: manufacturingOrders.productSku,
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
        "plannedQuantity"
      ),
      actualQuantity: trimScaleNullable(manufacturingOrders.actualQuantity).as(
        "actualQuantity"
      ),
      unitName: manufacturingOrders.unitName,
      plannedDate: manufacturingOrders.plannedDate,
      priorityRank: manufacturingOrders.priorityRank,
      status: manufacturingOrders.status,
      productionStatus: productionStatusExpression,
      manufacturingMode: manufacturingOrders.manufacturingMode,
      numberOfBatches: manufacturingOrders.numberOfBatches,
      completedBatchCount: completedBatchCountExpression,
      createdAt: manufacturingOrders.createdAt,
    })
    .from(manufacturingOrders)
    .where(
      and(
        inArray(manufacturingOrders.salesOrderId, uniqueSalesOrderIds),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.cancelledAt)
      )
    );

  const merged = new Map<string, LinkedManufacturingOrderRead>();
  const productDisplayNamesById = await getItemDisplayNamesByIdInTx(tx, [
    ...headerRows.map((row) => row.productId),
  ]);
  const addRow = (
    row: (typeof headerRows)[number],
    linkSource: SalesLinkedManufacturingOrder["linkSource"]
  ) => {
    if (!row.salesOrderId) return;
    const key = `${row.salesOrderId}:${row.id}`;
    const existing = merged.get(key);
    merged.set(key, {
      salesOrderId: row.salesOrderId,
      salesOrderLineId: row.salesOrderLineId,
      id: row.id,
      orderNumber: row.orderNumber,
      productName: productDisplayNamesById.get(row.productId) ?? row.productName,
      productSku: row.productSku,
      plannedQuantity: row.plannedQuantity,
      actualQuantity: row.actualQuantity,
      unitName: row.unitName,
      plannedDate: row.plannedDate,
      priorityRank: row.priorityRank,
      status: row.status as SalesLinkedManufacturingOrder["status"],
      productionStatus: row.productionStatus,
      manufacturingMode: row.manufacturingMode,
      numberOfBatches: row.numberOfBatches,
      completedBatchCount: row.completedBatchCount,
      linkSource: mergeManufacturingLinkSource(existing?.linkSource, linkSource),
      createdAt: row.createdAt,
    });
  };

  headerRows.forEach((row) => addRow(row, "sales_order"));

  [...merged.values()]
    .toSorted((left, right) => {
      const createdCompare = right.createdAt.getTime() - left.createdAt.getTime();
      if (createdCompare !== 0) return createdCompare;
      const orderCompare = left.orderNumber.localeCompare(
        right.orderNumber,
        undefined,
        { numeric: true }
      );
      if (orderCompare !== 0) return orderCompare;
      return left.id.localeCompare(right.id);
    })
    .forEach((row) => {
      const bucket = bySalesOrderId.get(row.salesOrderId) ?? [];
      bucket.push(row);
      bySalesOrderId.set(row.salesOrderId, bucket);
    });

  return bySalesOrderId;
}

function openLinkedManufacturingOrders<T extends SalesLinkedManufacturingOrder>(
  orders: T[]
) {
  return orders.filter((order) => order.status === "open");
}

function isEditableOpenSalesOrderStatus(status: string) {
  return status === "open";
}

function serializeLinkedManufacturingOrder(
  order: LinkedManufacturingOrderRead
): SalesLinkedManufacturingOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    productName: order.productName,
    productSku: order.productSku,
    plannedQuantity: order.plannedQuantity,
    actualQuantity: order.actualQuantity,
    unitName: order.unitName,
    plannedDate: order.plannedDate,
    priorityRank: order.priorityRank,
    status: order.status,
    productionStatus: order.productionStatus,
    manufacturingMode: order.manufacturingMode,
    numberOfBatches: order.numberOfBatches,
    completedBatchCount: order.completedBatchCount,
    linkSource: order.linkSource,
  };
}

function buildShippingReadiness({
  status,
  hasManufacturableLines,
  linkedManufacturingOrders,
  stockBlockers = [],
}: {
  status: SalesOrderDetail["status"] | SalesOrderListRow["status"];
  hasManufacturableLines: boolean;
  linkedManufacturingOrders: LinkedManufacturingStatus[];
  stockBlockers?: string[];
}): SalesShippingReadiness {
  if (status === "done") {
    return {
      state: "shipped",
      message: "Order has already shipped.",
      blockers: [],
    };
  }

  if (status !== "open") {
    return {
      state: "not_confirmed",
      message: "Order is not open.",
      blockers: ["Order is not open"],
    };
  }

  const openManufacturingOrders = linkedManufacturingOrders.filter(
    (order) => order.status === "open"
  );

  if (openManufacturingOrders.length > 0) {
    return {
      state: "in_production",
      message: "Production is still open for this order.",
      blockers: openManufacturingOrders.map(
        (order) => `${order.orderNumber} is ${order.productionStatus.replace("_", " ")}`
      ),
    };
  }

  if (stockBlockers.length > 0) {
    if (hasManufacturableLines) {
      return {
        state: "needs_manufacturing",
        message: "Create manufacturing orders or replenish stock before shipping.",
        blockers: stockBlockers,
      };
    }

    return {
      state: "insufficient_stock",
      message: "Stock is short for one or more lines.",
      blockers: stockBlockers,
    };
  }

  return {
    state: "ready",
    message: "Allocated.",
    blockers: [],
  };
}

const OPEN_SALES_ORDER_STATUSES = [
  "open",
] as const;

function isOpenSalesOrderStatus(status: string) {
  return (OPEN_SALES_ORDER_STATUSES as readonly string[]).includes(status);
}

function assertSameStringSet(actual: string[], expected: string[], message: string) {
  if (actual.length !== expected.length) {
    throw new SalesError(message, 400);
  }

  const expectedSet = new Set(expected);
  if (actual.some((value) => !expectedSet.has(value))) {
    throw new SalesError(message, 400);
  }
}

function mergeSubmittedOrderIds(currentIds: string[], submittedIds: string[]) {
  const submittedIdSet = new Set(submittedIds);
  let submittedIndex = 0;

  const mergedIds = currentIds.map((id) => {
    if (!submittedIdSet.has(id)) {
      return id;
    }

    return submittedIds[submittedIndex++] ?? id;
  });

  if (submittedIndex !== submittedIds.length) {
    throw new SalesError("Sales order ranking does not match open orders.", 400);
  }

  return mergedIds;
}

async function rerankOpenSalesOrdersInTx(tx: Tx, orgId: string) {
  await lockSalesPriorityQueueInTx(tx, orgId);

  await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.organizationId, orgId),
        inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
        isNull(salesOrders.deletedAt)
      )
    )
    .orderBy(asc(salesOrders.id))
    .for("update");

  const rows = await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.organizationId, orgId),
        inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
        isNull(salesOrders.deletedAt)
      )
    )
    .orderBy(
      sql`${salesOrders.priorityRank} IS NULL`,
      asc(salesOrders.priorityRank),
      asc(salesOrders.shipDate),
      asc(salesOrders.requestedDate),
      asc(salesOrders.orderDate),
      asc(salesOrders.orderNumber),
      asc(salesOrders.id)
    );

  if (rows.length === 0) {
    return;
  }

  const now = new Date();
  await tx
    .update(salesOrders)
    .set({
      priorityRank: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(salesOrders.organizationId, orgId),
        inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
        isNull(salesOrders.deletedAt)
      )
    );

  for (const [index, row] of rows.entries()) {
    await tx
      .update(salesOrders)
      .set({
        priorityRank: index + 1,
        updatedAt: now,
      })
      .where(eq(salesOrders.id, row.id));
  }
}

async function generateOrderNumber(tx: Tx, organizationId: string) {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  const pattern = `^${prefix}(\\d+)$`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`sales-order-number:${organizationId}:${year}`}))`
  );
  const result = await tx.execute(sql`
    SELECT COALESCE(MAX((substring(${salesOrders.orderNumber} from ${pattern}))::integer), 0) AS max
    FROM ${salesOrders}
    WHERE ${salesOrders.organizationId} = ${organizationId}
      AND ${salesOrders.orderNumber} LIKE ${`${prefix}%`}
  `);
  const raw = (result.rows[0] as { max: string | number | null }).max;
  const next = Number(raw ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

async function resolveSalesOrderNumberInTx(
  tx: Tx,
  organizationId: string,
  requestedOrderNumber: string | null | undefined,
  options?: { excludeId?: string }
) {
  const requested = requestedOrderNumber?.trim();
  if (!requested) {
    return await generateOrderNumber(tx, organizationId);
  }

  const orderNumber = requested;
  const conditions = [
    eq(salesOrders.organizationId, organizationId),
    eq(salesOrders.orderNumber, orderNumber),
  ];

  if (options?.excludeId) {
    conditions.push(sql`${salesOrders.id} <> ${options.excludeId}`);
  }

  const [existingOrder] = await tx
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(...conditions))
    .limit(1);

  if (existingOrder) {
    throw new SalesError("A sales order with this number already exists.", 400, {
      errors: {
        orderNumber: ["A sales order with this number already exists."],
      },
    });
  }

  return orderNumber;
}

async function generateDuplicateSalesOrderNumberInTx(
  tx: Tx,
  organizationId: string,
  sourceOrderNumber: string
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`sales-order-duplicate-number:${organizationId}:${sourceOrderNumber}`}))`
  );

  for (let copyNumber = 1; copyNumber <= 100; copyNumber += 1) {
    const suffix = copyNumber === 1 ? "_COPY" : `_COPY${copyNumber}`;
    const candidate = `${sourceOrderNumber.slice(0, 32 - suffix.length)}${suffix}`;
    const [existingOrder] = await tx
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.organizationId, organizationId),
          eq(salesOrders.orderNumber, candidate)
        )
      )
      .limit(1);

    if (!existingOrder) return candidate;
  }

  throw new SalesError("Could not generate a duplicate sales order number.", 400);
}

async function resolveBolContactInTx(tx: Tx, customerId: string) {
  const [customer] = await tx
    .select({
      email: customers.email,
      phone: customers.phone,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const [contact] = await tx
    .select({
      name: customerContacts.name,
      title: customerContacts.title,
      email: customerContacts.email,
      phone: customerContacts.phone,
    })
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.customerId, customerId),
        isNull(customerContacts.deletedAt)
      )
    )
    .orderBy(
      desc(customerContacts.receivesShipping),
      desc(customerContacts.isOnSite),
      desc(customerContacts.isPrimary),
      asc(customerContacts.name)
    )
    .limit(1);

  return {
    contactName: contact?.name ?? null,
    contactTitle: contact?.title ?? null,
    contactEmail: contact?.email ?? customer?.email ?? null,
    contactPhone: contact?.phone ?? customer?.phone ?? null,
  };
}

async function getOrderLinesInTx(tx: Tx, orderId: string) {
  return tx
    .select({
      id: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.unitName,
      quantity: trimScale(salesOrderLines.quantity).as("quantity"),
      shippedQuantity: trimScale(salesOrderLines.shippedQuantity).as(
        "shippedQuantity"
      ),
      cancelledQuantity: trimScale(salesOrderLines.cancelledQuantity).as(
        "cancelledQuantity"
      ),
      listUnitPrice: trimScaleNullable(salesOrderLines.listUnitPrice).as(
        "listUnitPrice"
      ),
      unitPrice: trimScale(salesOrderLines.unitPrice).as("unitPrice"),
      taxRateId: salesOrderLines.taxRateId,
      taxRateName: salesOrderLines.taxRateName,
      taxRatePercent: trimScale(salesOrderLines.taxRatePercent).as("taxRatePercent"),
      discountPercent: trimScale(salesOrderLines.discountPercent).as(
        "discountPercent"
      ),
      suggestedUnitPrice: trimScaleNullable(salesOrderLines.suggestedUnitPrice).as(
        "suggestedUnitPrice"
      ),
      pricingSourceType: salesOrderLines.pricingSourceType,
      pricingScheduleName: salesOrderLines.pricingScheduleName,
      pricingBreakLabel: salesOrderLines.pricingBreakLabel,
      isPriceOverridden: salesOrderLines.isPriceOverridden,
      lineSubtotal: trimScale(salesOrderLines.lineSubtotal).as("lineSubtotal"),
      lineTaxAmount: trimScale(salesOrderLines.lineTaxAmount).as("lineTaxAmount"),
      lineTotal: trimScale(salesOrderLines.lineTotal).as("lineTotal"),
      sortOrder: salesOrderLines.sortOrder,
      createdAt: salesOrderLines.createdAt,
      updatedAt: salesOrderLines.updatedAt,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));
}

async function getLockedSalesOrderInTx(tx: Tx, id: string) {
  const [order] = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      customerId: salesOrders.customerId,
      customerProjectId: salesOrders.customerProjectId,
      customerName: salesOrders.customerName,
      orderDate: salesOrders.orderDate,
      shipDate: salesOrders.shipDate,
      requestedDate: salesOrders.requestedDate,
      shipLine1: salesOrders.shipLine1,
      shipLine2: salesOrders.shipLine2,
      shipCity: salesOrders.shipCity,
      shipRegion: salesOrders.shipRegion,
      shipPostcode: salesOrders.shipPostcode,
      shipCountry: salesOrders.shipCountry,
      billingLine1: salesOrders.billingLine1,
      billingLine2: salesOrders.billingLine2,
      billingCity: salesOrders.billingCity,
      billingRegion: salesOrders.billingRegion,
      billingPostcode: salesOrders.billingPostcode,
      billingCountry: salesOrders.billingCountry,
      shippingFeeDescription: salesOrders.shippingFeeDescription,
      shippingFeeAmount: trimScale(salesOrders.shippingFeeAmount).as("shippingFeeAmount"),
      shippingFeeTaxAmount: trimScale(salesOrders.shippingFeeTaxAmount).as("shippingFeeTaxAmount"),
      subtotalAmount: trimScale(salesOrders.subtotalAmount).as("subtotalAmount"),
      taxAmount: trimScale(salesOrders.taxAmount).as("taxAmount"),
      totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)))
    .for("update");

  return order ?? null;
}

type SalesOrderLineShipState = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  quantity: number;
  cancelledQuantity: number;
  shippedQuantity: number;
  plannedQuantity: number;
  sortOrder: number;
};

function normalizeShipQuantity(value: number) {
  return normalizeQuantityNumber(roundQuantity(value));
}

async function getSalesLotPickPlansByLineInTx(
  tx: Tx,
  orgId: string,
  lines: SalesOrderDetailLine[]
) {
  const plans = new Map<string, LotPickPlanEntry[]>();
  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const lotTrackedItemIds =
    itemIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await tx
              .select({ itemId: items.id })
              .from(items)
              .innerJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
              .where(
                and(
                  eq(items.organizationId, orgId),
                  inArray(items.id, itemIds),
                  eq(itemFamilies.lotTrackingMode, "tracked")
                )
              )
          ).map((row) => row.itemId)
        );
  const lotTrackedLines = lines.filter((line) => lotTrackedItemIds.has(line.itemId));
  for (const line of lines) {
    if (!lotTrackedItemIds.has(line.itemId)) {
      plans.set(line.id, []);
    }
  }
  const manufacturingSourceIds = [
    ...new Set(
      lotTrackedLines.flatMap((line) =>
        line.allocationSources
          .filter(
            (source) => source.sourceType === "manufacturing_order" && source.sourceId
          )
          .map((source) => source.sourceId as string)
      )
    ),
  ];
  const linkedManufacturingRows =
    lotTrackedLines.length === 0
      ? []
      : await tx
          .select({
            id: manufacturingOrders.id,
            salesOrderLineId: manufacturingOrders.salesOrderLineId,
            orderNumber: manufacturingOrders.orderNumber,
            plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
              "plannedQuantity"
            ),
          })
          .from(manufacturingOrders)
          .where(
            and(
              inArray(
                manufacturingOrders.salesOrderLineId,
                lotTrackedLines.map((line) => line.id)
              ),
              isNull(manufacturingOrders.deletedAt),
              inArray(manufacturingOrders.status, ["open", "done"])
            )
          )
          .orderBy(asc(manufacturingOrders.plannedDate), asc(manufacturingOrders.orderNumber));
  const linkedManufacturingRowsByLineId = new Map<
    string,
    Array<(typeof linkedManufacturingRows)[number]>
  >();
  for (const row of linkedManufacturingRows) {
    if (!row.salesOrderLineId) continue;
    linkedManufacturingRowsByLineId.set(row.salesOrderLineId, [
      ...(linkedManufacturingRowsByLineId.get(row.salesOrderLineId) ?? []),
      row,
    ]);
  }
  for (const row of linkedManufacturingRows) {
    if (!manufacturingSourceIds.includes(row.id)) {
      manufacturingSourceIds.push(row.id);
    }
  }
  const outputRows =
    manufacturingSourceIds.length === 0
      ? []
      : await tx
          .select({
            manufacturingOrderId: manufacturingOrderOutputs.manufacturingOrderId,
            lotId: manufacturingOrderOutputs.lotId,
            lotNumber: lots.lotNumber,
            quantity: trimScale(manufacturingOrderOutputs.quantity).as("quantity"),
          })
          .from(manufacturingOrderOutputs)
          .innerJoin(lots, eq(lots.id, manufacturingOrderOutputs.lotId))
          .where(
            and(
              inArray(
                manufacturingOrderOutputs.manufacturingOrderId,
                manufacturingSourceIds
              ),
              eq(manufacturingOrderOutputs.disposition, "available"),
              sql`${manufacturingOrderOutputs.quantity} > 0`
            )
          )
          .orderBy(asc(manufacturingOrderOutputs.createdAt));
  const outputRowsByMoId = new Map<
    string,
    Array<(typeof outputRows)[number] & { remainingQuantity: number }>
  >();

  for (const row of outputRows) {
    const rows = outputRowsByMoId.get(row.manufacturingOrderId) ?? [];
    rows.push({
      ...row,
      remainingQuantity: Number(row.quantity),
    });
    outputRowsByMoId.set(row.manufacturingOrderId, rows);
  }

  for (const line of lotTrackedLines) {
    const plan: LotPickPlanEntry[] = [];
    const unavailableByLotId = new Map<string, number>();
    let coveredQuantity = 0;
    const remainingQuantity = Number(line.remainingQuantity);
    const explicitManufacturingSourceIds = new Set(
      line.allocationSources
        .filter((source) => source.sourceType === "manufacturing_order")
        .map((source) => source.sourceId)
    );
    const linkedSources = (linkedManufacturingRowsByLineId.get(line.id) ?? [])
      .filter((source) => !explicitManufacturingSourceIds.has(source.id))
      .map((source) => ({
        sourceType: "manufacturing_order" as const,
        sourceId: source.id,
        label: source.orderNumber,
        quantity: normalizeNumeric(
          Math.min(Number(source.plannedQuantity), remainingQuantity)
        ),
        coverageKind: "explicit" as const,
      }));

    for (const source of [...linkedSources, ...line.allocationSources]) {
      const openPlanQty = roundQuantity(remainingQuantity - coveredQuantity);
      if (openPlanQty <= 0) break;
      const quantity = Math.min(Number(source.quantity), openPlanQty);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      coveredQuantity = roundQuantity(coveredQuantity + quantity);

      if (source.sourceType === "inventory_lot") {
        if (source.sourceId) {
          unavailableByLotId.set(
            source.sourceId,
            roundQuantity((unavailableByLotId.get(source.sourceId) ?? 0) + quantity)
          );
        }
        plan.push({
          lotId: source.sourceId,
          lotNumber: source.label,
          quantity: source.quantity,
          unitName: line.unitName,
          sourceType: "inventory_lot",
          sourceId: source.sourceId,
          sourceLabel: source.label,
          kind: "allocated",
          status: "ready",
        });
        continue;
      }

      const producedLots = source.sourceId
        ? outputRowsByMoId.get(source.sourceId) ?? []
        : [];
      let remainingSourceQuantity = quantity;
      for (const producedLot of producedLots) {
        if (remainingSourceQuantity <= 0) break;
        const lotQuantity = roundQuantity(
          Math.min(producedLot.remainingQuantity, remainingSourceQuantity)
        );
        if (lotQuantity <= 0) continue;
        plan.push({
          lotId: producedLot.lotId,
          lotNumber: producedLot.lotNumber,
          quantity: normalizeNumeric(lotQuantity),
          unitName: line.unitName,
          sourceType: "manufacturing_order",
          sourceId: source.sourceId,
          sourceLabel: source.label,
          kind: "production",
          status: "ready",
        });
        remainingSourceQuantity = roundQuantity(
          remainingSourceQuantity - lotQuantity
        );
        producedLot.remainingQuantity = roundQuantity(
          producedLot.remainingQuantity - lotQuantity
        );
      }
      if (remainingSourceQuantity > 0) {
        plan.push({
          lotId: null,
          lotNumber: null,
          quantity: normalizeNumeric(remainingSourceQuantity),
          unitName: line.unitName,
          sourceType: "manufacturing_order",
          sourceId: source.sourceId,
          sourceLabel: source.label,
          kind: "production",
          status: "waiting",
        });
      }
    }

    const fifoQuantity = roundQuantity(remainingQuantity - coveredQuantity);
    if (fifoQuantity > 0) {
      plan.push(
        ...(await buildFifoLotPickPlanInTx(tx, {
          organizationId: orgId,
          itemId: line.itemId,
          quantity: fifoQuantity,
          unitName: line.unitName,
          unavailableByLotId,
        }))
      );
    }

    plans.set(line.id, plan);
  }

  return plans;
}

function deriveDemandQueueSalesItemsState(params: {
  remainingQty: number;
  shortQty: number;
  expectedQty: number;
}): SalesOrderFulfillmentSummary["salesItemsState"] {
  if (params.remainingQty <= 0) return "complete";
  if (params.shortQty > 0) return "not_available";
  if (params.expectedQty > 0) return "expected";
  return "available";
}

function latestExpectedDate(
  current: string | null,
  next: string | null | undefined
) {
  if (!next) return current;
  if (!current) return next;
  return next > current ? next : current;
}

function demandQueueCoverageToSalesAllocationSummary(params: {
  lineId: string;
  itemId: string;
  remainingQty: number;
  coverage: DemandQueueCoverageDemand | undefined;
}): SalesAllocationLineSummary {
  const queueCoveredQty = roundQuantity(
    Number(params.coverage?.queueCoveredQty ?? 0)
  );
  const shortQty = roundQuantity(
    Number(params.coverage?.shortQty ?? params.remainingQty)
  );
  const expectedQty = roundQuantity(Number(params.coverage?.expectedQty ?? 0));
  const sources: SalesAllocationLineSummary["sources"] =
    params.coverage?.segments.flatMap((segment) => {
      if (
        segment.kind === "short" ||
        !segment.sourceId ||
        (segment.sourceType !== "inventory_lot" &&
          segment.sourceType !== "manufacturing_order")
      ) {
        return [];
      }

      return [
        {
          sourceType: segment.sourceType,
          sourceId: segment.sourceId,
          label: segment.sourceLabel ?? "\u2014",
          quantity: segment.qty,
          coverageKind: "explicit" as const,
        },
      ];
    }) ?? [];
  const sourceSummary =
    sources.length > 0
      ? sources.map((source) => `${source.label} ${source.quantity}`).join(", ")
      : "\u2014";

  return {
    demandType: "sales_order_line",
    demandId: params.lineId,
    salesOrderLineId: params.lineId,
    itemId: params.itemId,
    allocatedQty: normalizeNumeric(queueCoveredQty),
    shortQty: normalizeNumeric(shortQty),
    sourceSummary,
    status:
      queueCoveredQty <= 0
        ? "short"
        : shortQty > 0
          ? "partial"
          : expectedQty > 0 ||
              sources.some((source) => source.sourceType === "manufacturing_order")
            ? "waiting_production"
            : "ready",
    sources,
  };
}

async function getSalesOrderLineShipStatesInTx(
  tx: Tx,
  orderId: string
) {
  const orderLines = await tx
    .select({
      id: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      itemSku: salesOrderLines.itemSku,
      unitName: salesOrderLines.unitName,
      quantity: salesOrderLines.quantity,
      shippedQuantity: salesOrderLines.shippedQuantity,
      cancelledQuantity: salesOrderLines.cancelledQuantity,
      sortOrder: salesOrderLines.sortOrder,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt))
    .for("update");

  return new Map<string, SalesOrderLineShipState>(
    orderLines.map((line) => [
      line.id,
      {
        id: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        itemSku: line.itemSku,
        unitName: line.unitName,
        quantity: parseFloat(line.quantity),
        cancelledQuantity: parseFloat(line.cancelledQuantity),
        shippedQuantity: normalizeShipQuantity(Number(line.shippedQuantity)),
        plannedQuantity: 0,
        sortOrder: line.sortOrder,
      },
    ])
  );
}

function remainingToShip(line: SalesOrderLineShipState) {
  return normalizeShipQuantity(
    line.quantity - line.shippedQuantity - line.cancelledQuantity
  );
}

async function assertSalesOrderHasNoShippedLinesForEditInTx(
  tx: Tx,
  orderId: string
) {
  const states = await getSalesOrderLineShipStatesInTx(tx, orderId);
  const hasShippedLine = [...states.values()].some(
    (line) => line.shippedQuantity > 0
  );

  if (hasShippedLine) {
    throw new SalesError(
      "Partially shipped orders cannot be edited. Create a new sales order for changes.",
      400
    );
  }
}

async function getOpenLinkedManufacturingOrdersForSalesEditInTx(
  tx: Tx,
  salesOrderId: string
) {
  const linkedRows = await tx
    .select({
      id: manufacturingOrders.id,
      productId: manufacturingOrders.productId,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      salesLineQuantity: trimScale(salesOrderLines.quantity).as("salesLineQuantity"),
      plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
        "plannedQuantity"
      ),
    })
    .from(manufacturingOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, manufacturingOrders.salesOrderLineId))
    .where(
      and(
        eq(manufacturingOrders.salesOrderId, salesOrderId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.cancelledAt)
      )
    )
    .for("update");

  if (linkedRows.length === 0) return [];

  const outputRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderOutputs.manufacturingOrderId,
      outputQuantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`
      ).as("outputQuantity"),
    })
    .from(manufacturingOrderOutputs)
    .where(
      inArray(
        manufacturingOrderOutputs.manufacturingOrderId,
        linkedRows.map((row) => row.id)
      )
    )
    .groupBy(manufacturingOrderOutputs.manufacturingOrderId);
  const outputQuantityByOrderId = new Map(
    outputRows.map((row) => [row.manufacturingOrderId, row.outputQuantity])
  );
  const ingredientStartRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        inArray(
          manufacturingOrderIngredients.manufacturingOrderId,
          linkedRows.map((row) => row.id)
        ),
        or(
          sql`${manufacturingOrderIngredients.pickedQuantity} > 0`,
          sql`${manufacturingOrderIngredients.actualQuantity} IS NOT NULL AND ${manufacturingOrderIngredients.actualQuantity} > 0`
        )
      )
    )
    .groupBy(manufacturingOrderIngredients.manufacturingOrderId);
  const activeBatchRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderBatches.manufacturingOrderId,
    })
    .from(manufacturingOrderBatches)
    .where(
      and(
        inArray(
          manufacturingOrderBatches.manufacturingOrderId,
          linkedRows.map((row) => row.id)
        ),
        ne(manufacturingOrderBatches.status, "pending")
      )
    )
    .groupBy(manufacturingOrderBatches.manufacturingOrderId);
  const startedOrderIds = new Set([
    ...ingredientStartRows.map((row) => row.manufacturingOrderId),
    ...activeBatchRows.map((row) => row.manufacturingOrderId),
    ...outputRows
      .filter((row) => Number(row.outputQuantity) > 0)
      .map((row) => row.manufacturingOrderId),
  ]);

  return linkedRows.map((row) => ({
    ...row,
    outputQuantity: outputQuantityByOrderId.get(row.id) ?? "0",
    hasStarted: startedOrderIds.has(row.id),
  }));
}

async function assertLinkedMtoSalesLinesUnchangedInTx(
  tx: Tx,
  salesOrderId: string,
  preparedLines: PreparedOrderLine[]
) {
  const linkedRows = await getOpenLinkedManufacturingOrdersForSalesEditInTx(
    tx,
    salesOrderId
  );
  if (linkedRows.length === 0) return;

  const replacementByItemId = new Map(
    preparedLines.map((line) => [line.itemId, line])
  );

  for (const linkedRow of linkedRows) {
    const replacement = replacementByItemId.get(linkedRow.productId);
    if (!replacement) {
      throw new SalesError(
        "Sales lines linked to make-to-order manufacturing cannot be changed.",
        400
      );
    }

    const nextQuantity = Number(replacement.quantity);
    if (
      Number.isFinite(nextQuantity) &&
      nextQuantity !== Number(linkedRow.salesLineQuantity)
    ) {
      throw new SalesError(
        "Sales lines linked to make-to-order manufacturing cannot be changed.",
        400
      );
    }
  }
}

async function moveLinkedManufacturingOrdersToReplacementSalesLinesInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    salesOrderId: string;
    insertedLines: Array<{
      salesOrderLineId: string;
      itemId: string;
      quantity: string;
      sortOrder: number | null;
    }>;
  }
) {
  const linkedRows = await getOpenLinkedManufacturingOrdersForSalesEditInTx(
    tx,
    params.salesOrderId
  );
  if (linkedRows.length === 0) return;

  const insertedByItemId = new Map<string, typeof params.insertedLines>();
  for (const line of params.insertedLines) {
    const lines = insertedByItemId.get(line.itemId) ?? [];
    lines.push(line);
    insertedByItemId.set(line.itemId, lines);
  }
  for (const lines of insertedByItemId.values()) {
    lines.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  }

  for (const linkedRow of linkedRows) {
    const replacement = insertedByItemId.get(linkedRow.productId)?.shift();
    if (!replacement) {
      throw new SalesError(
        "Sales lines linked to make-to-order manufacturing cannot be changed.",
        400
      );
    }

    if (replacement.salesOrderLineId === linkedRow.salesOrderLineId) {
      continue;
    }

    await tx
      .update(manufacturingOrders)
      .set({
        salesOrderLineId: replacement.salesOrderLineId,
        updatedAt: new Date(),
      })
      .where(eq(manufacturingOrders.id, linkedRow.id));
  }
}

async function assertSalesOrderLineQuantityEditableInTx(
  tx: Tx,
  salesOrderLineId: string,
  nextQuantity: number,
  currentQuantity: number
) {
  if (nextQuantity === currentQuantity) return;

  const [linkedOrder] = await tx
    .select({ id: manufacturingOrders.id })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.salesOrderLineId, salesOrderLineId),
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        isNull(manufacturingOrders.cancelledAt)
      )
    )
    .limit(1)
    .for("update");

  if (!linkedOrder) return;

  throw new SalesError(
    "Sales lines linked to make-to-order manufacturing cannot be changed.",
    400,
    {
      errors: {
        quantity: [
          "Cancel the linked manufacturing order before changing this quantity.",
        ],
      },
    }
  );
}

async function getSalesOrderDeleteBlockerInTx(tx: Tx, orderIds: string[]) {
  const [shippedOrder] = await tx
    .select({
      orderNumber: salesOrders.orderNumber,
    })
    .from(salesOrders)
    .where(
      and(
        inArray(salesOrders.id, orderIds),
        or(eq(salesOrders.status, "done"), sql`${salesOrders.shippedAt} IS NOT NULL`)
      )
    )
    .limit(1);

  if (shippedOrder) {
    return `Cannot delete sales order ${shippedOrder.orderNumber} because it has already shipped. Shipped fulfillment history must be preserved.`;
  }
  const [directOrderConsumption] = await tx
    .select({
      orderNumber: salesOrders.orderNumber,
    })
    .from(inventoryEvents)
    .innerJoin(
      salesOrders,
      and(
        eq(inventoryEvents.referenceType, "sales_order"),
        eq(inventoryEvents.referenceId, salesOrders.id)
      )
    )
    .where(
      and(
        inArray(salesOrders.id, orderIds),
        eq(inventoryEvents.eventType, "sales_consumption")
      )
    )
    .limit(1);

  if (directOrderConsumption) {
    return `Cannot delete sales order ${directOrderConsumption.orderNumber} because inventory has already been consumed for fulfillment. Inventory history must be preserved.`;
  }

  const [salesLineConsumption] = await tx
    .select({
      orderNumber: salesOrders.orderNumber,
    })
    .from(inventoryEvents)
    .innerJoin(
      salesOrderLines,
      and(
        eq(inventoryEvents.referenceType, "sales_order_line"),
        eq(inventoryEvents.referenceId, salesOrderLines.id)
      )
    )
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        inArray(salesOrders.id, orderIds),
        eq(inventoryEvents.eventType, "sales_consumption")
      )
    )
    .limit(1);

  if (salesLineConsumption) {
    return `Cannot delete sales order ${salesLineConsumption.orderNumber} because inventory has already been consumed for fulfillment. Inventory history must be preserved.`;
  }
  const [pushedOrderInvoice] = await tx
    .select({
      orderNumber: salesOrders.orderNumber,
    })
    .from(accountingDocumentSyncs)
    .innerJoin(salesOrders, eq(accountingDocumentSyncs.documentId, salesOrders.id))
    .where(
      and(
        eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_XERO),
        eq(accountingDocumentSyncs.documentType, "sales_order"),
        inArray(accountingDocumentSyncs.documentId, orderIds),
        or(
          eq(accountingDocumentSyncs.pushStatus, "pushed"),
          sql`${accountingDocumentSyncs.externalDocumentId} IS NOT NULL`
        )
      )
    )
    .limit(1);

  if (pushedOrderInvoice) {
    return `Cannot delete sales order ${pushedOrderInvoice.orderNumber} because its invoice has already been pushed to accounting. Accounting history must be preserved.`;
  }
  return null;
}

async function deleteSalesLinkedManufacturingOrdersInTx(
  tx: Tx,
  params: {
    organizationId: string;
    actorUserId?: string | null;
    salesOrderIds: string[];
    salesOrderLineIds: string[];
  }
) {
  const linkedOrders = await tx
    .select({
      id: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      salesOrderLineId: manufacturingOrders.salesOrderLineId,
      status: manufacturingOrders.status,
      completedAt: manufacturingOrders.completedAt,
    })
    .from(manufacturingOrders)
    .where(
      and(
        inArray(manufacturingOrders.salesOrderId, params.salesOrderIds),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .for("update");

  if (linkedOrders.length === 0) {
    return null;
  }

  const salesOrderLineIdSet = new Set(params.salesOrderLineIds);
  const linkedToMissingLine = linkedOrders.find(
    (order) =>
      !order.salesOrderLineId || !salesOrderLineIdSet.has(order.salesOrderLineId)
  );

  if (linkedToMissingLine) {
    return `Cannot delete this sales order because manufacturing order ${linkedToMissingLine.orderNumber} is linked to the order but not to a matching active sales line. Remove or repair the manufacturing link first.`;
  }

  const linkedOrderIds = linkedOrders.map((order) => order.id);
  const outputRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderOutputs.manufacturingOrderId,
      outputQuantity: trimScale(
        sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`
      ).as("outputQuantity"),
    })
    .from(manufacturingOrderOutputs)
    .where(inArray(manufacturingOrderOutputs.manufacturingOrderId, linkedOrderIds))
    .groupBy(manufacturingOrderOutputs.manufacturingOrderId);
  const ingredientStartRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderIngredients.manufacturingOrderId,
    })
    .from(manufacturingOrderIngredients)
    .where(
      and(
        inArray(manufacturingOrderIngredients.manufacturingOrderId, linkedOrderIds),
        or(
          sql`${manufacturingOrderIngredients.pickedQuantity} > 0`,
          sql`${manufacturingOrderIngredients.actualQuantity} IS NOT NULL AND ${manufacturingOrderIngredients.actualQuantity} > 0`
        )
      )
    )
    .groupBy(manufacturingOrderIngredients.manufacturingOrderId);
  const activeBatchRows = await tx
    .select({
      manufacturingOrderId: manufacturingOrderBatches.manufacturingOrderId,
    })
    .from(manufacturingOrderBatches)
    .where(
      and(
        inArray(manufacturingOrderBatches.manufacturingOrderId, linkedOrderIds),
        ne(manufacturingOrderBatches.status, "pending")
      )
    )
    .groupBy(manufacturingOrderBatches.manufacturingOrderId);
  const startedOrderIds = new Set([
    ...linkedOrders
      .filter((order) => order.status !== "open" || order.completedAt != null)
      .map((order) => order.id),
    ...ingredientStartRows.map((row) => row.manufacturingOrderId),
    ...activeBatchRows.map((row) => row.manufacturingOrderId),
    ...outputRows
      .filter((row) => Number(row.outputQuantity) > 0)
      .map((row) => row.manufacturingOrderId),
  ]);

  const startedLinkedOrderIds = linkedOrderIds.filter((id) => startedOrderIds.has(id));
  const notStartedLinkedOrderIds = linkedOrderIds.filter((id) => !startedOrderIds.has(id));

  if (startedLinkedOrderIds.length > 0) {
    await tx
      .update(manufacturingOrders)
      .set({
        salesOrderId: null,
        salesOrderLineId: null,
        updatedAt: new Date(),
      })
      .where(inArray(manufacturingOrders.id, startedLinkedOrderIds));
  }

  const deleted = await deleteManufacturingOrdersInTx(tx, {
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    ids: notStartedLinkedOrderIds,
  });

  return deleted.error ?? null;
}

async function getValidatedCustomerInTx(tx: Tx, customerId: string) {
  const [customer] = await tx
    .select({
      id: customers.id,
      name: customers.name,
      customerCategoryId: customers.customerCategoryId,
      customerCategoryName: customerCategories.name,
      billingLine1: customers.billingLine1,
      billingLine2: customers.billingLine2,
      billingCity: customers.billingCity,
      billingRegion: customers.billingRegion,
      billingPostcode: customers.billingPostcode,
      billingCountry: customers.billingCountry,
      shipLine1: customers.shipLine1,
      shipLine2: customers.shipLine2,
      shipCity: customers.shipCity,
      shipRegion: customers.shipRegion,
      shipPostcode: customers.shipPostcode,
      shipCountry: customers.shipCountry,
    })
    .from(customers)
    .leftJoin(
      customerCategories,
      and(
        eq(customers.customerCategoryId, customerCategories.id),
        isNull(customerCategories.deletedAt)
      )
    )
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));

  if (!customer) {
    throw new SalesError("Customer not found", 404);
  }

  return customer satisfies ValidatedCustomerRow;
}

async function getValidatedCustomerProjectInTx(
  tx: Tx,
  customerId: string,
  customerProjectId: string | null | undefined
) {
  if (customerProjectId == null) return null;

  const [project] = await tx
    .select({
      id: customerProjects.id,
      name: customerProjects.name,
    })
    .from(customerProjects)
    .where(
      and(
        eq(customerProjects.id, customerProjectId),
        eq(customerProjects.customerId, customerId),
        isNull(customerProjects.deletedAt)
      )
    );

  if (!project) {
    throw new SalesError("Project not found for this customer.", 400);
  }

  return project;
}

async function getValidatedSalesItemsInTx(
  tx: Tx,
  itemIds: string[]
) {
  const uniqueIds = [...new Set(itemIds)];

  const rows = await tx
    .select({
      id: items.id,
      itemType: items.itemType,
      name: items.name,
      familyName: itemFamilies.name,
      sku: items.sku,
      sellable: items.sellable,
      category: sql<string | null>`COALESCE(${itemFamilies.category}, ${items.category})`,
      unitDefinitionId: items.unitDefinitionId,
      unitName: unitDefinitions.name,
      defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
        "defaultSellingPrice"
      ),
      stock: stockSubquery,
      committedQty: committedQtySubquery,
      demandQty: demandQtySubquery,
      shortageQty: shortageQtySubquery,
      availableQty: availableQtySubquery,
      expectedQty: expectedQtySubquery,
      safetyStock: trimScale(items.safetyStock).as("safetyStock"),
    })
    .from(items)
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .where(
      and(
        inArray(items.id, uniqueIds),
        inArray(items.itemType, ["product", "material"]),
        isNull(items.deletedAt)
      )
    );

  const [optionLabelsByItemId, variantValuesByItemId] = await Promise.all([
    getSalesOptionLabelsByItemIdInTx(tx, uniqueIds),
    getSalesVariantValuesByItemIdInTx(tx, uniqueIds),
  ]);

  const itemMap = new Map(
    rows.map((row) => {
      if (row.itemType === "product" && row.sellable !== true) {
        throw new SalesError("Only sellable products can be added to sales orders.", 400);
      }

      const displayName = formatSalesItemDisplayName(
        row.name,
        row.familyName,
        optionLabelsByItemId.get(row.id) ?? []
      );

      return [
        row.id,
        {
          ...row,
          displayName,
          variantValues: variantValuesByItemId.get(row.id) ?? [],
        } as SalesItemValidationRow & { displayName: string },
      ];
    })
  );

  if (itemMap.size !== uniqueIds.length) {
    throw new SalesError("Item not found", 404);
  }

  return itemMap;
}

async function prepareOrderPayload(
  tx: Tx,
  orgId: string,
  payload: InsertSalesOrder,
  options?: { lockItems?: boolean }
): Promise<{
  customerId: string;
  customerProjectId: string | null;
  customerName: string;
  orderDate: string;
  shipDate: string | null;
  requestedDate: string | null;
  notes: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  shippingFeeDescription: string | null;
  shippingFeeAmount: string;
  shippingFeeTaxAmount: string;
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
  preparedLines: PreparedOrderLine[];
  affectedItemIds: string[];
  itemsById: Map<string, SalesItemValidationRow>;
}> {
  const customer = await getValidatedCustomerInTx(tx, payload.customerId);
  const project = await getValidatedCustomerProjectInTx(
    tx,
    customer.id,
    payload.customerProjectId
  );
  const itemIds = payload.lines.map((line) => line.itemId);
  const requestedTaxRateIds = payload.lines
    .map((line) => line.taxRateId?.trim() ?? "")
    .filter(Boolean);
  const taxSettings = await getTaxSettingsInTx(tx, orgId);
  const defaultSalesTaxRateId = taxSettings.defaultSalesTaxRateId;
  if (defaultSalesTaxRateId) {
    requestedTaxRateIds.push(defaultSalesTaxRateId);
  }

  if (options?.lockItems && itemIds.length > 0) {
    await lockItemsInTx(tx, itemIds);
  }

  const itemsById = itemIds.length
    ? await getValidatedSalesItemsInTx(tx, itemIds)
    : new Map<string, SalesItemValidationRow>();
  const pricingLookup = await getPricingScheduleLookupForProductsInTx(
    tx,
    [...itemsById.values()],
    customer.customerCategoryId
  );
  const taxRatesById = await getTaxRatesByIdInTx(tx, requestedTaxRateIds);

  const preparedLines = payload.lines.map((line, index) => {
    const item = itemsById.get(line.itemId);

    if (!item) {
      throw new SalesError("Item not found", 404);
    }

    const pricing = resolvePricingForProduct(
      {
        customerCategoryId: customer.customerCategoryId,
        customerCategoryName: customer.customerCategoryName,
        product: item,
        quantity: line.quantity,
      },
      pricingLookup
    );
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const normalizedUnitPrice = normalizeMoney(unitPrice);
    const effectiveTaxRateId =
      line.taxRateId === undefined ? defaultSalesTaxRateId : line.taxRateId;
    const selectedTaxRate = effectiveTaxRateId
      ? taxRatesById.get(effectiveTaxRateId) ?? null
      : null;
    const listUnitPrice =
      normalizeOptionalLineMoney(line.listUnitPrice) ??
      pricing.baseUnitPrice ??
      normalizedUnitPrice;
    const suggestedUnitPrice =
      normalizeOptionalLineMoney(line.suggestedUnitPrice) ??
      pricing.suggestedUnitPrice;
    const pricingSourceType = line.pricingSourceType ?? pricing.pricingSourceType;
    const pricingScheduleName =
      line.pricingScheduleName !== undefined
        ? line.pricingScheduleName
        : pricing.pricingScheduleName;
    const pricingBreakLabel =
      line.pricingBreakLabel !== undefined
        ? line.pricingBreakLabel
        : pricing.pricingBreakLabel;
    const discountPercent =
      normalizeOptionalLineMoney(line.discountPercent) ??
      calculateDiscountPercentString(listUnitPrice, normalizedUnitPrice);
    const { lineSubtotal, lineTaxAmount, lineTotal } = calculateSalesLineAmounts({
      quantity,
      unitPrice,
      taxRatePercent: selectedTaxRate?.ratePercent ?? 0,
    });

    return {
      itemId: item.id,
      itemName: item.displayName,
      itemSku: item.sku,
      unitName: item.unitName,
      quantity: normalizeNumeric(quantity),
      listUnitPrice,
      unitPrice: normalizedUnitPrice,
      taxRateId: selectedTaxRate?.id ?? null,
      taxRateName: selectedTaxRate?.name ?? null,
      taxRatePercent: selectedTaxRate?.ratePercent ?? "0",
      discountPercent,
      suggestedUnitPrice,
      pricingSourceType,
      pricingScheduleName,
      pricingBreakLabel,
      isPriceOverridden:
        line.isPriceOverridden ??
        (suggestedUnitPrice != null && normalizedUnitPrice !== suggestedUnitPrice),
      lineSubtotal,
      lineTaxAmount,
      lineTotal,
      sortOrder: index,
    } satisfies PreparedOrderLine;
  });

  const shippingFeeAmount = normalizeMoney(Number(payload.shippingFeeAmount ?? 0));
  const shippingFeeTaxAmount = normalizeMoney(Number(payload.shippingFeeTaxAmount ?? 0));
  const subtotalAmount = preparedLines.reduce(
    (sum, line) => sum + parseFloat(line.lineSubtotal),
    0
  ) + parseFloat(shippingFeeAmount);
  const taxAmount = preparedLines.reduce(
    (sum, line) => sum + parseFloat(line.lineTaxAmount),
    0
  ) + parseFloat(shippingFeeTaxAmount);
  const totalAmount = subtotalAmount + taxAmount;
  const customerHasShipAddress =
    customer.shipLine1 != null ||
    customer.shipLine2 != null ||
    customer.shipCity != null ||
    customer.shipRegion != null ||
    customer.shipPostcode != null ||
    customer.shipCountry != null;
  const fallbackShipAddress = customerHasShipAddress
    ? {
        shipLine1: customer.shipLine1,
        shipLine2: customer.shipLine2,
        shipCity: customer.shipCity,
        shipRegion: customer.shipRegion,
        shipPostcode: customer.shipPostcode,
        shipCountry: customer.shipCountry,
      }
    : {
        shipLine1: customer.billingLine1,
        shipLine2: customer.billingLine2,
        shipCity: customer.billingCity,
        shipRegion: customer.billingRegion,
        shipPostcode: customer.billingPostcode,
        shipCountry: customer.billingCountry,
      };

  return {
    customerId: customer.id,
    customerProjectId: project?.id ?? null,
    customerName: customer.name,
    orderDate: payload.orderDate,
    shipDate: payload.shipDate ?? null,
    requestedDate: payload.requestedDate ?? null,
    notes: payload.notes ?? null,
    shipLine1: payload.shipLine1 ?? fallbackShipAddress.shipLine1,
    shipLine2: payload.shipLine2 ?? fallbackShipAddress.shipLine2,
    shipCity: payload.shipCity ?? fallbackShipAddress.shipCity,
    shipRegion: payload.shipRegion ?? fallbackShipAddress.shipRegion,
    shipPostcode: payload.shipPostcode ?? fallbackShipAddress.shipPostcode,
    shipCountry: payload.shipCountry ?? fallbackShipAddress.shipCountry,
    billingLine1: payload.billingLine1 ?? customer.billingLine1,
    billingLine2: payload.billingLine2 ?? customer.billingLine2,
    billingCity: payload.billingCity ?? customer.billingCity,
    billingRegion: payload.billingRegion ?? customer.billingRegion,
    billingPostcode: payload.billingPostcode ?? customer.billingPostcode,
    billingCountry: payload.billingCountry ?? customer.billingCountry,
    shippingFeeDescription: payload.shippingFeeDescription ?? null,
    shippingFeeAmount,
    shippingFeeTaxAmount,
    subtotalAmount: normalizeMoney(subtotalAmount),
    taxAmount: normalizeMoney(taxAmount),
    totalAmount: normalizeMoney(totalAmount),
    preparedLines,
    affectedItemIds: preparedLines.map((line) => line.itemId),
    itemsById,
  };
}

export async function getCustomerCategoryOptions(): Promise<CustomerCategoryOption[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt))
      .orderBy(asc(customerCategories.sortOrder), asc(customerCategories.name));
  });
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

export async function getCustomerCategories(): Promise<CustomerCategoryRow[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
        description: customerCategories.description,
        createdAt: customerCategories.createdAt,
        updatedAt: customerCategories.updatedAt,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt))
      .orderBy(asc(customerCategories.sortOrder), asc(customerCategories.name));

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const [customerCounts, scheduleCounts] = await Promise.all([
      tx
        .select({
          customerCategoryId: customers.customerCategoryId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(customers)
        .where(
          and(
            inArray(customers.customerCategoryId, ids),
            isNull(customers.deletedAt)
          )
        )
        .groupBy(customers.customerCategoryId),
      tx
        .select({
          customerCategoryId: pricingSchedules.customerCategoryId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(pricingSchedules)
        .where(
          and(
            inArray(pricingSchedules.customerCategoryId, ids),
            isNull(pricingSchedules.deletedAt)
          )
        )
        .groupBy(pricingSchedules.customerCategoryId),
    ]);

    const customerCountsByCategoryId = new Map(
      customerCounts
        .filter(
          (
            row
          ): row is {
            customerCategoryId: string;
            count: number;
          } => row.customerCategoryId != null
        )
        .map((row) => [row.customerCategoryId, row.count])
    );
    const scheduleCountsByCategoryId = new Map(
      scheduleCounts
        .filter(
          (
            row
          ): row is {
            customerCategoryId: string;
            count: number;
          } => row.customerCategoryId != null
        )
        .map((row) => [row.customerCategoryId, row.count])
    );

    return rows.map((row) => ({
      ...row,
      customerCount: customerCountsByCategoryId.get(row.id) ?? 0,
      scheduleCount: scheduleCountsByCategoryId.get(row.id) ?? 0,
    }));
  });
}

export async function getCustomerCategory(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [category] = await tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
        description: customerCategories.description,
        updatedAt: customerCategories.updatedAt,
      })
      .from(customerCategories)
      .where(
        and(
          eq(customerCategories.id, id),
          isNull(customerCategories.deletedAt)
        )
      );

    return category ?? null;
  });
}

export async function createCustomerCategory(data: InsertCustomerCategory) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await ensureCustomerCategoryNameAvailableInTx(tx, data.name);

    const [maxSortOrderRow] = await tx
      .select({
        value: sql<number>`COALESCE(MAX(${customerCategories.sortOrder}), -1)`,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt));

    const [category] = await tx
      .insert(customerCategories)
      .values({
        organizationId: orgId,
        name: data.name,
        description: data.description,
        sortOrder: Number(maxSortOrderRow?.value ?? -1) + 1,
      })
      .returning({ id: customerCategories.id, name: customerCategories.name });

    return category;
  });
}

export async function updateCustomerCategory(id: string, data: UpdateCustomerCategory) {
  return withAuthedOrgContext(async (tx) => {
    await ensureCustomerCategoryNameAvailableInTx(tx, data.name, {
      excludeId: id,
    });

    const [category] = await tx
      .update(customerCategories)
      .set({
        name: data.name,
        description: data.description,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerCategories.id, id),
          isNull(customerCategories.deletedAt)
        )
      )
      .returning({ id: customerCategories.id });

    return category ?? null;
  });
}

async function ensureCustomerCategoriesDeletableInTx(
  tx: Tx,
  categoryIds: string[]
) {
  const uniqueCategoryIds = [...new Set(categoryIds)];
  const now = new Date();

  await Promise.all([
    tx
      .update(customers)
      .set({ customerCategoryId: null, updatedAt: now })
      .where(
        and(
          inArray(customers.customerCategoryId, uniqueCategoryIds),
          isNull(customers.deletedAt)
        )
      )
      .returning({ id: customers.id }),
    tx
      .update(pricingSchedules)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(pricingSchedules.customerCategoryId, uniqueCategoryIds),
          isNull(pricingSchedules.deletedAt)
        )
      )
      .returning({ id: pricingSchedules.id }),
  ]);

  return uniqueCategoryIds;
}

async function softDeleteCustomerCategoriesInTx(tx: Tx, categoryIds: string[]) {
  if (categoryIds.length === 0) {
    return [];
  }

  return tx
    .update(customerCategories)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(customerCategories.id, categoryIds),
        isNull(customerCategories.deletedAt)
      )
    )
    .returning({ id: customerCategories.id });
}

export async function deleteCustomerCategory(id: string) {
  const deleted = await withAuthedOrgContext(async (tx) => {
    const categoryIds = await ensureCustomerCategoriesDeletableInTx(tx, [id]);
    const [category] = await softDeleteCustomerCategoriesInTx(tx, categoryIds);
    return category != null;
  });

  return { deleted };
}

export async function deleteCustomerCategories(ids: string[]) {
  const deletedCount = await withAuthedOrgContext(async (tx) => {
    const categoryIds = await ensureCustomerCategoriesDeletableInTx(tx, ids);
    const deletedCategories = await softDeleteCustomerCategoriesInTx(tx, categoryIds);
    return deletedCategories.length;
  });

  return { deletedCount };
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

const customerRowSelect = {
  id: customers.id,
  name: customers.name,
  customerCategoryId: customers.customerCategoryId,
  customerCategoryName: customerCategories.name,
  accountState: customers.accountState,
  accountPriority: customers.accountPriority,
  openOrderCount: sql<number>`(
    SELECT COUNT(*)::int
    FROM sales.sales_orders so
    WHERE so.customer_id = ${customers.id}
      AND so.deleted_at IS NULL
      AND so.status = 'open'
  )`.as("openOrderCount"),
  openOrderValue: trimScale(sql`COALESCE((
    SELECT SUM(so.total_amount)
    FROM sales.sales_orders so
    WHERE so.customer_id = ${customers.id}
      AND so.deleted_at IS NULL
      AND so.status = 'open'
  ), 0)`).as("openOrderValue"),
  latestOrderDate: sql<string | null>`(
    SELECT MAX(so.order_date)::text
    FROM sales.sales_orders so
    WHERE so.customer_id = ${customers.id}
      AND so.deleted_at IS NULL
  )`.as("latestOrderDate"),
  email: customers.email,
  phone: customers.phone,
  billingLine1: customers.billingLine1,
  billingLine2: customers.billingLine2,
  billingCity: customers.billingCity,
  billingRegion: customers.billingRegion,
  billingPostcode: customers.billingPostcode,
  billingCountry: customers.billingCountry,
  shipLine1: customers.shipLine1,
  shipLine2: customers.shipLine2,
  shipCity: customers.shipCity,
  shipRegion: customers.shipRegion,
  shipPostcode: customers.shipPostcode,
  shipCountry: customers.shipCountry,
  xeroContactId: sql<string | null>`(
    SELECT ${integrationExternalRecords.externalId}
    FROM ${integrationExternalRecords}
    WHERE ${integrationExternalRecords.provider} = ${ACCOUNTING_PROVIDER_XERO}
      AND ${integrationExternalRecords.entityType} = 'customer'
      AND ${integrationExternalRecords.localRecordId} = ${customers.id}
    LIMIT 1
  )`,
  notes: customers.notes,
  deletedAt: customers.deletedAt,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
} as const;

type CustomerSelectRow = Omit<
  CustomerRow,
  "accountState" | "accountPriority" | "openOrderCount"
> & {
  accountState: string;
  accountPriority: string;
  openOrderCount: number | string;
};

function mapCustomerRow(row: CustomerSelectRow): CustomerRow {
  return {
    ...row,
    accountState: row.accountState as CustomerRow["accountState"],
    accountPriority: row.accountPriority as CustomerRow["accountPriority"],
    openOrderCount: Number(row.openOrderCount),
  };
}

async function getCustomerSalesOrdersInTx(tx: Tx, customerId: string) {
  const rows = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      shipDate: salesOrders.shipDate,
      requestedDate: salesOrders.requestedDate,
      totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
      customerProjectId: salesOrders.customerProjectId,
      customerProjectName: customerProjects.name,
      deletedAt: salesOrders.deletedAt,
      createdAt: salesOrders.createdAt,
    })
    .from(salesOrders)
    .leftJoin(
      customerProjects,
      and(
        eq(salesOrders.customerProjectId, customerProjects.id),
        isNull(customerProjects.deletedAt)
      )
    )
    .where(
      and(eq(salesOrders.customerId, customerId), isNull(salesOrders.deletedAt))
    )
    .orderBy(desc(salesOrders.createdAt), asc(salesOrders.orderNumber));

  return rows.map((row) => ({
    ...row,
    status: row.status as SalesOrderListRow["status"],
  }));
}

async function getCustomerInTx(
  tx: Tx,
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<CustomerRow | null> {
  const conditions = [eq(customers.id, id)];
  if (!options?.includeDeleted) {
    conditions.push(isNull(customers.deletedAt));
  }

  const [customer] = await tx
    .select(customerRowSelect)
    .from(customers)
    .leftJoin(
      customerCategories,
      eq(customers.customerCategoryId, customerCategories.id)
    )
    .where(and(...conditions));

  return customer ? mapCustomerRow(customer) : null;
}

export async function getCustomers(): Promise<CustomerRow[]> {
  return measureObservedOperation(
    "sales.get_customers",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        const rows = await tx
          .select(customerRowSelect)
          .from(customers)
          .leftJoin(
            customerCategories,
            eq(customers.customerCategoryId, customerCategories.id)
          )
          .where(isNull(customers.deletedAt))
          .orderBy(asc(customers.name));

        return rows.map(mapCustomerRow);
      });
    },
    {
      successData: (rows) => ({
        rowCount: rows.length,
      }),
    }
  );
}

export async function getSalesOrderCustomerOptions(): Promise<CustomerOption[]> {
  return withAuthedOrgContext(async (tx) => {
    const customerRows = await tx
      .select(customerRowSelect)
      .from(customers)
      .leftJoin(
        customerCategories,
        eq(customers.customerCategoryId, customerCategories.id)
      )
      .where(isNull(customers.deletedAt))
      .orderBy(asc(customers.name));

    const projectRows =
      customerRows.length === 0
        ? []
        : await tx
            .select({
              id: customerProjects.id,
              customerId: customerProjects.customerId,
              name: customerProjects.name,
              status: customerProjects.status,
            })
            .from(customerProjects)
            .where(
              and(
                inArray(
                  customerProjects.customerId,
                  customerRows.map((customer) => customer.id)
                ),
                isNull(customerProjects.deletedAt)
              )
            )
            .orderBy(asc(customerProjects.name));

    const projectsByCustomerId = new Map<string, CustomerOption["projects"]>();
    for (const project of projectRows) {
      const projects = projectsByCustomerId.get(project.customerId) ?? [];
      projects.push({
        id: project.id,
        name: project.name,
        status: project.status as CustomerProjectRow["status"],
      });
      projectsByCustomerId.set(project.customerId, projects);
    }

    return customerRows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      projects: projectsByCustomerId.get(customer.id) ?? [],
      billingLine1: customer.billingLine1,
      billingLine2: customer.billingLine2,
      billingCity: customer.billingCity,
      billingRegion: customer.billingRegion,
      billingPostcode: customer.billingPostcode,
      billingCountry: customer.billingCountry,
      shipLine1: customer.shipLine1,
      shipLine2: customer.shipLine2,
      shipCity: customer.shipCity,
      shipRegion: customer.shipRegion,
      shipPostcode: customer.shipPostcode,
      shipCountry: customer.shipCountry,
    }));
  });
}

export async function getCustomer(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<CustomerRow | null> {
  return withAuthedOrgContext(async (tx) => {
    return getCustomerInTx(tx, id, options);
  });
}

function buildCustomerContactRoles(row: {
  isPrimary: boolean;
  receivesShipping: boolean;
  receivesInvoices: boolean;
  receivesBillingCc: boolean;
  isOnSite: boolean;
}): CustomerContactRole[] {
  return [
    ...(row.isPrimary ? (["primary"] as const) : []),
    ...(row.receivesShipping ? (["shipping"] as const) : []),
    ...(row.receivesInvoices ? (["invoicing"] as const) : []),
    ...(row.receivesBillingCc ? (["billing"] as const) : []),
    ...(row.isOnSite ? (["field"] as const) : []),
  ];
}

function buildCustomerContactRoleColumns(roles: CustomerContactInput["roles"]) {
  const roleSet = new Set(roles);
  return {
    isPrimary: roleSet.has("primary"),
    receivesShipping: roleSet.has("shipping"),
    receivesInvoices: roleSet.has("invoicing"),
    receivesBillingCc: roleSet.has("billing"),
    isOnSite: roleSet.has("field"),
  };
}

const customerContactSelect = {
  id: customerContacts.id,
  name: customerContacts.name,
  title: customerContacts.title,
  email: customerContacts.email,
  phone: customerContacts.phone,
  addressEntryId: customerContacts.addressEntryId,
  isPrimary: customerContacts.isPrimary,
  receivesShipping: customerContacts.receivesShipping,
  receivesInvoices: customerContacts.receivesInvoices,
  receivesBillingCc: customerContacts.receivesBillingCc,
  isOnSite: customerContacts.isOnSite,
  notes: customerContacts.notes,
  createdAt: customerContacts.createdAt,
  updatedAt: customerContacts.updatedAt,
} as const;

function mapCustomerContactRow(
  row: {
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    addressEntryId: string | null;
    isPrimary: boolean;
    receivesShipping: boolean;
    receivesInvoices: boolean;
    receivesBillingCc: boolean;
    isOnSite: boolean;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }
): CustomerContactRow {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    addressEntryId: row.addressEntryId,
    roles: buildCustomerContactRoles(row),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureActiveCustomerInTx(tx: Tx, customerId: string) {
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));

  return customer ?? null;
}

async function ensureAddressEntryForContactInTx(
  tx: Tx,
  organizationId: string,
  addressEntryId: string | null | undefined
) {
  if (!addressEntryId) return;
  const address = await getAddressEntryInTx(tx, organizationId, addressEntryId);
  if (!address) {
    throw new SalesError("Address not found.", 404);
  }
}

async function getCustomerContactsInTx(
  tx: Tx,
  customerId: string
): Promise<CustomerContactRow[]> {
  const rows = await tx
    .select(customerContactSelect)
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.customerId, customerId),
        isNull(customerContacts.deletedAt)
      )
    )
    .orderBy(desc(customerContacts.isPrimary), asc(customerContacts.name));

  return rows.map(mapCustomerContactRow);
}

async function getCustomerCorrespondenceInTx(
  tx: Tx,
  customerId: string
): Promise<CustomerCorrespondenceRow[]> {
  const rows = await tx
    .select({
      id: customerCorrespondence.id,
      type: customerCorrespondence.type,
      occurredAt: customerCorrespondence.occurredAt,
      title: customerCorrespondence.title,
      body: customerCorrespondence.body,
      createdByUserId: customerCorrespondence.createdByUserId,
      createdByName: customerCorrespondence.createdByName,
      createdAt: customerCorrespondence.createdAt,
      updatedAt: customerCorrespondence.updatedAt,
    })
    .from(customerCorrespondence)
    .where(
      and(
        eq(customerCorrespondence.customerId, customerId),
        isNull(customerCorrespondence.deletedAt)
      )
    )
    .orderBy(desc(customerCorrespondence.occurredAt), desc(customerCorrespondence.createdAt));

  const ids = rows.map((row) => row.id);
  const attendeeRows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: customerCorrespondenceAttendees.id,
            correspondenceId: customerCorrespondenceAttendees.correspondenceId,
            contactId: customerCorrespondenceAttendees.contactId,
            contactName: customerCorrespondenceAttendees.contactName,
          })
          .from(customerCorrespondenceAttendees)
          .where(
            inArray(customerCorrespondenceAttendees.correspondenceId, ids)
          )
          .orderBy(asc(customerCorrespondenceAttendees.contactName));

  const attendeesByCorrespondence = new Map<
    string,
    CustomerCorrespondenceRow["attendees"]
  >();
  for (const attendee of attendeeRows) {
    const list = attendeesByCorrespondence.get(attendee.correspondenceId) ?? [];
    list.push({
      id: attendee.id,
      contactId: attendee.contactId,
      contactName: attendee.contactName,
    });
    attendeesByCorrespondence.set(attendee.correspondenceId, list);
  }

  return rows.map((row) => ({
    ...row,
    type: row.type as CustomerCorrespondenceRow["type"],
    attendees: attendeesByCorrespondence.get(row.id) ?? [],
  }));
}

function mapCustomerProjectFileRow(row: {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  uploadedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CustomerProjectFileRow {
  return row;
}

async function getCustomerProjectsInTx(
  tx: Tx,
  customerId: string
): Promise<CustomerProjectRow[]> {
  const rows = await tx
    .select({
      id: customerProjects.id,
      name: customerProjects.name,
      status: customerProjects.status,
      startDate: customerProjects.startDate,
      targetEndDate: customerProjects.targetEndDate,
      summary: customerProjects.summary,
      createdAt: customerProjects.createdAt,
      updatedAt: customerProjects.updatedAt,
    })
    .from(customerProjects)
    .where(
      and(eq(customerProjects.customerId, customerId), isNull(customerProjects.deletedAt))
    )
    .orderBy(desc(customerProjects.createdAt));

  const projectIds = rows.map((row) => row.id);
  const fileRows =
    projectIds.length === 0
      ? []
      : await tx
          .select({
            id: customerProjectFiles.id,
            projectId: customerProjectFiles.projectId,
            filename: customerProjectFiles.filename,
            contentType: customerProjectFiles.contentType,
            sizeBytes: customerProjectFiles.sizeBytes,
            uploadedByUserId: customerProjectFiles.uploadedByUserId,
            uploadedByName: customerProjectFiles.uploadedByName,
            createdAt: customerProjectFiles.createdAt,
            updatedAt: customerProjectFiles.updatedAt,
          })
          .from(customerProjectFiles)
          .where(
            and(
              inArray(customerProjectFiles.projectId, projectIds),
              isNull(customerProjectFiles.deletedAt)
            )
          )
          .orderBy(desc(customerProjectFiles.createdAt));

  const filesByProject = new Map<string, CustomerProjectFileRow[]>();
  for (const file of fileRows) {
    const files = filesByProject.get(file.projectId) ?? [];
    files.push(mapCustomerProjectFileRow(file));
    filesByProject.set(file.projectId, files);
  }

  return rows.map((row) => ({
    ...row,
    status: row.status as CustomerProjectRow["status"],
    files: filesByProject.get(row.id) ?? [],
    salesOrders: [],
    orderCount: 0,
    orderValue: "0",
  }));
}

export async function getCustomerDetail(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<CustomerDetailData | null> {
  return withAuthedOrgContext(async (tx) => {
    const customer = await getCustomerInTx(tx, id, options);
    if (!customer) return null;

    const contacts = await getCustomerContactsInTx(tx, id);
    const correspondence = await getCustomerCorrespondenceInTx(tx, id);
    const projects = await getCustomerProjectsInTx(tx, id);
    const salesOrderRows = await getCustomerSalesOrdersInTx(tx, id);
    const salesOrdersByProjectId = new Map<
      string,
      typeof salesOrderRows
    >();
    for (const salesOrder of salesOrderRows) {
      if (!salesOrder.customerProjectId) continue;
      const bucket =
        salesOrdersByProjectId.get(salesOrder.customerProjectId) ?? [];
      bucket.push(salesOrder);
      salesOrdersByProjectId.set(salesOrder.customerProjectId, bucket);
    }

    return {
      ...customer,
      contacts,
      correspondence,
      projects: projects.map((project) => ({
        ...project,
        salesOrders: salesOrdersByProjectId.get(project.id) ?? [],
        orderCount: salesOrdersByProjectId.get(project.id)?.length ?? 0,
        orderValue: normalizeMoney(
          (salesOrdersByProjectId.get(project.id) ?? []).reduce(
            (sum, order) => sum + parseMoneyValue(order.totalAmount),
            0
          )
        ),
      })),
      salesOrders: salesOrderRows,
    };
  });
}

export async function createCustomerContact(
  customerId: string,
  data: CustomerContactInput
): Promise<CustomerContactRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;
    await ensureAddressEntryForContactInTx(tx, orgId, data.addressEntryId);

    const [contact] = await tx
      .insert(customerContacts)
      .values({
        organizationId: orgId,
        customerId,
        name: data.name,
        title: data.title,
        email: data.email,
        phone: data.phone,
        addressEntryId: data.addressEntryId,
        ...buildCustomerContactRoleColumns(data.roles),
        notes: data.notes,
      })
      .returning(customerContactSelect);

    return contact ? mapCustomerContactRow(contact) : null;
  });
}

export async function updateCustomerContact(
  customerId: string,
  contactId: string,
  data: CustomerContactInput
): Promise<CustomerContactRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;
    await ensureAddressEntryForContactInTx(tx, orgId, data.addressEntryId);

    const [contact] = await tx
      .update(customerContacts)
      .set({
        name: data.name,
        title: data.title,
        email: data.email,
        phone: data.phone,
        addressEntryId: data.addressEntryId,
        ...buildCustomerContactRoleColumns(data.roles),
        notes: data.notes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerContacts.id, contactId),
          eq(customerContacts.customerId, customerId),
          isNull(customerContacts.deletedAt)
        )
      )
      .returning(customerContactSelect);

    return contact ? mapCustomerContactRow(contact) : null;
  });
}

export async function deleteCustomerContact(customerId: string, contactId: string) {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return { deleted: false };

    const [contact] = await tx
      .update(customerContacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(customerContacts.id, contactId),
          eq(customerContacts.customerId, customerId),
          isNull(customerContacts.deletedAt)
        )
      )
      .returning({ id: customerContacts.id });

    return { deleted: contact != null };
  });
}

export async function createCustomerCorrespondence(
  customerId: string,
  data: CustomerCorrespondenceInput,
  actor: { userId: string; name: string }
): Promise<CustomerCorrespondenceRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    const uniqueAttendeeIds = [...new Set(data.attendeeContactIds)];
    const attendeeContacts =
      uniqueAttendeeIds.length === 0
        ? []
        : await tx
            .select({ id: customerContacts.id, name: customerContacts.name })
            .from(customerContacts)
            .where(
              and(
                inArray(customerContacts.id, uniqueAttendeeIds),
                eq(customerContacts.customerId, customerId),
                isNull(customerContacts.deletedAt)
              )
            );

    if (attendeeContacts.length !== uniqueAttendeeIds.length) {
      throw new SalesError("One or more tagged contacts were not found.", 400);
    }

    const now = new Date();
    const [entry] = await tx
      .insert(customerCorrespondence)
      .values({
        organizationId: orgId,
        customerId,
        type: data.type,
        occurredAt: data.occurredAt ?? now,
        title: data.title,
        body: data.body,
        createdByUserId: actor.userId,
        createdByName: actor.name || null,
      })
      .returning({
        id: customerCorrespondence.id,
        type: customerCorrespondence.type,
        occurredAt: customerCorrespondence.occurredAt,
        title: customerCorrespondence.title,
        body: customerCorrespondence.body,
        createdByUserId: customerCorrespondence.createdByUserId,
        createdByName: customerCorrespondence.createdByName,
        createdAt: customerCorrespondence.createdAt,
        updatedAt: customerCorrespondence.updatedAt,
      });

    if (!entry) return null;

    const attendees =
      attendeeContacts.length === 0
        ? []
        : await tx
            .insert(customerCorrespondenceAttendees)
            .values(
              attendeeContacts.map((contact) => ({
                organizationId: orgId,
                customerId,
                correspondenceId: entry.id,
                contactId: contact.id,
                contactName: contact.name,
              }))
            )
            .returning({
              id: customerCorrespondenceAttendees.id,
              contactId: customerCorrespondenceAttendees.contactId,
              contactName: customerCorrespondenceAttendees.contactName,
            });

    return {
      ...entry,
      type: entry.type as CustomerCorrespondenceRow["type"],
      attendees,
    };
  });
}

export async function createCustomerProject(
  customerId: string,
  data: CustomerProjectInput
): Promise<CustomerProjectRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    const [project] = await tx
      .insert(customerProjects)
      .values({
        organizationId: orgId,
        customerId,
        name: data.name,
        status: data.status,
        startDate: data.startDate,
        targetEndDate: data.targetEndDate,
        summary: data.summary,
      })
      .returning({
        id: customerProjects.id,
        name: customerProjects.name,
        status: customerProjects.status,
        startDate: customerProjects.startDate,
        targetEndDate: customerProjects.targetEndDate,
        summary: customerProjects.summary,
        createdAt: customerProjects.createdAt,
        updatedAt: customerProjects.updatedAt,
      });

    return project
      ? {
          ...project,
          status: project.status as CustomerProjectRow["status"],
          files: [],
          salesOrders: [],
          orderCount: 0,
          orderValue: "0",
        }
      : null;
  });
}

export async function updateCustomerProject(
  customerId: string,
  projectId: string,
  data: CustomerProjectInput
): Promise<CustomerProjectRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    const [project] = await tx
      .update(customerProjects)
      .set({
        name: data.name,
        status: data.status,
        startDate: data.startDate,
        targetEndDate: data.targetEndDate,
        summary: data.summary,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt)
        )
      )
      .returning({
        id: customerProjects.id,
        name: customerProjects.name,
        status: customerProjects.status,
        startDate: customerProjects.startDate,
        targetEndDate: customerProjects.targetEndDate,
        summary: customerProjects.summary,
        createdAt: customerProjects.createdAt,
        updatedAt: customerProjects.updatedAt,
      });

    if (!project) return null;

    const projects = await getCustomerProjectsInTx(tx, customerId);
    const fullProject = projects.find((row) => row.id === project.id);
    return fullProject ?? {
      ...project,
      status: project.status as CustomerProjectRow["status"],
      files: [],
      salesOrders: [],
      orderCount: 0,
      orderValue: "0",
    };
  });
}

export async function deleteCustomerProject(customerId: string, projectId: string) {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return { deleted: false, blobUrls: [] };

    const now = new Date();
    const [project] = await tx
      .update(customerProjects)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt)
        )
      )
      .returning({ id: customerProjects.id });

    if (!project) return { deleted: false, blobUrls: [] };

    const files = await tx
      .select({
        id: customerProjectFiles.id,
        blobUrl: customerProjectFiles.blobUrl,
      })
      .from(customerProjectFiles)
      .where(
        and(
          eq(customerProjectFiles.customerId, customerId),
          eq(customerProjectFiles.projectId, projectId),
          isNull(customerProjectFiles.deletedAt)
        )
      );

    if (files.length > 0) {
      await tx
        .update(customerProjectFiles)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          inArray(
            customerProjectFiles.id,
            files.map((file) => file.id)
          )
        );
    }

    return {
      deleted: true,
      blobUrls: files.map((file) => file.blobUrl),
    };
  });
}

export async function getCustomerProjectFileUploadTarget(
  customerId: string,
  projectId: string
) {
  return withAuthedOrgContext(async (tx) => {
    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt)
        )
      );

    return project ?? null;
  });
}

export async function createCustomerProjectFile(params: {
  customerId: string;
  projectId: string;
  storageKey: string;
  blobUrl: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: { userId: string; name: string };
}): Promise<CustomerProjectFileRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .where(
        and(
          eq(customerProjects.id, params.projectId),
          eq(customerProjects.customerId, params.customerId),
          isNull(customerProjects.deletedAt)
        )
      );

    if (!project) return null;

    const [file] = await tx
      .insert(customerProjectFiles)
      .values({
        organizationId: orgId,
        customerId: params.customerId,
        projectId: params.projectId,
        storageKey: params.storageKey,
        blobUrl: params.blobUrl,
        filename: params.filename,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        uploadedByUserId: params.uploadedBy.userId,
        uploadedByName: params.uploadedBy.name || null,
      })
      .returning({
        id: customerProjectFiles.id,
        filename: customerProjectFiles.filename,
        contentType: customerProjectFiles.contentType,
        sizeBytes: customerProjectFiles.sizeBytes,
        uploadedByUserId: customerProjectFiles.uploadedByUserId,
        uploadedByName: customerProjectFiles.uploadedByName,
        createdAt: customerProjectFiles.createdAt,
        updatedAt: customerProjectFiles.updatedAt,
      });

    return file ? mapCustomerProjectFileRow(file) : null;
  });
}

export async function getCustomerProjectFileForDownload(
  customerId: string,
  projectId: string,
  fileId: string
) {
  return withAuthedOrgContext(async (tx) => {
    const [file] = await tx
      .select({
        id: customerProjectFiles.id,
        storageKey: customerProjectFiles.storageKey,
        blobUrl: customerProjectFiles.blobUrl,
        filename: customerProjectFiles.filename,
        contentType: customerProjectFiles.contentType,
        sizeBytes: customerProjectFiles.sizeBytes,
      })
      .from(customerProjectFiles)
      .innerJoin(
        customerProjects,
        eq(customerProjectFiles.projectId, customerProjects.id)
      )
      .innerJoin(customers, eq(customerProjectFiles.customerId, customers.id))
      .where(
        and(
          eq(customerProjectFiles.id, fileId),
          eq(customerProjectFiles.projectId, projectId),
          eq(customerProjectFiles.customerId, customerId),
          isNull(customerProjectFiles.deletedAt),
          isNull(customerProjects.deletedAt),
          isNull(customers.deletedAt)
        )
      );

    return file ?? null;
  });
}

export async function renameCustomerProjectFile(
  customerId: string,
  projectId: string,
  fileId: string,
  data: CustomerProjectFileRenameInput
): Promise<CustomerProjectFileRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .innerJoin(customers, eq(customerProjects.customerId, customers.id))
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt),
          isNull(customers.deletedAt)
        )
      )
      .limit(1);

    if (!project) return null;

    const [file] = await tx
      .update(customerProjectFiles)
      .set({ filename: data.filename, updatedAt: new Date() })
      .where(
        and(
          eq(customerProjectFiles.id, fileId),
          eq(customerProjectFiles.projectId, projectId),
          eq(customerProjectFiles.customerId, customerId),
          isNull(customerProjectFiles.deletedAt)
        )
      )
      .returning({
        id: customerProjectFiles.id,
        filename: customerProjectFiles.filename,
        contentType: customerProjectFiles.contentType,
        sizeBytes: customerProjectFiles.sizeBytes,
        uploadedByUserId: customerProjectFiles.uploadedByUserId,
        uploadedByName: customerProjectFiles.uploadedByName,
        createdAt: customerProjectFiles.createdAt,
        updatedAt: customerProjectFiles.updatedAt,
      });

    return file ? mapCustomerProjectFileRow(file) : null;
  });
}

export async function deleteCustomerProjectFile(
  customerId: string,
  projectId: string,
  fileId: string
) {
  return withAuthedOrgContext(async (tx) => {
    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .innerJoin(customers, eq(customerProjects.customerId, customers.id))
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt),
          isNull(customers.deletedAt)
        )
      )
      .limit(1);

    if (!project) return null;

    const [file] = await tx
      .update(customerProjectFiles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(customerProjectFiles.id, fileId),
          eq(customerProjectFiles.projectId, projectId),
          eq(customerProjectFiles.customerId, customerId),
          isNull(customerProjectFiles.deletedAt)
        )
      )
      .returning({
        id: customerProjectFiles.id,
        blobUrl: customerProjectFiles.blobUrl,
      });

    return file ?? null;
  });
}

export async function createCustomer(data: InsertCustomer) {
  return withAuthedOrgContext(async (tx, orgId) => {
    return createCustomerInTx(tx, orgId, data);
  });
}

export async function createCustomerInTx(tx: Tx, orgId: string, data: InsertCustomer) {
  await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);

  const [customer] = await tx
    .insert(customers)
    .values({
      organizationId: orgId,
      ...data,
    })
    .returning({ id: customers.id });

  return customer;
}

export async function updateCustomer(id: string, data: UpdateCustomer) {
  return withAuthedOrgContext(async (tx) => {
    return updateCustomerInTx(tx, id, data);
  });
}

export async function updateCustomerInTx(tx: Tx, id: string, data: UpdateCustomer) {
  await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);

  const [customer] = await tx
    .update(customers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .returning({ id: customers.id });

  return customer ?? null;
}

export async function patchCustomerInTx(tx: Tx, id: string, data: PatchCustomer) {
  if (data.customerCategoryId !== undefined) {
    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);
  }

  const [customer] = await tx
    .update(customers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .returning({ id: customers.id });

  return customer ?? null;
}

export async function patchCustomer(id: string, data: PatchCustomer) {
  return withAuthedOrgContext(async (tx) => {
    return patchCustomerInTx(tx, id, data);
  });
}

async function ensureCustomersDeletableInTx(customerIds: string[]) {
  const uniqueCustomerIds = [...new Set(customerIds)];
  return uniqueCustomerIds;
}

async function softDeleteCustomersInTx(tx: Tx, customerIds: string[]) {
  if (customerIds.length === 0) {
    return [];
  }

  return tx
    .update(customers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(customers.id, customerIds),
        isNull(customers.deletedAt)
      )
    )
    .returning({ id: customers.id });
}

async function softDeleteCustomerCrmArtifactsInTx(tx: Tx, customerIds: string[]) {
  if (customerIds.length === 0) {
    return [];
  }

  const now = new Date();
  await tx
    .update(customerContacts)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        inArray(customerContacts.customerId, customerIds),
        isNull(customerContacts.deletedAt)
      )
    );

  await tx
    .update(customerCorrespondence)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        inArray(customerCorrespondence.customerId, customerIds),
        isNull(customerCorrespondence.deletedAt)
      )
    );

  const files = await tx
    .select({
      id: customerProjectFiles.id,
      blobUrl: customerProjectFiles.blobUrl,
    })
    .from(customerProjectFiles)
    .where(
      and(
        inArray(customerProjectFiles.customerId, customerIds),
        isNull(customerProjectFiles.deletedAt)
      )
    );

  await tx
    .update(customerProjects)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        inArray(customerProjects.customerId, customerIds),
        isNull(customerProjects.deletedAt)
      )
    );

  if (files.length > 0) {
    await tx
      .update(customerProjectFiles)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        inArray(
          customerProjectFiles.id,
          files.map((file) => file.id)
        )
      );
  }

  return files.map((file) => file.blobUrl);
}

export async function deleteCustomer(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const customerIds = await ensureCustomersDeletableInTx([id]);
    const [customer] = await softDeleteCustomersInTx(tx, customerIds);
    const blobUrls =
      customer != null ? await softDeleteCustomerCrmArtifactsInTx(tx, [customer.id]) : [];

    return { deleted: customer != null, blobUrls };
  });
}

export async function deleteCustomers(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const customerIds = await ensureCustomersDeletableInTx(ids);
    const deletedCustomers = await softDeleteCustomersInTx(tx, customerIds);
    const deletedCustomerIds = deletedCustomers.map((customer) => customer.id);
    const blobUrls = await softDeleteCustomerCrmArtifactsInTx(tx, deletedCustomerIds);

    return { deletedCount: deletedCustomers.length, blobUrls };
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

export async function getSalesOrderItemOptions(): Promise<SalesOrderItemOption[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: items.id,
        itemType: items.itemType,
        name: items.name,
        familyName: itemFamilies.name,
        sellable: items.sellable,
        sku: items.sku,
        category: sql<string | null>`COALESCE(${itemFamilies.category}, ${items.category})`,
        unitName: unitDefinitions.name,
        defaultSellingPrice: trimScaleNullable(items.defaultSellingPrice).as(
          "defaultSellingPrice"
        ),
        stock: stockSubquery,
        committedQty: committedQtySubquery,
        demandQty: demandQtySubquery,
        shortageQty: shortageQtySubquery,
        availableQty: availableQtySubquery,
        expectedQty: expectedQtySubquery,
        safetyStock: trimScale(items.safetyStock).as("safetyStock"),
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(
        and(
          inArray(items.itemType, ["product", "material"]),
          isNull(items.deletedAt),
          isNotNull(items.familyId),
          sql`(${items.itemType} != 'product' OR ${items.sellable} = true)`,
        )
      )
      .orderBy(asc(items.name));

    const rowIds = rows.map((row) => row.id);
    const [optionLabelsByItemId, variantValuesByItemId] = await Promise.all([
      getSalesOptionLabelsByItemIdInTx(tx, rowIds),
      getSalesVariantValuesByItemIdInTx(tx, rowIds),
    ]);

    return rows
      .map((row) => {
        const displayName = formatSalesItemDisplayName(
          row.name,
          row.familyName,
          optionLabelsByItemId.get(row.id) ?? []
        );

        return {
          id: row.id,
          itemType: row.itemType as SalesOrderItemOption["itemType"],
          name: row.name,
          displayName,
          sku: row.sku,
          category: row.category,
          unitName: row.unitName,
          variantValues: variantValuesByItemId.get(row.id) ?? [],
          defaultSellingPrice: row.defaultSellingPrice,
          estimatedUnitCost: null,
          stock: row.stock,
          committedQty: row.committedQty,
          demandQty: row.demandQty,
          shortageQty: row.shortageQty,
          availableQty: row.availableQty,
          expectedQty: row.expectedQty,
          safetyStock: row.safetyStock,
        } satisfies SalesOrderItemOption;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  });
}

export async function getSalesOrders(): Promise<SalesOrderListRow[]> {
  return measureObservedOperation(
    "sales.get_orders",
    async () => {
      return withAuthedOrgContext(async (tx, orgId) => {
        const orderRows = await tx
          .select({
            id: salesOrders.id,
            orderNumber: salesOrders.orderNumber,
            customerId: salesOrders.customerId,
            customerName: salesOrders.customerName,
            customerEmail: customers.email,
            customerProjectId: salesOrders.customerProjectId,
            customerProjectName: customerProjects.name,
            notes: salesOrders.notes,
            status: salesOrders.status,
            priorityRank: salesOrders.priorityRank,
            orderDate: salesOrders.orderDate,
            shipDate: salesOrders.shipDate,
            requestedDate: salesOrders.requestedDate,
            shippedAt: salesOrders.shippedAt,
            totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
            deletedAt: salesOrders.deletedAt,
            createdAt: salesOrders.createdAt,
            updatedAt: salesOrders.updatedAt,
          })
          .from(salesOrders)
          .leftJoin(customers, eq(salesOrders.customerId, customers.id))
          .leftJoin(
            customerProjects,
            and(
              eq(salesOrders.customerProjectId, customerProjects.id),
              isNull(customerProjects.deletedAt)
            )
          )
          .where(isNull(salesOrders.deletedAt))
          .orderBy(
            sql`${salesOrders.priorityRank} IS NULL`,
            asc(salesOrders.priorityRank),
            asc(salesOrders.shipDate),
            desc(salesOrders.createdAt),
            asc(salesOrders.orderNumber),
            asc(salesOrders.id)
          );

        if (orderRows.length === 0) {
          return [];
        }

        const orderIds = orderRows.map((order) => order.id);
        const manufacturingSummaries = await getSalesOrderManufacturingSummariesInTx(
          tx,
          orderIds
        );
        const linkedManufacturingOrdersBySalesOrderId =
          await getLinkedManufacturingOrdersBySalesOrderIdInTx(tx, orderIds);
        const shippedByLine = new Map<string, number>();
        const plannedByLine = new Map<string, number>();

        const orderById = new Map(orderRows.map((order) => [order.id, order]));
        const availabilityLineRows = await tx
          .select({
            salesOrderId: salesOrderLines.salesOrderId,
            salesOrderLineId: salesOrderLines.id,
            itemId: salesOrderLines.itemId,
            quantity: trimScale(salesOrderLines.quantity).as("quantity"),
            shippedQuantity: trimScale(salesOrderLines.shippedQuantity).as("shippedQuantity"),
            sortOrder: salesOrderLines.sortOrder,
          })
          .from(salesOrderLines)
          .where(inArray(salesOrderLines.salesOrderId, orderIds))
          .orderBy(asc(salesOrderLines.salesOrderId), asc(salesOrderLines.sortOrder));
        const demandQueueCoverageByDemandKey =
          await getDemandQueueCoverageByDemandKeyForItemsInTx(tx, {
            organizationId: orgId,
            itemIds: availabilityLineRows.map((line) => line.itemId),
            includeManufacturingDetail: false,
          });
        const demandQueueCoverageBySalesLineId = new Map(
          [...demandQueueCoverageByDemandKey.values()]
            .filter((coverage) => coverage.demandType === "sales_order_line")
            .map((coverage) => [coverage.demandId, coverage])
        );
        const orderedQuantityByLineId = new Map(
          availabilityLineRows.map((line) => [line.salesOrderLineId, line.quantity])
        );
        availabilityLineRows.forEach((line) => {
          shippedByLine.set(line.salesOrderLineId, normalizeShipQuantity(Number(line.shippedQuantity)));
        });
        const demandLines = availabilityLineRows.flatMap((line) => {
          const order = orderById.get(line.salesOrderId);
          if (!order || order.status !== "open") return [];

          const shippedQty = shippedByLine.get(line.salesOrderLineId) ?? 0;
          const remainingQty = normalizeShipQuantity(
            Number(line.quantity) - shippedQty
          );
          if (!Number.isFinite(remainingQty) || remainingQty <= 0) {
            return [];
          }

          return [
            {
              salesOrderId: line.salesOrderId,
              salesOrderLineId: line.salesOrderLineId,
              itemId: line.itemId,
              requiredDate: order.shipDate,
              quantity: remainingQty,
              priorityRank: order.priorityRank,
              orderDate: order.orderDate,
              orderNumber: order.orderNumber,
              sortOrder: line.sortOrder,
            } satisfies SalesFulfillmentDemandLine,
          ];
        });
        const fulfillmentTotalsByOrderId = new Map<
          string,
          {
            remainingQty: number;
            allocatedQty: number;
            shortQty: number;
            expectedQty: number;
            expectedDate: string | null;
            productionAllocatedQty: number;
          }
        >();
        const salesLinesByOrderId = new Map<
          string,
          SalesOrderManufacturingLineSummary[]
        >();
        for (const order of orderRows) {
          const manufacturingSummary = manufacturingSummaries.get(order.id);
          const salesLines = (manufacturingSummary?.lines ?? []).map((line) => ({
            ...line,
            quantity: orderedQuantityByLineId.get(line.salesOrderLineId) ?? line.quantity,
          }));
          salesLinesByOrderId.set(order.id, salesLines);
          fulfillmentTotalsByOrderId.set(
            order.id,
            salesLines.reduce<{
              remainingQty: number;
              allocatedQty: number;
              shortQty: number;
              expectedQty: number;
              expectedDate: string | null;
              productionAllocatedQty: number;
            }>(
              (acc, line) => {
                const shippedQty = shippedByLine.get(line.salesOrderLineId) ?? 0;
                const remainingQty = normalizeShipQuantity(
                  Number(line.quantity) - shippedQty
                );
                const demandQueueCoverage = demandQueueCoverageBySalesLineId.get(
                  line.salesOrderLineId
                );
                const demandQueueInStockQty = Number(
                  demandQueueCoverage?.inStockQty ?? 0
                );
                const demandQueueExpectedQty = Number(
                  demandQueueCoverage?.expectedQty ?? 0
                );
                const demandQueueShortQty = Number(
                  demandQueueCoverage?.shortQty ?? remainingQty
                );
                acc.remainingQty += remainingQty;
                acc.allocatedQty += roundQuantity(
                  demandQueueInStockQty + demandQueueExpectedQty
                );
                acc.shortQty += demandQueueShortQty;
                acc.expectedQty += demandQueueExpectedQty;
                if (demandQueueExpectedQty > 0) {
                  acc.expectedDate = latestExpectedDate(
                    acc.expectedDate,
                    demandQueueCoverage?.latestExpectedDate
                  );
                }
                const allocation = demandQueueCoverageToSalesAllocationSummary({
                  lineId: line.salesOrderLineId,
                  itemId: line.itemId,
                  remainingQty,
                  coverage: demandQueueCoverage,
                });
                acc.productionAllocatedQty +=
                  allocation.sources
                    .filter((source) => source.sourceType === "manufacturing_order")
                    .reduce((sum, source) => sum + Number(source.quantity), 0) ?? 0;
                return acc;
              },
              {
                remainingQty: 0,
                allocatedQty: 0,
                shortQty: 0,
                expectedQty: 0,
                expectedDate: null,
                productionAllocatedQty: 0,
              }
            )
          );
        }
        const fulfillmentReadModels = await getSalesFulfillmentReadModelsInTx(
          tx,
          orgId,
          orderRows.map((order) => {
            const manufacturingSummary = manufacturingSummaries.get(order.id);
            const totals = fulfillmentTotalsByOrderId.get(order.id);
            return {
              id: order.id,
              status: order.status,
              hasManufacturableLines:
                manufacturingSummary?.hasManufacturableLines ?? false,
              shortQty: totals?.shortQty ?? 0,
              productionAllocatedQty: totals?.productionAllocatedQty ?? 0,
              linkedManufacturingOrders:
                linkedManufacturingOrdersBySalesOrderId.get(order.id) ?? [],
              manufacturableLines: manufacturingSummary?.lines ?? [],
            };
          }),
          demandLines
        );

        return orderRows.map((order) => {
          const manufacturingSummary = manufacturingSummaries.get(order.id);
          const salesLines = salesLinesByOrderId.get(order.id) ?? [];
          const fulfillmentReadModel = fulfillmentReadModels.get(order.id);
          const fulfillmentTotals = fulfillmentTotalsByOrderId.get(order.id) ?? {
            remainingQty: 0,
            allocatedQty: 0,
            shortQty: 0,
            expectedQty: 0,
            expectedDate: null,
            productionAllocatedQty: 0,
          };
          const hasManufacturableLines =
            manufacturingSummary?.hasManufacturableLines ?? false;
          const linkedManufacturingOrders =
            linkedManufacturingOrdersBySalesOrderId.get(order.id) ?? [];
          const openManufacturingOrders = openLinkedManufacturingOrders(
            linkedManufacturingOrders
          ).map(serializeLinkedManufacturingOrder);
          const stockBlockers = salesLines.flatMap((line) => {
            const shippedQty = shippedByLine.get(line.salesOrderLineId) ?? 0;
            const remainingQty = normalizeShipQuantity(
              Number(line.quantity) - shippedQty
            );
            const demandQueueCoverage = demandQueueCoverageBySalesLineId.get(
              line.salesOrderLineId
            );
            const shortQty = roundQuantity(
              Number(demandQueueCoverage?.shortQty ?? remainingQty)
            );

            if (!Number.isFinite(shortQty) || shortQty <= 0) {
              return [];
            }

            const inStockQty = demandQueueCoverage?.inStockQty ?? "0";
            const expectedQty = demandQueueCoverage?.expectedQty ?? "0";
            const coveredQty = normalizeNumeric(
              roundQuantity(Number(inStockQty) + Number(expectedQty))
            );

            return [
              `${line.itemName} needs ${formatQuantity(normalizeNumeric(remainingQty))} ${line.unitName}; ${formatQuantity(
                coveredQty
              )} ${line.unitName} covered`,
            ];
          });

          return {
            ...order,
            status: order.status as SalesOrderListRow["status"],
            itemSummary: summarizeItems(salesLines),
            lines: salesLines.map((line) => {
              const shippedQty = shippedByLine.get(line.salesOrderLineId) ?? 0;
              const remainingQty = normalizeShipQuantity(
                Number(line.quantity) - shippedQty
              );
              const unplannedQty = normalizeShipQuantity(
                remainingQty - (plannedByLine.get(line.salesOrderLineId) ?? 0)
              );
              const demandQueueCoverage = demandQueueCoverageBySalesLineId.get(
                line.salesOrderLineId
              );
              const allocation = demandQueueCoverageToSalesAllocationSummary({
                lineId: line.salesOrderLineId,
                itemId: line.itemId,
                remainingQty,
                coverage: demandQueueCoverage,
              });

              return {
                id: line.salesOrderLineId,
                itemId: line.itemId,
                itemType: line.itemType,
                masterName: line.masterName,
                attrs: line.attrs,
                itemSku: line.itemSku,
                quantity: line.quantity,
                shippedQuantity: normalizeNumeric(shippedQty),
                remainingQty: normalizeNumeric(remainingQty),
                allocatedQty: allocation.allocatedQty,
                shortQty: allocation.shortQty,
                sourceSummary: allocation.sourceSummary,
                allocationSources: allocation.sources,
                allocationStatus: allocation.status,
                demandQueueQueueCoveredQty:
                  demandQueueCoverage?.queueCoveredQty ?? "0",
                demandQueueSegments: demandQueueCoverage?.segments ?? [],
                demandQueueInStockQty: demandQueueCoverage?.inStockQty ?? "0",
                demandQueueExpectedQty: demandQueueCoverage?.expectedQty ?? "0",
                demandQueueShortQty:
                  demandQueueCoverage?.shortQty ?? normalizeNumeric(remainingQty),
                demandQueueExpectedDate:
                  demandQueueCoverage?.latestExpectedDate ?? null,
                unplannedAllocatedQty: allocation.allocatedQty,
                unplannedShortQty: normalizeNumeric(unplannedQty),
                unplannedSourceSummary: allocation.sourceSummary,
                unplannedAllocationStatus: allocation.status,
                unitName: line.unitName,
              };
            }),
            fulfillmentSummary: (() => {
              const allocated = normalizeNumeric(
                roundQuantity(fulfillmentTotals.allocatedQty)
              );
              const remaining = normalizeNumeric(
                roundQuantity(fulfillmentTotals.remainingQty)
              );
              const short = normalizeNumeric(roundQuantity(fulfillmentTotals.shortQty));
              const salesItemsState: SalesOrderFulfillmentSummary["salesItemsState"] =
                deriveDemandQueueSalesItemsState(fulfillmentTotals);
              const salesItemsExpectedDate =
                salesItemsState === "expected"
                  ? fulfillmentTotals.expectedDate
                  : null;
              return {
                remainingQty: remaining,
                allocatedQty: allocated,
                shortQty: short,
                productionAllocatedQty: normalizeNumeric(
                  roundQuantity(fulfillmentTotals.productionAllocatedQty)
                ),
                availabilityState: salesItemsState,
                expectedDate: salesItemsExpectedDate,
                label: getAvailabilityLabel(
                  salesItemsState,
                  salesItemsExpectedDate
                ),
                salesItemsState,
                salesItemsExpectedDate,
                ingredientsState:
                  fulfillmentReadModel?.ingredientsState ?? "not_applicable",
                ingredientsExpectedDate:
                  fulfillmentReadModel?.ingredientsExpectedDate ?? null,
                ingredientShortages:
                  fulfillmentReadModel?.ingredientShortages.map(
                    serializeIngredientShortage
                  ) ?? [],
                productionState:
                  fulfillmentReadModel?.productionState ?? "not_applicable",
              };
            })(),
            hasManufacturableLines,
            manufacturableLineCount: manufacturingSummary?.manufacturableLineCount ?? 0,
            manufacturableDisabledReason:
              manufacturingSummary?.disabledReason ??
              "No manufacturable lines remain on this order.",
            openManufacturingOrderCount: openManufacturingOrders.length,
            linkedManufacturingOrders,
            openManufacturingOrders,
            shippingReadiness: buildShippingReadiness({
              status: order.status as SalesOrderListRow["status"],
              hasManufacturableLines,
              linkedManufacturingOrders: openManufacturingOrders,
              stockBlockers,
            }),
          };
        });
      });
    },
    {
      successData: (orders) => ({
        rowCount: orders.length,
      }),
    }
  );
}

export async function getOpenSalesProductItemIds(): Promise<string[]> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const rows = await tx
      .selectDistinct({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
      .innerJoin(items, eq(salesOrderLines.itemId, items.id))
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          eq(salesOrders.status, "open"),
          isNull(salesOrders.deletedAt),
          eq(items.itemType, "product"),
          sql`${salesOrderLines.quantity} > ${salesOrderLines.cancelledQuantity}`
        )
      );

    return rows.map((row) => row.itemId);
  });
}

export async function reorderSalesOrderPriorityRanks(
  payload: ReorderSalesOrderPriorityRanks
): Promise<{ updated: number }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await lockSalesPriorityQueueInTx(tx, orgId);

    const orders = await tx
      .select({
        id: salesOrders.id,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          inArray(salesOrders.id, payload.orderIds),
          isNull(salesOrders.deletedAt)
        )
      )
      .for("update");

    const rankedOpenOrders = await tx
      .select({
        id: salesOrders.id,
        priorityRank: salesOrders.priorityRank,
        orderNumber: salesOrders.orderNumber,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
          isNull(salesOrders.deletedAt)
        )
      )
      .orderBy(
        asc(sql`COALESCE(${salesOrders.priorityRank}, 2147483647)`),
        asc(salesOrders.orderNumber)
      )
      .for("update");

    assertSameStringSet(
      orders.map((order) => order.id),
      payload.orderIds,
      "Sales order ranking does not match active orders."
    );

    const submittedOpenIds = payload.orderIds.filter((id) => {
      const order = orders.find((candidate) => candidate.id === id);
      return order ? isOpenSalesOrderStatus(order.status) : false;
    });

    const orderedIds = mergeSubmittedOrderIds(
      rankedOpenOrders.map((order) => order.id),
      submittedOpenIds
    );

    const now = new Date();
    await tx
      .update(salesOrders)
      .set({
        priorityRank: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          inArray(salesOrders.status, [...OPEN_SALES_ORDER_STATUSES]),
          isNull(salesOrders.deletedAt)
        )
      );

    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(salesOrders)
        .set({
          priorityRank: index + 1,
          updatedAt: now,
        })
        .where(eq(salesOrders.id, id));
    }

    return { updated: orderedIds.length };
  });
}

export async function getSalesShippingQueue(): Promise<SalesShippingQueueRow[]> {
  const orders = await getSalesOrders();
  const queueCandidates = orders.filter((order) => order.status === "open");

  const details = await Promise.all(
    queueCandidates.map((order) => getSalesOrder(order.id))
  );

  return details.flatMap((order) => {
    if (!order) return [];
    if (order.status !== "open") {
      return [];
    }
    const openManufacturingOrders = order.linkedManufacturingOrders.filter(
      (manufacturingOrder) =>
        manufacturingOrder.status === "open"
    );

    return [
      {
        salesOrderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        status: order.status,
        deliveryDate: order.shipDate,
        requestedDate: order.shipDate,
        shipDate: order.shipDate,
        notes: order.notes,
        shipLine1: order.shipLine1,
        shipLine2: order.shipLine2,
        shipCity: order.shipCity,
        shipRegion: order.shipRegion,
        shipPostcode: order.shipPostcode,
        shipCountry: order.shipCountry,
        shippingReadiness: order.shippingReadiness,
        lines: order.lines,
        openManufacturingOrders,
      } satisfies SalesShippingQueueRow,
    ];
  });
}

export async function getSalesOrder(
  id: string,
  options?: { includeDeleted?: boolean; accountingProvider?: AccountingProvider }
): Promise<SalesOrderDetail | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const orderConditions = [eq(salesOrders.id, id)];
    if (!options?.includeDeleted) {
      orderConditions.push(isNull(salesOrders.deletedAt));
    }

    const [order] = await tx
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        customerEmail: customers.email,
        customerProjectId: salesOrders.customerProjectId,
        customerProjectName: customerProjects.name,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
        priorityRank: salesOrders.priorityRank,
        orderDate: salesOrders.orderDate,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        notes: salesOrders.notes,
        shippedAt: salesOrders.shippedAt,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
        billingLine1: salesOrders.billingLine1,
        billingLine2: salesOrders.billingLine2,
        billingCity: salesOrders.billingCity,
        billingRegion: salesOrders.billingRegion,
        billingPostcode: salesOrders.billingPostcode,
        billingCountry: salesOrders.billingCountry,
        shippingFeeDescription: salesOrders.shippingFeeDescription,
        shippingFeeAmount: trimScale(salesOrders.shippingFeeAmount).as("shippingFeeAmount"),
        shippingFeeTaxAmount: trimScale(salesOrders.shippingFeeTaxAmount).as("shippingFeeTaxAmount"),
        subtotalAmount: trimScale(salesOrders.subtotalAmount).as("subtotalAmount"),
        taxAmount: trimScale(salesOrders.taxAmount).as("taxAmount"),
        xeroInvoiceId: accountingDocumentSyncs.externalDocumentId,
        xeroInvoiceNumber: accountingDocumentSyncs.externalDocumentNumber,
        xeroPushStatus: accountingDocumentSyncs.pushStatus,
        xeroPushError: accountingDocumentSyncs.pushError,
        xeroPushedAt: accountingDocumentSyncs.pushedAt,
        xeroPushPayloadHash: accountingDocumentSyncs.pushPayloadHash,
        xeroLastPushAttemptAt: accountingDocumentSyncs.lastPushAttemptAt,
        xeroRetryCount: sql<number>`COALESCE(${accountingDocumentSyncs.retryCount}, 0)`,
        xeroEmailStatus: accountingDocumentSyncs.emailStatus,
        xeroEmailError: accountingDocumentSyncs.emailError,
        xeroEmailedAt: accountingDocumentSyncs.emailedAt,
        totalAmount: trimScale(salesOrders.totalAmount).as("totalAmount"),
        deletedAt: salesOrders.deletedAt,
        createdAt: salesOrders.createdAt,
        updatedAt: salesOrders.updatedAt,
      })
      .from(salesOrders)
      .leftJoin(customers, eq(salesOrders.customerId, customers.id))
      .leftJoin(
        customerProjects,
        and(
          eq(salesOrders.customerProjectId, customerProjects.id),
          isNull(customerProjects.deletedAt)
        )
      )
      .leftJoin(
        accountingDocumentSyncs,
        and(
          eq(
            accountingDocumentSyncs.provider,
            options?.accountingProvider ?? ACCOUNTING_PROVIDER_XERO
          ),
          eq(accountingDocumentSyncs.documentType, ACCOUNTING_DOCUMENT_SALES_ORDER),
          eq(accountingDocumentSyncs.documentId, salesOrders.id)
        )
      )
      .where(and(...orderConditions));

    if (!order) {
      return null;
    }

    const lineRows = await tx
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        unitName: salesOrderLines.unitName,
        quantity: trimScale(salesOrderLines.quantity).as("quantity"),
        shippedQuantity: trimScale(salesOrderLines.shippedQuantity).as(
          "shippedQuantity"
        ),
        cancelledQuantity: trimScale(salesOrderLines.cancelledQuantity).as(
          "cancelledQuantity"
        ),
        listUnitPrice: trimScaleNullable(salesOrderLines.listUnitPrice).as(
          "listUnitPrice"
        ),
        unitPrice: trimScale(salesOrderLines.unitPrice).as("unitPrice"),
        taxRateId: salesOrderLines.taxRateId,
        taxRateName: salesOrderLines.taxRateName,
        taxRatePercent: trimScale(salesOrderLines.taxRatePercent).as("taxRatePercent"),
        discountPercent: trimScale(salesOrderLines.discountPercent).as(
          "discountPercent"
        ),
        suggestedUnitPrice: trimScaleNullable(salesOrderLines.suggestedUnitPrice).as(
          "suggestedUnitPrice"
        ),
        pricingSourceType: salesOrderLines.pricingSourceType,
        pricingScheduleName: salesOrderLines.pricingScheduleName,
        pricingBreakLabel: salesOrderLines.pricingBreakLabel,
        isPriceOverridden: salesOrderLines.isPriceOverridden,
        lineSubtotal: trimScale(salesOrderLines.lineSubtotal).as("lineSubtotal"),
        lineTaxAmount: trimScale(salesOrderLines.lineTaxAmount).as("lineTaxAmount"),
        lineTotal: trimScale(salesOrderLines.lineTotal).as("lineTotal"),
        sortOrder: salesOrderLines.sortOrder,
        createdAt: salesOrderLines.createdAt,
        updatedAt: salesOrderLines.updatedAt,
        familyName: itemFamilies.name,
        onHandQty: trimScaleNullable(
          projectedOnHandQtyExpr(items.organizationId, items.id)
        ).as("onHandQty"),
        availableQty: availableQtySubquery,
        allocatedQty: sql<string>`'0'`.as("allocatedQty"),
        reservedQty: trimScale(sql`COALESCE((
          SELECT SUM(${inventoryReservationsSummary.quantity})
          FROM ${inventoryReservationsSummary}
          WHERE ${inventoryReservationsSummary.organizationId} = ${orgId}
            AND ${inventoryReservationsSummary.referenceType} = 'sales_order_line'
            AND ${inventoryReservationsSummary.referenceId} = ${salesOrderLines.id}
        ), 0)`).as("reservedQty"),
        potential: projectedPotentialQty(
          items.organizationId,
          items.id,
          items.itemType
        ).as("potential"),
      })
      .from(salesOrderLines)
      .leftJoin(items, eq(salesOrderLines.itemId, items.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(eq(salesOrderLines.salesOrderId, id))
      .orderBy(asc(salesOrderLines.sortOrder), asc(salesOrderLines.createdAt));

    const [estimatedUnitCosts, actualLineCosts, optionLabelsByItemId, taxSettings] =
      await Promise.all([
        getEstimatedUnitCostsByItemIdInTx(
          tx,
          lineRows.map((line) => line.itemId),
        ),
        getActualSalesLineCostsByLineIdInTx(tx, id),
        getSalesOptionLabelsByItemIdInTx(
          tx,
          lineRows.map((line) => line.itemId),
        ),
        getTaxSettingsInTx(tx, orgId),
      ]);

    const lines = lineRows.map(({ familyName, ...rest }) => {
      const optionLabels = optionLabelsByItemId.get(rest.itemId) ?? [];
      const display = {
        masterName: familyName ?? rest.itemName,
        attrs: optionLabels,
      };
      const estimatedUnitCost = estimatedUnitCosts.get(rest.itemId) ?? null;
      const estimatedMargin = calculateUnitMarginMetrics({
        quantity: rest.quantity,
        unitPrice: rest.unitPrice,
        unitCost: estimatedUnitCost,
      });
      const actualCost = actualLineCosts.get(rest.id) ?? null;
      const actualMargin = actualCost
          ? calculateMarginMetrics({
            revenue: rest.lineSubtotal,
            cogs: actualCost.cogs,
          })
        : null;
      const actualQuantity = actualCost ? Number.parseFloat(actualCost.quantity) : null;
      const actualCogs = actualCost ? Number.parseFloat(actualCost.cogs) : null;
      const actualUnitCost =
        actualQuantity != null &&
        actualCogs != null &&
        Number.isFinite(actualQuantity) &&
        Number.isFinite(actualCogs) &&
        actualQuantity > 0
          ? normalizeNumericScale(actualCogs / actualQuantity, 6)
          : null;

      return {
        ...rest,
        masterName: display.masterName,
        attrs: display.attrs,
        estimatedUnitCost,
        estimatedCogs: estimatedMargin?.cogs ?? null,
        estimatedGrossProfit: estimatedMargin?.grossProfit ?? null,
        estimatedMarginPercent: estimatedMargin?.marginPercent ?? null,
        actualUnitCost,
        actualCogs: actualMargin?.cogs ?? null,
        actualGrossProfit: actualMargin?.grossProfit ?? null,
        actualMarginPercent: actualMargin?.marginPercent ?? null,
      };
    });
    const shippedByLine = new Map<string, number>();
    const plannedByLine = new Map<string, number>();
    for (const line of lines) {
      shippedByLine.set(line.id, normalizeShipQuantity(Number(line.shippedQuantity ?? 0)));
    }
    const orderFreightRecovery = parseMoneyValue(order.shippingFeeAmount);
    const orderProductCogs = order.status === "done"
      ? lines.some((line) => line.actualCogs == null)
        ? null
        : lines.reduce((sum, line) => sum + parseMoneyValue(line.actualCogs), 0)
      : lines.some((line) => line.estimatedCogs == null)
        ? null
        : lines.reduce((sum, line) => sum + parseMoneyValue(line.estimatedCogs), 0);
    const orderMarginSummary = buildSalesMarginSummary({
      productRevenue: lines.reduce(
        (sum, line) => sum + parseMoneyValue(line.lineSubtotal),
        0
      ),
      freightRecovery: orderFreightRecovery,
      productCogs: orderProductCogs,
      fulfillmentCosts: 0,
      costStatus: orderProductCogs == null
        ? "unknown"
        : order.status === "done"
          ? "actual"
          : "estimated",
    });

    const linesWithFulfillment = lines.map((line) => {
      const shippedQuantity = shippedByLine.get(line.id) ?? 0;
      const plannedQuantity = plannedByLine.get(line.id) ?? 0;
      const cancelledQuantity = parseFloat(line.cancelledQuantity);
      const orderedQuantity = parseFloat(line.quantity);
      const remainingQuantity = normalizeShipQuantity(
        orderedQuantity - shippedQuantity - cancelledQuantity
      );
      const unplannedRemainingQuantity = normalizeShipQuantity(
        remainingQuantity - plannedQuantity
      );

      return {
        ...line,
        reservationAllocatedQty: line.allocatedQty,
        reservedQty: line.reservedQty,
        shippedQuantity: normalizeNumeric(shippedQuantity),
        plannedQuantity: normalizeNumeric(plannedQuantity),
        cancelledQuantity: normalizeNumeric(cancelledQuantity),
        remainingQuantity: normalizeNumeric(remainingQuantity),
        unplannedRemainingQuantity: normalizeNumeric(unplannedRemainingQuantity),
      };
    });
    const demandQueueCoverageByDemandKey =
      await getDemandQueueCoverageByDemandKeyForItemsInTx(tx, {
        organizationId: orgId,
        itemIds: linesWithFulfillment.map((line) => line.itemId),
        includeManufacturingDetail: false,
      });
    const demandQueueCoverageBySalesLineId = new Map(
      [...demandQueueCoverageByDemandKey.values()]
        .filter((coverage) => coverage.demandType === "sales_order_line")
        .map((coverage) => [coverage.demandId, coverage])
    );
    const linesWithAllocation = linesWithFulfillment.map((line) => {
      const demandQueueCoverage = demandQueueCoverageBySalesLineId.get(line.id);
      const allocation = demandQueueCoverageToSalesAllocationSummary({
        lineId: line.id,
        itemId: line.itemId,
        remainingQty: Number(line.remainingQuantity),
        coverage: demandQueueCoverage,
      });

      return {
        ...line,
        allocatedQty: allocation.allocatedQty,
        shortQty: allocation.shortQty,
        sourceSummary: allocation.sourceSummary,
        allocationStatus: allocation.status,
        allocationSources: allocation.sources,
        demandQueueQueueCoveredQty:
          demandQueueCoverage?.queueCoveredQty ?? "0",
        demandQueueSegments: demandQueueCoverage?.segments ?? [],
        demandQueueInStockQty: demandQueueCoverage?.inStockQty ?? "0",
        demandQueueExpectedQty: demandQueueCoverage?.expectedQty ?? "0",
        demandQueueShortQty:
          demandQueueCoverage?.shortQty ?? line.remainingQuantity,
        demandQueueExpectedDate: demandQueueCoverage?.latestExpectedDate ?? null,
      };
    });
    let fulfillmentSummary: SalesOrderFulfillmentSummary = (() => {
      const remainingQty = linesWithAllocation.reduce(
        (sum, line) => roundQuantity(sum + Number(line.remainingQuantity)),
        0
      );
      const allocatedQty = linesWithAllocation.reduce(
        (sum, line) =>
          roundQuantity(
            sum +
              Number(line.demandQueueInStockQty) +
              Number(line.demandQueueExpectedQty)
          ),
        0
      );
      const shortQty = linesWithAllocation.reduce(
        (sum, line) => roundQuantity(sum + Number(line.demandQueueShortQty)),
        0
      );
      const expectedQty = linesWithAllocation.reduce(
        (sum, line) => roundQuantity(sum + Number(line.demandQueueExpectedQty)),
        0
      );
      const expectedDate = linesWithAllocation.reduce<string | null>(
        (latest, line) =>
          Number(line.demandQueueExpectedQty) > 0
            ? latestExpectedDate(latest, line.demandQueueExpectedDate)
            : latest,
        null
      );
      const productionAllocatedQty = linesWithAllocation.reduce(
        (sum, line) =>
          roundQuantity(
            sum +
              line.allocationSources
                .filter((source) => source.sourceType === "manufacturing_order")
                .reduce((sourceSum, source) => sourceSum + Number(source.quantity), 0)
          ),
        0
      );
      const label =
        shortQty > 0
          ? "Short"
          : productionAllocatedQty > 0
            ? "Waiting production"
            : "Ready";
      const availabilityState: SalesOrderFulfillmentSummary["availabilityState"] =
        deriveDemandQueueSalesItemsState({ remainingQty, shortQty, expectedQty });

      return {
        remainingQty: normalizeNumeric(remainingQty),
        allocatedQty: normalizeNumeric(allocatedQty),
        shortQty: normalizeNumeric(shortQty),
        productionAllocatedQty: normalizeNumeric(productionAllocatedQty),
        availabilityState,
        expectedDate: availabilityState === "expected" ? expectedDate : null,
        label,
        salesItemsState: availabilityState,
        salesItemsExpectedDate: availabilityState === "expected" ? expectedDate : null,
        ingredientsState: "not_applicable",
        ingredientsExpectedDate: null,
        ingredientShortages: [],
        productionState: "not_applicable",
      };
    })();

    const manufacturingSummary = (
      await getSalesOrderManufacturingSummariesInTx(tx, [id])
    ).get(id);

    const linkedManufacturingOrders =
      (await getLinkedManufacturingOrdersBySalesOrderIdInTx(tx, [id])).get(id) ?? [];

    const hasManufacturableLines = manufacturingSummary?.hasManufacturableLines ?? false;
    const linkedManufacturingOrderRows = linkedManufacturingOrders.map(
      serializeLinkedManufacturingOrder
    );
    const fulfillmentReadModel = (
      await getSalesFulfillmentReadModelsInTx(
        tx,
        orgId,
        [
          {
            id,
            status: order.status,
            hasManufacturableLines,
            shortQty: Number(fulfillmentSummary.shortQty),
            productionAllocatedQty: Number(fulfillmentSummary.productionAllocatedQty),
            linkedManufacturingOrders,
            manufacturableLines: manufacturingSummary?.lines ?? [],
          },
        ],
        order.status === "open"
          ? linesWithAllocation.flatMap((line) => {
              const remainingQty = Number(line.remainingQuantity);
              if (!Number.isFinite(remainingQty) || remainingQty <= 0) return [];

              return [
                {
                  salesOrderId: id,
                  salesOrderLineId: line.id,
                  itemId: line.itemId,
                  requiredDate: order.shipDate,
                  quantity: remainingQty,
                  priorityRank: order.priorityRank,
                  orderDate: order.orderDate,
                  orderNumber: order.orderNumber,
                  sortOrder: line.sortOrder,
                } satisfies SalesFulfillmentDemandLine,
              ];
            })
          : []
      )
    ).get(id);
    const salesItemsState: SalesOrderFulfillmentSummary["salesItemsState"] =
      fulfillmentSummary.salesItemsState;
    const salesItemsExpectedDate =
      salesItemsState === "expected"
        ? fulfillmentSummary.salesItemsExpectedDate
        : null;
    fulfillmentSummary = {
      ...fulfillmentSummary,
      availabilityState: salesItemsState,
      expectedDate: salesItemsExpectedDate,
      label: getAvailabilityLabel(salesItemsState, salesItemsExpectedDate),
      salesItemsState,
      salesItemsExpectedDate,
      ingredientsState: fulfillmentReadModel?.ingredientsState ?? "not_applicable",
      ingredientsExpectedDate: fulfillmentReadModel?.ingredientsExpectedDate ?? null,
      ingredientShortages:
        fulfillmentReadModel?.ingredientShortages.map(
          serializeIngredientShortage
        ) ?? [],
      productionState: fulfillmentReadModel?.productionState ?? "not_applicable",
    };
    const manufacturingLinesByLineId = new Map(
      (manufacturingSummary?.lines ?? []).map((line) => [
        line.salesOrderLineId,
        line,
      ])
    );
    const lineFulfillmentDemandLines = linesWithAllocation.flatMap((line) => {
      const remainingQty = Number(line.remainingQuantity);
      if (
        order.status !== "open" ||
        !Number.isFinite(remainingQty) ||
        remainingQty <= 0
      ) {
        return [];
      }

      return [
        {
          salesOrderId: line.id,
          salesOrderLineId: line.id,
          itemId: line.itemId,
          requiredDate: order.shipDate,
          quantity: remainingQty,
          priorityRank: order.priorityRank,
          orderDate: order.orderDate,
          orderNumber: order.orderNumber,
          sortOrder: line.sortOrder,
        } satisfies SalesFulfillmentDemandLine,
      ];
    });
    const lineFulfillmentReadModels = await getSalesFulfillmentReadModelsInTx(
      tx,
      orgId,
      linesWithAllocation.map((line) => {
        const manufacturingLine = manufacturingLinesByLineId.get(line.id);
        const linkedLineManufacturingOrders = linkedManufacturingOrders.filter(
          (linkedOrder) => linkedOrder.salesOrderLineId === line.id
        );
        const productionAllocatedQty = line.allocationSources
          .filter((source) => source.sourceType === "manufacturing_order")
          .reduce((sum, source) => sum + Number(source.quantity), 0);

        return {
          id: line.id,
          status: order.status,
          hasManufacturableLines: manufacturingLine?.status === "will_create",
          shortQty: Number(line.demandQueueShortQty),
          productionAllocatedQty,
          linkedManufacturingOrders: linkedLineManufacturingOrders,
          manufacturableLines: manufacturingLine
            ? [
                {
                  ...manufacturingLine,
                  salesOrderId: line.id,
                },
              ]
            : [],
        };
      }),
      lineFulfillmentDemandLines
    );
    const lineFulfillmentSummariesByLineId = new Map<
      string,
      SalesOrderFulfillmentSummary
    >();
    for (const line of linesWithAllocation) {
      const readModel = lineFulfillmentReadModels.get(line.id);
      const remainingQty = Number(line.remainingQuantity);
      const allocatedQty = roundQuantity(
        Number(line.demandQueueInStockQty) + Number(line.demandQueueExpectedQty)
      );
      const shortQty = Number(line.demandQueueShortQty);
      const productionAllocatedQty = roundQuantity(
        line.allocationSources
          .filter((source) => source.sourceType === "manufacturing_order")
          .reduce((sum, source) => sum + Number(source.quantity), 0)
      );
      const lineSalesItemsState: SalesOrderFulfillmentSummary["salesItemsState"] =
        deriveDemandQueueSalesItemsState({
          remainingQty,
          shortQty,
          expectedQty: Number(line.demandQueueExpectedQty),
        });
      const lineSalesItemsExpectedDate =
        lineSalesItemsState === "expected"
          ? line.demandQueueExpectedDate
          : null;

      lineFulfillmentSummariesByLineId.set(line.id, {
        remainingQty: normalizeNumeric(roundQuantity(remainingQty)),
        allocatedQty: normalizeNumeric(allocatedQty),
        shortQty: normalizeNumeric(roundQuantity(shortQty)),
        productionAllocatedQty: normalizeNumeric(productionAllocatedQty),
        availabilityState: lineSalesItemsState,
        expectedDate: lineSalesItemsExpectedDate,
        label: getAvailabilityLabel(lineSalesItemsState, lineSalesItemsExpectedDate),
        salesItemsState: lineSalesItemsState,
        salesItemsExpectedDate: lineSalesItemsExpectedDate,
        ingredientsState: readModel?.ingredientsState ?? "not_applicable",
        ingredientsExpectedDate: readModel?.ingredientsExpectedDate ?? null,
        ingredientShortages:
          readModel?.ingredientShortages.map(serializeIngredientShortage) ?? [],
        productionState: readModel?.productionState ?? "not_applicable",
      });
    }
    const stockBlockers = linesWithAllocation.flatMap((line) => {
      const shortQty = Number(line.demandQueueShortQty);

      if (!Number.isFinite(shortQty) || shortQty <= 0) {
        return [];
      }

      const coveredQty = normalizeNumeric(
        roundQuantity(
          Number(line.demandQueueInStockQty) + Number(line.demandQueueExpectedQty)
        )
      );

      return [
        `${line.itemName} needs ${formatQuantity(line.remainingQuantity)} ${line.unitName}; ${formatQuantity(
          coveredQty
        )} ${line.unitName} covered`,
      ];
    });
    const linesWithLineFulfillment = linesWithAllocation.map((line) => ({
      ...line,
      fulfillmentSummary:
        lineFulfillmentSummariesByLineId.get(line.id) ?? fulfillmentSummary,
    })) as SalesOrderDetailLine[];
    const lotPickPlansByLineId = await getSalesLotPickPlansByLineInTx(
      tx,
      orgId,
      linesWithLineFulfillment
    );
    const linesWithLotGuidance = linesWithLineFulfillment.map((line) => ({
      ...line,
      lotPickPlan: lotPickPlansByLineId.get(line.id) ?? [],
    }));

    return {
      ...order,
      status: order.status as SalesOrderDetail["status"],
      xeroPushStatus: order.xeroPushStatus as SalesOrderDetail["xeroPushStatus"],
      xeroEmailStatus:
        order.xeroEmailStatus as SalesOrderDetail["xeroEmailStatus"],
      lines: linesWithLotGuidance as SalesOrderDetailLine[],
      taxRates: taxSettings.rates,
      defaultTaxRateId: taxSettings.defaultSalesTaxRateId,
      marginSummary: orderMarginSummary,
      hasManufacturableLines,
      manufacturableLineCount: manufacturingSummary?.manufacturableLineCount ?? 0,
      manufacturableDisabledReason:
        manufacturingSummary?.disabledReason ?? "No manufacturable lines remain on this order.",
      fulfillmentSummary,
      shippingReadiness: buildShippingReadiness({
        status: order.status as SalesOrderDetail["status"],
        hasManufacturableLines,
        linkedManufacturingOrders: linkedManufacturingOrderRows,
        stockBlockers,
      }),
      linkedManufacturingOrders: linkedManufacturingOrderRows,
    };
  });
}

export async function getEditableSalesOrder(id: string): Promise<SalesOrderEditData | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [order] = await tx
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        customerProjectId: salesOrders.customerProjectId,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
        orderDate: salesOrders.orderDate,
        shipDate: salesOrders.shipDate,
        requestedDate: salesOrders.requestedDate,
        notes: salesOrders.notes,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
        billingLine1: salesOrders.billingLine1,
        billingLine2: salesOrders.billingLine2,
        billingCity: salesOrders.billingCity,
        billingRegion: salesOrders.billingRegion,
        billingPostcode: salesOrders.billingPostcode,
        billingCountry: salesOrders.billingCountry,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.status, "open")
        )
      );

    if (!order) {
      return null;
    }

    const [lines, taxSettings] = await Promise.all([
      getOrderLinesInTx(tx, id),
      getTaxSettingsInTx(tx, orgId),
    ]);

    return {
      ...order,
      status: order.status as "open",
      lines: lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        listUnitPrice: line.listUnitPrice,
        unitPrice: line.unitPrice,
        taxRateId: line.taxRateId,
        discountPercent: line.discountPercent,
        suggestedUnitPrice: line.suggestedUnitPrice,
        pricingSourceType: (line.pricingSourceType ??
          "base_price") as PricingSourceType,
        pricingScheduleName: line.pricingScheduleName,
        pricingBreakLabel: line.pricingBreakLabel,
        isPriceOverridden: line.isPriceOverridden,
      })),
      taxRates: taxSettings.rates,
      defaultTaxRateId: taxSettings.defaultSalesTaxRateId,
    };
  });
}

export async function createSalesOrder(
  data: InsertSalesOrder,
  options?: { idempotencyKey?: string }
) {
  return withSalesTransactionRetry(() => withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string }>(tx, {
      organizationId: orgId,
      operationName: "createSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: data,
    });

    if (replay.replayed) {
      return replay.result;
    }

    const prepared = await prepareOrderPayload(tx, orgId, data);

    const orderNumber = await resolveSalesOrderNumberInTx(
      tx,
      orgId,
      data.orderNumber
    );
    const [order] = await tx
      .insert(salesOrders)
      .values({
        organizationId: orgId,
        orderNumber,
        customerId: prepared.customerId,
        customerProjectId: prepared.customerProjectId,
        customerName: prepared.customerName,
        status: "open",
        orderDate: prepared.orderDate,
        shipDate: prepared.shipDate,
        requestedDate: prepared.requestedDate,
        notes: prepared.notes,
        shipLine1: prepared.shipLine1,
        shipLine2: prepared.shipLine2,
        shipCity: prepared.shipCity,
        shipRegion: prepared.shipRegion,
        shipPostcode: prepared.shipPostcode,
        shipCountry: prepared.shipCountry,
        billingLine1: prepared.billingLine1,
        billingLine2: prepared.billingLine2,
        billingCity: prepared.billingCity,
        billingRegion: prepared.billingRegion,
        billingPostcode: prepared.billingPostcode,
        billingCountry: prepared.billingCountry,
        shippingFeeDescription: prepared.shippingFeeDescription,
        shippingFeeAmount: prepared.shippingFeeAmount,
        shippingFeeTaxAmount: prepared.shippingFeeTaxAmount,
        subtotalAmount: prepared.subtotalAmount,
        taxAmount: prepared.taxAmount,
        totalAmount: prepared.totalAmount,
      })
      .returning({ id: salesOrders.id });

    const insertedLines =
      prepared.preparedLines.length > 0
        ? await tx.insert(salesOrderLines).values(
            prepared.preparedLines.map((line) => ({
              salesOrderId: order.id,
              ...line,
            }))
          ).returning({
            salesOrderLineId: salesOrderLines.id,
            itemId: salesOrderLines.itemId,
            itemName: salesOrderLines.itemName,
            itemSku: salesOrderLines.itemSku,
            unitName: salesOrderLines.unitName,
            quantity: salesOrderLines.quantity,
            sortOrder: salesOrderLines.sortOrder,
          })
        : [];

    await reserveForSalesInTx(tx, {
      organizationId: orgId,
      salesOrderId: order.id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "create-open-order"
      ),
      lines: insertedLines.map((line) => ({
        salesOrderLineId: line.salesOrderLineId,
        itemId: line.itemId,
        quantity: parseFloat(line.quantity),
      })),
    });

    if (isOpenSalesOrderStatus(data.status)) {
      await rerankOpenSalesOrdersInTx(tx, orgId);
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: order,
    });

    return order;
  }));
}

export async function duplicateSalesOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  const order = await getSalesOrder(id);

  if (!order) {
    return null;
  }

  const orderNumber = await withAuthedOrgContext((tx, orgId) =>
    generateDuplicateSalesOrderNumberInTx(tx, orgId, order.orderNumber)
  );

  return createSalesOrder(
    {
      orderNumber,
      customerId: order.customerId,
      customerProjectId: order.customerProjectId,
      status: "open",
      orderDate: order.orderDate,
      shipDate: order.shipDate,
      requestedDate: null,
      notes: order.notes,
      shipLine1: order.shipLine1,
      shipLine2: order.shipLine2,
      shipCity: order.shipCity,
      shipRegion: order.shipRegion,
      shipPostcode: order.shipPostcode,
      shipCountry: order.shipCountry,
      billingLine1: order.billingLine1,
      billingLine2: order.billingLine2,
      billingCity: order.billingCity,
      billingRegion: order.billingRegion,
      billingPostcode: order.billingPostcode,
      billingCountry: order.billingCountry,
      shippingFeeDescription: order.shippingFeeDescription,
      shippingFeeAmount: order.shippingFeeAmount,
      shippingFeeTaxAmount: order.shippingFeeTaxAmount,
      lines: order.lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRateId: line.taxRateId,
      })),
      confirmOversell: true,
    },
    options
  );
}

export async function updateSalesOrder(
  id: string,
  data: UpdateSalesOrder,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "updateSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, data },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const existingOrder = await getLockedSalesOrderInTx(tx, id);

    if (!existingOrder) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    const existingLines = await getOrderLinesInTx(tx, id);

    if (existingOrder.status === "done") {
      throw new SalesError("Done orders cannot be changed.", 400);
    }

    await assertSalesOrderHasNoShippedLinesForEditInTx(tx, id);

    const prepared = await prepareOrderPayload(tx, orgId, data);

    if (isEditableOpenSalesOrderStatus(existingOrder.status)) {
      await lockItemsInTx(tx, [
        ...existingLines.map((line) => line.itemId),
        ...data.lines.map((line) => line.itemId),
      ]);

      await assertLinkedMtoSalesLinesUnchangedInTx(
        tx,
        id,
        prepared.preparedLines
      );

      await releaseReservationForSalesLineInTx(tx, {
        organizationId: orgId,
        salesOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "edit-open-order-release"
        ),
        reason: "edited",
        salesOrderLineIds: existingLines.map((line) => line.id),
      });
    }

    await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));

    const insertedLines =
      prepared.preparedLines.length > 0
        ? await tx.insert(salesOrderLines).values(
            prepared.preparedLines.map((line) => ({
              salesOrderId: id,
              ...line,
            }))
          ).returning({
            salesOrderLineId: salesOrderLines.id,
            itemId: salesOrderLines.itemId,
            itemName: salesOrderLines.itemName,
            itemSku: salesOrderLines.itemSku,
            unitName: salesOrderLines.unitName,
            quantity: salesOrderLines.quantity,
            sortOrder: salesOrderLines.sortOrder,
          })
        : [];

    await moveLinkedManufacturingOrdersToReplacementSalesLinesInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      idempotencyKey: options?.idempotencyKey ?? null,
      salesOrderId: id,
      insertedLines,
    });

    const orderNumber = await resolveSalesOrderNumberInTx(
      tx,
      orgId,
      data.orderNumber,
      { excludeId: id }
    );

    await tx
      .update(salesOrders)
      .set({
        orderNumber,
        customerId: prepared.customerId,
        customerProjectId: prepared.customerProjectId,
        customerName: prepared.customerName,
        status: "open",
        orderDate: prepared.orderDate,
        shipDate: prepared.shipDate,
        requestedDate: prepared.requestedDate,
        notes: prepared.notes,
        shipLine1: prepared.shipLine1,
        shipLine2: prepared.shipLine2,
        shipCity: prepared.shipCity,
        shipRegion: prepared.shipRegion,
        shipPostcode: prepared.shipPostcode,
        shipCountry: prepared.shipCountry,
        billingLine1: prepared.billingLine1,
        billingLine2: prepared.billingLine2,
        billingCity: prepared.billingCity,
        billingRegion: prepared.billingRegion,
        billingPostcode: prepared.billingPostcode,
        billingCountry: prepared.billingCountry,
        shippingFeeDescription: prepared.shippingFeeDescription,
        shippingFeeAmount: prepared.shippingFeeAmount,
        shippingFeeTaxAmount: prepared.shippingFeeTaxAmount,
        subtotalAmount: prepared.subtotalAmount,
        taxAmount: prepared.taxAmount,
        totalAmount: prepared.totalAmount,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, id));

    await reserveForSalesInTx(tx, {
      organizationId: orgId,
      salesOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "update-open-order"
      ),
      lines: insertedLines.map((line) => ({
        salesOrderLineId: line.salesOrderLineId,
        itemId: line.itemId,
        quantity: parseFloat(line.quantity),
      })),
    });

    const result = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export type BolSalesOrderData = {
  orderNumber: string;
  customerName: string;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  requestedDate: string | null;
  shippedAt: Date | null;
  notes: string | null;
  status: string;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  lines: Array<{
    itemName: string;
    itemSku: string | null;
    quantity: string;
    unitName: string;
  }>;
};

export async function getSalesOrderForBol(
  id: string
): Promise<BolSalesOrderData | null> {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .select({
        orderNumber: salesOrders.orderNumber,
        customerId: salesOrders.customerId,
        customerName: salesOrders.customerName,
        requestedDate: salesOrders.requestedDate,
        shippedAt: salesOrders.shippedAt,
        notes: salesOrders.notes,
        status: salesOrders.status,
        shipDate: salesOrders.shipDate,
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
      })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, id), isNull(salesOrders.deletedAt)));

    if (!order) return null;
    if (order.status !== "done") return null;

    const lines = await tx
      .select({
        itemName: salesOrderLines.itemName,
        itemSku: salesOrderLines.itemSku,
        quantity: trimScale(salesOrderLines.quantity).as("quantity"),
        unitName: salesOrderLines.unitName,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, id))
      .orderBy(asc(salesOrderLines.sortOrder));

    const shipAddress = {
      shipLine1: order.shipLine1,
      shipLine2: order.shipLine2,
      shipCity: order.shipCity,
      shipRegion: order.shipRegion,
      shipPostcode: order.shipPostcode,
      shipCountry: order.shipCountry,
    };
    const contact = await resolveBolContactInTx(tx, order.customerId);

    return {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      ...contact,
      requestedDate: null,
      shippedAt: order.shippedAt,
      notes: order.notes,
      status: order.status,
      ...shipAddress,
      lines,
    };
  });
}

async function buildStockWarningPayloadInTx(
  _tx: Tx,
  params: {
    organizationId: string;
    itemId: string;
    itemName: string;
    available: number;
    requested: number;
    excludeSalesOrderLineIds: string[];
  }
): Promise<NegativeStockWarningPayload> {
  const shortage = Math.max(0, params.requested - params.available);

  return {
    itemId: params.itemId,
    itemName: params.itemName,
    available: params.available,
    requested: params.requested,
    shortage,
    reason: "negative_stock",
    committedToOthers: 0,
    commitments: [],
  };
}

async function resolveDemandQueueCommitmentsInTx(
  tx: Tx,
  candidates: Array<{
    demandType: "sales_order_line" | "manufacturing_order_ingredient";
    demandId: string;
    label: string;
    contextLabel: string | null;
    quantity: number;
    href: string | null;
  }>
): Promise<NonNullable<NegativeStockWarningPayload["commitments"]>> {
  const salesDemandIds = candidates
    .filter((candidate) => candidate.demandType === "sales_order_line")
    .map((candidate) => candidate.demandId);
  const manufacturingDemandIds = candidates
    .filter((candidate) => candidate.demandType === "manufacturing_order_ingredient")
    .map((candidate) => candidate.demandId);

  const salesRows =
    salesDemandIds.length > 0
      ? await tx
          .select({
            demandId: salesOrderLines.id,
            orderId: salesOrders.id,
            orderNumber: salesOrders.orderNumber,
            customerName: salesOrders.customerName,
          })
          .from(salesOrderLines)
          .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
          .where(inArray(salesOrderLines.id, salesDemandIds))
      : [];
  const manufacturingRows =
    manufacturingDemandIds.length > 0
      ? await tx
          .select({
            demandId: manufacturingOrderIngredients.id,
            orderId: manufacturingOrders.id,
            orderNumber: manufacturingOrders.orderNumber,
            productName: manufacturingOrders.productName,
          })
          .from(manufacturingOrderIngredients)
          .innerJoin(
            manufacturingOrders,
            eq(manufacturingOrders.id, manufacturingOrderIngredients.manufacturingOrderId)
          )
          .where(inArray(manufacturingOrderIngredients.id, manufacturingDemandIds))
      : [];

  const salesByDemandId = new Map(salesRows.map((row) => [row.demandId, row]));
  const manufacturingByDemandId = new Map(
    manufacturingRows.map((row) => [row.demandId, row])
  );

  const commitments: NonNullable<NegativeStockWarningPayload["commitments"]> = [];
  for (const candidate of candidates) {
    if (candidate.demandType === "sales_order_line") {
      const row = salesByDemandId.get(candidate.demandId);
      if (!row) continue;
      commitments.push({
        referenceType: "sales_order",
        referenceId: row.orderId,
        label: `${row.orderNumber} ${row.customerName}`,
        quantity: candidate.quantity,
        href: `/sales/orders/${row.orderId}`,
      });
      continue;
    }

    const row = manufacturingByDemandId.get(candidate.demandId);
    if (!row) continue;
    commitments.push({
      referenceType: "manufacturing_order",
      referenceId: row.orderId,
      label: `${row.orderNumber} ${row.productName}`,
      quantity: candidate.quantity,
      href: `/manufacturing/orders/${row.orderId}`,
    });
  }

  return commitments;
}

async function buildDemandQueueShippingWarningInTx(
  tx: Tx,
  params: {
    organizationId: string;
    lines: Array<{
      salesOrderLineId: string;
      itemId: string;
      itemName: string;
      quantity: number;
    }>;
  }
): Promise<NegativeStockWarningPayload | null> {
  const coverageByItem = new Map(
    (
      await getDemandQueueCoverageForItemsInTx(tx, {
        organizationId: params.organizationId,
        itemIds: params.lines.map((line) => line.itemId),
        includeManufacturingDetail: true,
      })
    ).map((coverage) => [coverage.itemId, coverage])
  );

  for (const line of params.lines) {
    const itemCoverage = coverageByItem.get(line.itemId);
    const lineCoverage = itemCoverage?.demands.find(
      (demand) =>
        demandQueueCoverageKey(demand) ===
        demandQueueCoverageKey({
          demandType: "sales_order_line",
          demandId: line.salesOrderLineId,
        })
    );
    const available = roundQuantity(Number(lineCoverage?.inStockQty ?? 0));
    if (available >= line.quantity) continue;

    const commitmentCandidates = getDemandQueueInventoryLotClaimConflicts({
      coverage: itemCoverage,
      excludeDemand: {
        demandType: "sales_order_line",
        demandId: line.salesOrderLineId,
      },
      quantity: roundQuantity(line.quantity - available),
    });
    const commitments = await resolveDemandQueueCommitmentsInTx(
      tx,
      commitmentCandidates
    );
    const committedToOthers = roundQuantity(
      commitments.reduce((sum, commitment) => sum + commitment.quantity, 0)
    );
    const shortage = roundQuantity(line.quantity - available);
    const reason =
      committedToOthers <= 0
        ? "negative_stock"
        : committedToOthers >= shortage
          ? "commitment_conflict"
          : "commitment_and_negative_stock";

    return {
      itemId: line.itemId,
      itemName: line.itemName,
      available,
      requested: line.quantity,
      shortage,
      reason,
      committedToOthers,
      commitments: commitments.slice(0, 5),
    };
  }

  return null;
}

export async function shipSalesOrder(
  id: string,
  options?: {
    idempotencyKey?: string;
  } & ShipSalesOrder
) {
  if (options?.completeLinkedManufacturing === true) {
    await completeLinkedManufacturingForFullOrderShip(id, options);
  }

  const result = await withSalesTransactionRetry(() => withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{
      id: string;
      status: string;
    } | null>(tx, {
      organizationId: orgId,
      operationName: "shipSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: {
        id,
        syncAccounting: options?.syncAccounting ?? true,
        confirmNegativeStock: options?.confirmNegativeStock ?? false,
        completeLinkedManufacturing: options?.completeLinkedManufacturing ?? false,
        lines: options?.lines ?? null,
      },
    });

    if (replay.replayed) {
      return {
        replayed: true as const,
        shipped: replay.result,
        orgId,
      };
    }

    const order = await getLockedSalesOrderInTx(tx, id);

    if (!order) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return {
        replayed: false as const,
        shipped: null,
        orgId,
      };
    }

    if (order.status === "done") {
      throw new SalesError("Order is already shipped.", 400);
    }

    if (order.status !== "open") {
      throw new SalesError("Only open orders can be shipped.", 400);
    }

    const lines = await getOrderLinesInTx(tx, id);
    const states = await getSalesOrderLineShipStatesInTx(tx, id);
    const orderLinesById = new Map(lines.map((line) => [line.id, line]));
    const linesToShip = (() => {
      if (options?.lines) {
        return options.lines.map((input) => {
          const state = states.get(input.salesOrderLineId);
          const orderLine = orderLinesById.get(input.salesOrderLineId);
          if (!state || !orderLine) {
            throw new SalesError("Sales order line not found.", 404, {
              errors: { lines: ["Sales order line not found."] },
            });
          }
          const quantity = normalizeShipQuantity(Number(input.quantity));
          const remaining = remainingToShip(state);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new SalesError("Quantity must be greater than 0.", 400, {
              errors: { lines: ["Quantity must be greater than 0."] },
            });
          }
          if (quantity > remaining) {
            throw new SalesError("Cannot ship more than the remaining quantity.", 400, {
              errors: { lines: ["Cannot ship more than the remaining quantity."] },
            });
          }
          return {
            salesOrderLineId: state.id,
            itemId: state.itemId,
            itemName: state.itemName,
            itemSku: state.itemSku,
            unitName: state.unitName,
            sortOrder: state.sortOrder,
            quantity,
          };
        });
      }

      return [...states.values()].flatMap((state) => {
        const quantity = remainingToShip(state);
        if (quantity <= 0) return [];
        return [
          {
            salesOrderLineId: state.id,
            itemId: state.itemId,
            itemName: state.itemName,
            itemSku: state.itemSku,
            unitName: state.unitName,
            sortOrder: state.sortOrder,
            quantity,
          },
        ];
      });
    })();

    if (linesToShip.length === 0) {
      throw new SalesError("No remaining quantity to ship.", 400);
    }

    if (options?.confirmNegativeStock !== true) {
      const warning = await buildDemandQueueShippingWarningInTx(tx, {
        organizationId: orgId,
        lines: linesToShip.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          itemId: line.itemId,
          itemName: line.itemName,
          quantity: line.quantity,
        })),
      });
      if (warning) {
        throw new SalesError(
          `Cannot ship order. Insufficient stock for ${warning.itemName}.`,
          409,
          { negativeStock: warning }
        );
      }
    }

    const shippedAt = new Date();

    try {
      await consumeForSalesOrderShippingInTx(tx, {
        organizationId: orgId,
        salesOrderId: id,
        actorUserId: userId,
        idempotencyKey: deriveInventoryIdempotencyKey(
          options?.idempotencyKey,
          "ship-order"
        ),
        shippedAt,
        allowNegativeStock: options?.confirmNegativeStock === true,
        lines: linesToShip.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          itemId: line.itemId,
          quantity: line.quantity,
        })),
      });
    } catch (error) {
      if (error instanceof LinkedManufacturingOutputUnavailableError) {
        const blockingLine = linesToShip.find((line) => line.itemId === error.itemId);
        throw new SalesError(
          `Cannot ship order. Linked make-to-order output is not available for ${blockingLine?.itemName ?? "one item"}.`,
          409
        );
      }

      if (error instanceof InsufficientStockError) {
        const blockingLine = linesToShip.find((line) => line.itemId === error.itemId);
        const warning = await buildStockWarningPayloadInTx(tx, {
          organizationId: orgId,
          itemId: error.itemId,
          itemName: blockingLine?.itemName ?? "one item",
          available: error.available,
          requested: error.requested,
          excludeSalesOrderLineIds: linesToShip.map((line) => line.salesOrderLineId),
        });
        throw new SalesError(
          `Cannot ship order. Insufficient stock for ${blockingLine?.itemName ?? "one item"}.`,
          409,
          {
            negativeStock: warning,
          }
        );
      }

      throw error;
    }

    for (const line of linesToShip) {
      await tx
        .update(salesOrderLines)
        .set({
          shippedQuantity: sql`${salesOrderLines.shippedQuantity} + ${normalizeNumeric(line.quantity)}`,
          updatedAt: shippedAt,
        })
        .where(eq(salesOrderLines.id, line.salesOrderLineId));
    }

    const [currentOrder] = await tx
      .select({
        shipLine1: salesOrders.shipLine1,
        shipLine2: salesOrders.shipLine2,
        shipCity: salesOrders.shipCity,
        shipRegion: salesOrders.shipRegion,
        shipPostcode: salesOrders.shipPostcode,
        shipCountry: salesOrders.shipCountry,
        customerId: salesOrders.customerId,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, id));

    const orderHasShipAddress =
      currentOrder &&
      (currentOrder.shipLine1 != null ||
        currentOrder.shipLine2 != null ||
        currentOrder.shipCity != null ||
        currentOrder.shipRegion != null ||
        currentOrder.shipPostcode != null ||
        currentOrder.shipCountry != null);

    let shipLine1 = currentOrder?.shipLine1 ?? null;
    let shipLine2 = currentOrder?.shipLine2 ?? null;
    let shipCity = currentOrder?.shipCity ?? null;
    let shipRegion = currentOrder?.shipRegion ?? null;
    let shipPostcode = currentOrder?.shipPostcode ?? null;
    let shipCountry = currentOrder?.shipCountry ?? null;

    if (!orderHasShipAddress && currentOrder) {
      const [customer] = await tx
        .select({
          shipLine1: customers.shipLine1,
          shipLine2: customers.shipLine2,
          shipCity: customers.shipCity,
          shipRegion: customers.shipRegion,
          shipPostcode: customers.shipPostcode,
          shipCountry: customers.shipCountry,
          billingLine1: customers.billingLine1,
          billingLine2: customers.billingLine2,
          billingCity: customers.billingCity,
          billingRegion: customers.billingRegion,
          billingPostcode: customers.billingPostcode,
          billingCountry: customers.billingCountry,
        })
        .from(customers)
        .where(eq(customers.id, currentOrder.customerId));

      if (customer) {
        const customerHasShip =
          customer.shipLine1 != null ||
          customer.shipLine2 != null ||
          customer.shipCity != null ||
          customer.shipRegion != null ||
          customer.shipPostcode != null ||
          customer.shipCountry != null;

        if (customerHasShip) {
          shipLine1 = customer.shipLine1;
          shipLine2 = customer.shipLine2;
          shipCity = customer.shipCity;
          shipRegion = customer.shipRegion;
          shipPostcode = customer.shipPostcode;
          shipCountry = customer.shipCountry;
        } else {
          shipLine1 = customer.billingLine1;
          shipLine2 = customer.billingLine2;
          shipCity = customer.billingCity;
          shipRegion = customer.billingRegion;
          shipPostcode = customer.billingPostcode;
          shipCountry = customer.billingCountry;
        }
      }
    }

    const finalStates = await getSalesOrderLineShipStatesInTx(tx, id);
    const allClosed = [...finalStates.values()].every(
      (line) => remainingToShip(line) <= 0
    );
    const [shipped] = await tx
      .update(salesOrders)
      .set({
        status: allClosed ? "done" : "open",
        ...(allClosed ? { priorityRank: null } : {}),
        shippedAt: allClosed ? shippedAt : null,
        shipLine1,
        shipLine2,
        shipCity,
        shipRegion,
        shipPostcode,
        shipCountry,
        updatedAt: shippedAt,
      })
      .where(eq(salesOrders.id, id))
      .returning({ id: salesOrders.id, status: salesOrders.status });

    if (allClosed) {
      await rerankOpenSalesOrdersInTx(tx, orgId);
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: shipped,
    });

    return {
      replayed: false as const,
      shipped,
      orgId,
    };
  }));

  if (!result || !result.shipped) {
    return null;
  }

  if (result.replayed) {
    return result.shipped;
  }

  if (options?.syncAccounting === false || result.shipped.status !== "done") {
    return result.shipped;
  }

  const { getXeroAutomationSettingsForOrg } = await import("@/lib/dal/xero");
  const automation = await getXeroAutomationSettingsForOrg(result.orgId);
  if (!automation?.autoPushSalesInvoices) {
    return result.shipped;
  }

  // Stock tx has committed. Attempt the Xero push; a failure must NOT roll
  // back the ship — the order is shipped regardless of accounting state.
  const { pushSalesOrderToXero, markXeroPushFailed } = await import(
    "@/lib/xero/push-invoice"
  );
  const { XeroError } = await import("@/lib/xero/errors");

  try {
    await pushSalesOrderToXero(result.orgId, id);
  } catch (error) {
    if (
      error instanceof XeroError &&
      (error.message.includes("not connected") ||
        error.status === 409 ||
        error.status === 500)
    ) {
      // Xero isn't set up for this org — leave push_status null rather than
      // flagging a failure that the user can't act on.
      if (!error.message.includes("not connected")) {
        await markXeroPushFailed(result.orgId, id, error);
      }
    } else {
      await markXeroPushFailed(result.orgId, id, error);
    }
  }

  return result.shipped;
}

async function completeLinkedManufacturingForFullOrderShip(
  salesOrderId: string,
  options: ShipSalesOrder & { idempotencyKey?: string }
) {
  if (options.lines != null) {
    throw new SalesError(
      "Linked manufacturing can only be completed automatically when shipping the full order.",
      400
    );
  }

  const linkedRows = await withAuthedOrgContext(async (tx, orgId) => {
    return await tx
      .select({
        id: manufacturingOrders.id,
        plannedQuantity: trimScale(manufacturingOrders.plannedQuantity).as(
          "plannedQuantity"
        ),
        outputQuantity: trimScale(
          sql`COALESCE(SUM(${manufacturingOrderOutputs.quantity}), 0)`
        ).as("outputQuantity"),
      })
      .from(manufacturingOrders)
      .leftJoin(
        manufacturingOrderOutputs,
        eq(manufacturingOrderOutputs.manufacturingOrderId, manufacturingOrders.id)
      )
      .where(
        and(
          eq(manufacturingOrders.organizationId, orgId),
          eq(manufacturingOrders.salesOrderId, salesOrderId),
          eq(manufacturingOrders.status, "open"),
          isNull(manufacturingOrders.deletedAt)
        )
      )
      .groupBy(manufacturingOrders.id);
  });

  for (const row of linkedRows) {
    const plannedQuantity = Number(row.plannedQuantity);
    const outputQuantity = Number(row.outputQuantity);
    const remainingOutputQuantity = normalizeQuantityNumber(
      plannedQuantity - outputQuantity
    );

    try {
      if (remainingOutputQuantity > 0) {
        if (outputQuantity > 0) {
          await recordManufacturingOutput(
            row.id,
            {
              quantity: normalizeNumeric(remainingOutputQuantity),
              outputDisposition: "available",
              notes: null,
              confirmNegativeStock: options.confirmNegativeStock,
            },
            {
              idempotencyKey:
                deriveInventoryIdempotencyKey(
                  options.idempotencyKey,
                  `complete-linked-manufacturing-output:${row.id}`
                ) ?? undefined,
            }
          );
          await completeManufacturingOrder(
            row.id,
            {
              outputDisposition: "available",
              ingredientActuals: [],
              confirmNegativeStock: options.confirmNegativeStock,
            },
            {
              idempotencyKey:
                deriveInventoryIdempotencyKey(
                  options.idempotencyKey,
                  `complete-linked-manufacturing:${row.id}`
                ) ?? undefined,
              ingredientTrackedLotDefault: "unbatched",
            }
          );
        } else {
          await completeManufacturingOrder(
            row.id,
            {
              actualQuantity: row.plannedQuantity,
              outputDisposition: "available",
              ingredientActuals: [],
              confirmNegativeStock: options.confirmNegativeStock,
            },
            {
              idempotencyKey:
                deriveInventoryIdempotencyKey(
                  options.idempotencyKey,
                  `complete-linked-manufacturing:${row.id}`
                ) ?? undefined,
              ingredientTrackedLotDefault: "unbatched",
            }
          );
        }
      } else {
        await completeManufacturingOrder(
          row.id,
          {
            outputDisposition: "available",
            ingredientActuals: [],
            confirmNegativeStock: options.confirmNegativeStock,
          },
          {
            idempotencyKey:
              deriveInventoryIdempotencyKey(
                options.idempotencyKey,
                `complete-linked-manufacturing:${row.id}`
              ) ?? undefined,
            ingredientTrackedLotDefault: "unbatched",
          }
        );
      }
    } catch (error) {
      if (error instanceof ManufacturingError) {
        throw new SalesError(error.message, error.status);
      }
      throw error;
    }
  }
}

export async function getXeroOnlineInvoiceUrlForSalesOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { getOnlineInvoiceUrlForOrder } = await import("@/lib/xero/push-invoice");
    return { url: await getOnlineInvoiceUrlForOrder(orgId, id) };
  });
}

export async function retryXeroPushForSalesOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { pushSalesOrderToXero, markXeroPushFailed } = await import(
      "@/lib/xero/push-invoice"
    );
    const { XeroError } = await import("@/lib/xero/errors");

    try {
      const result = await pushSalesOrderToXero(orgId, id);
      return { ok: true as const, result };
    } catch (error) {
      if (
        error instanceof XeroError &&
        (error.status === 400 || error.status === 404 || error.status === 409)
      ) {
        throw error;
      }

      await markXeroPushFailed(orgId, id, error);
      throw error;
    }
  });
}

export async function retryAccountingPushForSalesOrder(id: string) {
  return withAuthedOrgContext(async (_tx, orgId) => {
    const { getActiveAccountingProviderForOrg } = await import(
      "@/lib/dal/accounting"
    );
    const active = await getActiveAccountingProviderForOrg(orgId);
    if (active.status === "none") {
      const { DomainError } = await import("@/lib/errors/domain-error");
      throw new DomainError("Connect an accounting provider before sending invoices.", 409);
    }
    if (active.status === "conflict") {
      const { DomainError } = await import("@/lib/errors/domain-error");
      throw new DomainError(
        "Disconnect either Xero or QuickBooks before sending invoices.",
        409
      );
    }

    if (active.provider === "quickbooks") {
      const {
        pushSalesOrderToQuickBooks,
        markQuickBooksInvoicePushFailed,
      } = await import(
        "@/lib/accounting/providers/quickbooks/push-invoice"
      );
      const { QuickBooksError } = await import(
        "@/lib/accounting/providers/quickbooks/client"
      );

      try {
        const result = await pushSalesOrderToQuickBooks(orgId, id);
        return { ok: true as const, provider: active.provider, result };
      } catch (error) {
        if (
          error instanceof QuickBooksError &&
          (error.status === 400 || error.status === 404 || error.status === 409)
        ) {
          throw error;
        }
        await markQuickBooksInvoicePushFailed(orgId, id, error);
        throw error;
      }
    }

    const result = await retryXeroPushForSalesOrder(id);
    return { ...result, provider: active.provider };
  });
}

export async function confirmSalesOrder(
  id: string,
  flags:
    | boolean
    | {
        confirmOversell?: boolean;
      } = false,
  options?: { idempotencyKey?: string }
): Promise<{ id: string } | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ id: string } | null>(tx, {
      organizationId: orgId,
      operationName: "confirmSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, confirmOversell: typeof flags === "boolean" ? flags : flags.confirmOversell === true },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const existingOrder = await getLockedSalesOrderInTx(tx, id);
    if (!existingOrder) {
      const result = null;
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

    const result = { id };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function bulkConfirmSalesOrders(
  payload: BulkConfirmSalesOrders,
  options?: { idempotencyKey?: string }
): Promise<{ confirmedCount: number }> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ confirmedCount: number }>(tx, {
      organizationId: orgId,
      operationName: "bulkConfirmSalesOrders",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload,
    });

    if (replay.replayed) {
      return replay.result;
    }

    const result = { confirmedCount: payload.ids.length };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

/**
 * Per-field header patch for the inline-edit flow on the Calm Matrix Sales
 * Order page. Touches only the salesOrders row, never lines or inventory kernel
 * state. For full-document edits, use {@link updateSalesOrder}.
 */
export async function patchSalesOrderHeader(
  id: string,
  patch: PatchSalesOrderHeader,
  options?: { idempotencyKey?: string }
) {
  const result = await withAuthedOrgContext(async (tx, orgId) => {
    const replay = await beginInventoryOperationInTx<{ ok: true } | null>(tx, {
      organizationId: orgId,
      operationName: "patchSalesOrderHeader",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id, patch },
    });
    if (replay.replayed) {
      return replay.result === null ? null : { ok: true };
    }

    const existingOrder = await getLockedSalesOrderInTx(tx, id);
    if (!existingOrder) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }
    const nextCustomerId = patch.customerId ?? existingOrder.customerId;
    const customer = await getValidatedCustomerInTx(tx, nextCustomerId);
    const nextCustomerProjectId =
      patch.customerProjectId !== undefined
        ? patch.customerProjectId
        : patch.customerId && patch.customerId !== existingOrder.customerId
          ? null
          : existingOrder.customerProjectId;
    await getValidatedCustomerProjectInTx(tx, customer.id, nextCustomerProjectId);

    const updates: Record<string, unknown> = {};
    if (patch.orderNumber !== undefined) {
      updates.orderNumber = await resolveSalesOrderNumberInTx(
        tx,
        orgId,
        patch.orderNumber,
        { excludeId: id }
      );
    }
    if (patch.customerId != null) {
      updates.customerId = customer.id;
      updates.customerName = customer.name;
    }
    if (patch.customerProjectId !== undefined || patch.customerId != null) {
      updates.customerProjectId = nextCustomerProjectId;
    }
    if (patch.orderDate != null) updates.orderDate = patch.orderDate;
    if (patch.shipDate !== undefined) updates.shipDate = patch.shipDate;
    if (patch.notes !== undefined) updates.notes = patch.notes;
    if (patch.shipLine1 !== undefined) updates.shipLine1 = patch.shipLine1;
    if (patch.shipLine2 !== undefined) updates.shipLine2 = patch.shipLine2;
    if (patch.shipCity !== undefined) updates.shipCity = patch.shipCity;
    if (patch.shipRegion !== undefined) updates.shipRegion = patch.shipRegion;
    if (patch.shipPostcode !== undefined) updates.shipPostcode = patch.shipPostcode;
    if (patch.shipCountry !== undefined) updates.shipCountry = patch.shipCountry;
    if (patch.billingLine1 !== undefined) updates.billingLine1 = patch.billingLine1;
    if (patch.billingLine2 !== undefined) updates.billingLine2 = patch.billingLine2;
    if (patch.billingCity !== undefined) updates.billingCity = patch.billingCity;
    if (patch.billingRegion !== undefined) updates.billingRegion = patch.billingRegion;
    if (patch.billingPostcode !== undefined) {
      updates.billingPostcode = patch.billingPostcode;
    }
    if (patch.billingCountry !== undefined) updates.billingCountry = patch.billingCountry;
    if (patch.shippingFeeDescription !== undefined) {
      updates.shippingFeeDescription = patch.shippingFeeDescription;
    }
    if (patch.shippingFeeAmount !== undefined) {
      updates.shippingFeeAmount = patch.shippingFeeAmount ?? "0";
    }
    if (patch.shippingFeeTaxAmount !== undefined) {
      updates.shippingFeeTaxAmount = patch.shippingFeeTaxAmount ?? "0";
    }
    if (
      patch.shippingFeeAmount !== undefined ||
      patch.shippingFeeTaxAmount !== undefined
    ) {
      const lineTotals = await tx
        .select({
          subtotal: sql<string>`COALESCE(SUM(${salesOrderLines.lineSubtotal}), 0)`,
          tax: sql<string>`COALESCE(SUM(${salesOrderLines.lineTaxAmount}), 0)`,
        })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.salesOrderId, id));
      const nextShippingFee =
        patch.shippingFeeAmount !== undefined
          ? Number(patch.shippingFeeAmount ?? 0)
          : Number(existingOrder.shippingFeeAmount ?? 0);
      const nextShippingTax =
        patch.shippingFeeTaxAmount !== undefined
          ? Number(patch.shippingFeeTaxAmount ?? 0)
          : Number(existingOrder.shippingFeeTaxAmount ?? 0);
      updates.subtotalAmount = normalizeMoney(
        Number(lineTotals[0]?.subtotal ?? 0) + nextShippingFee
      );
      updates.taxAmount = normalizeMoney(
        Number(lineTotals[0]?.tax ?? 0) + nextShippingTax
      );
      updates.totalAmount = normalizeMoney(
        Number(updates.subtotalAmount) + Number(updates.taxAmount)
      );
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await tx
        .update(salesOrders)
        .set(updates)
        .where(eq(salesOrders.id, id));
    }

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: { ok: true },
    });

    return { ok: true };
  });
  return result === null ? null : await getSalesOrder(id);
}

/**
 * Per-line patch for inline-edit cells. This keeps the existing line id stable
 * while still going through pricing validation and inventory-kernel
 * demand/reservation deltas for quantity changes. Use {@link updateSalesOrder}
 * via PUT for structural changes (item swap, line add/remove/reorder).
 */
export async function patchSalesOrderLine(
  orderId: string,
  lineId: string,
  patch: PatchSalesOrderLine,
  options?: { idempotencyKey?: string }
) {
  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ ok: true } | null>(tx, {
      organizationId: orgId,
      operationName: "patchSalesOrderLine",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { orderId, lineId, patch },
    });
    if (replay.replayed) {
      return replay.result === null ? null : { ok: true };
    }

    const existingOrder = await getLockedSalesOrderInTx(tx, orderId);
    if (!existingOrder) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }
    if (existingOrder.status === "done") {
      throw new SalesError("Done orders cannot be changed.", 400);
    }

    const [existingLine] = await tx
      .select({
        id: salesOrderLines.id,
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
        listUnitPrice: salesOrderLines.listUnitPrice,
        unitPrice: salesOrderLines.unitPrice,
        taxRateId: salesOrderLines.taxRateId,
        taxRatePercent: salesOrderLines.taxRatePercent,
        discountPercent: salesOrderLines.discountPercent,
        suggestedUnitPrice: salesOrderLines.suggestedUnitPrice,
        pricingSourceType: salesOrderLines.pricingSourceType,
        pricingScheduleName: salesOrderLines.pricingScheduleName,
        pricingBreakLabel: salesOrderLines.pricingBreakLabel,
        isPriceOverridden: salesOrderLines.isPriceOverridden,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.id, lineId),
          eq(salesOrderLines.salesOrderId, orderId)
        )
      )
      .for("update");
    if (!existingLine) {
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result: null,
      });
      return null;
    }

    const nextQuantity = patch.quantity ?? existingLine.quantity;
    const nextUnitPrice = patch.unitPrice ?? existingLine.unitPrice;
    const taxRate =
      patch.taxRateId === undefined
        ? null
        : patch.taxRateId
          ? (await getTaxRatesByIdInTx(tx, [patch.taxRateId])).get(patch.taxRateId) ?? null
          : null;
    if (patch.taxRateId && !taxRate) {
      throw new SalesError("Tax rate not found", 404);
    }
    const nextTaxRateId =
      patch.taxRateId === undefined ? existingLine.taxRateId : taxRate?.id ?? null;
    const nextTaxRateName =
      patch.taxRateId === undefined ? undefined : taxRate?.name ?? null;
    const nextTaxRatePercent =
      patch.taxRateId === undefined
        ? existingLine.taxRatePercent
        : taxRate?.ratePercent ?? "0";
    const nextQuantityNumber = parseFloat(nextQuantity);
    const currentQuantityNumber = parseFloat(existingLine.quantity);

    if (
      patch.quantity != null &&
      nextQuantityNumber < Number(existingLine.cancelledQuantity)
    ) {
      throw new SalesError(
        "Quantity cannot be less than cancelled quantity.",
        400
      );
    }

    if (patch.quantity != null) {
      await assertSalesOrderLineQuantityEditableInTx(
        tx,
        lineId,
        nextQuantityNumber,
        currentQuantityNumber
      );

      const lineState = (await getSalesOrderLineShipStatesInTx(tx, orderId)).get(lineId);
      if (!lineState) {
        await finishInventoryOperationInTx(tx, {
          organizationId: orgId,
          idempotencyKey: options?.idempotencyKey ?? null,
          result: null,
        });
        return null;
      }
      const minimumQuantity = normalizeShipQuantity(
        lineState.shippedQuantity +
          lineState.cancelledQuantity
      );
      if (nextQuantityNumber < minimumQuantity) {
        throw new SalesError(
          "Quantity cannot be less than shipped or cancelled quantity.",
          400,
          {
            errors: {
              quantity: [`Must be ${normalizeNumeric(minimumQuantity)} or greater`],
            },
          }
        );
      }
    }

    await lockItemsInTx(tx, [existingLine.itemId]);
    const normalizedUnitPrice = normalizeMoney(Number(nextUnitPrice));
    const {
      lineSubtotal: nextLineSubtotal,
      lineTaxAmount: nextLineTaxAmount,
      lineTotal: nextLineTotal,
    } = calculateSalesLineAmounts({
      quantity: nextQuantityNumber,
      unitPrice: nextUnitPrice,
      taxRatePercent: nextTaxRatePercent,
    });
    let listUnitPrice =
      existingLine.listUnitPrice == null
        ? null
        : normalizeMoney(Number(existingLine.listUnitPrice));
    if (patch.unitPrice != null && listUnitPrice == null) {
      const item = (await getValidatedSalesItemsInTx(tx, [existingLine.itemId])).get(
        existingLine.itemId
      );
      if (!item) {
        throw new SalesError("Item not found", 404);
      }
      listUnitPrice =
        normalizeOptionalLineMoney(item.defaultSellingPrice) ??
        normalizeMoney(Number(existingLine.unitPrice));
    }
    const nextDiscountPercent =
      patch.unitPrice != null
        ? calculateDiscountPercentString(listUnitPrice, normalizedUnitPrice)
        : existingLine.discountPercent;

    const updates: Record<string, unknown> = {
      taxRateId: nextTaxRateId,
      taxRatePercent: nextTaxRatePercent,
      lineSubtotal: nextLineSubtotal,
      lineTaxAmount: nextLineTaxAmount,
      lineTotal: nextLineTotal,
      discountPercent: nextDiscountPercent,
      suggestedUnitPrice: existingLine.suggestedUnitPrice,
      pricingSourceType: existingLine.pricingSourceType,
      pricingScheduleName: existingLine.pricingScheduleName,
      pricingBreakLabel: existingLine.pricingBreakLabel,
      isPriceOverridden:
        patch.unitPrice != null
          ? existingLine.suggestedUnitPrice != null &&
            normalizedUnitPrice !== normalizeMoney(Number(existingLine.suggestedUnitPrice))
          : existingLine.isPriceOverridden,
      updatedAt: new Date(),
    };
    if (patch.taxRateId !== undefined) updates.taxRateName = nextTaxRateName;
    if (patch.quantity != null) updates.quantity = patch.quantity;
    if (patch.unitPrice != null) updates.unitPrice = normalizedUnitPrice;
    if (patch.unitPrice != null && existingLine.listUnitPrice == null) {
      updates.listUnitPrice = listUnitPrice;
    }

    await tx
      .update(salesOrderLines)
      .set(updates)
      .where(eq(salesOrderLines.id, lineId));

    if (patch.quantity != null) {
      const quantityDelta = roundQuantity(nextQuantityNumber - currentQuantityNumber);
      if (quantityDelta > 0) {
        await recordSalesDemandAndReservationsInTx(tx, {
          organizationId: orgId,
          salesOrderId: orderId,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "patch-line-quantity-increase"
          ),
          demandLines: [
            {
              salesOrderLineId: lineId,
              itemId: existingLine.itemId,
              quantity: quantityDelta,
            },
          ],
          reservationLines: [
            {
              salesOrderLineId: lineId,
              itemId: existingLine.itemId,
              quantity: quantityDelta,
            },
          ],
        });
      } else if (quantityDelta < 0) {
        await releaseReservationForSalesQuantitiesInTx(tx, {
          organizationId: orgId,
          salesOrderId: orderId,
          actorUserId: userId,
          idempotencyKey: deriveInventoryIdempotencyKey(
            options?.idempotencyKey,
            "patch-line-quantity-decrease"
          ),
          reason: "edited",
          lines: [
            {
              salesOrderLineId: lineId,
              itemId: existingLine.itemId,
              quantity: Math.abs(quantityDelta),
            },
          ],
        });
      }
    }

    // Refresh order totals from canonical line totals.
    const allLines = await tx
      .select({
        lineSubtotal: salesOrderLines.lineSubtotal,
        lineTaxAmount: salesOrderLines.lineTaxAmount,
        lineTotal: salesOrderLines.lineTotal,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    const total = allLines.reduce(
      (sum, line) => sum + Number(line.lineTotal),
      0
    );
    await tx
      .update(salesOrders)
      .set({
        subtotalAmount: normalizeMoney(
          allLines.reduce((sum, line) => sum + Number(line.lineSubtotal), 0) +
            Number(existingOrder.shippingFeeAmount ?? 0)
        ),
        taxAmount: normalizeMoney(
          allLines.reduce((sum, line) => sum + Number(line.lineTaxAmount), 0) +
            Number(existingOrder.shippingFeeTaxAmount ?? 0)
        ),
        totalAmount: normalizeMoney(
          total +
            Number(existingOrder.shippingFeeAmount ?? 0) +
            Number(existingOrder.shippingFeeTaxAmount ?? 0)
        ),
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, orderId));

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result: { ok: true },
    });

    return { ok: true };
  });
  return result === null ? null : await getSalesOrder(orderId);
}


export async function deleteSalesOrder(
  id: string,
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ deleted: boolean }>(tx, {
      organizationId: orgId,
      operationName: "deleteSalesOrder",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { id },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const order = await getLockedSalesOrderInTx(tx, id);

    if (!order) {
      const result = { deleted: false };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
	      return result;
	    }

    const blocker = await getSalesOrderDeleteBlockerInTx(tx, [id]);
    if (blocker) {
      throw new SalesError(blocker, 400);
    }

    const existingLines = await getOrderLinesInTx(tx, id);
    const existingLineIds = existingLines.map((line) => line.id);
    const linkedManufacturingError = await deleteSalesLinkedManufacturingOrdersInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      salesOrderIds: [id],
      salesOrderLineIds: existingLineIds,
    });

    if (linkedManufacturingError) {
      throw new SalesError(linkedManufacturingError, 400);
    }

    const deletedAt = new Date();

    await tx
      .update(salesOrders)
      .set({
        priorityRank: null,
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(eq(salesOrders.id, id));

	    await releaseReservationForSalesLineInTx(tx, {
      organizationId: orgId,
      salesOrderId: id,
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "delete-order"
      ),
      reason: "deleted",
	      salesOrderLineIds: existingLineIds,
	    });

    if (isOpenSalesOrderStatus(order.status)) {
      await rerankOpenSalesOrdersInTx(tx, orgId);
    }

    const result = { deleted: true };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}

export async function deleteSalesOrders(
  ids: string[],
  options?: { idempotencyKey?: string }
) {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const replay = await beginInventoryOperationInTx<{ deletedCount: number }>(tx, {
      organizationId: orgId,
      operationName: "deleteSalesOrders",
      idempotencyKey: options?.idempotencyKey ?? null,
      payload: { ids: [...new Set(ids)].sort() },
    });

    if (replay.replayed) {
      return replay.result;
    }

    const uniqueIds = [...new Set(ids)];

	    const orders = await tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(
        and(
          inArray(salesOrders.id, uniqueIds),
          isNull(salesOrders.deletedAt)
        )
      )
      .for("update");

    if (orders.length === 0) {
      const result = { deletedCount: 0 };
      await finishInventoryOperationInTx(tx, {
        organizationId: orgId,
        idempotencyKey: options?.idempotencyKey ?? null,
        result,
      });
      return result;
    }

	    const orderIds = orders.map((o) => o.id);
    const blocker = await getSalesOrderDeleteBlockerInTx(tx, orderIds);
    if (blocker) {
      throw new SalesError(blocker, 400);
    }

    const lines = await tx
      .select({ id: salesOrderLines.id })
	      .from(salesOrderLines)
	      .where(inArray(salesOrderLines.salesOrderId, orderIds));
    const lineIds = lines.map((line) => line.id);
    const linkedManufacturingError = await deleteSalesLinkedManufacturingOrdersInTx(tx, {
      organizationId: orgId,
      actorUserId: userId,
      salesOrderIds: orderIds,
      salesOrderLineIds: lineIds,
    });

    if (linkedManufacturingError) {
      throw new SalesError(linkedManufacturingError, 400);
    }
	    const deletedAt = new Date();

	    await tx
      .update(salesOrders)
      .set({ priorityRank: null, deletedAt, updatedAt: deletedAt })
      .where(inArray(salesOrders.id, orderIds));

    await releaseReservationForSalesLineInTx(tx, {
      organizationId: orgId,
      salesOrderId: orderIds.join(","),
      actorUserId: userId,
      idempotencyKey: deriveInventoryIdempotencyKey(
        options?.idempotencyKey,
        "bulk-delete-orders"
      ),
      reason: "deleted",
	      salesOrderLineIds: lineIds,
	    });

    if (orders.some((order) => isOpenSalesOrderStatus(order.status))) {
      await rerankOpenSalesOrdersInTx(tx, orgId);
    }

    const result = { deletedCount: orders.length };

    await finishInventoryOperationInTx(tx, {
      organizationId: orgId,
      idempotencyKey: options?.idempotencyKey ?? null,
      result,
    });

    return result;
  });
}
