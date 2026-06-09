import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  bomRevisionComponentConstraints,
  bomRevisionComponents,
  bomRevisions,
  inventoryLotBalances,
  itemFamilies,
  itemVariantValues,
  items,
  manufacturingOrderBatches,
  manufacturingOrderIngredients,
  manufacturingOrders,
  purchaseOrderLines,
  purchaseOrders,
  organization,
  supplierItems,
  salesOrderLines,
  salesOrders,
  suppliers,
  unitDefinitions,
  variantOptions,
  variantOptionValues,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";
import { documentNumberSortSql } from "@/lib/document-numbers";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import {
  projectedCommittedQty,
  projectedExpectedQty,
  projectedOnHandQty,
} from "@/lib/inventory/kernel";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import { dateInTimeZone, normalizeNumeric, roundQuantity } from "@/lib/format";
import { calculateIngredientPlannedQuantity, normalizeRecipeBasis } from "@/lib/manufacturing/consumption";
import {
  LOT_AGE_MIN_DAYS_CONSTRAINT,
  toPlanningComponentRequirement,
  type BomComponentConstraint,
} from "@/lib/bom/constraints";
import type {
  BomRequirementFact,
  BomComponentRequirement,
  DemandFact,
  DaysOfCoverStatus,
  InventoryFact,
  PlanningItemRow,
  PlanningRecommendation,
  PlanningReasonCode,
  PlanningRuleSource,
  PlanningSnapshot,
  PlanningSourceRef,
  PlanningWarning,
  ProductionDemandPath,
  ProductionBlockerFact,
  ProductionBucket,
  SupplyFact,
} from "./types";

const MAX_BOM_EXPLOSION_LEVEL = 8;
const DEFAULT_COVER_HORIZON_DAYS = 90;
const REPLENISHMENT_SOON_MULTIPLIER = 1.2;

