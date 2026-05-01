"use client";

import {
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type FilterFn } from "@tanstack/react-table";
import {
  Add01Icon,
  Alert01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Factory01Icon,
  Layers01Icon,
  MoreHorizontalIcon,
  Package01Icon,
  Search01Icon,
  ShoppingCart01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import { SortableHeader } from "@/components/sortable-header";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatQuantity,
  normalizeNumeric,
} from "@/lib/format";
import {
  PLANNING_NEED_TOOLTIP,
  PLANNING_NEEDED_BY_TOOLTIP,
  PLANNING_SHORT_TOOLTIP,
  SAFETY_STOCK_TOOLTIP,
} from "@/lib/tooltip-copy";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { PlanningHeader } from "./planning-header";
import type {
  BomRequirementFact,
  DemandFact,
  InventoryFact,
  PlanningActionPayload,
  PlanningItemRow,
  PlanningRecommendation,
  PlanningSnapshot,
  PlanningSourceRef,
  ProductionDemandPath,
  ProductionBlockerFact,
  SupplyFact,
} from "@/lib/planning/types";

type ActionResult = {
  id: string;
};

type PlanningActionErrorState = {
  message: string;
  href?: string;
  linkLabel?: string;
  refresh?: boolean;
};

type OperationalRow = {
  row: PlanningItemRow;
  recommendation: PlanningRecommendation | null;
  demandFacts: DemandFact[];
  supplyFacts: SupplyFact[];
  inventoryFact: InventoryFact | null;
  bomFacts: BomRequirementFact[];
  demandPaths: ProductionDemandPath[];
  neededFor: string;
  statusLabel: string;
  actionLabel: string;
  actionSummary: string;
  componentShortageCount: number;
  makeDependencyCount: number;
  productionBlockers: ProductionBlockerFact[];
  isAttention: boolean;
};

type PlanningPermissions = {
  canCreatePurchaseOrders: boolean;
  canCreateManufacturingOrders: boolean;
  canUpdatePlanningRules: boolean;
};

type AttentionGroup = {
  key: string;
  label: string;
  actionLabel: string;
  rows: OperationalRow[];
  earliestRequiredDate: string | null;
  salesOrderCount: number;
};

type DetailTarget =
  | { kind: "row"; key: string }
  | { kind: "attention"; key: string };

type PlanningTab = "production" | "replenishment";

type ProductionBucketKey = "now" | "this-week" | "next-week" | "later";

type ProductionWorkItem = {
  entry: OperationalRow;
  bucket: ProductionBucketKey;
  urgency: "critical" | "blocked" | "normal";
  downstreamCount: number;
  coveredByStock?: boolean;
};

type ReplenishmentItem = {
  id: string;
  entry: OperationalRow;
  status: "order-now" | "order-soon" | "stocked" | "unknown";
  supplierName: string;
  projectedStock: number;
  safetyStock: number;
};

type ReplenishmentStatusFilter = "all" | ReplenishmentItem["status"];
type ProductionViewFilter = "needs-action" | "covered";

function toQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function replenishmentStatusFromDaysOfCover(
  status: PlanningItemRow["daysOfCoverStatus"]
): ReplenishmentItem["status"] {
  if (status === "order_now") return "order-now";
  if (status === "order_soon") return "order-soon";
  return status;
}

function productionBlockerLabel(entry: OperationalRow) {
  if (entry.makeDependencyCount > 0) {
    return "Sub-assemblies needed";
  }

  if (entry.productionBlockers.some((blocker) => blocker.blockerType === "material_shortage")) {
    return "Materials short";
  }

  return "Waits on setup";
}

function formatQuantityWithUnit(value: string | null | undefined, unitName: string | null) {
  return [formatQuantity(value), unitName].filter(Boolean).join(" ");
}

function itemUnit(row: PlanningItemRow) {
  return row.item.unitName ?? row.item.unitUom;
}

const drawerTextWrapClass =
  "min-w-0 !whitespace-normal break-words [overflow-wrap:anywhere]";
const drawerNumericWrapClass = cn(
  drawerTextWrapClass,
  "text-right tabular-nums"
);

function planningRowKey(row: OperationalRow) {
  return `item:${row.row.item.id}`;
}

function formatRowQuantity(row: PlanningItemRow, value: string | null | undefined) {
  return formatQuantityWithUnit(value, itemUnit(row));
}

function purchaseUnit(row: PlanningItemRow) {
  return row.purchaseUnitName ?? itemUnit(row);
}

function formatPurchaseQuantity(row: PlanningItemRow, value: string | null | undefined) {
  const factor = toQuantity(row.purchaseToStockFactor ?? "1");
  if (!row.purchaseUnitName || factor <= 0) {
    return formatRowQuantity(row, value);
  }

  return formatQuantityWithUnit(
    normalizeNumeric(toQuantity(value) / factor),
    purchaseUnit(row)
  );
}

function compactPackageLabel(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/\bCubic Foot\b/gi, "cf")
    .replace(/\bCubic Feet\b/gi, "cf")
    .replace(/\bYard\b/gi, "yd")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function displayPackageLabel(row: PlanningItemRow) {
  return (
    compactPackageLabel(row.item.displayAttrs[0]) ??
    compactPackageLabel(row.item.unitName) ??
    row.item.unitUom
  );
}

function quantityUnitLabel(row: PlanningItemRow) {
  const packageLabel = displayPackageLabel(row);
  if (!packageLabel) return itemUnit(row);

  if (/\bbags?\b/.test(packageLabel)) return "bags";
  if (/\btotes?\b/.test(packageLabel)) return "totes";
  if (/\bpacks?\b/.test(packageLabel)) return "packs";
  if (/\brolls?\b/.test(packageLabel)) return "rolls";
  if (/\bpal(lets?)?\b/.test(packageLabel)) return "pallets";
  if (/\beach\b/.test(packageLabel)) return "ea";

  return itemUnit(row);
}

function singularOutputUnit(unit: string | null) {
  if (!unit) return null;
  if (unit === "bags") return "bag";
  if (unit === "totes") return "tote";
  if (unit === "packs") return "pack";
  if (unit === "rolls") return "roll";
  if (unit === "pallets") return "pallet";
  return unit;
}

function isDiscreteOutputUnit(unit: string | null) {
  return Boolean(unit && /^(bags?|totes?|packs?|rolls?|pallets?|ea)$/.test(unit));
}

function productionQuantityParts(row: PlanningItemRow, value: string | null | undefined) {
  const unit = quantityUnitLabel(row);
  return displayQuantityParts(value, unit);
}

function displayQuantityParts(value: string | null | undefined, unit: string | null) {
  const parsed = Number.parseFloat(value ?? "0");

  if (!Number.isFinite(parsed)) {
    return { quantity: formatQuantity(value), unit };
  }

  if (!isDiscreteOutputUnit(unit)) {
    return { quantity: formatQuantity(value), unit };
  }

  const quantity = Math.ceil(parsed);
  return {
    quantity: String(quantity),
    unit: quantity === 1 ? singularOutputUnit(unit) : unit,
  };
}

function packageText(row: PlanningItemRow) {
  const label = displayPackageLabel(row);
  if (!label) return null;
  const unit = quantityUnitLabel(row);
  if (label === unit) return singularOutputUnit(unit);
  return label;
}

function salesOrderQueueLabel(row: OperationalRow) {
  const salesOrders = uniqueSalesOrderLabels(row.demandFacts).map(normalizeSalesOrderLabel);
  if (salesOrders.length === 1) return salesOrders[0];
  if (salesOrders.length > 1) return `${salesOrders[0]} +${salesOrders.length - 1} more`;
  return row.neededFor;
}

function normalizeSalesOrderLabel(label: string) {
  return label.replace(/^so-/i, "SO-");
}

function formatShortDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isPastDate(value: string | null) {
  const days = daysUntil(value);
  return days != null && days < 0;
}