async function getPlanningOptionValuesByItemIdInTx(tx: Tx, itemIds: string[]) {
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

type PlanningItemRecord = {
  id: string;
  name: string;
  displayName: string;
  displayAttrs: string[];
  sku: string | null;
  itemType: string;
  unitName: string | null;
  unitSize: string | null;
  unitUom: string | null;
  safetyStock: string;
  onHandQuantity: string;
  reservedQuantity: string;
  expectedQuantity: string;
  defaultPurchasePrice: string | null;
  purchaseUnitDefinitionId: string | null;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
};

type BomComponentRecord = {
  id: string;
  componentId: string;
  componentName: string;
  componentSku: string | null;
  componentItemType: string;
  unitName: string;
  quantity: string;
  sortOrder: number;
  requirements: BomComponentRequirement[];
};

type CurrentBomRecord = {
  revisionId: string;
  revisionNumber: number;
  recipeBasis: "unit" | "batch";
  outputQuantity: string;
  components: BomComponentRecord[];
};

type SupplierSuggestion = {
  supplierId: string | null;
  supplierName: string | null;
  supplierSku: string | null;
  supplierSource: PlanningRuleSource;
  unitCost: string | null;
  unitCostSource: PlanningRuleSource;
  purchaseUnitDefinitionId: string | null;
  purchaseUnitName: string | null;
  purchaseToStockFactor: string | null;
  purchaseRuleSource: PlanningRuleSource;
  reasonCodes: PlanningReasonCode[];
};

type InternalDemandFact = DemandFact & {
  explosionPath: string[];
};

type DemandSliceOrigin =
  | {
      type: "sales_order";
      salesOrderId: string;
      salesOrderLineId: string;
      salesOrderLabel: string;
      customerName: string | null;
      terminalItemId: string;
    }
  | { type: "safety_stock" }
  | { type: "open_mo"; manufacturingOrderId: string };

type DemandSliceStep = {
  itemId: string;
  quantityRequired: number;
};

type DemandSlice = {
  id: string;
  itemId: string;
  quantity: number;
  requiredDate: string | null;
  origin: DemandSliceOrigin;
  chain: DemandSliceStep[];
  explosionPath: string[];
  requirements: BomComponentRequirement[];
};

type SupplySlice = {
  id: string;
  itemId: string;
  supplyType: SupplyFact["supplyType"];
  quantity: number;
  expectedDate: string | null;
  receivedDate: string | null;
  isLotSupply: boolean;
};

type QuantityBuckets = {
  demandQuantity: number;
  incomingPurchaseOrderQuantity: number;
  incomingManufacturingOrderQuantity: number;
};

type AvailableLotFact = {
  itemId: string;
  lotId: string;
  quantity: number;
  receivedDate: string;
};

function toQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQuantity(value: number) {
  return normalizeNumeric(roundQuantity(value));
}

function positiveQuantity(value: number) {
  return Math.max(0, roundQuantity(value));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function daysBetween(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  return Math.max(
    0,
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000)
  );
}

async function getAvailableLotFactsInTx(
  tx: Tx,
  orgId: string,
  locationId: string
): Promise<AvailableLotFact[]> {
  const rows = await tx
    .select({
      itemId: inventoryLotBalances.itemId,
      lotId: inventoryLotBalances.lotId,
      quantity: trimScale(inventoryLotBalances.quantity).as("quantity"),
      receivedAt: inventoryLotBalances.receivedAt,
    })
    .from(inventoryLotBalances)
    .innerJoin(items, eq(items.id, inventoryLotBalances.itemId))
    .innerJoin(itemFamilies, eq(itemFamilies.id, items.familyId))
    .where(
      and(
        eq(inventoryLotBalances.organizationId, orgId),
        eq(inventoryLotBalances.locationId, locationId),
        eq(itemFamilies.lotTrackingMode, "tracked"),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    );

  return rows.map((row) => ({
    itemId: row.itemId,
    lotId: row.lotId,
    quantity: toQuantity(row.quantity),
    receivedDate: isoDate(row.receivedAt),
  })).sort((left, right) => {
    const receivedCompare = left.receivedDate.localeCompare(right.receivedDate);
    return receivedCompare !== 0
      ? receivedCompare
      : left.lotId.localeCompare(right.lotId);
  });
}

function productionBucketForDate(
  value: string | null,
  horizonStart: string
): ProductionBucket {
  if (!value) return "later";
  const days = daysBetween(horizonStart, value);
  if (value <= horizonStart) return "now";
  if (days <= 7) return "this-week";
  if (days <= 14) return "next-week";
  return "later";
}

function sourceRefKey(ref: PlanningSourceRef) {
  return [
    ref.sourceType,
    ref.sourceId,
    ref.itemId ?? "",
    ref.quantity ?? "",
    ref.date ?? "",
    ref.parentSourceId ?? "",
  ].join(":");
}

function uniqueSourceRefs(refs: PlanningSourceRef[]) {
  const byKey = new Map<string, PlanningSourceRef>();
  for (const ref of refs) {
    byKey.set(sourceRefKey(ref), ref);
  }

  return [...byKey.values()].sort((left, right) =>
    sourceRefKey(left).localeCompare(sourceRefKey(right))
  );
}

function uniqueReasonCodes(codes: PlanningReasonCode[]) {
  return [...new Set(codes)].sort();
}

function earliestDate(values: Array<string | null | undefined>) {
  const dates = values.filter((value): value is string => Boolean(value));
  if (dates.length === 0) {
    return null;
  }

  return dates.sort()[0];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function hashValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function buildRecommendationId(args: {
  recommendationType: PlanningRecommendation["recommendationType"];
  itemId: string;
  quantity: string;
  sourceRefs: PlanningSourceRef[];
}) {
  const digest = hashValue({
    recommendationType: args.recommendationType,
    itemId: args.itemId,
    quantity: args.quantity,
    sourceRefs: uniqueSourceRefs(args.sourceRefs),
  }).slice(0, 20);

  return `planning_${digest}`;
}

function itemRef(item: Pick<PlanningItemRecord, "id" | "name">): PlanningSourceRef {
  return {
    sourceType: "item",
    sourceId: item.id,
    itemId: item.id,
    label: item.name,
  };
}

function planningPathStep(
  item: PlanningItemRecord,
  quantityRequired: number
): ProductionDemandPath["steps"][number] {
  return {
    itemId: item.id,
    itemName: item.name,
    displayName: item.displayName,
    displayAttrs: item.displayAttrs,
    sku: item.sku,
    unitName: item.unitName,
    quantityRequired: normalizeQuantity(quantityRequired),
  };
}

function splitSalesOrderLabel(label: string) {
  const [orderNumber, ...customerParts] = label.split(" · ");
  const customerName = customerParts.join(" · ").trim();

  return {
    salesOrderLabel: label,
    customerName: customerName || null,
    orderNumber,
  };
}

function buildInitialDemandSlices(
  demandFacts: InternalDemandFact[],
  itemById: Map<string, PlanningItemRecord>
) {
  const slices: DemandSlice[] = [];

  for (const fact of demandFacts) {
    const quantity = toQuantity(fact.quantity);
    const item = itemById.get(fact.itemId);
    if (!item || quantity <= 0) {
      continue;
    }

    const chain = [{ itemId: fact.itemId, quantityRequired: quantity }];

    if (fact.demandType === "sales_order") {
      const salesOrderRef = fact.sourceRefs.find(
        (ref) => ref.sourceType === "sales_order"
      );
      const salesOrderLineRef = fact.sourceRefs.find(
        (ref) => ref.sourceType === "sales_order_line"
      );

      if (!salesOrderRef || !salesOrderLineRef) {
        continue;
      }

      const { salesOrderLabel, customerName } = splitSalesOrderLabel(
        salesOrderRef.label
      );

      slices.push({
        id: `slice:sales:${salesOrderLineRef.sourceId}`,
        itemId: fact.itemId,
        quantity,
        requiredDate: fact.requiredDate,
        origin: {
          type: "sales_order",
          salesOrderId: salesOrderRef.sourceId,
          salesOrderLineId: salesOrderLineRef.sourceId,
          salesOrderLabel,
          customerName,
          terminalItemId: fact.itemId,
        },
        chain,
        explosionPath: [fact.itemId],
        requirements: [],
      });
      continue;
    }

    if (fact.demandType === "manufacturing_component") {
      const manufacturingRef = fact.sourceRefs.find(
        (ref) => ref.sourceType === "manufacturing_order"
      );

      if (!manufacturingRef) {
        continue;
      }

      slices.push({
        id: `slice:open-mo:${fact.id}`,
        itemId: fact.itemId,
        quantity,
        requiredDate: fact.requiredDate,
        origin: {
          type: "open_mo",
          manufacturingOrderId: manufacturingRef.sourceId,
        },
        chain,
        explosionPath: fact.explosionPath,
        requirements: [],
      });
      continue;
    }

    if (fact.demandType === "safety_stock") {
      slices.push({
        id: `slice:safety:${fact.itemId}`,
        itemId: fact.itemId,
        quantity,
        requiredDate: fact.requiredDate,
        origin: { type: "safety_stock" },
        chain,
        explosionPath: [fact.itemId],
        requirements: [],
      });
    }
  }

  return slices;
}

function demandDateSortValue(value: string | null) {
  return value ?? "9999-12-31";
}

function demandOriginSortValue(origin: DemandSliceOrigin) {
  if (origin.type === "sales_order") return 0;
  if (origin.type === "open_mo") return 1;
  return 2;
}

function compareDemandSlices(left: DemandSlice, right: DemandSlice) {
  const dateSort = demandDateSortValue(left.requiredDate).localeCompare(
    demandDateSortValue(right.requiredDate)
  );
  if (dateSort !== 0) return dateSort;

  const originSort =
    demandOriginSortValue(left.origin) - demandOriginSortValue(right.origin);
  if (originSort !== 0) return originSort;

  return left.id.localeCompare(right.id);
}

function compareSupplySlices(left: SupplySlice, right: SupplySlice) {
  if (left.supplyType === "available_inventory" && right.supplyType !== "available_inventory") {
    return -1;
  }

  if (left.supplyType !== "available_inventory" && right.supplyType === "available_inventory") {
    return 1;
  }

  const dateSort = demandDateSortValue(left.expectedDate).localeCompare(
    demandDateSortValue(right.expectedDate)
  );
  if (dateSort !== 0) return dateSort;

  return left.id.localeCompare(right.id);
}

function supplyCanCoverDemand(supply: SupplySlice, demand: DemandSlice) {
  const lotAgeRequirement = demand.requirements.find(
    (requirement) => requirement.requirementType === LOT_AGE_MIN_DAYS_CONSTRAINT
  );

  if (lotAgeRequirement) {
    if (!demand.requiredDate) {
      return false;
    }

    if (supply.supplyType === "available_inventory") {
      if (!supply.isLotSupply || !supply.receivedDate) return false;
      return addDays(supply.receivedDate, lotAgeRequirement.days) <= demand.requiredDate;
    }

    if (!supply.expectedDate) return false;
    return addDays(supply.expectedDate, lotAgeRequirement.days) <= demand.requiredDate;
  }

  if (supply.supplyType === "available_inventory") {
    return true;
  }

  if (demand.requiredDate == null) {
    return true;
  }

  if (supply.expectedDate == null) {
    return false;
  }

  return supply.expectedDate <= demand.requiredDate;
}

function buildSupplySlices(
  supplyFacts: SupplyFact[],
  availableLots: AvailableLotFact[] = []
) {
  const itemIdsWithLotSupply = new Set(
    availableLots.filter((lot) => lot.quantity > 0).map((lot) => lot.itemId)
  );

  return [
    ...supplyFacts
      .filter(
        (fact) =>
          fact.supplyType !== "available_inventory" ||
          !itemIdsWithLotSupply.has(fact.itemId)
      )
      .map((fact) => ({
        id: fact.id,
        itemId: fact.itemId,
        supplyType: fact.supplyType,
        quantity: toQuantity(fact.quantity),
        expectedDate: fact.expectedDate,
        receivedDate: null,
        isLotSupply: false,
      }))
      .filter((fact) => fact.quantity > 0),
    ...availableLots
      .map((lot) => ({
        id: `supply:available-lot:${lot.lotId}`,
        itemId: lot.itemId,
        supplyType: "available_inventory" as const,
        quantity: lot.quantity,
        expectedDate: null,
        receivedDate: lot.receivedDate,
        isLotSupply: true,
      }))
      .filter((fact) => fact.quantity > 0),
  ];
}

function allocateUncoveredDemandSlices(
  demandSlices: DemandSlice[],
  supplyFacts: SupplyFact[],
  availableLots: AvailableLotFact[] = []
) {
  const suppliesByItem = new Map<string, SupplySlice[]>();
  for (const supply of buildSupplySlices(supplyFacts, availableLots)) {
    const bucket = suppliesByItem.get(supply.itemId) ?? [];
    bucket.push(supply);
    suppliesByItem.set(supply.itemId, bucket);
  }

  for (const supplies of suppliesByItem.values()) {
    supplies.sort(compareSupplySlices);
  }

  const demandsByItem = new Map<string, DemandSlice[]>();
  for (const slice of demandSlices) {
    const bucket = demandsByItem.get(slice.itemId) ?? [];
    bucket.push(slice);
    demandsByItem.set(slice.itemId, bucket);
  }

  const uncovered: DemandSlice[] = [];
  for (const [itemId, itemDemands] of demandsByItem) {
    const supplies = (suppliesByItem.get(itemId) ?? []).map((supply) => ({
      ...supply,
    }));

    for (const demand of [...itemDemands].sort(compareDemandSlices)) {
      let remainingDemand = demand.quantity;

      for (const supply of supplies) {
        if (remainingDemand <= 0) {
          break;
        }

        if (supply.quantity <= 0 || !supplyCanCoverDemand(supply, demand)) {
          continue;
        }

        const consumed = Math.min(remainingDemand, supply.quantity);
        remainingDemand = roundQuantity(remainingDemand - consumed);
        supply.quantity = roundQuantity(supply.quantity - consumed);
      }

      if (remainingDemand > 0) {
        uncovered.push({
          ...demand,
          quantity: remainingDemand,
          chain: demand.chain.map((step, index) =>
            index === 0
              ? { ...step, quantityRequired: remainingDemand }
              : step
          ),
        });
      }
    }
  }

  return uncovered.sort(compareDemandSlices);
}

function buildSlicePathKey(slice: DemandSlice) {
  const terminalItemId =
    slice.origin.type === "sales_order" ? slice.origin.terminalItemId : "";

  return [
    slice.itemId,
    slice.origin.type === "sales_order" ? slice.origin.salesOrderLineId : "",
    terminalItemId,
    slice.chain.map((step) => step.itemId).join(">"),
    slice.requiredDate ?? "",
  ].join("|");
}

function coalesceSalesOrderProductionDemandPaths(
  slices: DemandSlice[],
  itemById: Map<string, PlanningItemRecord>
) {
  type CoalescedPath = {
    slice: DemandSlice;
    quantity: number;
    chainQuantities: number[];
  };

  const coalesced = new Map<string, CoalescedPath>();

  for (const slice of slices) {
    if (slice.origin.type !== "sales_order" || slice.chain.length <= 1) {
      continue;
    }

    const cardItem = itemById.get(slice.itemId);
    const terminalItem = itemById.get(slice.origin.terminalItemId);
    if (!cardItem || !terminalItem || cardItem.itemType !== "product") {
      continue;
    }

    const key = buildSlicePathKey(slice);
    const existing = coalesced.get(key);
    if (!existing) {
      coalesced.set(key, {
        slice,
        quantity: slice.quantity,
        chainQuantities: slice.chain.map((step) => step.quantityRequired),
      });
      continue;
    }

    existing.quantity = roundQuantity(existing.quantity + slice.quantity);
    existing.chainQuantities = existing.chainQuantities.map((quantity, index) =>
      roundQuantity(quantity + (slice.chain[index]?.quantityRequired ?? 0))
    );
  }

  const paths: ProductionDemandPath[] = [];
  for (const [key, entry] of coalesced) {
    const { slice } = entry;
    if (slice.origin.type !== "sales_order") {
      continue;
    }

    const terminalItem = itemById.get(slice.origin.terminalItemId);
    if (!terminalItem) {
      continue;
    }

    const steps = slice.chain.flatMap((step, index) => {
      const item = itemById.get(step.itemId);
      if (!item) return [];

      return [
        planningPathStep(item, entry.chainQuantities[index] ?? step.quantityRequired),
      ];
    });

    paths.push({
      id: `production_demand_path_${hashValue({ key }).slice(0, 20)}`,
      itemId: slice.itemId,
      uncoveredQuantity: normalizeQuantity(entry.quantity),
      requiredDate: slice.requiredDate,
      steps,
      terminal: {
        itemId: terminalItem.id,
        itemName: terminalItem.name,
        displayName: terminalItem.displayName,
        displayAttrs: terminalItem.displayAttrs,
        sku: terminalItem.sku,
        requiredDate: slice.requiredDate,
        salesOrderId: slice.origin.salesOrderId,
        salesOrderLineId: slice.origin.salesOrderLineId,
        salesOrderLabel: slice.origin.salesOrderLabel,
        customerName: slice.origin.customerName,
      },
    });
  }

  return paths.sort((left, right) => {
    const dateSort = demandDateSortValue(left.requiredDate).localeCompare(
      demandDateSortValue(right.requiredDate)
    );
    if (dateSort !== 0) return dateSort;

    const orderSort = left.terminal.salesOrderLabel.localeCompare(
      right.terminal.salesOrderLabel
    );
    if (orderSort !== 0) return orderSort;

    const itemSort = left.terminal.displayName.localeCompare(
      right.terminal.displayName
    );
    if (itemSort !== 0) return itemSort;

    return left.id.localeCompare(right.id);
  });
}

function buildSalesOrderProductionDemandPaths(args: {
  itemsList: PlanningItemRecord[];
  baseDemandFacts: InternalDemandFact[];
  supplyFacts: SupplyFact[];
  bomByProductId: Map<string, CurrentBomRecord>;
  availableLots: AvailableLotFact[];
}) {
  const itemById = new Map(args.itemsList.map((item) => [item.id, item]));
  const slices = buildInitialDemandSlices(args.baseDemandFacts, itemById);
  const explodedSliceIds = new Set<string>();

  for (let level = 1; level <= MAX_BOM_EXPLOSION_LEVEL; level += 1) {
    const uncovered = allocateUncoveredDemandSlices(
      slices,
      args.supplyFacts,
      args.availableLots
    );
    let addedSlices = 0;

    for (const slice of uncovered) {
      if (explodedSliceIds.has(slice.id)) {
        continue;
      }

      const parentItem = itemById.get(slice.itemId);
      const bom = args.bomByProductId.get(slice.itemId);
      if (!parentItem || parentItem.itemType !== "product" || !bom) {
        continue;
      }

      explodedSliceIds.add(slice.id);
      if (bom.components.length === 0) {
        continue;
      }

      for (const component of bom.components) {
        if (slice.explosionPath.includes(component.componentId)) {
          continue;
        }

        const componentQuantity = computeBomComponentQuantity(
          bom,
          component,
          slice.quantity
        );
        if (componentQuantity <= 0) {
          continue;
        }

        slices.push({
          id: [
            "slice",
            "bom",
            level,
            slice.id,
            component.componentId,
          ].join(":"),
          itemId: component.componentId,
          quantity: componentQuantity,
          requiredDate: slice.requiredDate,
          origin: slice.origin,
          chain: [
            { itemId: component.componentId, quantityRequired: componentQuantity },
            ...slice.chain,
          ],
          explosionPath: [...slice.explosionPath, component.componentId],
          requirements: component.requirements,
        });
        addedSlices += 1;
      }
    }

    if (addedSlices === 0) {
      break;
    }
  }

  const uncovered = allocateUncoveredDemandSlices(
    slices,
    args.supplyFacts,
    args.availableLots
  );
  return coalesceSalesOrderProductionDemandPaths(uncovered, itemById);
}

function salesOrderLineSourceId(fact: DemandFact) {
  return fact.sourceRefs.find((ref) => ref.sourceType === "sales_order_line")
    ?.sourceId;
}

function buildSupplementalProductionPathDemandFacts(args: {
  paths: ProductionDemandPath[];
  existingDemandFacts: InternalDemandFact[];
  productionBlockerFacts: ProductionBlockerFact[];
  itemById: Map<string, PlanningItemRecord>;
}): InternalDemandFact[] {
  type PendingPathDemand = {
    path: ProductionDemandPath;
    quantity: number;
    sourceRefs: PlanningSourceRef[];
  };

  const representedDemand = new Set(
    args.existingDemandFacts.flatMap((fact) => {
      const salesOrderLineId = salesOrderLineSourceId(fact);
      return salesOrderLineId ? [`${fact.itemId}:${salesOrderLineId}`] : [];
    })
  );
  const pendingByKey = new Map<string, PendingPathDemand>();
  const constrainedComponentBlockers = args.productionBlockerFacts.filter(
    (blocker) =>
      blocker.blockerType === "component_requirement" && blocker.componentItemId
  );
  const pathSalesOrderLineMatchesBlocker = (
    path: ProductionDemandPath,
    blocker: ProductionBlockerFact
  ) => {
    const salesOrderLineIds = blocker.sourceRefs
      .filter((ref) => ref.sourceType === "sales_order_line")
      .map((ref) => ref.sourceId);

    return (
      salesOrderLineIds.length === 0 ||
      salesOrderLineIds.includes(path.terminal.salesOrderLineId)
    );
  };
  const isBehindConstrainedComponent = (path: ProductionDemandPath) =>
    constrainedComponentBlockers.some((blocker) => {
      if (!pathSalesOrderLineMatchesBlocker(path, blocker)) {
        return false;
      }

      return path.steps.some(
        (step, index) =>
          index > 0 && step.itemId === blocker.componentItemId
      );
    });
  const hasDeeperPathForSameItem = (path: ProductionDemandPath) =>
    args.paths.some((candidate) => {
      if (
        candidate.id === path.id ||
        candidate.terminal.salesOrderLineId !== path.terminal.salesOrderLineId
      ) {
        return false;
      }

      const firstStep = candidate.steps[0];
      const containsPathItemDownstream = candidate.steps.some(
        (step, index) => index > 0 && step.itemId === path.itemId
      );

      return (
        containsPathItemDownstream &&
        Boolean(firstStep) &&
        args.itemById.get(firstStep.itemId)?.itemType === "product"
      );
    });

  for (const path of args.paths) {
    const item = args.itemById.get(path.itemId);
    if (!item || item.itemType !== "product") {
      continue;
    }
    if (
      constrainedComponentBlockers.length === 0 ||
      !isBehindConstrainedComponent(path) ||
      hasDeeperPathForSameItem(path)
    ) {
      continue;
    }

    const representedKey = `${path.itemId}:${path.terminal.salesOrderLineId}`;
    if (representedDemand.has(representedKey)) {
      continue;
    }

    const quantity = toQuantity(path.uncoveredQuantity);
    if (quantity <= 0) {
      continue;
    }

    const terminalStep = path.steps[path.steps.length - 1];
    const sourceRefs = uniqueSourceRefs([
      {
        sourceType: "sales_order",
        sourceId: path.terminal.salesOrderId,
        label: path.terminal.salesOrderLabel,
        date: path.terminal.requiredDate,
      },
      {
        sourceType: "sales_order_line",
        sourceId: path.terminal.salesOrderLineId,
        label: `${splitSalesOrderLabel(path.terminal.salesOrderLabel).orderNumber} / ${
          path.terminal.displayName || path.terminal.itemName
        }`,
        itemId: path.terminal.itemId,
        quantity: terminalStep?.quantityRequired ?? path.uncoveredQuantity,
        date: path.terminal.requiredDate,
        parentSourceId: path.terminal.salesOrderId,
      },
    ]);
    const key = [
      path.itemId,
      path.terminal.salesOrderLineId,
      path.requiredDate ?? "",
      path.steps.map((step) => step.itemId).join(">"),
    ].join(":");
    const existing = pendingByKey.get(key);

    if (!existing) {
      pendingByKey.set(key, { path, quantity, sourceRefs });
      continue;
    }

    existing.quantity = roundQuantity(existing.quantity + quantity);
    existing.sourceRefs = uniqueSourceRefs([...existing.sourceRefs, ...sourceRefs]);
  }

  return [...pendingByKey.entries()].map(([key, entry]) => {
    const parentStep = entry.path.steps[1];
    const itemName =
      entry.path.steps[0]?.displayName ||
      entry.path.steps[0]?.itemName ||
      "component";
    const terminalName =
      entry.path.terminal.displayName || entry.path.terminal.itemName;

    return {
      id: `demand:path:${hashValue({ key }).slice(0, 20)}`,
      itemId: entry.path.itemId,
      demandType: "bom_explosion" as const,
      quantity: normalizeQuantity(entry.quantity),
      requiredDate: entry.path.requiredDate,
      reasonCodes: ["bom_component_demand"],
      sourceRefs: entry.sourceRefs,
      parentItemId: parentStep?.itemId,
      parentDemandFactId: `demand:path:parent:${entry.path.id}`,
      explanation: `${terminalName} demand creates ${normalizeQuantity(
        entry.quantity
      )} ${itemName} demand through downstream production constraints.`,
      explosionPath: entry.path.steps.map((step) => step.itemId).reverse(),
    };
  });
}

async function getPlanningItemsInTx(tx: Tx): Promise<PlanningItemRecord[]> {
  const rows = await tx
    .select({
      id: items.id,
      name: items.name,
      familyName: itemFamilies.name,
      sku: items.sku,
      itemType: items.itemType,
      unitName: unitDefinitions.name,
      unitSize: trimScale(unitDefinitions.size).as("unitSize"),
      unitUom: unitDefinitions.uom,
      safetyStock: trimScale(items.safetyStock).as("safetyStock"),
      onHandQuantity: projectedOnHandQty(items.organizationId, items.id).as(
        "onHandQuantity"
      ),
      reservedQuantity: projectedCommittedQty(items.organizationId, items.id).as(
        "reservedQuantity"
      ),
      expectedQuantity: projectedExpectedQty(items.organizationId, items.id).as(
        "expectedQuantity"
      ),
      defaultPurchasePrice: trimScaleNullable(items.defaultPurchasePrice).as(
        "defaultPurchasePrice"
      ),
      purchaseUnitDefinitionId: sql<string | null>`COALESCE(${itemFamilies.purchaseUnitDefinitionId}, ${items.purchaseUnitDefinitionId})`,
      purchaseUnitName: sql<string | null>`(
        SELECT ${unitDefinitions.name}
        FROM ${unitDefinitions}
        WHERE ${unitDefinitions.id} = COALESCE(${itemFamilies.purchaseUnitDefinitionId}, ${items.purchaseUnitDefinitionId})
      )`,
      purchaseToStockFactor: trimScaleNullable(
        sql`COALESCE(${itemFamilies.purchaseToStockFactor}, ${items.purchaseToStockFactor})`,
      ).as("purchaseToStockFactor"),
    })
    .from(items)
    .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
    .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(and(isNull(items.deletedAt), isNotNull(items.familyId)))
    .orderBy(asc(items.name), asc(items.id));

  const optionValuesByItemId = await getPlanningOptionValuesByItemIdInTx(
    tx,
    rows.map((row) => row.id),
  );

  return rows.map((row) => {
    const optionValues = optionValuesByItemId.get(row.id) ?? [];
    return {
      ...row,
      displayName: row.familyName ?? row.name,
      displayAttrs: optionValues,
    };
  });
}

async function getSalesDemandFactsInTx(tx: Tx): Promise<InternalDemandFact[]> {
  const rows = await tx
    .select({
      salesOrderId: salesOrders.id,
      salesOrderLineId: salesOrderLines.id,
      orderNumber: salesOrders.orderNumber,
      customerName: salesOrders.customerName,
      requestedDate: salesOrders.requestedDate,
      itemId: salesOrderLines.itemId,
      itemName: salesOrderLines.itemName,
      quantity: trimScale(
        sql`(
          SELECT COALESCE(SUM(demand.quantity), 0)
          FROM inventory.inventory_demands_summary demand
          WHERE demand.reference_type = 'sales_order_line'
            AND demand.reference_id = ${salesOrderLines.id}
        )`
      ).as("quantity"),
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(
      and(
        eq(salesOrders.status, "open"),
        isNull(salesOrders.deletedAt)
      )
    )
    .orderBy(
      asc(salesOrders.orderDate),
      asc(salesOrders.requestedDate),
      asc(documentNumberSortSql(salesOrders.orderNumber, "SO")),
      asc(salesOrders.orderNumber),
      asc(salesOrderLines.sortOrder),
      asc(salesOrderLines.id)
    );

  return rows
    .map((row) => ({
      id: `demand:sales:${row.salesOrderLineId}`,
      itemId: row.itemId,
      demandType: "sales_order" as const,
      quantity: row.quantity,
      requiredDate: row.requestedDate,
      reasonCodes: ["sales_order_demand"] as PlanningReasonCode[],
      sourceRefs: [
        {
          sourceType: "sales_order" as const,
          sourceId: row.salesOrderId,
          label: `${row.orderNumber} · ${row.customerName}`,
          date: row.requestedDate,
        },
        {
          sourceType: "sales_order_line" as const,
          sourceId: row.salesOrderLineId,
          label: `${row.orderNumber} / ${row.itemName}`,
          itemId: row.itemId,
          quantity: row.quantity,
          date: row.requestedDate,
          parentSourceId: row.salesOrderId,
        },
      ],
      explanation: `${row.orderNumber} needs ${row.quantity} ${row.itemName}.`,
      explosionPath: [row.itemId],
    }))
    .filter((row) => toQuantity(row.quantity) > 0);
}

function getSafetyStockDemandFacts(itemsList: PlanningItemRecord[]) {
  return itemsList
    .filter((item) => toQuantity(item.safetyStock) > 0)
    .map((item) => ({
      id: `demand:safety:${item.id}`,
      itemId: item.id,
      demandType: "safety_stock" as const,
      quantity: item.safetyStock,
      requiredDate: null,
      reasonCodes: ["safety_stock_demand"] as PlanningReasonCode[],
      sourceRefs: [
        {
          sourceType: "safety_stock" as const,
          sourceId: `safety:${item.id}`,
          label: `Safety stock for ${item.name}`,
          itemId: item.id,
          quantity: item.safetyStock,
        },
      ],
      explanation: `Safety stock target is ${item.safetyStock}.`,
      explosionPath: [item.id],
    }));
}

async function getOpenManufacturingComponentDemandFactsInTx(
  tx: Tx
): Promise<InternalDemandFact[]> {
  const remainingQuantity = trimScale(
    sql`GREATEST(${manufacturingOrderIngredients.plannedQuantity} - ${manufacturingOrderIngredients.pickedQuantity}, 0)`
  );

  const rows = await tx
    .select({
      manufacturingOrderId: manufacturingOrders.id,
      manufacturingOrderNumber: manufacturingOrders.orderNumber,
      plannedDate: manufacturingOrders.plannedDate,
      ingredientId: manufacturingOrderIngredients.id,
      itemId: manufacturingOrderIngredients.itemId,
      itemName: manufacturingOrderIngredients.itemName,
      productId: manufacturingOrders.productId,
      productName: manufacturingOrders.productName,
      quantity: remainingQuantity.as("quantity"),
    })
    .from(manufacturingOrderIngredients)
    .innerJoin(
      manufacturingOrders,
      eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrders.id)
    )
    .where(
      and(
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt),
        sql`${manufacturingOrderIngredients.plannedQuantity} > ${manufacturingOrderIngredients.pickedQuantity}`
      )
    )
    .orderBy(
      asc(manufacturingOrders.plannedDate),
      asc(documentNumberSortSql(manufacturingOrders.orderNumber, "MO")),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrderIngredients.sortOrder),
      asc(manufacturingOrderIngredients.id)
    );

  return rows.map((row) => ({
    id: `demand:manufacturing:${row.ingredientId}`,
    itemId: row.itemId,
    demandType: "manufacturing_component",
    quantity: row.quantity,
    requiredDate: row.plannedDate,
    reasonCodes: ["manufacturing_component_demand"],
    sourceRefs: [
      {
        sourceType: "manufacturing_order",
        sourceId: row.manufacturingOrderId,
        label: row.manufacturingOrderNumber,
        itemId: row.productId,
        date: row.plannedDate,
      },
      {
        sourceType: "manufacturing_order_ingredient",
        sourceId: row.ingredientId,
        label: `${row.manufacturingOrderNumber} / ${row.itemName}`,
        itemId: row.itemId,
        quantity: row.quantity,
        date: row.plannedDate,
        parentSourceId: row.manufacturingOrderId,
      },
    ],
    parentItemId: row.productId,
    explanation: `${row.manufacturingOrderNumber} needs ${row.quantity} ${row.itemName} for ${row.productName}.`,
    explosionPath: [row.productId, row.itemId],
  }));
}

function getInventoryFacts(itemsList: PlanningItemRecord[]): InventoryFact[] {
  return itemsList.map((item) => {
    const onHandQuantity = toQuantity(item.onHandQuantity);
    const reservedQuantity = toQuantity(item.reservedQuantity);
    const availableQuantity = positiveQuantity(onHandQuantity - reservedQuantity);

    return {
      itemId: item.id,
      onHandQuantity: normalizeQuantity(onHandQuantity),
      reservedQuantity: normalizeQuantity(reservedQuantity),
      availableQuantity: normalizeQuantity(availableQuantity),
      expectedQuantity: item.expectedQuantity,
      sourceRefs: [itemRef(item)],
    };
  });
}

function getInventorySupplyFacts(
  itemsList: PlanningItemRecord[],
  inventoryFacts: InventoryFact[]
): SupplyFact[] {
  const itemById = new Map(itemsList.map((item) => [item.id, item]));

  return inventoryFacts
    .filter((fact) => toQuantity(fact.onHandQuantity) > 0)
    .map((fact) => {
      const item = itemById.get(fact.itemId);
      return {
        id: `supply:inventory:${fact.itemId}`,
        itemId: fact.itemId,
        supplyType: "available_inventory",
        quantity: fact.onHandQuantity,
        expectedDate: null,
        status: "on_hand",
        reasonCodes: ["inventory_available"],
        sourceRefs: fact.sourceRefs,
        explanation: `${item?.name ?? "Item"} has ${fact.onHandQuantity} on hand.`,
      };
    });
}

async function getPurchaseSupplyFactsInTx(tx: Tx): Promise<SupplyFact[]> {
  const remainingQuantity = trimScale(
    sql`GREATEST(${purchaseOrderLines.stockQuantityOrdered} - ${purchaseOrderLines.stockQuantityReceived}, 0)`
  );

  const rows = await tx
    .select({
      purchaseOrderId: purchaseOrders.id,
      purchaseOrderLineId: purchaseOrderLines.id,
      orderNumber: purchaseOrders.orderNumber,
      supplierName: purchaseOrders.supplierName,
      status: purchaseOrders.status,
      expectedDate: purchaseOrders.expectedDate,
      itemId: purchaseOrderLines.itemId,
      itemName: purchaseOrderLines.itemName,
      quantity: remainingQuantity.as("quantity"),
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
    .where(
      and(
        inArray(purchaseOrders.status, ["ordered", "partial"]),
        isNull(purchaseOrders.deletedAt),
        sql`${purchaseOrderLines.stockQuantityOrdered} > ${purchaseOrderLines.stockQuantityReceived}`
      )
    )
    .orderBy(
      asc(purchaseOrders.expectedDate),
      asc(documentNumberSortSql(purchaseOrders.orderNumber, "PO")),
      asc(purchaseOrders.orderNumber),
      asc(purchaseOrderLines.sortOrder),
      asc(purchaseOrderLines.id)
    );

  return rows.map((row) => ({
    id: `supply:purchase:${row.purchaseOrderLineId}`,
    itemId: row.itemId,
    supplyType: "purchase_order",
    quantity: row.quantity,
    expectedDate: row.expectedDate,
    status: row.status,
    reasonCodes: ["open_purchase_supply"],
    sourceRefs: [
      {
        sourceType: "purchase_order",
        sourceId: row.purchaseOrderId,
        label: row.orderNumber,
        date: row.expectedDate,
      },
      {
        sourceType: "purchase_order_line",
        sourceId: row.purchaseOrderLineId,
        label: `${row.orderNumber} / ${row.itemName}`,
        itemId: row.itemId,
        quantity: row.quantity,
        date: row.expectedDate,
        parentSourceId: row.purchaseOrderId,
      },
    ],
    explanation: `${row.orderNumber} from ${row.supplierName} has ${row.quantity} incoming.`,
  }));
}

async function getManufacturingSupplyFactsInTx(tx: Tx): Promise<SupplyFact[]> {
  const completedBatchQuantity = sql`COALESCE((
    SELECT SUM(${manufacturingOrderBatches.actualQuantity})
    FROM ${manufacturingOrderBatches}
    WHERE ${manufacturingOrderBatches.manufacturingOrderId} = ${manufacturingOrders.id}
      AND ${manufacturingOrderBatches.status} = 'completed'
  ), 0)`;
  const remainingQuantity = trimScale(sql`GREATEST(
    ${manufacturingOrders.plannedQuantity} - CASE
      WHEN ${manufacturingOrders.manufacturingMode} = 'batch'
        THEN ${completedBatchQuantity}
      ELSE 0
    END,
    0
  )`);

  const rows = await tx
    .select({
      manufacturingOrderId: manufacturingOrders.id,
      orderNumber: manufacturingOrders.orderNumber,
      status: manufacturingOrders.status,
      plannedDate: manufacturingOrders.plannedDate,
      itemId: manufacturingOrders.productId,
      itemName: manufacturingOrders.productName,
      quantity: remainingQuantity.as("quantity"),
    })
    .from(manufacturingOrders)
    .where(
      and(
        eq(manufacturingOrders.status, "open"),
        isNull(manufacturingOrders.deletedAt)
      )
    )
    .orderBy(
      asc(manufacturingOrders.plannedDate),
      asc(documentNumberSortSql(manufacturingOrders.orderNumber, "MO")),
      asc(manufacturingOrders.orderNumber),
      asc(manufacturingOrders.id)
    );

  return rows
    .filter((row) => toQuantity(row.quantity) > 0)
    .map((row) => ({
      id: `supply:manufacturing:${row.manufacturingOrderId}`,
      itemId: row.itemId,
      supplyType: "manufacturing_order",
      quantity: row.quantity,
      expectedDate: row.plannedDate,
      status: row.status,
      reasonCodes: ["open_manufacturing_supply"],
      sourceRefs: [
        {
          sourceType: "manufacturing_order",
          sourceId: row.manufacturingOrderId,
          label: row.orderNumber,
          itemId: row.itemId,
          quantity: row.quantity,
          date: row.plannedDate,
        },
      ],
      explanation: `${row.orderNumber} has ${row.quantity} ${row.itemName} incoming.`,
    }));
}

async function getCurrentBomsInTx(
  tx: Tx,
  productIds: string[]
): Promise<Map<string, CurrentBomRecord>> {
  const uniqueProductIds = [...new Set(productIds)];
  if (uniqueProductIds.length === 0) {
    return new Map();
  }

  const revisions = await tx
    .select({
      id: bomRevisions.id,
      productId: bomRevisions.productId,
      revisionNumber: bomRevisions.revisionNumber,
      recipeBasis: bomRevisions.recipeBasis,
      outputQuantity: trimScale(bomRevisions.outputQuantity).as("outputQuantity"),
    })
    .from(bomRevisions)
    .where(
      and(
        inArray(bomRevisions.productId, uniqueProductIds),
        eq(bomRevisions.isCurrent, true)
      )
    )
    .orderBy(asc(bomRevisions.productId), asc(bomRevisions.revisionNumber));

  if (revisions.length === 0) {
    return new Map();
  }

  const components = await tx
    .select({
      id: bomRevisionComponents.id,
      bomRevisionId: bomRevisionComponents.bomRevisionId,
      componentId: bomRevisionComponents.componentId,
      componentName: items.name,
      componentSku: items.sku,
      componentItemType: items.itemType,
      unitName: unitDefinitions.name,
      quantity: trimScale(bomRevisionComponents.quantity).as("quantity"),
      sortOrder: bomRevisionComponents.sortOrder,
    })
    .from(bomRevisionComponents)
    .innerJoin(items, eq(bomRevisionComponents.componentId, items.id))
    .innerJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
    .where(
      and(
        inArray(
          bomRevisionComponents.bomRevisionId,
          revisions.map((revision) => revision.id)
        ),
        isNull(items.deletedAt)
      )
    )
    .orderBy(
      asc(bomRevisionComponents.bomRevisionId),
      asc(bomRevisionComponents.sortOrder),
      asc(bomRevisionComponents.createdAt)
    );

  const constraints =
    components.length === 0
      ? []
      : await tx
          .select({
            bomRevisionComponentId:
              bomRevisionComponentConstraints.bomRevisionComponentId,
            constraintType: bomRevisionComponentConstraints.constraintType,
            config: bomRevisionComponentConstraints.config,
            sortOrder: bomRevisionComponentConstraints.sortOrder,
          })
          .from(bomRevisionComponentConstraints)
          .where(
            inArray(
              bomRevisionComponentConstraints.bomRevisionComponentId,
              components.map((component) => component.id)
            )
          );
  const requirementsByComponentId = new Map<string, BomComponentRequirement[]>();
  for (const constraint of constraints) {
    const componentConstraint: BomComponentConstraint = {
      constraintType: constraint.constraintType as BomComponentConstraint["constraintType"],
      config: constraint.config,
      sortOrder: constraint.sortOrder,
    };
    const planningRequirement = toPlanningComponentRequirement(componentConstraint);
    if (!planningRequirement) continue;
    const bucket = requirementsByComponentId.get(constraint.bomRevisionComponentId) ?? [];
    bucket.push(planningRequirement);
    requirementsByComponentId.set(constraint.bomRevisionComponentId, bucket);
  }

  const componentsByRevision = new Map<string, BomComponentRecord[]>();
  for (const component of components) {
    const bucket = componentsByRevision.get(component.bomRevisionId) ?? [];
    bucket.push({
      id: component.id,
      componentId: component.componentId,
      componentName: component.componentName,
      componentSku: component.componentSku,
      componentItemType: component.componentItemType,
      unitName: component.unitName,
      quantity: component.quantity,
      sortOrder: component.sortOrder,
      requirements: requirementsByComponentId.get(component.id) ?? [],
    });
    componentsByRevision.set(component.bomRevisionId, bucket);
  }

  return new Map(
    revisions.map((revision) => [
      revision.productId,
      {
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        recipeBasis: normalizeRecipeBasis(revision.recipeBasis),
        outputQuantity: revision.outputQuantity,
        components: componentsByRevision.get(revision.id) ?? [],
      },
    ])
  );
}

async function getSupplierSuggestionsInTx(
  tx: Tx,
  itemsList: PlanningItemRecord[]
): Promise<Map<string, SupplierSuggestion>> {
  const uniqueItemIds = [
    ...new Set(
      itemsList
        .filter((item) => item.itemType === "material" || item.itemType === "product")
        .map((item) => item.id)
    ),
  ];
  const itemById = new Map(itemsList.map((item) => [item.id, item]));
  const activeSuppliers = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
    })
    .from(suppliers)
    .where(isNull(suppliers.deletedAt))
    .orderBy(asc(suppliers.name), asc(suppliers.id));

  const suggestions = new Map<string, SupplierSuggestion>();

  if (uniqueItemIds.length > 0) {
    const supplierRuleRows = await tx
      .select({
        itemId: supplierItems.itemId,
        supplierId: supplierItems.supplierId,
        supplierName: suppliers.name,
        supplierSku: supplierItems.supplierSku,
        unitCost: trimScaleNullable(supplierItems.unitCost).as("unitCost"),
        purchaseUnitDefinitionId: supplierItems.purchaseUnitDefinitionId,
        purchaseUnitName: unitDefinitions.name,
        purchaseToStockFactor: trimScaleNullable(
          supplierItems.purchaseToStockFactor
        ).as("purchaseToStockFactor"),
        isPreferred: supplierItems.isPreferred,
        createdAt: supplierItems.createdAt,
      })
      .from(supplierItems)
      .innerJoin(suppliers, eq(supplierItems.supplierId, suppliers.id))
      .leftJoin(
        unitDefinitions,
        eq(supplierItems.purchaseUnitDefinitionId, unitDefinitions.id)
      )
      .where(
        and(
          inArray(supplierItems.itemId, uniqueItemIds),
          isNull(supplierItems.deletedAt),
          isNull(suppliers.deletedAt)
        )
      )
      .orderBy(
        desc(supplierItems.isPreferred),
        asc(suppliers.name),
        desc(supplierItems.createdAt)
      );

    const supplierRulesByItem = new Map<string, typeof supplierRuleRows>();
    for (const row of supplierRuleRows) {
      const bucket = supplierRulesByItem.get(row.itemId) ?? [];
      bucket.push(row);
      supplierRulesByItem.set(row.itemId, bucket);
    }

    for (const [itemId, rules] of supplierRulesByItem) {
      const preferredRules = rules.filter((rule) => rule.isPreferred);
      const candidate =
        preferredRules.length === 1
          ? preferredRules[0]
          : preferredRules.length === 0 && rules.length === 1
            ? rules[0]
            : null;

      if (!candidate) {
        continue;
      }

      const item = itemById.get(itemId);
      suggestions.set(itemId, {
        supplierId: candidate.supplierId,
        supplierName: candidate.supplierName,
        supplierSku: candidate.supplierSku,
        supplierSource: "supplier_item",
        unitCost: candidate.unitCost ?? item?.defaultPurchasePrice ?? null,
        unitCostSource:
          candidate.unitCost != null
            ? "supplier_item"
            : item?.defaultPurchasePrice != null
              ? "item_default"
              : "unknown",
        purchaseUnitDefinitionId:
          candidate.purchaseUnitDefinitionId ?? item?.purchaseUnitDefinitionId ?? null,
        purchaseUnitName: candidate.purchaseUnitName ?? item?.purchaseUnitName ?? null,
        purchaseToStockFactor:
          candidate.purchaseToStockFactor ?? item?.purchaseToStockFactor ?? "1",
        purchaseRuleSource:
          candidate.purchaseUnitDefinitionId != null ||
          candidate.purchaseToStockFactor != null
            ? "supplier_item"
            : item?.purchaseUnitDefinitionId != null ||
                item?.purchaseToStockFactor != null
              ? "item_default"
              : "default",
        reasonCodes: [],
      });
    }

    const supplierHistory = await tx
      .select({
        itemId: purchaseOrderLines.itemId,
        supplierId: suppliers.id,
        supplierName: suppliers.name,
      })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(
        and(
          inArray(purchaseOrderLines.itemId, uniqueItemIds),
          isNull(purchaseOrders.deletedAt),
          isNull(suppliers.deletedAt)
        )
      )
      .orderBy(
        desc(purchaseOrders.createdAt),
        desc(purchaseOrders.id),
        asc(suppliers.name)
      );

    for (const row of supplierHistory) {
      if (suggestions.has(row.itemId)) {
        continue;
      }

      const item = itemById.get(row.itemId);
      suggestions.set(row.itemId, {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        supplierSku: null,
        supplierSource: "history",
        unitCost: item?.defaultPurchasePrice ?? null,
        unitCostSource: item?.defaultPurchasePrice != null ? "item_default" : "unknown",
        purchaseUnitDefinitionId: item?.purchaseUnitDefinitionId ?? null,
        purchaseUnitName: item?.purchaseUnitName ?? null,
        purchaseToStockFactor: item?.purchaseToStockFactor ?? "1",
        purchaseRuleSource:
          item?.purchaseUnitDefinitionId != null || item?.purchaseToStockFactor != null
            ? "item_default"
            : "default",
        reasonCodes: [],
      });
    }
  }

  for (const itemId of uniqueItemIds) {
    if (suggestions.has(itemId)) {
      continue;
    }

    if (activeSuppliers.length === 1) {
      const [supplier] = activeSuppliers;
      const item = itemById.get(itemId);
      suggestions.set(itemId, {
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierSku: null,
        supplierSource: "default",
        unitCost: item?.defaultPurchasePrice ?? null,
        unitCostSource: item?.defaultPurchasePrice != null ? "item_default" : "unknown",
        purchaseUnitDefinitionId: item?.purchaseUnitDefinitionId ?? null,
        purchaseUnitName: item?.purchaseUnitName ?? null,
        purchaseToStockFactor: item?.purchaseToStockFactor ?? "1",
        purchaseRuleSource:
          item?.purchaseUnitDefinitionId != null || item?.purchaseToStockFactor != null
            ? "item_default"
            : "default",
        reasonCodes: [],
      });
      continue;
    }

    suggestions.set(itemId, {
      supplierId: null,
      supplierName: null,
      supplierSku: null,
      supplierSource: "unknown",
      unitCost: itemById.get(itemId)?.defaultPurchasePrice ?? null,
      unitCostSource:
        itemById.get(itemId)?.defaultPurchasePrice != null
          ? "item_default"
          : "unknown",
      purchaseUnitDefinitionId: itemById.get(itemId)?.purchaseUnitDefinitionId ?? null,
      purchaseUnitName: itemById.get(itemId)?.purchaseUnitName ?? null,
      purchaseToStockFactor: itemById.get(itemId)?.purchaseToStockFactor ?? "1",
      purchaseRuleSource:
        itemById.get(itemId)?.purchaseUnitDefinitionId != null ||
        itemById.get(itemId)?.purchaseToStockFactor != null
          ? "item_default"
          : "default",
      reasonCodes:
        activeSuppliers.length === 0 ? ["missing_supplier"] : ["ambiguous_supplier"],
    });
  }

  return suggestions;
}

function buildQuantityBuckets(
  demandFacts: DemandFact[],
  supplyFacts: SupplyFact[]
) {
  const buckets = new Map<string, QuantityBuckets>();

  for (const fact of demandFacts) {
    const bucket = buckets.get(fact.itemId) ?? {
      demandQuantity: 0,
      incomingPurchaseOrderQuantity: 0,
      incomingManufacturingOrderQuantity: 0,
    };
    bucket.demandQuantity = roundQuantity(
      bucket.demandQuantity + toQuantity(fact.quantity)
    );
    buckets.set(fact.itemId, bucket);
  }

  for (const fact of supplyFacts) {
    const bucket = buckets.get(fact.itemId) ?? {
      demandQuantity: 0,
      incomingPurchaseOrderQuantity: 0,
      incomingManufacturingOrderQuantity: 0,
    };

    if (fact.supplyType === "purchase_order") {
      bucket.incomingPurchaseOrderQuantity = roundQuantity(
        bucket.incomingPurchaseOrderQuantity + toQuantity(fact.quantity)
      );
    }

    if (fact.supplyType === "manufacturing_order") {
      bucket.incomingManufacturingOrderQuantity = roundQuantity(
        bucket.incomingManufacturingOrderQuantity + toQuantity(fact.quantity)
      );
    }

    buckets.set(fact.itemId, bucket);
  }

  return buckets;
}

function computeReplenishmentMetadata(args: {
  item: PlanningItemRecord;
  itemDemandFacts: DemandFact[];
  itemSupplyFacts: SupplyFact[];
  onHandStock: number;
  shortageQuantity: number;
  supplierSuggestion: SupplierSuggestion | undefined;
  horizonStart: string;
}) {
  const safetyStockTarget = args.itemDemandFacts.reduce(
    (sum, fact) =>
      fact.demandType === "safety_stock"
        ? roundQuantity(sum + toQuantity(fact.quantity))
        : sum,
    0
  );
  const nonSafetyDemand = Math.max(
    0,
    args.itemDemandFacts.reduce(
      (sum, fact) =>
        fact.demandType === "safety_stock"
          ? sum
          : roundQuantity(sum + toQuantity(fact.quantity)),
      0
    )
  );
  const expectedSupply = args.itemSupplyFacts.reduce(
    (sum, fact) =>
      fact.supplyType === "available_inventory"
        ? sum
        : roundQuantity(sum + toQuantity(fact.quantity)),
    0
  );
  const projectedStock = Math.max(
    0,
    roundQuantity(args.onHandStock + expectedSupply - nonSafetyDemand)
  );
  const safetyBand = safetyStockTarget * REPLENISHMENT_SOON_MULTIPLIER;
  const daysOfCoverStatus: DaysOfCoverStatus =
    args.shortageQuantity > 0
      ? "order_now"
      : safetyStockTarget <= 0
        ? "stocked"
        : projectedStock <= safetyStockTarget
          ? "order_now"
          : projectedStock <= safetyBand
            ? "order_soon"
            : "stocked";

  return {
    daysOfCover: null,
    daysOfCoverStatus,
    suggestedOrderQuantity:
      args.shortageQuantity > 0 ? normalizeQuantity(args.shortageQuantity) : null,
  };
}

function computeBomBatchMetadata(
  bom: CurrentBomRecord | undefined,
  quantity: number
): {
  manufacturingMode: "batch";
  expectedBatchYield: string;
  plannedBatchCount: number;
} | null {
  if (!bom || normalizeRecipeBasis(bom.recipeBasis) !== "batch") return null;
  const expectedBatchYield = Number(bom.outputQuantity);
  if (!Number.isFinite(expectedBatchYield) || expectedBatchYield <= 0) return null;
  return {
    manufacturingMode: "batch",
    expectedBatchYield: normalizeQuantity(expectedBatchYield),
    plannedBatchCount: Math.max(1, Math.ceil(quantity / expectedBatchYield)),
  };
}

function computeManufacturingOrderQuantity(
  bom: CurrentBomRecord | undefined,
  shortageQuantity: string | number
) {
  const requestedQuantity =
    typeof shortageQuantity === "number" ? shortageQuantity : toQuantity(shortageQuantity);
  const batchMetadata = computeBomBatchMetadata(bom, requestedQuantity);
  if (!batchMetadata) return normalizeQuantity(requestedQuantity);

  return normalizeQuantity(
    batchMetadata.plannedBatchCount * Number(batchMetadata.expectedBatchYield)
  );
}

function computeBomComponentQuantity(
  bom: CurrentBomRecord,
  component: BomComponentRecord,
  outputQuantity: number
) {
  const recipeBasis = normalizeRecipeBasis(bom.recipeBasis);
  const recipeOutputQuantity = Number(bom.outputQuantity);
  const numberOfBatches =
    recipeBasis === "batch" && Number.isFinite(recipeOutputQuantity) && recipeOutputQuantity > 0
      ? Math.ceil(outputQuantity / recipeOutputQuantity)
      : null;
  const plannedQuantity = calculateIngredientPlannedQuantity({
    recipeBasis,
    quantityPerRecipeBasis: component.quantity,
    outputQuantity,
    numberOfBatches,
  });

  return roundQuantity(toQuantity(plannedQuantity));
}

function computeProductionMetadata(args: {
  item: PlanningItemRecord;
  bom: CurrentBomRecord | undefined;
  shortageQuantity: number;
  earliestRequiredDate: string | null;
  horizonStart: string;
}) {
  const productionBucket = productionBucketForDate(
    args.earliestRequiredDate,
    args.horizonStart
  );

  const bomBatchMetadata = computeBomBatchMetadata(args.bom, args.shortageQuantity);

  return {
    latestStartDate: null,
    productionBucket,
    manufacturingMode: bomBatchMetadata?.manufacturingMode ?? "discrete",
    expectedBatchYield: bomBatchMetadata?.expectedBatchYield ?? null,
    plannedBatchCount: bomBatchMetadata?.plannedBatchCount ?? null,
  };
}

function buildPlanningRows(args: {
  itemsList: PlanningItemRecord[];
  demandFacts: DemandFact[];
  supplyFacts: SupplyFact[];
  inventoryFacts: InventoryFact[];
  supplierSuggestions: Map<string, SupplierSuggestion>;
  horizonStart: string;
  bomByProductId?: Map<string, CurrentBomRecord>;
}): PlanningItemRow[] {
  const buckets = buildQuantityBuckets(args.demandFacts, args.supplyFacts);
  const demandFactsByItem = new Map<string, DemandFact[]>();
  const supplyFactsByItem = new Map<string, SupplyFact[]>();
  const inventoryByItem = new Map(
    args.inventoryFacts.map((fact) => [fact.itemId, fact])
  );

  for (const fact of args.demandFacts) {
    const bucket = demandFactsByItem.get(fact.itemId) ?? [];
    bucket.push(fact);
    demandFactsByItem.set(fact.itemId, bucket);
  }

  for (const fact of args.supplyFacts) {
    const bucket = supplyFactsByItem.get(fact.itemId) ?? [];
    bucket.push(fact);
    supplyFactsByItem.set(fact.itemId, bucket);
  }

  return args.itemsList.map((item) => {
    const bucket = buckets.get(item.id) ?? {
      demandQuantity: 0,
      incomingPurchaseOrderQuantity: 0,
      incomingManufacturingOrderQuantity: 0,
    };
    const inventory = inventoryByItem.get(item.id);
    const onHandQuantity = toQuantity(inventory?.onHandQuantity);
    const reservedQuantity = toQuantity(inventory?.reservedQuantity);
    const availableStock = positiveQuantity(onHandQuantity - reservedQuantity);
    const projectedQuantity = roundQuantity(
      onHandQuantity +
        bucket.incomingPurchaseOrderQuantity +
        bucket.incomingManufacturingOrderQuantity -
        bucket.demandQuantity
    );
    const shortageQuantity = positiveQuantity(-projectedQuantity);
    const itemDemandFacts = demandFactsByItem.get(item.id) ?? [];
    const itemSupplyFacts = supplyFactsByItem.get(item.id) ?? [];
    const earliestRequiredDate = earliestDate(
      itemDemandFacts.map((fact) => fact.requiredDate)
    );
    const supplierSuggestion = args.supplierSuggestions.get(item.id);
    const bom = args.bomByProductId?.get(item.id);
    const replenishment = computeReplenishmentMetadata({
      item,
      itemDemandFacts,
      itemSupplyFacts,
      onHandStock: onHandQuantity,
      shortageQuantity,
      supplierSuggestion,
      horizonStart: args.horizonStart,
    });
    const hasBom = Boolean(bom && bom.components.length > 0);
    const hasProductPurchaseSetup =
      item.itemType === "product" &&
      (item.defaultPurchasePrice != null ||
        supplierSuggestion?.supplierSource === "supplier_item" ||
        supplierSuggestion?.supplierSource === "history");
    const planningType =
      item.itemType === "material"
        ? "buy"
        : item.itemType === "product"
          ? hasBom && hasProductPurchaseSetup
            ? "buy_or_make"
            : hasBom
              ? "make"
              : "buy"
          : "unknown";
    const production =
      planningType === "make" || planningType === "buy_or_make"
        ? computeProductionMetadata({
            item,
            bom,
            shortageQuantity,
            earliestRequiredDate,
            horizonStart: args.horizonStart,
          })
        : {
            latestStartDate: null,
            productionBucket: "later" as ProductionBucket,
            manufacturingMode: null,
            expectedBatchYield: null,
            plannedBatchCount: null,
          };
    const reasonCodes = uniqueReasonCodes([
      ...itemDemandFacts.flatMap((fact) => fact.reasonCodes),
      ...itemSupplyFacts.flatMap((fact) => fact.reasonCodes),
      ...(onHandQuantity > 0 ? ["inventory_available" as const] : []),
      ...(reservedQuantity > 0 ? ["reserved_stock" as const] : []),
      shortageQuantity > 0 ? "projected_shortage" : "no_shortage",
    ]);
    const hasSuggestedBuy =
      planningType === "buy" &&
      toQuantity(replenishment.suggestedOrderQuantity) > 0 &&
      ["order_now", "order_soon"].includes(replenishment.daysOfCoverStatus);
    const suggestedAction =
      planningType === "buy" && (shortageQuantity > 0 || hasSuggestedBuy)
          ? "buy"
          : shortageQuantity <= 0
            ? "none"
            : planningType === "buy_or_make"
              ? "review"
            : planningType === "make"
              ? "make"
              : "review";

    return {
      item: {
        id: item.id,
        name: item.name,
        displayName: item.displayName,
        displayAttrs: item.displayAttrs,
        sku: item.sku,
        itemType: item.itemType,
        unitName: item.unitName,
        unitSize: item.unitSize,
        unitUom: item.unitUom,
      },
      planningType,
      demandQuantity: normalizeQuantity(bucket.demandQuantity),
      availableStock: normalizeQuantity(availableStock),
      reservedQuantity: normalizeQuantity(reservedQuantity),
      incomingPurchaseOrderQuantity: normalizeQuantity(
        bucket.incomingPurchaseOrderQuantity
      ),
      incomingManufacturingOrderQuantity: normalizeQuantity(
        bucket.incomingManufacturingOrderQuantity
      ),
      projectedQuantity: normalizeQuantity(projectedQuantity),
      shortageQuantity: normalizeQuantity(shortageQuantity),
      earliestRequiredDate,
      safetyStock: item.safetyStock,
      daysOfCover: replenishment.daysOfCover,
      daysOfCoverStatus: replenishment.daysOfCoverStatus,
      suggestedOrderQuantity: replenishment.suggestedOrderQuantity,
      preferredSupplierId: supplierSuggestion?.supplierId ?? null,
      preferredSupplierName: supplierSuggestion?.supplierName ?? null,
      preferredSupplierSku: supplierSuggestion?.supplierSku ?? null,
      preferredSupplierSource: supplierSuggestion?.supplierSource ?? "unknown",
      purchaseUnitDefinitionId:
        supplierSuggestion?.purchaseUnitDefinitionId ??
        item.purchaseUnitDefinitionId ??
        null,
      purchaseUnitName:
        supplierSuggestion?.purchaseUnitName ?? item.purchaseUnitName ?? null,
      purchaseToStockFactor:
        supplierSuggestion?.purchaseToStockFactor ??
        item.purchaseToStockFactor ??
        "1",
      purchaseRuleSource: supplierSuggestion?.purchaseRuleSource ?? "default",
      unitCost: supplierSuggestion?.unitCost ?? item.defaultPurchasePrice,
      unitCostSource:
        supplierSuggestion?.unitCostSource ??
        (item.defaultPurchasePrice != null ? "item_default" : "unknown"),
      latestStartDate: production.latestStartDate,
      productionBucket: production.productionBucket,
      manufacturingMode: production.manufacturingMode,
      expectedBatchYield: production.expectedBatchYield,
      plannedBatchCount: production.plannedBatchCount,
      suggestedAction,
      reasonCodes,
      sourceRefs: uniqueSourceRefs([
        itemRef(item),
        ...(inventory?.sourceRefs ?? []),
        ...itemDemandFacts.flatMap((fact) => fact.sourceRefs),
        ...itemSupplyFacts.flatMap((fact) => fact.sourceRefs),
      ]),
      explanationSummary:
        shortageQuantity > 0
          ? `${item.name} is short ${normalizeQuantity(shortageQuantity)} after netting demand and open supply.`
          : `${item.name} has no projected shortage.`,
      recommendationId: null,
    } satisfies PlanningItemRow;
  });
}

function addBomExplosionDemand(args: {
  row: PlanningItemRow;
  itemById: Map<string, PlanningItemRecord>;
  bomByProductId: Map<string, CurrentBomRecord>;
  demandFactsByItem: Map<string, InternalDemandFact[]>;
  componentMultiplier: number;
  level: number;
  warnings: PlanningWarning[];
}): {
  demandFacts: InternalDemandFact[];
  bomRequirementFacts: BomRequirementFact[];
} {
  const parentItem = args.itemById.get(args.row.item.id);
  const bom = args.bomByProductId.get(args.row.item.id);
  const parentDemandFacts = args.demandFactsByItem.get(args.row.item.id) ?? [];
  const parentDemandFact =
    parentDemandFacts.length > 0
      ? parentDemandFacts.reduce((longest, fact) =>
          fact.explosionPath.length >= longest.explosionPath.length
            ? fact
            : longest
        )
      : null;

  if (!parentItem || !parentDemandFact || !bom || bom.components.length === 0) {
    return { demandFacts: [], bomRequirementFacts: [] };
  }

  const demandFacts: InternalDemandFact[] = [];
  const bomRequirementFacts: BomRequirementFact[] = [];

  for (const component of bom.components) {
    const componentQuantity = computeBomComponentQuantity(
      bom,
      component,
      args.componentMultiplier
    );
    if (componentQuantity <= 0) {
      continue;
    }

    if (parentDemandFact.explosionPath.includes(component.componentId)) {
      args.warnings.push({
        code: "bom_cycle_detected",
        severity: "error",
        message: `BOM cycle detected while exploding ${parentItem.name}.`,
        itemId: parentItem.id,
        sourceRefs: uniqueSourceRefs([
          ...args.row.sourceRefs,
          {
            sourceType: "bom_revision",
            sourceId: bom.revisionId,
            label: `BOM revision ${bom.revisionNumber}`,
            itemId: parentItem.id,
          },
        ]),
      });
      continue;
    }

    const quantity = normalizeQuantity(componentQuantity);
    const ingredientNeedDate = args.row.latestStartDate ?? args.row.earliestRequiredDate;
    const factId = [
      "demand:bom",
      args.level,
      args.row.item.id,
      component.componentId,
      bom.revisionId,
      parentDemandFact.id,
    ].join(":");
    const sourceRefs = uniqueSourceRefs([
      ...args.row.sourceRefs,
      {
        sourceType: "bom_revision",
        sourceId: bom.revisionId,
        label: `BOM revision ${bom.revisionNumber}`,
        itemId: parentItem.id,
        quantity: component.quantity,
      },
    ]);

    demandFacts.push({
      id: factId,
      itemId: component.componentId,
      demandType: "bom_explosion",
      quantity,
      requiredDate: ingredientNeedDate,
      reasonCodes: ["bom_component_demand"],
      sourceRefs,
      parentItemId: parentItem.id,
      parentDemandFactId: parentDemandFact.id,
      bomRevisionId: bom.revisionId,
      explanation: `${parentItem.name} shortage creates ${quantity} ${component.componentName} demand through BOM revision ${bom.revisionNumber}.`,
      explosionPath: [...parentDemandFact.explosionPath, component.componentId],
    });

    bomRequirementFacts.push({
      id: `bom:req:${factId}`,
      parentItemId: parentItem.id,
      componentItemId: component.componentId,
      bomRevisionId: bom.revisionId,
      parentDemandFactId: parentDemandFact.id,
      level: args.level,
      quantityPerParent: component.quantity,
      parentShortageQuantity: args.row.shortageQuantity,
      requiredQuantity: quantity,
      ingredientNeedDate,
      requirements: component.requirements,
      reasonCodes: ["bom_component_demand"],
      sourceRefs,
    });
  }

  return { demandFacts, bomRequirementFacts };
}

function buildRowsWithBomExplosion(args: {
  itemsList: PlanningItemRecord[];
  baseDemandFacts: InternalDemandFact[];
  supplyFacts: SupplyFact[];
  inventoryFacts: InventoryFact[];
  bomByProductId: Map<string, CurrentBomRecord>;
  supplierSuggestions: Map<string, SupplierSuggestion>;
  horizonStart: string;
  warnings: PlanningWarning[];
}) {
  const itemById = new Map(args.itemsList.map((item) => [item.id, item]));
  const demandFacts: InternalDemandFact[] = [...args.baseDemandFacts];
  const bomRequirementFacts: BomRequirementFact[] = [];
  const explodedMultiplierByItemId = new Map<string, number>();
  let rows = buildPlanningRows({
    itemsList: args.itemsList,
    demandFacts,
    supplyFacts: args.supplyFacts,
    inventoryFacts: args.inventoryFacts,
    supplierSuggestions: args.supplierSuggestions,
    horizonStart: args.horizonStart,
    bomByProductId: args.bomByProductId,
  });

  for (let level = 1; level <= MAX_BOM_EXPLOSION_LEVEL; level += 1) {
    const demandFactsByItem = new Map<string, InternalDemandFact[]>();
    for (const fact of demandFacts) {
      const bucket = demandFactsByItem.get(fact.itemId) ?? [];
      bucket.push(fact);
      demandFactsByItem.set(fact.itemId, bucket);
    }

    let addedFacts = 0;
    const parentRows = rows
      .filter(
        (row) =>
          row.planningType === "make" &&
          toQuantity(row.shortageQuantity) > 0 &&
          args.bomByProductId.has(row.item.id)
      )
      .sort((left, right) => left.item.name.localeCompare(right.item.name));

    for (const row of parentRows) {
      const parentItem = itemById.get(row.item.id);
      if (!parentItem) {
        continue;
      }
      const shortageQuantity = toQuantity(row.shortageQuantity);
      const requiredMultiplier = shortageQuantity;
      const alreadyExploded = explodedMultiplierByItemId.get(row.item.id) ?? 0;
      const incrementalMultiplier = roundQuantity(requiredMultiplier - alreadyExploded);
      if (incrementalMultiplier <= 0) {
        continue;
      }
      explodedMultiplierByItemId.set(row.item.id, requiredMultiplier);

      const explosion = addBomExplosionDemand({
        row,
        itemById,
        bomByProductId: args.bomByProductId,
        demandFactsByItem,
        componentMultiplier: incrementalMultiplier,
        level,
        warnings: args.warnings,
      });

      demandFacts.push(...explosion.demandFacts);
      bomRequirementFacts.push(...explosion.bomRequirementFacts);
      addedFacts += explosion.demandFacts.length;
    }

    rows = buildPlanningRows({
      itemsList: args.itemsList,
      demandFacts,
      supplyFacts: args.supplyFacts,
      inventoryFacts: args.inventoryFacts,
      supplierSuggestions: args.supplierSuggestions,
      horizonStart: args.horizonStart,
      bomByProductId: args.bomByProductId,
    });

    if (addedFacts === 0) {
      return { rows, demandFacts, bomRequirementFacts };
    }
  }

  for (const row of rows.filter(
    (entry) =>
      entry.planningType === "make" &&
      toQuantity(entry.shortageQuantity) > 0 &&
      args.bomByProductId.has(entry.item.id)
  )) {
    args.warnings.push({
      code: "bom_depth_limit",
      severity: "warning",
      message: `BOM explosion stopped at ${MAX_BOM_EXPLOSION_LEVEL} levels while planning ${row.item.name}.`,
      itemId: row.item.id,
      sourceRefs: row.sourceRefs,
    });
  }

  return { rows, demandFacts, bomRequirementFacts };
}

function buildProductionBlockerFacts(args: {
  rows: PlanningItemRow[];
  bomRequirementFacts: BomRequirementFact[];
  bomByProductId: Map<string, CurrentBomRecord>;
  availableLots: AvailableLotFact[];
  horizonStart: string;
  warnings: PlanningWarning[];
}): ProductionBlockerFact[] {
  const rowsByItemId = new Map(args.rows.map((row) => [row.item.id, row]));
  const blockers: ProductionBlockerFact[] = [];
  const remainingLotsByItemId = new Map<string, AvailableLotFact[]>();

  for (const lot of args.availableLots) {
    const bucket = remainingLotsByItemId.get(lot.itemId) ?? [];
    bucket.push({ ...lot });
    remainingLotsByItemId.set(lot.itemId, bucket);
  }

  const requirementsByComponent = new Map<string, BomRequirementFact[]>();
  for (const fact of args.bomRequirementFacts) {
    const bucket = requirementsByComponent.get(fact.componentItemId) ?? [];
    bucket.push(fact);
    requirementsByComponent.set(fact.componentItemId, bucket);
  }

  for (const [componentItemId, facts] of requirementsByComponent) {
    const component = rowsByItemId.get(componentItemId);
    if (!component) {
      continue;
    }

    let remainingAvailable = toQuantity(component.availableStock);
    const remainingLots = remainingLotsByItemId.get(componentItemId) ?? [];
    const consumeLots = (lotsToConsume: AvailableLotFact[], quantity: number) => {
      let quantityToConsume = quantity;
      for (const lot of lotsToConsume) {
        if (quantityToConsume <= 0) break;
        const consumed = Math.min(lot.quantity, quantityToConsume);
        lot.quantity = roundQuantity(lot.quantity - consumed);
        quantityToConsume = roundQuantity(quantityToConsume - consumed);
      }
    };
    const sortedFacts = [...facts].sort((left, right) => {
      const leftParent = rowsByItemId.get(left.parentItemId);
      const rightParent = rowsByItemId.get(right.parentItemId);
      const dateSort = (leftParent?.earliestRequiredDate ?? "9999-12-31").localeCompare(
        rightParent?.earliestRequiredDate ?? "9999-12-31"
      );
      if (dateSort !== 0) return dateSort;
      return left.id.localeCompare(right.id);
    });

    for (const fact of sortedFacts) {
      const parent = rowsByItemId.get(fact.parentItemId);
      if (!parent) {
        continue;
      }

      const requiredQuantity = toQuantity(fact.requiredQuantity);
      const lotAgeRequirement = fact.requirements.find(
        (requirement) => requirement.requirementType === LOT_AGE_MIN_DAYS_CONSTRAINT
      );
      let availableForRequirement = Math.max(0, remainingAvailable);
      let blockerType: ProductionBlockerFact["blockerType"] = "material_shortage";

      if (lotAgeRequirement) {
        const needDate =
          fact.ingredientNeedDate ??
          parent.latestStartDate ??
          parent.earliestRequiredDate ??
          args.horizonStart;
        const eligibleLots = remainingLots.filter(
          (lot) => addDays(lot.receivedDate, lotAgeRequirement.days) <= needDate
        );
        availableForRequirement = eligibleLots.reduce(
          (sum, lot) => sum + lot.quantity,
          0
        );
        blockerType = "component_requirement";
      } else {
        availableForRequirement = Math.max(0, remainingAvailable);
      }

      const shortageQuantity = positiveQuantity(
        requiredQuantity - availableForRequirement
      );
      const consumedQuantity = Math.min(requiredQuantity, availableForRequirement);
      consumeLots(
        lotAgeRequirement
          ? remainingLots.filter(
              (lot) =>
                addDays(lot.receivedDate, lotAgeRequirement.days) <=
                (fact.ingredientNeedDate ??
                  parent.latestStartDate ??
                  parent.earliestRequiredDate ??
                  args.horizonStart)
            )
          : remainingLots,
        consumedQuantity
      );
      remainingAvailable = roundQuantity(remainingAvailable - consumedQuantity);

      if (shortageQuantity <= 0) {
        continue;
      }

      blockers.push({
        id: `production:blocker:material:${fact.id}`,
        parentItemId: parent.item.id,
        parentItemName: parent.item.name,
        parentRecommendationId: parent.recommendationId,
        componentItemId: component.item.id,
        componentItemName: component.item.name,
        componentUnitName: component.item.unitName,
        requiredQuantity: fact.requiredQuantity,
        availableQuantity: normalizeQuantity(availableForRequirement),
        shortageQuantity: normalizeQuantity(shortageQuantity),
        blockerType,
        earliestRequiredDate: parent.earliestRequiredDate,
        sourceRefs: fact.sourceRefs,
      });
    }
  }

  for (const row of args.rows.filter((entry) => entry.planningType === "make")) {
    const hasShortage = toQuantity(row.shortageQuantity) > 0;
    const bom = args.bomByProductId.get(row.item.id);
    if (hasShortage && (!bom || bom.components.length === 0)) {
      blockers.push({
        id: `production:blocker:missing-bom:${row.item.id}`,
        parentItemId: row.item.id,
        parentItemName: row.item.name,
        parentRecommendationId: row.recommendationId,
        componentItemId: null,
        componentItemName: null,
        componentUnitName: null,
        requiredQuantity: row.shortageQuantity,
        availableQuantity: row.availableStock,
        shortageQuantity: row.shortageQuantity,
        blockerType: "missing_bom",
        earliestRequiredDate: row.earliestRequiredDate,
        sourceRefs: row.sourceRefs,
      });
    }

  }

  for (const warning of args.warnings) {
    const blockerType =
      warning.code === "bom_cycle_detected"
        ? "bom_cycle_detected"
        : warning.code === "bom_depth_limit"
          ? "bom_depth_limit"
          : null;
    if (!blockerType || !warning.itemId) continue;
    const parent = rowsByItemId.get(warning.itemId);
    if (!parent) continue;

    blockers.push({
      id: `production:blocker:${blockerType}:${warning.itemId}`,
      parentItemId: parent.item.id,
      parentItemName: parent.item.name,
      parentRecommendationId: parent.recommendationId,
      componentItemId: null,
      componentItemName: null,
      componentUnitName: null,
      requiredQuantity: parent.shortageQuantity,
      availableQuantity: parent.availableStock,
      shortageQuantity: parent.shortageQuantity,
      blockerType,
      earliestRequiredDate: parent.earliestRequiredDate,
      sourceRefs: warning.sourceRefs,
    });
  }

  return blockers;
}

function warningForRow(args: {
  code: PlanningReasonCode;
  message: string;
  itemId: string;
  sourceRefs: PlanningSourceRef[];
}): PlanningWarning {
  return {
    code: args.code,
    severity: "warning",
    message: args.message,
    itemId: args.itemId,
    sourceRefs: args.sourceRefs,
  };
}

function buildRecommendations(args: {
  rows: PlanningItemRow[];
  itemsList: PlanningItemRecord[];
  bomByProductId: Map<string, CurrentBomRecord>;
  supplierSuggestions: Map<string, SupplierSuggestion>;
  inputHash: string;
}) {
  const itemById = new Map(args.itemsList.map((item) => [item.id, item]));
  const recommendations: PlanningRecommendation[] = [];
  const rowRecommendationIdByItem = new Map<string, string>();

  for (const row of args.rows) {
    const shortageQuantity = toQuantity(row.shortageQuantity);
    const recommendationQuantity =
      row.planningType === "buy" || row.planningType === "buy_or_make"
        ? row.suggestedOrderQuantity ?? row.shortageQuantity
        : row.shortageQuantity;
    if (
      toQuantity(recommendationQuantity) <= 0 ||
      (row.planningType !== "buy" &&
        row.planningType !== "buy_or_make" &&
        shortageQuantity <= 0)
    ) {
      continue;
    }

    const item = itemById.get(row.item.id);
    if (!item) {
      continue;
    }

    if (row.planningType === "buy" || row.planningType === "buy_or_make") {
      const supplierSuggestion = args.supplierSuggestions.get(item.id) ?? {
        supplierId: null,
        supplierName: null,
        supplierSku: null,
        supplierSource: "unknown" as PlanningRuleSource,
        unitCost: null,
        unitCostSource: "unknown" as PlanningRuleSource,
        purchaseUnitDefinitionId: item.purchaseUnitDefinitionId,
        purchaseUnitName: item.purchaseUnitName,
        purchaseToStockFactor: item.purchaseToStockFactor ?? "1",
        purchaseRuleSource: "item_default" as PlanningRuleSource,
        reasonCodes: ["missing_supplier"] satisfies PlanningReasonCode[],
      };
      const unitCost = row.unitCost ?? supplierSuggestion.unitCost;
      const purchaseToStockFactor =
        row.purchaseToStockFactor ?? supplierSuggestion.purchaseToStockFactor ?? "1";
      const hasPurchasePrice = unitCost != null && toQuantity(unitCost) >= 0;
      const warningCodes = [
        ...supplierSuggestion.reasonCodes,
        ...(!hasPurchasePrice
          ? ["missing_purchase_price" as const]
          : []),
      ];
      const recommendationType =
        warningCodes.length > 0 ? "review_item_setup" : "create_purchase_order";
      const recommendationId = buildRecommendationId({
        recommendationType,
        itemId: item.id,
        quantity: recommendationQuantity,
        sourceRefs: row.sourceRefs,
      });
      const warnings = warningCodes.map((code) =>
        warningForRow({
          code,
          itemId: item.id,
          sourceRefs: row.sourceRefs,
          message:
            code === "missing_purchase_price"
              ? `${item.name} needs a purchase price before planning can draft a purchase order.`
              : code === "ambiguous_supplier"
                ? `${item.name} has no item-specific supplier history and multiple suppliers exist.`
                : `${item.name} needs a supplier before planning can draft a purchase order.`,
        })
      );

      rowRecommendationIdByItem.set(item.id, recommendationId);
      recommendations.push({
        id: recommendationId,
        recommendationType,
        itemId: item.id,
        quantity: recommendationQuantity,
        requiredDate: row.earliestRequiredDate,
        suggestedSupplierId: supplierSuggestion.supplierId,
        suggestedSupplierName: supplierSuggestion.supplierName,
        suggestedBomRevisionId: null,
        reasonCodes: uniqueReasonCodes([
          ...row.reasonCodes,
          "buy_item",
          ...warningCodes,
        ]),
        sourceRefs: row.sourceRefs,
        warnings,
        actionPayload:
          recommendationType === "create_purchase_order" &&
          supplierSuggestion.supplierId != null &&
          hasPurchasePrice &&
          unitCost != null
            ? {
                actionType: "create_purchase_order",
                inputHash: args.inputHash,
                recommendationId,
                itemId: item.id,
                quantity: recommendationQuantity,
                requiredDate: row.earliestRequiredDate,
                supplierId: supplierSuggestion.supplierId,
                unitCost,
                purchaseUnitDefinitionId: row.purchaseUnitDefinitionId,
                purchaseToStockFactor,
                sourceRefs: row.sourceRefs,
              }
            : null,
        explanation:
          recommendationType === "create_purchase_order"
            ? `Draft a purchase order for ${recommendationQuantity} ${item.name}.`
            : `Review purchasing setup for ${item.name}.`,
      });
      if (row.planningType === "buy") {
        continue;
      }
    }

    if (row.planningType === "make" || row.planningType === "buy_or_make") {
      const bom = args.bomByProductId.get(item.id);
      const hasBom = Boolean(bom && bom.components.length > 0);
      const canDraftManufacturingOrder = hasBom;
      const manufacturingOrderQuantity = hasBom
        ? computeManufacturingOrderQuantity(bom, row.shortageQuantity)
        : row.shortageQuantity;
      const recommendationType = canDraftManufacturingOrder
        ? "create_manufacturing_order"
        : "review_item_setup";
      const recommendationId = buildRecommendationId({
        recommendationType,
        itemId: item.id,
        quantity: row.shortageQuantity,
        sourceRefs: row.sourceRefs,
      });
      const warnings = !hasBom
        ? [
            warningForRow({
              code: "missing_bom" as const,
              itemId: item.id,
              sourceRefs: row.sourceRefs,
              message: `${item.name} needs a current BOM before planning can draft a manufacturing order.`,
            }),
          ]
        : [];

      rowRecommendationIdByItem.set(item.id, recommendationId);
      recommendations.push({
        id: recommendationId,
        recommendationType,
        itemId: item.id,
        quantity: manufacturingOrderQuantity,
        requiredDate: row.earliestRequiredDate,
        suggestedSupplierId: null,
        suggestedSupplierName: null,
        suggestedBomRevisionId: bom?.revisionId ?? null,
        reasonCodes: uniqueReasonCodes([
          ...row.reasonCodes,
          "make_item",
          ...(!hasBom ? ["missing_bom" as const] : []),
        ]),
        sourceRefs: row.sourceRefs,
        warnings,
        actionPayload:
          canDraftManufacturingOrder && bom
            ? {
                actionType: "create_manufacturing_order",
                inputHash: args.inputHash,
                recommendationId,
                itemId: item.id,
                quantity: manufacturingOrderQuantity,
                requiredDate: row.earliestRequiredDate,
                latestStartDate: row.latestStartDate,
                bomRevisionId: bom.revisionId,
                ingredients: bom.components.map((component) => ({
                  itemId: component.componentId,
                  quantityPerUnit: component.quantity,
                })),
                sourceRefs: row.sourceRefs,
              }
            : null,
        explanation:
          recommendationType === "create_manufacturing_order"
            ? `Draft a manufacturing order for ${manufacturingOrderQuantity} ${item.name}.`
            : `Review manufacturing setup for ${item.name}.`,
      });
      continue;
    }

    const recommendationId = buildRecommendationId({
      recommendationType: "review_item_setup",
      itemId: item.id,
      quantity: row.shortageQuantity,
      sourceRefs: row.sourceRefs,
    });
    rowRecommendationIdByItem.set(item.id, recommendationId);
    recommendations.push({
      id: recommendationId,
      recommendationType: "review_item_setup",
      itemId: item.id,
      quantity: row.shortageQuantity,
      requiredDate: row.earliestRequiredDate,
      suggestedSupplierId: null,
      suggestedSupplierName: null,
      suggestedBomRevisionId: null,
      reasonCodes: row.reasonCodes,
      sourceRefs: row.sourceRefs,
      warnings: [],
      actionPayload: null,
      explanation: `Review planning setup for ${item.name}.`,
    });
  }

  const rows = args.rows.map((row) => ({
    ...row,
    recommendationId: rowRecommendationIdByItem.get(row.item.id) ?? null,
    suggestedAction:
      rowRecommendationIdByItem.has(row.item.id) && row.suggestedAction === "none"
        ? "review"
        : row.suggestedAction,
  }));

  return { rows, recommendations };
}

function addConstrainedComponentRecommendations(args: {
  rows: PlanningItemRow[];
  recommendations: PlanningRecommendation[];
  itemsList: PlanningItemRecord[];
  productionBlockerFacts: ProductionBlockerFact[];
  salesOrderProductionDemandPaths: ProductionDemandPath[];
  bomByProductId: Map<string, CurrentBomRecord>;
  inputHash: string;
}) {
  const itemById = new Map(args.itemsList.map((item) => [item.id, item]));
  const rowByItemId = new Map(args.rows.map((row) => [row.item.id, row]));
  const recommendationByItemId = new Map(
    args.recommendations.map((recommendation) => [
      recommendation.itemId,
      recommendation,
    ])
  );
  const blockersByComponentId = new Map<string, ProductionBlockerFact[]>();
  const hasDeeperMakePath = (blocker: ProductionBlockerFact) => {
    if (!blocker.componentItemId) return false;
    const salesOrderLineIds = new Set(
      blocker.sourceRefs
        .filter((ref) => ref.sourceType === "sales_order_line")
        .map((ref) => ref.sourceId)
    );

    return args.salesOrderProductionDemandPaths.some((path) => {
      if (
        salesOrderLineIds.size > 0 &&
        !salesOrderLineIds.has(path.terminal.salesOrderLineId)
      ) {
        return false;
      }

      const componentIndex = path.steps.findIndex(
        (step) => step.itemId === blocker.componentItemId
      );
      if (componentIndex <= 0) {
        return false;
      }

      const firstStep = path.steps[0];
      return itemById.get(firstStep.itemId)?.itemType === "product";
    });
  };

  for (const blocker of args.productionBlockerFacts) {
    if (
      blocker.blockerType !== "component_requirement" ||
      !blocker.componentItemId ||
      recommendationByItemId.has(blocker.componentItemId) ||
      hasDeeperMakePath(blocker)
    ) {
      continue;
    }

    const componentRow = rowByItemId.get(blocker.componentItemId);
    if (componentRow?.planningType !== "make") {
      continue;
    }

    const bucket = blockersByComponentId.get(blocker.componentItemId) ?? [];
    bucket.push(blocker);
    blockersByComponentId.set(blocker.componentItemId, bucket);
  }

  if (blockersByComponentId.size === 0) {
    return { rows: args.rows, recommendations: args.recommendations };
  }

  const addedRecommendations: PlanningRecommendation[] = [];
  const recommendationIdByItemId = new Map<string, string>();

  for (const [componentItemId, blockers] of blockersByComponentId) {
    const row = rowByItemId.get(componentItemId);
    const item = itemById.get(componentItemId);
    if (!row || !item) {
      continue;
    }

    const quantity = normalizeQuantity(
      blockers.reduce(
        (sum, blocker) => sum + toQuantity(blocker.shortageQuantity),
        0
      )
    );
    if (toQuantity(quantity) <= 0) {
      continue;
    }

    const bom = args.bomByProductId.get(componentItemId);
    const hasBom = Boolean(bom && bom.components.length > 0);
    const manufacturingOrderQuantity = hasBom
      ? computeManufacturingOrderQuantity(bom, quantity)
      : quantity;
    const recommendationType = hasBom
      ? "create_manufacturing_order"
      : "review_item_setup";
    const sourceRefs = uniqueSourceRefs([
      itemRef(item),
      ...blockers.flatMap((blocker) => blocker.sourceRefs),
    ]);
    const recommendationId = buildRecommendationId({
      recommendationType,
      itemId: componentItemId,
      quantity,
      sourceRefs,
    });
    const requiredDate = earliestDate(
      blockers.map((blocker) => blocker.earliestRequiredDate)
    );
    const warnings = !hasBom
      ? [
          warningForRow({
            code: "missing_bom" as const,
            itemId: componentItemId,
            sourceRefs,
            message: `${item.name} needs a current BOM before planning can draft a manufacturing order.`,
          }),
        ]
      : [];

    recommendationIdByItemId.set(componentItemId, recommendationId);
    addedRecommendations.push({
      id: recommendationId,
      recommendationType,
      itemId: componentItemId,
      quantity: manufacturingOrderQuantity,
      requiredDate,
      suggestedSupplierId: null,
      suggestedSupplierName: null,
      suggestedBomRevisionId: bom?.revisionId ?? null,
      reasonCodes: uniqueReasonCodes([
        ...row.reasonCodes,
        "bom_component_demand",
        "make_item",
        "projected_shortage",
        ...(!hasBom ? ["missing_bom" as const] : []),
      ]),
      sourceRefs,
      warnings,
      actionPayload:
        hasBom && bom
          ? {
              actionType: "create_manufacturing_order",
              inputHash: args.inputHash,
              recommendationId,
              itemId: componentItemId,
              quantity: manufacturingOrderQuantity,
              requiredDate,
              latestStartDate: requiredDate,
              bomRevisionId: bom.revisionId,
              ingredients: bom.components.map((component) => ({
                itemId: component.componentId,
                quantityPerUnit: component.quantity,
              })),
              sourceRefs,
            }
          : null,
      explanation:
        recommendationType === "create_manufacturing_order"
          ? `Draft a manufacturing order for ${manufacturingOrderQuantity} ${item.name}.`
          : `Review manufacturing setup for ${item.name}.`,
    });
  }

  if (addedRecommendations.length === 0) {
    return { rows: args.rows, recommendations: args.recommendations };
  }

  const rows = args.rows.map((row) => {
    const recommendationId = recommendationIdByItemId.get(row.item.id);
    if (!recommendationId) {
      return row;
    }

    return {
      ...row,
      recommendationId,
      suggestedAction: "make" as const,
    };
  });

  return {
    rows,
    recommendations: [...args.recommendations, ...addedRecommendations],
  };
}

export async function buildPlanningSnapshotInTx(
  tx: Tx,
  orgId: string,
  generatedAt: Date = new Date()
): Promise<PlanningSnapshot> {
  const [org] = await tx
    .select({ timeZone: organization.timeZone })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  const horizonStart = dateInTimeZone(generatedAt, org?.timeZone ?? "America/Denver");
  const horizonEnd = addDays(horizonStart, DEFAULT_COVER_HORIZON_DAYS);
  const itemsList = await getPlanningItemsInTx(tx);
  const productIds = itemsList
    .filter((item) => item.itemType === "product")
    .map((item) => item.id);
  const salesDemandFacts = await getSalesDemandFactsInTx(tx);
  const manufacturingComponentDemandFacts =
    await getOpenManufacturingComponentDemandFactsInTx(tx);
  const purchaseSupplyFacts = await getPurchaseSupplyFactsInTx(tx);
  const manufacturingSupplyFacts = await getManufacturingSupplyFactsInTx(tx);
  const bomByProductId = await getCurrentBomsInTx(tx, productIds);
  const supplierSuggestions = await getSupplierSuggestionsInTx(tx, itemsList);
  const inventoryFacts = getInventoryFacts(itemsList);
  const defaultLocation = await getDefaultInventoryLocationInTx(tx, orgId);
  const availableLots = await getAvailableLotFactsInTx(
    tx,
    orgId,
    defaultLocation.id
  );
  const supplyFacts = [
    ...getInventorySupplyFacts(itemsList, inventoryFacts),
    ...purchaseSupplyFacts,
    ...manufacturingSupplyFacts,
  ];
  const baseDemandFacts = [
    ...salesDemandFacts,
    ...getSafetyStockDemandFacts(itemsList),
    ...manufacturingComponentDemandFacts,
  ];
  const itemById = new Map(itemsList.map((item) => [item.id, item]));
  const salesOrderProductionDemandPaths = buildSalesOrderProductionDemandPaths({
    itemsList,
    baseDemandFacts,
    supplyFacts,
    bomByProductId,
    availableLots,
  });
  const initialWarnings: PlanningWarning[] = [];
  const initialExplosion = buildRowsWithBomExplosion({
    itemsList,
    baseDemandFacts,
    supplyFacts,
    inventoryFacts,
    bomByProductId,
    supplierSuggestions,
    horizonStart,
    warnings: initialWarnings,
  });
  const initialProductionBlockerFacts = buildProductionBlockerFacts({
    rows: initialExplosion.rows,
    bomRequirementFacts: initialExplosion.bomRequirementFacts,
    bomByProductId,
    availableLots,
    horizonStart,
    warnings: initialWarnings,
  });
  const supplementalDemandFacts = buildSupplementalProductionPathDemandFacts({
    paths: salesOrderProductionDemandPaths,
    existingDemandFacts: initialExplosion.demandFacts,
    productionBlockerFacts: initialProductionBlockerFacts,
    itemById,
  });
  const planningDemandFacts = [
    ...baseDemandFacts,
    ...supplementalDemandFacts,
  ];
  const warnings: PlanningWarning[] = [];
  const { rows: explodedRows, demandFacts, bomRequirementFacts } =
    buildRowsWithBomExplosion({
      itemsList,
      baseDemandFacts: planningDemandFacts,
      supplyFacts,
      inventoryFacts,
      bomByProductId,
      supplierSuggestions,
      horizonStart,
      warnings,
    });
  const assumptions = [
    {
      code: "single_default_location",
      description: "Inventory quantities use the default location projection.",
    },
    {
      code: "quality_disposition_not_configured",
      description: "No quality disposition table exists in this schema, so projected on-hand stock is treated as usable.",
    },
    {
      code: "current_bom_only",
      description: `BOM explosion uses current BOM revisions and stops after ${MAX_BOM_EXPLOSION_LEVEL} levels or at cycles.`,
    },
    {
      code: "supplier_resolution_order",
      description: "Supplier planning uses preferred supplier-item rules, then purchase history, then the sole active supplier.",
    },
  ];
  const inputHash = hashValue({
    assumptions,
    items: itemsList,
    inventoryFacts,
    availableLots,
    demandFacts,
    supplyFacts,
    bomRequirementFacts,
    salesOrderProductionDemandPaths,
    supplierSuggestions: [...supplierSuggestions.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    ),
    warnings,
  });
  let { rows, recommendations } = buildRecommendations({
    rows: explodedRows,
    itemsList,
    bomByProductId,
    supplierSuggestions,
    inputHash,
  });
  const productionBlockerFacts = buildProductionBlockerFacts({
    rows,
    bomRequirementFacts,
    bomByProductId,
    availableLots,
    horizonStart,
    warnings,
  });
  ({ rows, recommendations } = addConstrainedComponentRecommendations({
    rows,
    recommendations,
    itemsList,
    productionBlockerFacts,
    salesOrderProductionDemandPaths,
    bomByProductId,
    inputHash,
  }));

  return {
    orgId,
    generatedAt: generatedAt.toISOString(),
    horizonStart,
    horizonEnd,
    inputHash,
    assumptions,
    rows,
    demandFacts: demandFacts.map((fact) => ({
      id: fact.id,
      itemId: fact.itemId,
      demandType: fact.demandType,
      quantity: fact.quantity,
      requiredDate: fact.requiredDate,
      reasonCodes: fact.reasonCodes,
      sourceRefs: fact.sourceRefs,
      parentItemId: fact.parentItemId,
      parentDemandFactId: fact.parentDemandFactId,
      bomRevisionId: fact.bomRevisionId,
      explanation: fact.explanation,
    })),
    supplyFacts,
    inventoryFacts,
    bomRequirementFacts,
    productionBlockerFacts,
    salesOrderProductionDemandPaths,
    recommendations,
    warnings: [
      ...warnings,
      ...recommendations.flatMap((recommendation) => recommendation.warnings),
    ],
  };
}

export async function getPlanningSnapshot(options?: {
  generatedAt?: Date;
}): Promise<PlanningSnapshot> {
  return withAuthedOrgContext((tx, orgId) =>
    buildPlanningSnapshotInTx(tx, orgId, options?.generatedAt ?? new Date())
  );
}