function daysUntil(value: string | null) {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${value}T00:00:00`);
  const diffMs = date.getTime() - today.getTime();
  return Math.round(diffMs / 86_400_000);
}

function requiredDateSortValue(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
}

function compareRequiredDates(left: string | null, right: string | null) {
  return requiredDateSortValue(left) - requiredDateSortValue(right);
}

function earliestDate(values: Array<string | null>) {
  const dates = values.filter((value): value is string => Boolean(value));
  return dates.length > 0 ? dates.sort()[0] : null;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  return [...byKey.values()];
}

function uniqueSourceLabels(facts: DemandFact[], sourceType: PlanningSourceRef["sourceType"]) {
  return [
    ...new Set(
      facts
        .flatMap((fact) => fact.sourceRefs)
        .filter((ref) => ref.sourceType === sourceType)
        .map((ref) => ref.label)
    ),
  ];
}

function uniqueSalesOrderLabels(facts: DemandFact[]) {
  return uniqueSourceLabels(facts, "sales_order");
}

function sourceHref(ref: PlanningSourceRef) {
  if (ref.sourceType === "sales_order") return `/sales/orders/${ref.sourceId}`;
  if (ref.sourceType === "purchase_order") return `/purchasing/orders/${ref.sourceId}`;
  if (ref.sourceType === "manufacturing_order") {
    return `/manufacturing/orders/${ref.sourceId}`;
  }
  return null;
}

function pathPackageLabel(step: ProductionDemandPath["steps"][number]) {
  return (
    compactPackageLabel(step.displayAttrs[0]) ??
    compactPackageLabel(step.unitName) ??
    null
  );
}

function pathQuantityUnitLabel(step: ProductionDemandPath["steps"][number]) {
  const packageLabel = pathPackageLabel(step);
  if (!packageLabel) return step.unitName;

  if (/\bbags?\b/.test(packageLabel)) return "bags";
  if (/\btotes?\b/.test(packageLabel)) return "totes";
  if (/\bpacks?\b/.test(packageLabel)) return "packs";
  if (/\brolls?\b/.test(packageLabel)) return "rolls";
  if (/\bpal(lets?)?\b/.test(packageLabel)) return "pallets";
  if (/\beach\b/.test(packageLabel)) return "ea";

  return step.unitName;
}

function pathQuantityParts(step: ProductionDemandPath["steps"][number]) {
  return displayQuantityParts(step.quantityRequired, pathQuantityUnitLabel(step));
}

function terminalPackageLabel(terminal: ProductionDemandPath["terminal"]) {
  return compactPackageLabel(terminal.displayAttrs[0]);
}

function downstreamCardSummary(paths: ProductionDemandPath[]) {
  if (paths.length === 0) return null;

  const firstPath = paths[0];
  const terminalName =
    firstPath.terminal.displayName || firstPath.terminal.itemName;
  const packageLabel = terminalPackageLabel(firstPath.terminal);
  const target = [terminalName, packageLabel].filter(Boolean).join(" · ");
  const suffix =
    paths.length === 1
      ? normalizeSalesOrderLabel(firstPath.terminal.salesOrderLabel)
      : `${paths.length} downstream orders`;

  return `Feeds ${target} · ${suffix}`;
}

function summarizeNeededFor(facts: DemandFact[]) {
  const salesOrders = uniqueSourceLabels(facts, "sales_order");
  if (salesOrders.length === 1) return salesOrders[0];
  if (salesOrders.length > 1) return `${salesOrders.length} sales orders`;

  const manufacturingOrders = uniqueSourceLabels(facts, "manufacturing_order");
  if (manufacturingOrders.length === 1) return "Internal manufacturing demand";
  if (manufacturingOrders.length > 1) return `${manufacturingOrders.length} internal demands`;

  if (facts.some((fact) => fact.demandType === "safety_stock")) {
    return "Safety stock";
  }

  if (facts.some((fact) => fact.demandType === "bom_explosion")) {
    return "Parent shortages";
  }

  return "Demand";
}

function getActionLabel(
  row: PlanningItemRow,
  recommendation: PlanningRecommendation | null,
  componentShortageCount: number,
  makeDependencyCount = 0
) {
  const reasonCodes = combinedReasonCodes(row, recommendation);

  if (!recommendation || recommendation.recommendationType === "none") {
    return toQuantity(row.shortageQuantity) > 0 ? "Review" : "No action";
  }

  if (recommendation.recommendationType === "create_purchase_order") {
    return "Create PO";
  }

  if (recommendation.recommendationType === "create_manufacturing_order") {
    if (makeDependencyCount > 0) return "Review sub-assemblies";
    return componentShortageCount > 0 ? "Review shortages" : "Create MO";
  }

  if (reasonCodes.has("missing_supplier")) return "Assign supplier";
  if (reasonCodes.has("ambiguous_supplier")) return "Choose supplier";
  if (reasonCodes.has("missing_purchase_price")) return "Add price";

  if (
    reasonCodes.has("missing_bom") ||
    reasonCodes.has("bom_cycle_detected") ||
    reasonCodes.has("bom_depth_limit")
  ) {
    return "Fix BOM";
  }

  return "Fix setup";
}

function getActionSummary(
  row: PlanningItemRow,
  recommendation: PlanningRecommendation | null,
  componentShortageCount: number,
  makeDependencyCount = 0
) {
  const quantity = formatRowQuantity(row, row.shortageQuantity);

  if (!recommendation || recommendation.recommendationType === "none") {
    return toQuantity(row.shortageQuantity) > 0
      ? "Review this shortage before production or sales are blocked."
      : "Stock and open supply cover known demand.";
  }

  if (recommendation.recommendationType === "create_purchase_order") {
    const supplier = recommendation.suggestedSupplierName ?? "preferred supplier";
    return `Buy ${formatPurchaseQuantity(row, recommendation.quantity)} from ${supplier}.`;
  }

  if (recommendation.recommendationType === "create_manufacturing_order") {
    if (makeDependencyCount > 0) {
      return `${makeDependencyCount} sub-${makeDependencyCount === 1 ? "assembly" : "assemblies"} must be made before this build.`;
    }

    if (componentShortageCount > 0) {
      return `${componentShortageCount} material ${componentShortageCount === 1 ? "shortage" : "shortages"} need attention before this build.`;
    }

    return `Make ${quantity}.`;
  }

  return recommendation.explanation;
}

function getStatus(
  row: PlanningItemRow,
  recommendation: PlanningRecommendation | null,
  componentShortageCount: number,
  makeDependencyCount = 0
): string {
  const reasonCodes = combinedReasonCodes(row, recommendation);

  if (recommendation?.recommendationType === "review_item_setup") {
    if (reasonCodes.has("missing_supplier")) return "Missing supplier";
    if (reasonCodes.has("ambiguous_supplier")) return "Choose supplier";
    if (reasonCodes.has("missing_purchase_price")) return "Missing price";
    if (reasonCodes.has("missing_bom")) {
      return "BOM missing";
    }

    return "Setup issue";
  }

  if (row.planningType === "buy" && recommendation) {
    return "Ready to order";
  }

  if (recommendation?.recommendationType === "create_manufacturing_order") {
    if (makeDependencyCount > 0) {
      return "Sub-assemblies needed";
    }

    if (componentShortageCount > 0) {
      return "Materials short";
    }

    return "Ready to build";
  }

  if (recommendation?.recommendationType === "create_purchase_order") {
    if (row.daysOfCoverStatus === "unknown") {
      return "Review rules";
    }

    return "Ready to order";
  }

  if (toQuantity(row.shortageQuantity) > 0) {
    return "Blocked";
  }

  return "Covered";
}

function isSetupIssue(entry: OperationalRow) {
  return (
    entry.recommendation?.recommendationType === "review_item_setup" ||
    Array.from(entryReasonCodes(entry)).some((code) =>
      [
        "missing_bom",
        "bom_cycle_detected",
        "bom_depth_limit",
        "stale_recommendation",
        "duplicate_draft_action",
      ].includes(code)
    )
  );
}

function setupProblemLabel(row: OperationalRow) {
  const reasonCodes = entryReasonCodes(row);

  if (reasonCodes.has("missing_supplier")) return "Missing supplier";
  if (reasonCodes.has("ambiguous_supplier")) return "Choose supplier";
  if (reasonCodes.has("missing_purchase_price")) return "Missing price";
  if (reasonCodes.has("missing_bom")) return "Missing BOM";
  if (reasonCodes.has("bom_cycle_detected")) return "BOM cycle";
  if (reasonCodes.has("bom_depth_limit")) return "BOM too deep";
  if (reasonCodes.has("duplicate_draft_action")) return "Draft exists";
  if (reasonCodes.has("stale_recommendation")) return "Plan changed";
  return "Review setup";
}

function canExecuteAction(row: OperationalRow, permissions: PlanningPermissions) {
  const payload = row.recommendation?.actionPayload;
  if (!payload) return false;

  if (payload.actionType === "create_purchase_order") {
    return permissions.canCreatePurchaseOrders;
  }

  return permissions.canCreateManufacturingOrders && row.productionBlockers.length === 0;
}

function setupActionHref(row: OperationalRow) {
  const reasonCodes = entryReasonCodes(row);

  if (reasonCodes.has("missing_supplier")) return "/purchasing/suppliers/new";
  if (reasonCodes.has("ambiguous_supplier")) {
    return `/inventory/materials/${row.row.item.id}/edit`;
  }
  if (reasonCodes.has("missing_purchase_price")) {
    return `/inventory/materials/${row.row.item.id}/edit`;
  }
  if (
    reasonCodes.has("missing_bom") ||
    reasonCodes.has("bom_cycle_detected") ||
    reasonCodes.has("bom_depth_limit")
  ) {
    return `/inventory/products/${row.row.item.id}/edit`;
  }
  return row.row.item.itemType === "product"
    ? `/inventory/products/${row.row.item.id}`
    : `/inventory/materials/${row.row.item.id}`;
}

function combinedReasonCodes(
  row: PlanningItemRow,
  recommendation: PlanningRecommendation | null
) {
  return new Set([...(row.reasonCodes ?? []), ...(recommendation?.reasonCodes ?? [])]);
}

function entryReasonCodes(row: OperationalRow) {
  return combinedReasonCodes(row.row, row.recommendation);
}

function isReadyPurchaseRow(row: OperationalRow) {
  return (
    row.row.planningType === "buy" &&
    !isSetupIssue(row) &&
    row.recommendation?.actionPayload?.actionType === "create_purchase_order"
  );
}

function canOpenPurchaseOrderForm(item: ReplenishmentItem) {
  return canOpenPurchaseOrderFormForRow(item.entry);
}

function canOpenPurchaseOrderFormForRow(row: OperationalRow) {
  return (
    row.row.planningType === "buy" &&
    replenishmentStatusFromDaysOfCover(row.row.daysOfCoverStatus) !== "stocked"
  );
}

function isReadyManufacturingRow(row: OperationalRow) {
  return (
    row.row.planningType === "make" &&
    !isSetupIssue(row) &&
    row.productionBlockers.length === 0 &&
    row.recommendation?.actionPayload?.actionType === "create_manufacturing_order"
  );
}

function isAttentionBlocker(row: OperationalRow) {
  return (
    row.isAttention &&
    !isReadyPurchaseRow(row) &&
    !isReadyManufacturingRow(row)
  );
}

function salesOrderCount(row: OperationalRow) {
  return uniqueSalesOrderLabels(row.demandFacts).length;
}

function formatOrderCount(count: number) {
  return `${count} ${count === 1 ? "order" : "orders"}`;
}

function formatAffects(count: number) {
  return `affects ${formatOrderCount(count)}`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function bucketTitle(bucket: ProductionBucketKey, horizonStart: string | null) {
  if (bucket === "now") return "Start today";
  if (!horizonStart) {
    if (bucket === "this-week") return "This week";
    if (bucket === "next-week") return "Next week";
    return "Later";
  }

  if (bucket === "this-week") {
    return `${formatShortDate(addIsoDays(horizonStart, 1))} - ${formatShortDate(
      addIsoDays(horizonStart, 7)
    )}`;
  }

  if (bucket === "next-week") {
    return `${formatShortDate(addIsoDays(horizonStart, 8))} - ${formatShortDate(
      addIsoDays(horizonStart, 14)
    )}`;
  }

  return `${formatShortDate(addIsoDays(horizonStart, 15))}+`;
}

function attentionProblemLabel(row: OperationalRow) {
  if (row.row.planningType === "make" && row.makeDependencyCount > 0) {
    return "Sub-assemblies needed";
  }

  if (row.row.planningType === "make" && row.componentShortageCount > 0) {
    return "Materials short";
  }

  return setupProblemLabel(row);
}

function attentionImpact(row: OperationalRow) {
  if (row.row.planningType === "make" && row.makeDependencyCount > 0) {
    return `${row.makeDependencyCount} sub-${
      row.makeDependencyCount === 1 ? "assembly" : "assemblies"
    } needed`;
  }

  if (row.row.planningType === "make" && row.componentShortageCount > 0) {
    return `${row.componentShortageCount} ${
      row.componentShortageCount === 1 ? "material" : "materials"
    } short`;
  }

  const orders = salesOrderCount(row);
  if (orders > 0) return `Blocking ${formatOrderCount(orders)}`;

  return row.neededFor;
}

function hasQueueImpact(row: OperationalRow) {
  return Boolean(row.row.earliestRequiredDate) && salesOrderCount(row) > 0;
}

function hasDirectSalesOrderDemand(row: OperationalRow) {
  return row.demandFacts.some((fact) => fact.demandType === "sales_order");
}

function isCoveredSalesOrderRow(row: OperationalRow) {
  return (
    row.row.planningType === "make" &&
    hasDirectSalesOrderDemand(row) &&
    toQuantity(row.row.shortageQuantity) <= 0 &&
    !row.recommendation &&
    row.productionBlockers.length === 0
  );
}

function compareQueuePriority(left: OperationalRow, right: OperationalRow) {
  const leftRank = productionPriorityRank(left);
  const rightRank = productionPriorityRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const orderSort = salesOrderCount(right) - salesOrderCount(left);
  if (orderSort !== 0) return orderSort;

  const dateSort = compareRequiredDates(
    left.row.earliestRequiredDate,
    right.row.earliestRequiredDate
  );
  if (dateSort !== 0) return dateSort;

  return left.row.item.name.localeCompare(right.row.item.name);
}

function productionPriorityRank(row: OperationalRow) {
  const hasDownstreamDemand = row.demandPaths.length > 0;
  const readyToMake =
    row.recommendation?.actionPayload?.actionType === "create_manufacturing_order" &&
    row.componentShortageCount === 0 &&
    row.makeDependencyCount === 0 &&
    !isSetupIssue(row);

  if (hasDownstreamDemand && readyToMake) return 0;
  if (hasDownstreamDemand && row.makeDependencyCount === 0) return 1;
  if (readyToMake) return 2;
  if (hasDownstreamDemand) return 3;
  if (row.makeDependencyCount > 0) return 4;
  return 5;
}

function buildProductionWorkItems(
  rows: OperationalRow[],
  options: { coveredByStock?: boolean } = {}
): ProductionWorkItem[] {
  return rows
    .filter((entry) => entry.row.planningType === "make")
    .map((entry) => {
      const days = daysUntil(entry.row.latestStartDate ?? entry.row.earliestRequiredDate);
      const isBlocked =
        entry.makeDependencyCount > 0 ||
        entry.componentShortageCount > 0 ||
        isSetupIssue(entry);
      const urgency: ProductionWorkItem["urgency"] = isBlocked
        ? "blocked"
        : days != null && days <= 7
          ? "critical"
          : "normal";

      return {
        entry,
        bucket: entry.row.productionBucket,
        urgency,
        coveredByStock: options.coveredByStock,
        downstreamCount: Math.max(
          entry.demandPaths.length,
          entry.row.plannedBatchCount ?? 0
        ),
      };
    })
    .sort((left, right) => compareQueuePriority(left.entry, right.entry));
}

function bucketLabel(bucket: ProductionBucketKey) {
  if (bucket === "now") return "Now";
  if (bucket === "this-week") return "This week";
  if (bucket === "next-week") return "Next week";
  return "Later";
}

function demandSku(row: PlanningItemRow) {
  return row.item.sku ?? row.item.itemType;
}

function buildReplenishmentItems(rows: OperationalRow[]): ReplenishmentItem[] {
  return rows
    .filter((entry) => entry.row.planningType === "buy")
    .map((entry) => {
      const safetyStock = Math.max(0, toQuantity(entry.row.safetyStock));
      const onHandStock =
        entry.inventoryFact != null
          ? toQuantity(entry.inventoryFact.onHandQuantity)
          : toQuantity(entry.row.availableStock) + toQuantity(entry.row.reservedQuantity);
      const incomingSupply = entry.supplyFacts.reduce(
        (sum, fact) =>
          fact.supplyType === "available_inventory"
            ? sum
            : sum + toQuantity(fact.quantity),
        0
      );
      const nonSafetyDemand = entry.demandFacts.reduce(
        (sum, fact) =>
          fact.demandType === "safety_stock"
            ? sum
            : sum + toQuantity(fact.quantity),
        0
      );
      const projectedStock = Math.max(0, onHandStock + incomingSupply - nonSafetyDemand);
      const status = replenishmentStatusFromDaysOfCover(entry.row.daysOfCoverStatus);

      return {
        id: entry.row.item.id,
        entry,
        status,
        supplierName:
          entry.row.preferredSupplierName ??
          entry.recommendation?.suggestedSupplierName ??
          "Supplier needed",
        projectedStock,
        safetyStock,
      };
    })
    .sort(compareReplenishmentPriority);
}

function compareReplenishmentPriority(left: ReplenishmentItem, right: ReplenishmentItem) {
  const statusSort =
    ["order-now", "order-soon", "unknown", "stocked"].indexOf(left.status) -
    ["order-now", "order-soon", "unknown", "stocked"].indexOf(right.status);
  if (statusSort !== 0) return statusSort;
  const leftRatio =
    left.safetyStock > 0 ? left.projectedStock / left.safetyStock : Number.MAX_SAFE_INTEGER;
  const rightRatio =
    right.safetyStock > 0 ? right.projectedStock / right.safetyStock : Number.MAX_SAFE_INTEGER;
  if (leftRatio !== rightRatio) return leftRatio - rightRatio;
  return left.entry.row.item.name.localeCompare(right.entry.row.item.name);
}

function matchesPlanningSearch(entry: OperationalRow, normalizedSearch: string) {
  if (normalizedSearch === "") return true;

  const searchText = [
    entry.row.item.name,
    entry.row.item.sku,
    entry.neededFor,
    entry.actionLabel,
    entry.actionSummary,
    entry.statusLabel,
    entry.row.daysOfCoverStatus,
    entry.recommendation?.suggestedSupplierName,
    entry.row.preferredSupplierName,
    entry.row.preferredSupplierSku,
    ...entry.demandFacts.flatMap((fact) => fact.sourceRefs.map((ref) => ref.label)),
    ...entry.demandPaths.flatMap((path) => [
      path.terminal.salesOrderLabel,
      path.terminal.customerName,
      path.terminal.displayName,
      ...path.steps.map((step) => step.displayName || step.itemName),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchText.includes(normalizedSearch);
}

function actionLabelForAttentionGroup(label: string) {
  if (label === "Materials short") return "Review shortages";
  if (label === "Missing supplier" || label === "Choose supplier") return "Assign supplier";
  if (label === "Missing price") return "Add price";
  if (label.includes("BOM")) return "Fix BOM";
  return "Review";
}

function buildAttentionGroups(rows: OperationalRow[]) {
  const groups = new Map<string, AttentionGroup>();

  for (const row of rows.filter(isAttentionBlocker)) {
    const label = attentionProblemLabel(row);
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const group = groups.get(key) ?? {
      key,
      label,
      actionLabel: actionLabelForAttentionGroup(label),
      rows: [],
      earliestRequiredDate: null,
      salesOrderCount: 0,
    };

    group.rows.push(row);
    group.earliestRequiredDate = earliestDate(
      group.rows.map((entry) => entry.row.earliestRequiredDate)
    );
    group.salesOrderCount = new Set(
      group.rows.flatMap((entry) => uniqueSalesOrderLabels(entry.demandFacts))
    ).size;
    groups.set(key, group);
  }

  return [...groups.values()].sort((left, right) => {
    const orderSort = right.salesOrderCount - left.salesOrderCount;
    if (orderSort !== 0) return orderSort;

    const dateSort = compareRequiredDates(
      left.earliestRequiredDate,
      right.earliestRequiredDate
    );
    if (dateSort !== 0) return dateSort;

    return left.label.localeCompare(right.label);
  });
}

function openablePanelProps(onOpen: () => void) {
  return {
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    },
    className:
      "cursor-pointer outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50",
  };
}

function DrawerSummary({
  items,
}: {
  items: Array<{ label: string; value: string; tone?: "default" | "danger" }>;
}) {
  return (
    <div className="grid overflow-hidden rounded-lg border bg-muted/20 sm:grid-cols-3">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={`min-w-0 p-3 ${index > 0 ? "border-t sm:border-l sm:border-t-0" : ""}`}
        >
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div
            className={`mt-1 min-w-0 font-mono text-sm tabular-nums break-words [overflow-wrap:anywhere] ${
              item.tone === "danger" ? "text-destructive" : ""
            }`}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanningTabs({
  value,
  productionCount,
  replenishmentCount,
  onChange,
}: {
  value: PlanningTab;
  productionCount: number;
  replenishmentCount: number;
  onChange: (value: PlanningTab) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === "production" || next === "replenishment") onChange(next);
      }}
      className="rounded-lg bg-muted p-1"
      size="sm"
    >
      <ToggleGroupItem value="production" className="gap-1.5 data-[state=on]:bg-background data-[state=on]:shadow-xs">
        <HugeiconsIcon icon={Factory01Icon} data-icon="inline-start" />
        Production
        <span className="text-muted-foreground">{productionCount}</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="replenishment" className="gap-1.5 data-[state=on]:bg-background data-[state=on]:shadow-xs">
        <HugeiconsIcon icon={Layers01Icon} data-icon="inline-start" />
        Replenishment
        <span className="text-muted-foreground">{replenishmentCount}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function StatStrip({
  items,
}: {
  items: Array<{
    label: string;
    value: string;
    suffix: string;
    icon: typeof Package01Icon;
    danger?: boolean;
  }>;
}) {
  return (
    <div className="grid overflow-hidden rounded-lg border bg-background md:grid-cols-4">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={`p-4 ${index > 0 ? "border-t md:border-l md:border-t-0" : ""}`}
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HugeiconsIcon icon={item.icon} className="size-3.5" />
            {item.label}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className={`font-mono text-xl font-semibold tabular-nums ${
                item.danger ? "text-destructive" : ""
              }`}
            >
              {item.value}
            </span>
            <span className="text-xs text-muted-foreground">{item.suffix}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductionWorkCard({
  item,
  expanded,
  isPending,
  onOpen,
  onToggleExpanded,
}: {
  item: ProductionWorkItem;
  expanded: boolean;
  isPending: boolean;
  onOpen: () => void;
  onToggleExpanded: () => void;
}) {
  const { entry } = item;
  const isCritical = item.urgency === "critical";
  const isBlocked = item.urgency === "blocked";
  const paths = entry.demandPaths;
  const hasTree = paths.length > 0;
  const productName = entry.row.item.displayName || entry.row.item.name;
  const packageLabel = packageText(entry.row);
  const quantity = productionQuantityParts(
    entry.row,
    item.coveredByStock ? entry.row.demandQuantity : entry.row.shortageQuantity
  );
  const downstreamSummary = downstreamCardSummary(paths);
  const panelProps = openablePanelProps(onOpen);
  const requiredDateIsLate = isPastDate(entry.row.earliestRequiredDate);

  return (
    <div
      role="listitem"
      aria-label={`${entry.row.item.name}, ${entry.actionSummary}`}
      className="group"
    >
      <div
        {...panelProps}
        className={cn(
          "relative flex min-h-[76px] items-center gap-3 rounded-lg border bg-background px-3 py-3 transition-colors hover:border-border/80 hover:shadow-xs",
          panelProps.className,
          isBlocked && "bg-muted/40"
        )}
      >
        {isCritical || isBlocked ? (
          <div className="absolute inset-y-0 left-0 w-0.5 rounded-l-lg bg-destructive" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="inline-flex min-w-9 justify-center rounded-md bg-muted px-2 py-0.5 font-mono text-[14.5px] font-semibold tabular-nums text-foreground">
              {quantity.quantity}
            </span>
            <span className="text-[14.5px] font-semibold text-foreground">{productName}</span>
            {packageLabel ? (
              <>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-[14.5px] font-normal text-muted-foreground">
                  {packageLabel}
                </span>
              </>
            ) : null}
            {hasTree ? (
              <Badge
                variant="secondary"
                className="h-[18px] rounded-[3px] border-transparent bg-muted px-1.5 text-[11px] font-medium text-muted-foreground shadow-none"
              >
                Sub-assembly
              </Badge>
            ) : null}
            {entry.row.manufacturingMode === "batch" && entry.row.plannedBatchCount ? (
              <Badge variant="outline" className="h-[18px] px-1.5 text-[11px] font-medium">
                {formatCount(entry.row.plannedBatchCount, "batch", "batches")}
              </Badge>
            ) : null}
            {isBlocked ? (
              <Badge
                variant="destructive"
                className="h-[18px] rounded-[3px] border-transparent px-1.5 text-[11px] font-medium shadow-none"
              >
                {productionBlockerLabel(entry)}
              </Badge>
            ) : null}
            {item.coveredByStock ? (
              <Badge variant="success" className="h-[18px] px-1.5 text-[11px] font-medium">
                Covered
              </Badge>
            ) : null}
          </div>
          {!hasTree ? (
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              <SalesOrderMetaLabel label={salesOrderQueueLabel(entry)} />
            </div>
          ) : null}
          {hasTree ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
              {downstreamSummary ? <span>{downstreamSummary}</span> : null}
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpanded();
                }}
              >
                <HugeiconsIcon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} />
                {`${paths.length} downstream ${paths.length === 1 ? "need" : "needs"}`}
              </button>
            </div>
          ) : null}
          <div className="sr-only">
            {hasTree ? (
              <span>{`${paths.length} downstream ${paths.length === 1 ? "need" : "needs"}`}</span>
            ) : (
              <SalesOrderMetaLabel label={salesOrderQueueLabel(entry)} />
            )}
          </div>
        </div>
        <div className="hidden min-w-20 text-right sm:block">
          <div className="text-[11px] font-normal text-muted-foreground">Required by</div>
          <div
            className={cn(
              "font-mono text-[13px] font-medium tabular-nums text-foreground",
              requiredDateIsLate && "font-semibold text-destructive"
            )}
          >
            {formatShortDate(entry.row.earliestRequiredDate)}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-3 text-[12.5px] font-medium"
          disabled={isPending}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {item.coveredByStock ? "View" : "Review"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={(event) => event.stopPropagation()}
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} />
              <span className="sr-only">More</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onOpen}>
                {item.coveredByStock ? "View" : "Review"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasTree && expanded ? <DownstreamTree paths={paths} /> : null}
    </div>
  );
}

function SalesOrderMetaLabel({ label }: { label: string }) {
  const [orderNumber, ...customerParts] = label.split(" · ");
  const customer = customerParts.join(" · ");

  if (!customer) return <span>{label}</span>;

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="font-mono text-[11.5px] tabular-nums">{orderNumber}</span>
      <span className="text-muted-foreground">·</span>
      <span>{customer}</span>
    </span>
  );
}

function DownstreamTree({ paths }: { paths: ProductionDemandPath[] }) {
  return (
    <div className="-mt-px ml-[60px] border-l px-4 py-2 text-sm">
      {paths.map((path) => (
        <DownstreamTreeItem key={path.id} path={path} />
      ))}
    </div>
  );
}

function DownstreamTreeItem({ path }: { path: ProductionDemandPath }) {
  return (
    <div className="relative py-1.5 before:absolute before:-left-4 before:top-4 before:h-px before:w-3 before:bg-border">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {path.steps.map((step, index) => {
            const quantity = pathQuantityParts(step);
            const packageLabel = pathPackageLabel(step);

            return (
              <div key={`${path.id}:${step.itemId}:${index}`} className="contents">
                {index > 0 ? (
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    className="size-3.5 text-muted-foreground"
                  />
                ) : null}
                <span className="inline-flex min-w-8 justify-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] font-semibold tabular-nums text-foreground">
                  {quantity.quantity}
                </span>
                <span className="text-[13px] font-medium text-foreground">
                  {step.displayName || step.itemName}
                </span>
                {packageLabel ? (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {packageLabel}
                    </span>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Link href={`/sales/orders/${path.terminal.salesOrderId}`} className="hover:underline">
            <SalesOrderMetaLabel label={normalizeSalesOrderLabel(path.terminal.salesOrderLabel)} />
          </Link>
          <span className="text-muted-foreground">·</span>
          <span>due {formatShortDate(path.requiredDate)}</span>
        </div>
      </div>
    </div>
  );
}

function ProductionPlanningView({
  items,
  coveredItems,
  horizonStart,
  search,
  viewFilter,
  isPending,
  onOpenRow,
}: {
  items: ProductionWorkItem[];
  coveredItems: ProductionWorkItem[];
  horizonStart: string | null;
  search: string;
  viewFilter: ProductionViewFilter;
  isPending: boolean;
  onOpenRow: (row: OperationalRow) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const visibleItems = viewFilter === "covered" ? coveredItems : items;
  const buckets: ProductionBucketKey[] = ["now", "this-week", "next-week", "later"];
  const byBucket = new Map<ProductionBucketKey, ProductionWorkItem[]>(
    buckets.map((bucket) => [bucket, []])
  );

  for (const item of visibleItems) {
    const bucket = item.bucket;

    byBucket.get(bucket)?.push({
      ...item,
      bucket,
      urgency:
        bucket === "now" && item.urgency === "normal"
          ? "critical"
          : item.urgency,
    });
  }

  const criticalCount = byBucket.get("now")?.length ?? 0;
  const blockedCount = visibleItems.filter((item) => item.urgency === "blocked").length;
  const subAssemblyCount = visibleItems.filter((item) => item.entry.demandPaths.length > 0);
  const salesOrderTotal = new Set(
    visibleItems.flatMap((item) => uniqueSalesOrderLabels(item.entry.demandFacts))
  ).size;
  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          {
            label: viewFilter === "covered" ? "Due today" : "Must start today",
            value: String(criticalCount),
            suffix: viewFilter === "covered" ? "covered items" : "production items",
            icon: Alert01Icon,
            danger: criticalCount > 0,
          },
          {
            label: "Sub-assembly batches",
            value: String(subAssemblyCount.length),
            suffix: "in plan",
            icon: Layers01Icon,
          },
          {
            label:
              viewFilter === "covered"
                ? "Covered sales orders"
                : "Sales orders needing production",
            value: String(salesOrderTotal),
            suffix: "in plan",
            icon: Package01Icon,
          },
          {
            label: "Blocked / waiting",
            value: String(blockedCount),
            suffix: "production items",
            icon: Alert01Icon,
            danger: blockedCount > 0,
          },
        ]}
      />

      {visibleItems.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {search.trim()
            ? "No production planning items match the current search."
            : viewFilter === "covered"
              ? "No covered sales orders."
              : "No current production planning needs."}
        </div>
      ) : null}

      {buckets.map((bucket) => {
        const bucketItems = byBucket.get(bucket) ?? [];
        if (bucketItems.length === 0) return null;

        return (
          <section key={bucket} className="space-y-3">
            <div className="flex items-baseline justify-between border-b pb-3">
            <div className="flex items-baseline gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {bucketLabel(bucket)}
                </span>
                <h2 className="text-base font-semibold">{bucketTitle(bucket, horizonStart)}</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                {`${formatCount(bucketItems.length, "planning item")} in bucket`}
              </p>
            </div>
            <div className="space-y-2" role="list">
              {bucketItems.map((item) => (
                <ProductionWorkCard
                  key={planningRowKey(item.entry)}
                  item={item}
                  expanded={expandedIds.has(item.entry.row.item.id)}
                  isPending={isPending}
                  onOpen={() => onOpenRow(item.entry)}
                  onToggleExpanded={() => {
                    setExpandedIds((current) => {
                      const next = new Set(current);
                      if (next.has(item.entry.row.item.id)) {
                        next.delete(item.entry.row.item.id);
                      } else {
                        next.add(item.entry.row.item.id);
                      }
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StatusChip({ status }: { status: ReplenishmentItem["status"] }) {
  if (status === "order-now") {
    return <Badge variant="destructive">Order now</Badge>;
  }

  if (status === "order-soon") {
    return <Badge variant="warning">Order soon</Badge>;
  }

  if (status === "unknown") {
    return <Badge variant="outline">Review</Badge>;
  }

  return <Badge variant="success">Stocked</Badge>;
}

function ProjectedSafetyBar({ item }: { item: ReplenishmentItem }) {
  const projected = Math.max(0, item.projectedStock);
  const safety = Math.max(0, item.safetyStock);
  const projectedPercent =
    safety > 0 ? Math.min(100, (projected / safety) * 50) : projected > 0 ? 100 : 0;
  const fillClass =
    item.status === "order-now"
      ? "bg-destructive"
      : item.status === "order-soon"
        ? "bg-warning"
        : "bg-success";

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", fillClass)}
          style={{ width: `${projectedPercent}%` }}
        />
        {safety > 0 ? (
          <span
            aria-hidden
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-foreground"
            style={{ left: "50%" }}
          />
        ) : null}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <QuantityWithUnit
          value={projected}
          unitName={item.entry.row.item.unitName}
          unitSize={item.entry.row.item.unitSize}
          unitUom={item.entry.row.item.unitUom}
          className="text-xs"
          valueClassName="font-medium text-foreground"
        />
        <QuantityWithUnit
          label="safety"
          value={safety}
          unitName={item.entry.row.item.unitName}
          unitSize={item.entry.row.item.unitSize}
          unitUom={item.entry.row.item.unitUom}
          className="text-xs"
          muted
        />
      </div>
    </div>
  );
}

const replenishmentSearchFilter: FilterFn<ReplenishmentItem> = (
  row,
  _columnId,
  filterValue
) => {
  const search = String(filterValue).trim().toLowerCase();
  if (!search) return true;

  const item = row.original.entry.row.item;
  return [
    item.name,
    item.sku,
    row.original.status,
    row.original.supplierName,
    row.original.entry.neededFor,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(search);
};

function planningPurchaseOrderUrl(items: ReplenishmentItem[]) {
  const params = new URLSearchParams();
  const supplierIds = [...new Set(items.map((item) => item.entry.row.preferredSupplierId))];

  for (const item of items) {
    params.append("itemId", item.entry.row.item.id);
  }

  if (supplierIds.length === 1 && supplierIds[0] != null) {
    params.set("supplierId", supplierIds[0]);
  }

  const query = params.toString();
  return query ? `/purchasing/orders/new?${query}` : "/purchasing/orders/new";
}

function getReplenishmentColumns({
  permissions,
  isPending,
  onOpenItem,
  onCreatePurchaseOrder,
}: {
  permissions: PlanningPermissions;
  isPending: boolean;
  onOpenItem: (row: OperationalRow) => void;
  onCreatePurchaseOrder: (items: ReplenishmentItem[]) => void;
}): ColumnDef<ReplenishmentItem>[] {
  return [
    {
      id: "select",
      meta: { className: "w-10" },
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all materials"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={`Select ${row.original.entry.row.item.name}`}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorFn: (row) => row.entry.row.item.name,
      id: "material",
      meta: { className: "w-[30%] min-w-0" },
      header: ({ column }) => <SortableHeader column={column} label="Material" />,
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="block min-w-0 max-w-full text-left hover:underline"
              onClick={() => onOpenItem(row.original.entry)}
            >
              <span className="block min-w-0 truncate font-medium">
                {row.original.entry.row.item.name}
              </span>
              <span className="block min-w-0 truncate font-mono text-xs text-muted-foreground">
                {demandSku(row.original.entry.row)}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm">
            {row.original.entry.row.item.name}
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      accessorKey: "status",
      meta: { className: "w-[8.5rem]" },
      header: ({ column }) => <SortableHeader column={column} label="Status" />,
      cell: ({ row }) => <StatusChip status={row.original.status} />,
    },
    {
      accessorKey: "projectedStock",
      id: "projectedSafety",
      meta: { className: "w-[32%] min-w-0" },
      sortDescFirst: false,
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Projected vs safety"
          tooltip={SAFETY_STOCK_TOOLTIP}
        />
      ),
      cell: ({ row }) => <ProjectedSafetyBar item={row.original} />,
    },
    {
      accessorKey: "supplierName",
      meta: { className: "w-[11rem]" },
      header: ({ column }) => <SortableHeader column={column} label="Supplier" />,
    },
    {
      id: "actions",
      meta: { className: "w-[7.5rem]" },
      cell: ({ row }) => (
        <div className="text-right">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={
              canOpenPurchaseOrderForm(row.original) &&
              (!permissions.canCreatePurchaseOrders || isPending)
            }
            onClick={() => {
              if (canOpenPurchaseOrderForm(row.original)) {
                onCreatePurchaseOrder([row.original]);
                return;
              }
              onOpenItem(row.original.entry);
            }}
          >
            {canOpenPurchaseOrderForm(row.original) ? "Create PO" : "Review"}
          </Button>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ];
}

function ReplenishmentPlanningView({
  items,
  permissions,
  isPending,
  onOpenItem,
  onCreatePurchaseOrder,
}: {
  items: ReplenishmentItem[];
  permissions: PlanningPermissions;
  isPending: boolean;
  onOpenItem: (row: OperationalRow) => void;
  onCreatePurchaseOrder: (items: ReplenishmentItem[]) => void;
}) {
  const [statusFilter, setStatusFilter] =
    useState<ReplenishmentStatusFilter>("all");
  const columns = useMemo(
    () =>
      getReplenishmentColumns({
        permissions,
        isPending,
        onOpenItem,
        onCreatePurchaseOrder,
      }),
    [permissions, isPending, onOpenItem, onCreatePurchaseOrder]
  );
  const statusCounts = useMemo(
    () =>
      items.reduce(
        (counts, item) => {
          counts.all += 1;
          counts[item.status] += 1;
          return counts;
        },
        {
          all: 0,
          "order-now": 0,
          "order-soon": 0,
          stocked: 0,
          unknown: 0,
        } satisfies Record<ReplenishmentStatusFilter, number>
      ),
    [items]
  );
  const filteredItems = useMemo(
    () =>
      statusFilter === "all"
        ? items
        : items.filter((item) => item.status === statusFilter),
    [items, statusFilter]
  );

  return (
    <DashboardDataTable
      columns={columns}
      data={filteredItems}
      initialData={filteredItems}
      queryKey={["planning", "replenishment", statusFilter]}
      enableRowSelection
      tableClassName="table-fixed"
      searchAriaLabel="Search planning"
      emptyMessage="No materials match the current filters."
      globalFilterFn={replenishmentSearchFilter}
      toolbarContent={
        <ToggleGroup
          type="single"
          value={statusFilter}
          onValueChange={(value) => {
            if (value) setStatusFilter(value as ReplenishmentStatusFilter);
          }}
          aria-label="Filter replenishment status"
          className="rounded-lg bg-muted p-1"
          size="sm"
        >
          <ToggleGroupItem
            value="all"
            className="gap-1.5 data-[state=on]:bg-background data-[state=on]:shadow-xs"
          >
            All
            <span className="text-muted-foreground">{statusCounts.all}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="order-now"
            className="gap-1.5 data-[state=on]:bg-background data-[state=on]:shadow-xs"
          >
            Order now
            <span className="text-muted-foreground">
              {statusCounts["order-now"]}
            </span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="order-soon"
            className="gap-1.5 data-[state=on]:bg-background data-[state=on]:shadow-xs"
          >
            Soon
            <span className="text-muted-foreground">
              {statusCounts["order-soon"]}
            </span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="stocked"
            className="gap-1.5 data-[state=on]:bg-background data-[state=on]:shadow-xs"
          >
            Stocked
            <span className="text-muted-foreground">{statusCounts.stocked}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      }
      selectedActions={[
        {
          label: "Create PO",
          disabled: !permissions.canCreatePurchaseOrders || isPending,
          onSelect: onCreatePurchaseOrder,
        },
      ]}
    />
  );
}

function DemandLinesTable({
  row,
  facts,
}: {
  row: PlanningItemRow;
  facts: DemandFact[];
}) {
  const salesOrderRefs = uniqueSourceRefs(
    facts.flatMap((fact) =>
      fact.sourceRefs
        .filter((ref) => ref.sourceType === "sales_order")
        .map((ref) => ({ ...ref, quantity: ref.quantity ?? fact.quantity }))
    )
  );

  const otherDemandRows = facts
    .filter(
      (fact) =>
        !fact.sourceRefs.some((ref) => ref.sourceType === "sales_order")
    )
    .map((fact) => {
      const sourceRef =
        fact.sourceRefs.find((ref) =>
          ["safety_stock", "manufacturing_order", "bom_revision"].includes(
            ref.sourceType
          )
        ) ?? fact.sourceRefs[0];
      const sourceType =
        fact.demandType === "safety_stock"
          ? "Safety stock"
          : fact.demandType === "manufacturing_component"
            ? "Internal manufacturing"
            : fact.demandType === "bom_explosion"
              ? "BOM dependency"
              : "Demand";

      return {
        key: fact.id,
        sourceType,
        label: sourceRef?.label ?? fact.explanation,
        href: sourceRef ? sourceHref(sourceRef) : null,
        quantity: fact.quantity,
        date: fact.requiredDate,
        explanation: fact.explanation,
      };
    });

  return (
    <div className="min-w-0 flex flex-col gap-2">
      <h2 className="text-sm font-medium">Demand</h2>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[52%]">Source</TableHead>
            <TableHead className="w-[28%] text-right">
              <TooltipHeader label="Qty" tooltip={PLANNING_NEED_TOOLTIP} />
            </TableHead>
            <TableHead className="w-[20%]">
              <TooltipHeader label="Needed by" tooltip={PLANNING_NEEDED_BY_TOOLTIP} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {salesOrderRefs.slice(0, 6).map((ref) => (
            <TableRow key={sourceRefKey(ref)}>
              <TableCell className={cn(drawerTextWrapClass, "font-medium")}>
                {sourceLabelWithLink(ref)}
              </TableCell>
              <TableCell className={drawerNumericWrapClass}>
                {formatQuantityWithUnit(ref.quantity, itemUnit(row))}
              </TableCell>
              <TableCell className={drawerTextWrapClass}>
                {formatShortDate(ref.date ?? null)}
              </TableCell>
            </TableRow>
          ))}
          {otherDemandRows.slice(0, Math.max(0, 6 - salesOrderRefs.length)).map((entry) => (
            <TableRow key={entry.key}>
              <TableCell className={cn(drawerTextWrapClass, "font-medium")}>
                {entry.href ? (
                  <Link href={entry.href} className="hover:underline">
                    {entry.sourceType}: {entry.label}
                  </Link>
                ) : (
                  `${entry.sourceType}: ${entry.label}`
                )}
                <div className="text-xs font-normal text-muted-foreground">
                  {entry.explanation}
                </div>
              </TableCell>
              <TableCell className={drawerNumericWrapClass}>
                {formatQuantityWithUnit(entry.quantity, itemUnit(row))}
              </TableCell>
              <TableCell className={drawerTextWrapClass}>
                {formatShortDate(entry.date)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {salesOrderRefs.length + otherDemandRows.length > 6 ? (
        <p className="text-xs text-muted-foreground">
          Showing 6 of {salesOrderRefs.length + otherDemandRows.length} demand groups.
        </p>
      ) : null}
    </div>
  );
}

function sourceLabelWithLink(ref: PlanningSourceRef) {
  const href = sourceHref(ref);
  if (!href) return ref.label;

  return (
    <Link href={href} className="hover:underline">
      {ref.label}
    </Link>
  );
}

function SupplyContextList({ planningRow }: { planningRow: OperationalRow }) {
  const incomingSupply = planningRow.supplyFacts.filter(
    (fact) => fact.supplyType !== "available_inventory"
  );

  return (
    <div className="min-w-0 flex flex-col gap-2">
      <h2 className="text-sm font-medium">Supply context</h2>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[34%]">Source</TableHead>
            <TableHead className="w-[24%] text-right">Qty</TableHead>
            <TableHead className="w-[22%]">Expected</TableHead>
            <TableHead className="w-[20%]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {planningRow.inventoryFact ? (
            <TableRow>
              <TableCell className={cn(drawerTextWrapClass, "font-medium")}>
                On-hand inventory
              </TableCell>
              <TableCell className={drawerNumericWrapClass}>
                {formatRowQuantity(
                  planningRow.row,
                  planningRow.inventoryFact.onHandQuantity
                )}
              </TableCell>
              <TableCell className={drawerTextWrapClass}>Now</TableCell>
              <TableCell className={drawerTextWrapClass}>
                {formatRowQuantity(
                  planningRow.row,
                  planningRow.inventoryFact.availableQuantity
                )}{" "}
                available
              </TableCell>
            </TableRow>
          ) : null}
          {incomingSupply.map((fact) => {
            const primaryRef =
              fact.sourceRefs.find((ref) =>
                ["purchase_order", "manufacturing_order"].includes(ref.sourceType)
              ) ?? fact.sourceRefs[0];

            return (
              <TableRow key={fact.id}>
                <TableCell className={cn(drawerTextWrapClass, "font-medium")}>
                  {primaryRef ? sourceLabelWithLink(primaryRef) : fact.explanation}
                </TableCell>
                <TableCell className={drawerNumericWrapClass}>
                  {formatRowQuantity(planningRow.row, fact.quantity)}
                </TableCell>
                <TableCell className={drawerTextWrapClass}>
                  {formatShortDate(fact.expectedDate)}
                </TableCell>
                <TableCell className={drawerTextWrapClass}>{fact.status}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {incomingSupply.length === 0 ? (
        <p className="text-xs text-muted-foreground">No incoming supply.</p>
      ) : null}
    </div>
  );
}

function ProductionBlockersList({
  planningRow,
  rowsByItemId,
  permissions,
  onAction,
  onOpenRow,
  isPending,
}: {
  planningRow: OperationalRow;
  rowsByItemId: Map<string, OperationalRow>;
  permissions: PlanningPermissions;
  onAction: (payload: PlanningActionPayload) => void;
  onOpenRow: (row: OperationalRow) => void;
  isPending: boolean;
}) {
  const blockers = planningRow.productionBlockers;
  const dependencies = blockers.flatMap((blocker) => {
    if (!blocker.componentItemId) return [];
    const componentRow = rowsByItemId.get(blocker.componentItemId);
    if (!componentRow || componentRow.row.planningType !== "make") return [];
    return [{ blocker, componentRow }];
  });

  if (blockers.length === 0) {
    return <p className="text-sm text-muted-foreground">No production blockers.</p>;
  }

  return (
    <div className="min-w-0 flex flex-col gap-4">
      {dependencies.length > 0 ? (
        <div className="min-w-0 flex flex-col gap-2">
          <h2 className="text-sm font-medium">Make first</h2>
          <div className="divide-y rounded-lg border" role="list">
            {dependencies.map(({ blocker, componentRow }) => {
              const canCreateDependency = canExecuteAction(componentRow, permissions);

              return (
                <div
                  key={`dependency:${blocker.id}`}
                  role="listitem"
                  className="flex min-w-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
                >
                  <button
                    type="button"
                    className="min-w-0 text-left hover:underline"
                    onClick={() => onOpenRow(componentRow)}
                  >
                    <span className="block font-medium">
                      Make{" "}
                      {formatQuantityWithUnit(
                        blocker.shortageQuantity ?? blocker.requiredQuantity,
                        blocker.componentUnitName
                      )}{" "}
                      {componentRow.row.item.displayName || componentRow.row.item.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Needed before {planningRow.row.item.displayName || planningRow.row.item.name}
                      {componentRow.makeDependencyCount > 0
                        ? ` · ${componentRow.makeDependencyCount} sub-${
                            componentRow.makeDependencyCount === 1
                              ? "assembly"
                              : "assemblies"
                          } underneath`
                        : componentRow.componentShortageCount > 0
                          ? ` · ${componentRow.componentShortageCount} material ${
                              componentRow.componentShortageCount === 1
                                ? "shortage"
                                : "shortages"
                            }`
                          : ""}
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatShortDate(blocker.earliestRequiredDate)}</span>
                    {canCreateDependency ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2 text-[12px]"
                        disabled={isPending}
                        onClick={() => onAction(componentRow.recommendation!.actionPayload!)}
                      >
                        <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                        Create MO
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[12px]"
                        onClick={() => onOpenRow(componentRow)}
                      >
                        Review
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="min-w-0 flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        {blockers.length} {blockers.length === 1 ? "blocker" : "blockers"}
      </h2>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30%]">Constraint</TableHead>
            <TableHead className="w-[22%] text-right">
              <TooltipHeader label="Required" tooltip={PLANNING_NEED_TOOLTIP} />
            </TableHead>
            <TableHead className="w-[20%] text-right">Available</TableHead>
            <TableHead className="w-[18%] text-right">
              <TooltipHeader label="Short" tooltip={PLANNING_SHORT_TOOLTIP} />
            </TableHead>
            <TableHead className="w-[10%]">
              <TooltipHeader label="Needed by" tooltip={PLANNING_NEEDED_BY_TOOLTIP} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {blockers.map((blocker) => (
            <TableRow key={blocker.id}>
              <TableCell className={cn(drawerTextWrapClass, "font-medium")}>
                {blocker.componentItemId &&
                rowsByItemId.get(blocker.componentItemId)?.row.planningType === "make"
                  ? `Make ${blocker.componentItemName}`
                  : blocker.blockerType === "material_shortage"
                    ? blocker.componentItemName
                    : blocker.componentItemName ?? productionBlockerLabel(planningRow)}
                <div className="text-xs font-normal text-muted-foreground">
                  {blocker.componentItemId &&
                  rowsByItemId.get(blocker.componentItemId)?.row.planningType === "make"
                    ? "sub-assembly required"
                    : blocker.blockerType.replaceAll("_", " ")}
                </div>
              </TableCell>
              <TableCell className={drawerNumericWrapClass}>
                {blocker.requiredQuantity
                  ? formatQuantityWithUnit(blocker.requiredQuantity, blocker.componentUnitName)
                  : "—"}
              </TableCell>
              <TableCell className={drawerNumericWrapClass}>
                {blocker.availableQuantity
                  ? formatQuantityWithUnit(blocker.availableQuantity, blocker.componentUnitName)
                  : "—"}
              </TableCell>
              <TableCell className={drawerNumericWrapClass}>
                {blocker.shortageQuantity
                  ? formatQuantityWithUnit(blocker.shortageQuantity, blocker.componentUnitName)
                  : "—"}
              </TableCell>
              <TableCell className={drawerTextWrapClass}>
                {formatShortDate(blocker.earliestRequiredDate)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

function PlanningRowDrawerContent({
  planningRow,
  rowsByItemId,
  permissions,
  onAction,
  onCreatePurchaseOrderRows,
  onOpenRow,
  isPending,
}: {
  planningRow: OperationalRow;
  rowsByItemId: Map<string, OperationalRow>;
  permissions: PlanningPermissions;
  onAction: (payload: PlanningActionPayload) => void;
  onCreatePurchaseOrderRows: (rows: OperationalRow[]) => void;
  onOpenRow: (row: OperationalRow) => void;
  isPending: boolean;
}) {
  const canCreate = canExecuteAction(planningRow, permissions);
  const isReadyBuild = isReadyManufacturingRow(planningRow);
  const isBuyRow = planningRow.row.planningType === "buy";
  const showProblemBadge = !isBuyRow && !isReadyBuild;
  const isBlockedBuild =
    planningRow.row.planningType === "make" &&
    planningRow.productionBlockers.length > 0;

  return (
    <div className="min-w-0 flex flex-col gap-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {showProblemBadge ? (
            <Badge variant="destructive">{attentionProblemLabel(planningRow)}</Badge>
          ) : null}
        </div>
        <div className="space-y-1">
          <div className="font-medium">{planningRow.row.item.name}</div>
          {isReadyBuild ? (
            <p className="text-sm text-muted-foreground">
              Build {formatRowQuantity(planningRow.row, planningRow.row.shortageQuantity)} ·
              needed by {formatShortDate(planningRow.row.earliestRequiredDate)} ·{" "}
              {formatAffects(salesOrderCount(planningRow))}
            </p>
          ) : isBlockedBuild ? (
            <p className="text-sm text-muted-foreground">
              Need {formatRowQuantity(planningRow.row, planningRow.row.shortageQuantity)} by{" "}
              {formatShortDate(planningRow.row.earliestRequiredDate)}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {attentionImpact(planningRow)}
            </p>
          )}
        </div>
        <DrawerSummary
          items={
            isBuyRow
              ? [
                  {
                    label: "On hand",
                    value: formatRowQuantity(
                      planningRow.row,
                      planningRow.inventoryFact?.onHandQuantity ?? "0"
                    ),
                  },
                  {
                    label: "Available",
                    value: formatRowQuantity(
                      planningRow.row,
                      planningRow.row.availableStock
                    ),
                  },
                  {
                    label: "Safety",
                    value: formatRowQuantity(
                      planningRow.row,
                      planningRow.row.safetyStock
                    ),
                  },
                  {
                    label: "Short",
                    value: formatRowQuantity(
                      planningRow.row,
                      planningRow.row.shortageQuantity
                    ),
                  },
                ]
              : isReadyBuild
              ? [
                  {
                    label: "Build",
                    value: formatRowQuantity(planningRow.row, planningRow.row.shortageQuantity),
                  },
                  {
                    label: "Needed by",
                    value: formatShortDate(planningRow.row.earliestRequiredDate),
                  },
                ]
              : isBlockedBuild
                ? [
                    {
                      label: "Need",
                      value: formatRowQuantity(planningRow.row, planningRow.row.shortageQuantity),
                    },
                    {
                      label: "Needed by",
                      value: formatShortDate(planningRow.row.earliestRequiredDate),
                  },
                  {
                    label: "Blockers",
                    value: formatCount(planningRow.productionBlockers.length, "blocker"),
                    tone: "danger",
                  },
                  ]
                : [
                    {
                      label: "Impact",
                      value: attentionImpact(planningRow),
                    },
                    {
                      label: "Needed by",
                      value: formatShortDate(planningRow.row.earliestRequiredDate),
                    },
                    {
                      label: "Affected",
                      value: formatOrderCount(salesOrderCount(planningRow)),
                    },
                  ]
          }
        />
        {canOpenPurchaseOrderFormForRow(planningRow) && permissions.canCreatePurchaseOrders ? (
          <Button
            className="w-fit"
            disabled={isPending}
            onClick={() => onCreatePurchaseOrderRows([planningRow])}
          >
            <HugeiconsIcon icon={ShoppingCart01Icon} data-icon="inline-start" />
            Create PO
          </Button>
        ) : planningRow.recommendation?.actionPayload && canCreate ? (
          <Button
            className="w-fit"
            disabled={isPending}
            onClick={() => onAction(planningRow.recommendation!.actionPayload!)}
          >
            <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
            {planningRow.actionLabel}
          </Button>
        ) : planningRow.recommendation?.recommendationType === "review_item_setup" ? (
          <Button className="w-fit" variant="outline" asChild>
            <Link href={setupActionHref(planningRow)}>{planningRow.actionLabel}</Link>
          </Button>
        ) : null}
      </div>

      {isBlockedBuild ? (
        <ProductionBlockersList
          planningRow={planningRow}
          rowsByItemId={rowsByItemId}
          permissions={permissions}
          onAction={onAction}
          onOpenRow={onOpenRow}
          isPending={isPending}
        />
      ) : (
        <DemandLinesTable
          row={planningRow.row}
          facts={planningRow.demandFacts}
        />
      )}
      <SupplyContextList planningRow={planningRow} />
    </div>
  );
}

function AttentionGroupDrawerContent({ group }: { group: AttentionGroup }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1">
        <div className="font-medium">{group.label}</div>
        <p className="text-sm text-muted-foreground">
          {formatCount(group.rows.length, "item")}
          {group.earliestRequiredDate
            ? ` · due ${formatShortDate(group.earliestRequiredDate)}`
            : ""}
          {" · "}
          {formatOrderCount(group.salesOrderCount)}
        </p>
      </div>
      <DrawerSummary
        items={[
          {
            label: "Items",
            value: formatCount(group.rows.length, "item"),
          },
          {
            label: "Earliest need",
            value: formatShortDate(group.earliestRequiredDate),
          },
          {
            label: "Affected",
            value: formatOrderCount(group.salesOrderCount),
            tone: group.label === "Materials short" ? "danger" : "default",
          },
        ]}
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Items</h2>
        <div className="divide-y rounded-lg border" role="list">
          {group.rows.map((entry) => (
            <div
              key={planningRowKey(entry)}
              role="listitem"
              className="px-3 py-2"
            >
              <div className="font-medium">{entry.row.item.name}</div>
              <div className="text-sm text-muted-foreground">
                {attentionImpact(entry)}
                {entry.row.earliestRequiredDate
                  ? ` · due ${formatShortDate(entry.row.earliestRequiredDate)}`
                  : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanningDetailDrawer({
  target,
  rows,
  attentionGroups,
  permissions,
  onClose,
  onAction,
  onCreatePurchaseOrderRows,
  onOpenRow,
  isPending,
}: {
  target: DetailTarget | null;
  rows: OperationalRow[];
  attentionGroups: AttentionGroup[];
  permissions: PlanningPermissions;
  onClose: () => void;
  onAction: (payload: PlanningActionPayload) => void;
  onCreatePurchaseOrderRows: (rows: OperationalRow[]) => void;
  onOpenRow: (row: OperationalRow) => void;
  isPending: boolean;
}) {
  const rowsByItemId = new Map(rows.map((entry) => [entry.row.item.id, entry]));
  const row =
    target?.kind === "row"
      ? rows.find((entry) => planningRowKey(entry) === target.key) ?? null
      : null;
  const attentionGroup =
    target?.kind === "attention"
      ? attentionGroups.find((group) => group.key === target.key) ?? null
      : null;
  const isOpen = Boolean(row || attentionGroup);
  const title = attentionGroup
      ? attentionGroup.label
      : row?.row.planningType === "buy"
        ? "Material planning"
        : row && isReadyManufacturingRow(row)
        ? "Create manufacturing order"
        : row?.row.planningType === "make" && row.productionBlockers.length > 0
          ? "Cannot build yet"
          : "Needs attention";
  const description = attentionGroup
      ? `${formatCount(attentionGroup.rows.length, "item")} · ${formatOrderCount(
          attentionGroup.salesOrderCount
        )}`
      : row
        ? row.row.item.name
        : "";
  const sheetWidthClass = "data-[side=right]:sm:max-w-lg";

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className={cn("w-full gap-0 overflow-hidden", sheetWidthClass)}>
        <SheetHeader className="min-w-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div className="min-w-0 p-4">
            {attentionGroup ? (
              <AttentionGroupDrawerContent group={attentionGroup} />
            ) : row ? (
              <PlanningRowDrawerContent
                planningRow={row}
                rowsByItemId={rowsByItemId}
                permissions={permissions}
                onAction={onAction}
                onCreatePurchaseOrderRows={onCreatePurchaseOrderRows}
                onOpenRow={onOpenRow}
                isPending={isPending}
              />
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export function PlanningWorkspace({
  initialSnapshot,
  permissions,
}: {
  initialSnapshot: PlanningSnapshot;
  permissions: PlanningPermissions;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [productionSearch, setProductionSearch] = useState("");
  const [productionViewFilter, setProductionViewFilter] =
    useState<ProductionViewFilter>("needs-action");
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [actionError, setActionError] = useState<PlanningActionErrorState | null>(null);
  const [activeTab, setActiveTab] = useState<PlanningTab>("production");

  const {
    data: snapshot = initialSnapshot,
    error: snapshotError,
    isFetching: isSnapshotFetching,
  } = useQuery<PlanningSnapshot>({
    queryKey: ["planning"],
    queryFn: async () => {
      const response = await fetch("/api/planning");
      if (!response.ok) {
        throw new Error("Failed to fetch planning snapshot");
      }
      return response.json();
    },
    initialData: initialSnapshot,
  });

  const recommendationsById = useMemo(
    () => new Map(snapshot.recommendations.map((entry) => [entry.id, entry])),
    [snapshot.recommendations]
  );

  const operationalRows = useMemo<OperationalRow[]>(() => {
    const planningRowsByItemId = new Map(
      snapshot.rows.map((entry) => [entry.item.id, entry])
    );

    return snapshot.rows.map((row) => {
      const recommendation = row.recommendationId
        ? recommendationsById.get(row.recommendationId) ?? null
        : null;
      const inventoryFact =
        snapshot.inventoryFacts.find((fact) => fact.itemId === row.item.id) ?? null;
      const demandFacts = snapshot.demandFacts.filter((fact) => fact.itemId === row.item.id);
      const supplyFacts = snapshot.supplyFacts.filter((fact) => fact.itemId === row.item.id);
      const bomFacts = snapshot.bomRequirementFacts.filter(
        (fact) => fact.parentItemId === row.item.id || fact.componentItemId === row.item.id
      );
      const demandPaths = snapshot.salesOrderProductionDemandPaths.filter(
        (path) => path.itemId === row.item.id
      );
      const productionBlockers = snapshot.productionBlockerFacts.filter(
        (fact) => fact.parentItemId === row.item.id
      );
      const componentShortageCount = new Set(
        productionBlockers
          .filter((fact) => fact.blockerType === "material_shortage")
          .map((fact) => fact.componentItemId)
          .filter(Boolean)
      ).size;
      const makeDependencyCount = new Set(
        productionBlockers
          .map((fact) => fact.componentItemId)
          .filter((itemId): itemId is string => {
            if (!itemId) return false;
            return planningRowsByItemId.get(itemId)?.planningType === "make";
          })
      ).size;
      const status = getStatus(
        row,
        recommendation,
        componentShortageCount,
        makeDependencyCount
      );

      return {
        row,
        recommendation,
        demandFacts,
        supplyFacts,
        inventoryFact,
        bomFacts,
        demandPaths,
        neededFor: summarizeNeededFor(demandFacts),
        statusLabel: status,
        actionLabel: getActionLabel(
          row,
          recommendation,
          componentShortageCount,
          makeDependencyCount
        ),
        actionSummary: getActionSummary(
          row,
          recommendation,
          componentShortageCount,
          makeDependencyCount
        ),
        componentShortageCount,
        makeDependencyCount,
        productionBlockers,
        isAttention: Boolean(recommendation) || toQuantity(row.shortageQuantity) > 0,
      };
    });
  }, [
    recommendationsById,
    snapshot.bomRequirementFacts,
    snapshot.demandFacts,
    snapshot.inventoryFacts,
    snapshot.productionBlockerFacts,
    snapshot.salesOrderProductionDemandPaths,
    snapshot.rows,
    snapshot.supplyFacts,
  ]);

  const queueRows = useMemo(() => {
    return operationalRows
      .filter(
        (entry) =>
          entry.isAttention &&
          (hasQueueImpact(entry) ||
            (entry.row.planningType === "make" && Boolean(entry.recommendation)) ||
            entry.row.planningType === "buy" ||
            entry.productionBlockers.length > 0)
      )
      .sort(compareQueuePriority);
  }, [operationalRows]);

  const matchingRows = useMemo(() => {
    const normalizedSearch = productionSearch.trim().toLowerCase();

    return queueRows.filter((entry) => matchesPlanningSearch(entry, normalizedSearch));
  }, [queueRows, productionSearch]);

  const matchingProductionRows = useMemo(() => {
    const normalizedSearch = productionSearch.trim().toLowerCase();

    return operationalRows.filter((entry) =>
      matchesPlanningSearch(entry, normalizedSearch)
    );
  }, [operationalRows, productionSearch]);

  const matchingOperationalRows = operationalRows;

  const attentionGroups = useMemo(
    () => buildAttentionGroups(matchingRows),
    [matchingRows]
  );

  const productionItems = useMemo(
    () => buildProductionWorkItems(matchingRows),
    [matchingRows]
  );

  const coveredProductionItems = useMemo(
    () =>
      buildProductionWorkItems(
        matchingProductionRows.filter(isCoveredSalesOrderRow),
        { coveredByStock: true }
      ),
    [matchingProductionRows]
  );

  const replenishmentItems = useMemo(
    () => buildReplenishmentItems(matchingOperationalRows),
    [matchingOperationalRows]
  );

  const actionMutation = useMutation<ActionResult, Error, PlanningActionPayload>({
    mutationFn: async (payload) => {
      const endpoint =
        payload.actionType === "create_purchase_order"
          ? "/api/planning/actions/purchase-order"
          : "/api/planning/actions/manufacturing-order";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error(body?.error ?? "Failed to create draft.") as Error & {
          planning?: PlanningActionErrorState;
        };
        error.planning = {
          message: body?.error ?? "Failed to create draft.",
          href: body?.existingDraft?.href,
          linkLabel: body?.existingDraft?.label,
          refresh:
            body?.conflictType === "stale_recommendation" ||
            body?.conflictType === "blocked_make",
        };
        throw error;
      }

      return body;
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (result, payload) => {
      await queryClient.invalidateQueries({ queryKey: ["planning"] });
      if (payload.actionType === "create_purchase_order") {
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        router.push(`/purchasing/orders/${result.id}`);
      } else {
        await queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
        router.push(`/manufacturing/orders/${result.id}`);
      }
    },
    onError: (error) => {
      const planningError = (error as Error & { planning?: PlanningActionErrorState }).planning;
      setActionError(planningError ?? { message: error.message, refresh: true });
    },
  });

  const isActionPending = actionMutation.isPending;
  const openPurchaseOrderForm = (items: ReplenishmentItem[]) => {
    setActionError(null);
    router.push(planningPurchaseOrderUrl(items));
  };
  const openPurchaseOrderFormForRows = (rows: OperationalRow[]) => {
    openPurchaseOrderForm(buildReplenishmentItems(rows));
  };

  return (
    <>
      <PlanningHeader />
      <div className="flex flex-1 flex-col gap-6 p-4 group-has-data-[collapsible=icon]/sidebar-wrapper:pt-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold">Planning</h1>
          <p className="text-xs text-muted-foreground">
            {isSnapshotFetching ? "Refreshing planning..." : `Updated ${formatUpdatedAt(snapshot.generatedAt)}`}
            {snapshotError ? " · showing stale data" : ""}
            {snapshot.warnings.length > 0 ? ` · ${formatCount(snapshot.warnings.length, "warning")}` : ""}
          </p>
        </div>
        <PlanningTabs
          value={activeTab}
          productionCount={productionItems.length}
          replenishmentCount={replenishmentItems.length}
          onChange={setActiveTab}
        />
      </div>

      {snapshotError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Planning refresh failed. The data below may be stale.
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === "production" ? (
            <ToggleGroup
              type="single"
              value={productionViewFilter}
              onValueChange={(value) => {
                if (value === "needs-action" || value === "covered") {
                  setProductionViewFilter(value);
                }
              }}
              aria-label="Filter production planning"
              className="rounded-md bg-muted p-0.5"
              size="sm"
            >
              <ToggleGroupItem
                value="needs-action"
                className="h-7 gap-1.5 px-2.5 text-xs data-[state=on]:bg-background data-[state=on]:shadow-xs"
              >
                Needs action
                <span className="text-muted-foreground">{productionItems.length}</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="covered"
                className="h-7 gap-1.5 px-2.5 text-xs data-[state=on]:bg-background data-[state=on]:shadow-xs"
              >
                Covered orders
                <span className="text-muted-foreground">{coveredProductionItems.length}</span>
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </div>
        {activeTab === "production" ? (
          <div className="relative w-full lg:w-80">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search planning"
              placeholder="Search production..."
              value={productionSearch}
              onChange={(event) => setProductionSearch(event.target.value)}
              className="h-8 w-full pl-8"
            />
          </div>
        ) : null}
      </div>

      {actionError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <div>{actionError.message}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {actionError.refresh ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["planning"] })}
              >
                Refresh planning
              </Button>
            ) : null}
            {actionError.href ? (
              <Button size="xs" variant="outline" asChild>
                <Link href={actionError.href}>
                  Open {actionError.linkLabel ?? "draft"}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "production" ? (
        <ProductionPlanningView
          items={productionItems}
          coveredItems={coveredProductionItems}
          horizonStart={snapshot.horizonStart}
          search={productionSearch}
          viewFilter={productionViewFilter}
          isPending={isActionPending}
          onOpenRow={(row) => setDetailTarget({ kind: "row", key: planningRowKey(row) })}
        />
      ) : (
        <ReplenishmentPlanningView
          items={replenishmentItems}
          permissions={permissions}
          isPending={isActionPending}
          onOpenItem={(row) => {
            setDetailTarget({ kind: "row", key: planningRowKey(row) });
          }}
          onCreatePurchaseOrder={openPurchaseOrderForm}
        />
      )}

      <PlanningDetailDrawer
        target={detailTarget}
        rows={operationalRows}
        attentionGroups={attentionGroups}
        permissions={permissions}
        onClose={() => setDetailTarget(null)}
        onAction={(payload) => actionMutation.mutate(payload)}
        onCreatePurchaseOrderRows={openPurchaseOrderFormForRows}
        onOpenRow={(row) => setDetailTarget({ kind: "row", key: planningRowKey(row) })}
        isPending={isActionPending}
      />
      </div>
    </>
  );
}
