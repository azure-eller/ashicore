"use client";

import {
  useMemo,
  useState,
  type FormEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Add01Icon,
  Alert01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Calendar01Icon,
  Factory01Icon,
  Layers01Icon,
  MoreHorizontalIcon,
  Package01Icon,
  Search01Icon,
  Settings02Icon,
  Sorting05Icon,
  ShoppingCart01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Switch } from "@/components/ui/switch";
import { formatQuantity } from "@/lib/format";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { PlanningHeader } from "./planning-header";
import type {
  BomRequirementFact,
  CreatePurchaseOrderDraftActionPayload,
  DemandFact,
  PlanningActionPayload,
  PlanningItemRow,
  PlanningRecommendation,
  PlanningSnapshot,
  PlanningSourceRef,
  ProductionBlockerFact,
} from "@/lib/planning/types";

type ActionResult = {
  id: string;
};

type BulkPurchaseActionResult = {
  orders: Array<{ id: string }>;
};

type OperationalRow = {
  row: PlanningItemRow;
  recommendation: PlanningRecommendation | null;
  demandFacts: DemandFact[];
  bomFacts: BomRequirementFact[];
  neededFor: string;
  statusLabel: string;
  actionLabel: string;
  actionSummary: string;
  componentShortageCount: number;
  productionBlockers: ProductionBlockerFact[];
  isAttention: boolean;
};

type PlanningPermissions = {
  canCreatePurchaseOrders: boolean;
  canCreateManufacturingOrders: boolean;
  canUpdatePlanningRules: boolean;
};

type BuyGroup = {
  key: string;
  supplierName: string;
  rows: OperationalRow[];
  actionPayloads: CreatePurchaseOrderDraftActionPayload[];
  earliestRequiredDate: string | null;
  salesOrderCount: number;
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
  | { kind: "buy"; key: string }
  | { kind: "row"; key: string }
  | { kind: "attention"; key: string };

type PlanningTab = "production" | "replenishment";

type ReplenishmentFilter = "all" | "order-now" | "order-soon" | "stocked" | "unknown";

type ProductionBucketKey = "now" | "this-week" | "next-week" | "later";

type ProductionWorkItem = {
  entry: OperationalRow;
  bucket: ProductionBucketKey;
  urgency: "critical" | "blocked" | "normal";
  downstreamCount: number;
};

type ReplenishmentItem = {
  entry: OperationalRow;
  status: "order-now" | "order-soon" | "stocked" | "unknown";
  supplierName: string;
  onHand: number;
  reorderAt: number;
  suggestedQuantity: string | null;
  daysCover: number | null;
};

type DownstreamUse = {
  key: string;
  quantity: string;
  quantityUnit: string | null;
  productName: string;
  packageLabel: string | null;
  label: string;
  dueDate: string | null;
  relationship: "final-stage" | "feeds-another-mo";
  requiresAgingHold: boolean;
  agingTooltip: string | null;
};

type PlanningRulesPayload = {
  planningEnabled?: boolean;
  reorderPoint?: string | null;
  targetCoverDays?: string | null;
  leadTimeDaysOverride?: string | null;
  productionLeadTimeDays?: string | null;
  preferredSupplierItem?: {
    supplierId: string;
    supplierSku?: string | null;
    unitCost?: string | null;
    purchaseUnitDefinitionId?: string | null;
    purchaseToStockFactor?: string | null;
    leadTimeDaysOverride?: string | null;
    minimumOrderQuantity?: string | null;
    orderMultiple?: string | null;
    isPreferred?: boolean;
  };
};

function toQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyToNull(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function sameNullableString(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "") === (right ?? "");
}

function formatDaysCover(value: number | null) {
  return value == null ? "—" : `${value}d`;
}

function sourceLabel(value: PlanningItemRow["leadTimeSource"]) {
  if (value === "supplier_item") return "supplier rule";
  if (value === "item_default") return "item default";
  if (value === "default") return "default";
  return value;
}

function leadTimeLabel(row: PlanningItemRow) {
  if (row.leadTimeDays == null) return "Lead unknown";
  const sample = row.leadTimeSampleCount > 0 ? ` · ${row.leadTimeSampleCount} samples` : "";
  return `Lead ${row.leadTimeDays}d · ${sourceLabel(row.leadTimeSource)}${sample}`;
}

function productionBlockerLabel(entry: OperationalRow) {
  if (entry.productionBlockers.some((blocker) => blocker.blockerType === "material_shortage")) {
    return "Materials short";
  }

  if (entry.row.reasonCodes.includes("missing_production_lead_time")) {
    return "Lead time missing";
  }

  return "Waits on setup";
}

function formatQuantityWithUnit(value: string | null | undefined, unitName: string | null) {
  return [formatQuantity(value), unitName].filter(Boolean).join(" ");
}

function itemUnit(row: PlanningItemRow) {
  return row.item.unitName ?? row.item.unitUom;
}

function planningRowKey(row: OperationalRow) {
  return `item:${row.row.item.id}`;
}

function buyGroupKey(group: BuyGroup) {
  return `buy:${group.key}`;
}

function formatRowQuantity(row: PlanningItemRow, value: string | null | undefined) {
  return formatQuantityWithUnit(value, itemUnit(row));
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

function urgencyLabel(value: string | null) {
  const days = daysUntil(value);
  if (days == null) return "No date";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days}d`;
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
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function NeededByCell({ value }: { value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span>{formatShortDate(value)}</span>
      <span className="text-xs text-muted-foreground">{urgencyLabel(value)}</span>
    </div>
  );
}

function sourceRefKey(ref: PlanningSourceRef) {
  return [
    ref.sourceType,
    ref.sourceId,
    ref.itemId ?? "",
    ref.quantity ?? "",
    ref.date ?? "",
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

function downstreamUses(
  row: OperationalRow,
  rowsByItemId: Map<string, OperationalRow>
): DownstreamUse[] {
  const byKey = new Map<string, DownstreamUse>();

  for (const fact of row.demandFacts) {
    const salesRefs = uniqueSourceRefs(
      fact.sourceRefs.filter((ref) => ref.sourceType === "sales_order")
    );
    const refs = salesRefs.length > 0 ? salesRefs : uniqueSourceRefs(fact.sourceRefs);
    const relationship: DownstreamUse["relationship"] =
      fact.demandType === "sales_order" ? "final-stage" : "feeds-another-mo";
    const leafRow =
      relationship === "feeds-another-mo" && fact.parentItemId
        ? rowsByItemId.get(fact.parentItemId)?.row ?? row.row
        : row.row;
    const leafProductName = leafRow.item.displayName || leafRow.item.name;
    const leafPackageLabel = packageText(leafRow);

    for (const ref of refs) {
      const key = sourceRefKey(ref);
      byKey.set(key, {
        key,
        quantity: ref.quantity ?? fact.quantity,
        quantityUnit: quantityUnitLabel(leafRow),
        productName: leafProductName,
        packageLabel: leafPackageLabel,
        label: normalizeSalesOrderLabel(ref.label),
        dueDate: ref.date ?? fact.requiredDate,
        relationship,
        requiresAgingHold: false,
        agingTooltip: null,
      });
    }
  }

  return [...byKey.values()].sort((left, right) => {
    const dateSort = compareRequiredDates(left.dueDate, right.dueDate);
    if (dateSort !== 0) return dateSort;
    return left.label.localeCompare(right.label);
  });
}

function summarizeNeededFor(facts: DemandFact[]) {
  const salesOrders = uniqueSourceLabels(facts, "sales_order");
  if (salesOrders.length === 1) return salesOrders[0];
  if (salesOrders.length > 1) return `${salesOrders.length} sales orders`;

  const manufacturingOrders = uniqueSourceLabels(facts, "manufacturing_order");
  if (manufacturingOrders.length === 1) return manufacturingOrders[0];
  if (manufacturingOrders.length > 1) return `${manufacturingOrders.length} production orders`;

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
  componentShortageCount: number
) {
  if (!recommendation || recommendation.recommendationType === "none") {
    return toQuantity(row.shortageQuantity) > 0 ? "Review" : "No action";
  }

  if (recommendation.recommendationType === "create_purchase_order") {
    return recommendation.suggestedSupplierName ? "Create PO" : "Assign supplier";
  }

  if (recommendation.recommendationType === "create_manufacturing_order") {
    return componentShortageCount > 0 ? "Review shortages" : "Create MO";
  }

  if (row.reasonCodes.includes("missing_supplier") || row.reasonCodes.includes("ambiguous_supplier")) {
    return "Assign supplier";
  }

  if (row.reasonCodes.includes("missing_purchase_price")) {
    return "Add price";
  }

  if (
    row.reasonCodes.includes("missing_lead_time") ||
    row.reasonCodes.includes("missing_production_lead_time")
  ) {
    return "Set lead time";
  }

  if (
    row.reasonCodes.includes("missing_bom") ||
    row.reasonCodes.includes("bom_cycle_detected") ||
    row.reasonCodes.includes("bom_depth_limit")
  ) {
    return "Fix BOM";
  }

  return "Fix setup";
}

function getActionSummary(
  row: PlanningItemRow,
  recommendation: PlanningRecommendation | null,
  componentShortageCount: number
) {
  const quantity = formatRowQuantity(row, row.shortageQuantity);

  if (!recommendation || recommendation.recommendationType === "none") {
    return toQuantity(row.shortageQuantity) > 0
      ? "Review this shortage before production or sales are blocked."
      : "Stock and open supply cover known demand.";
  }

  if (recommendation.recommendationType === "create_purchase_order") {
    const supplier = recommendation.suggestedSupplierName ?? "preferred supplier";
    return `Buy ${quantity} from ${supplier}.`;
  }

  if (recommendation.recommendationType === "create_manufacturing_order") {
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
  componentShortageCount: number
): string {
  if (recommendation?.recommendationType === "review_item_setup") {
    if (row.reasonCodes.includes("missing_supplier")) {
      return "Supplier missing";
    }

    if (row.reasonCodes.includes("ambiguous_supplier")) {
      return "Supplier needed";
    }

    if (row.reasonCodes.includes("missing_purchase_price")) {
      return "Price missing";
    }

    if (row.reasonCodes.includes("missing_lead_time")) {
      return "Lead time missing";
    }

    if (row.reasonCodes.includes("planning_disabled")) {
      return "Planning disabled";
    }

    if (row.reasonCodes.includes("missing_bom")) {
      return "BOM missing";
    }

    return "Setup issue";
  }

  if (recommendation?.recommendationType === "create_manufacturing_order") {
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
    entry.row.reasonCodes.some((code) =>
      [
        "missing_supplier",
        "ambiguous_supplier",
        "missing_purchase_price",
        "missing_lead_time",
        "missing_production_lead_time",
        "planning_disabled",
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
  if (row.row.reasonCodes.includes("missing_supplier")) return "Missing supplier";
  if (row.row.reasonCodes.includes("ambiguous_supplier")) return "Choose supplier";
  if (row.row.reasonCodes.includes("missing_purchase_price")) return "Missing price";
  if (row.row.reasonCodes.includes("missing_lead_time")) return "Missing lead time";
  if (row.row.reasonCodes.includes("missing_production_lead_time")) return "Missing lead time";
  if (row.row.reasonCodes.includes("planning_disabled")) return "Planning disabled";
  if (row.row.reasonCodes.includes("missing_bom")) return "Missing BOM";
  if (row.row.reasonCodes.includes("bom_cycle_detected")) return "BOM cycle";
  if (row.row.reasonCodes.includes("bom_depth_limit")) return "BOM too deep";
  if (row.row.reasonCodes.includes("duplicate_draft_action")) return "Draft exists";
  if (row.row.reasonCodes.includes("stale_recommendation")) return "Plan changed";
  return "Review setup";
}

function canExecuteAction(row: OperationalRow, permissions: PlanningPermissions) {
  const payload = row.recommendation?.actionPayload;
  if (!payload) return false;

  if (payload.actionType === "create_purchase_order") {
    return permissions.canCreatePurchaseOrders;
  }

  return permissions.canCreateManufacturingOrders && row.componentShortageCount === 0;
}

function isReadyPurchaseRow(row: OperationalRow) {
  return (
    row.row.planningType === "buy" &&
    !isSetupIssue(row) &&
    row.recommendation?.actionPayload?.actionType === "create_purchase_order"
  );
}

function isReadyManufacturingRow(row: OperationalRow) {
  return (
    row.row.planningType === "make" &&
    !isSetupIssue(row) &&
    row.componentShortageCount === 0 &&
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
  if (row.row.planningType === "make" && row.componentShortageCount > 0) {
    return "Materials short";
  }

  return setupProblemLabel(row);
}

function attentionImpact(row: OperationalRow) {
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

function compareQueuePriority(left: OperationalRow, right: OperationalRow) {
  const orderSort = salesOrderCount(right) - salesOrderCount(left);
  if (orderSort !== 0) return orderSort;

  const dateSort = compareRequiredDates(
    left.row.earliestRequiredDate,
    right.row.earliestRequiredDate
  );
  if (dateSort !== 0) return dateSort;

  return left.row.item.name.localeCompare(right.row.item.name);
}

function buildProductionWorkItems(rows: OperationalRow[]): ProductionWorkItem[] {
  return rows
    .filter((entry) => entry.row.planningType === "make")
    .map((entry) => {
      const days = daysUntil(entry.row.latestStartDate);
      const isBlocked =
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
        downstreamCount: Math.max(
          salesOrderCount(entry),
          entry.demandFacts.length,
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
      const shortage = toQuantity(entry.row.shortageQuantity);
      const available = Math.max(0, toQuantity(entry.row.availableStock));
      const reorderAt = Math.max(0, toQuantity(entry.row.reorderPoint));
      const status: ReplenishmentItem["status"] =
        entry.row.daysOfCoverStatus === "order_now"
          ? "order-now"
          : entry.row.daysOfCoverStatus === "order_soon"
            ? "order-soon"
            : entry.row.daysOfCoverStatus === "stocked"
              ? "stocked"
              : shortage > 0
                ? "order-now"
                : "unknown";

      return {
        entry,
        status,
        supplierName:
          entry.row.preferredSupplierName ??
          entry.recommendation?.suggestedSupplierName ??
          "Supplier needed",
        onHand: available,
        reorderAt,
        suggestedQuantity: entry.row.suggestedOrderQuantity,
        daysCover: entry.row.daysOfCover,
      };
    })
    .sort((left, right) => {
      const statusSort =
        ["order-now", "order-soon", "unknown", "stocked"].indexOf(left.status) -
        ["order-now", "order-soon", "unknown", "stocked"].indexOf(right.status);
      if (statusSort !== 0) return statusSort;
      const leftCover = left.daysCover ?? Number.MAX_SAFE_INTEGER;
      const rightCover = right.daysCover ?? Number.MAX_SAFE_INTEGER;
      if (leftCover !== rightCover) return leftCover - rightCover;
      return left.entry.row.item.name.localeCompare(right.entry.row.item.name);
    });
}

function buildBuyGroups(rows: OperationalRow[]) {
  const groups = new Map<string, BuyGroup>();

  for (const entry of rows.filter(isReadyPurchaseRow)) {
    const purchasePayload = entry.recommendation!.actionPayload as CreatePurchaseOrderDraftActionPayload;
    const group = groups.get(purchasePayload.supplierId) ?? {
      key: purchasePayload.supplierId,
      supplierName: entry.recommendation?.suggestedSupplierName ?? "Preferred supplier",
      rows: [],
      actionPayloads: [],
      earliestRequiredDate: null,
      salesOrderCount: 0,
    };

    group.rows.push(entry);
    group.actionPayloads.push(purchasePayload);
    group.earliestRequiredDate = earliestDate(
      group.rows.map((row) => row.row.earliestRequiredDate)
    );
    group.salesOrderCount = new Set(
      group.rows.flatMap((row) => uniqueSalesOrderLabels(row.demandFacts))
    ).size;
    groups.set(purchasePayload.supplierId, group);
  }

  return [...groups.values()].sort((left, right) => {
    const orderSort = right.salesOrderCount - left.salesOrderCount;
    if (orderSort !== 0) return orderSort;

    const dateSort = compareRequiredDates(
      left.earliestRequiredDate,
      right.earliestRequiredDate
    );
    if (dateSort !== 0) return dateSort;
    return left.supplierName.localeCompare(right.supplierName);
  });
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
          className={`p-3 ${index > 0 ? "border-t sm:border-l sm:border-t-0" : ""}`}
        >
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div
            className={`mt-1 font-mono text-sm tabular-nums ${
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
  draggable,
  rowsByItemId,
  isPending,
  onOpen,
  onToggleExpanded,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  item: ProductionWorkItem;
  expanded: boolean;
  draggable: boolean;
  rowsByItemId: Map<string, OperationalRow>;
  isPending: boolean;
  onOpen: () => void;
  onToggleExpanded: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const { entry } = item;
  const isCritical = item.urgency === "critical";
  const isBlocked = item.urgency === "blocked";
  const uses = downstreamUses(entry, rowsByItemId);
  const hasTree = uses.some((use) => use.relationship === "feeds-another-mo");
  const productName = entry.row.item.displayName || entry.row.item.name;
  const packageLabel = packageText(entry.row);
  const quantity = productionQuantityParts(entry.row, entry.row.shortageQuantity);
  const panelProps = openablePanelProps(onOpen);
  const requiredDateIsLate = isPastDate(entry.row.earliestRequiredDate);

  return (
    <div
      role="listitem"
      aria-label={`${entry.row.item.name}, ${entry.actionSummary}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
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
        <div
          className="flex size-4 shrink-0 cursor-grab items-center justify-center text-sm leading-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={`Reorder ${entry.row.item.name}`}
          role="img"
        >
          ⠿
        </div>
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
            {isBlocked ? (
              <Badge
                variant="destructive"
                className="h-[18px] rounded-[3px] border-transparent px-1.5 text-[11px] font-medium shadow-none"
              >
                {productionBlockerLabel(entry)}
              </Badge>
            ) : null}
          </div>
          {!hasTree ? (
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              <SalesOrderMetaLabel label={salesOrderQueueLabel(entry)} />
            </div>
          ) : null}
          {hasTree ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpanded();
                }}
              >
                <HugeiconsIcon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} />
                {`Feeds ${uses.length} downstream ${uses.length === 1 ? "use" : "uses"}`}
              </button>
            </div>
          ) : null}
          <div className="sr-only">
            {hasTree ? (
              <span>{`Sub-assembly for ${uses.length} downstream ${uses.length === 1 ? "use" : "uses"}`}</span>
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
          Review
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
              <DropdownMenuItem onSelect={onOpen}>Review</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasTree && expanded ? <DownstreamTree uses={uses} /> : null}
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

function DownstreamTree({ uses }: { uses: DownstreamUse[] }) {
  return (
    <div className="-mt-px ml-[60px] border-l px-4 py-2 text-sm">
      {uses.map((use) => (
        <DownstreamTreeItem key={use.key} use={use} />
      ))}
    </div>
  );
}

function DownstreamTreeItem({ use }: { use: DownstreamUse }) {
  const quantity = displayQuantityParts(use.quantity, use.quantityUnit);

  return (
    <div className="relative py-1.5 before:absolute before:-left-4 before:top-4 before:h-px before:w-3 before:bg-border">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex min-w-8 justify-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] font-semibold tabular-nums text-foreground">
            {quantity.quantity}
          </span>
          <span className="text-[13px] font-medium text-foreground">{use.productName}</span>
          {use.packageLabel ? (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-[13px] font-normal text-muted-foreground">
                {use.packageLabel}
              </span>
            </>
          ) : null}
          {use.requiresAgingHold ? (
            <Badge
              variant="secondary"
              title={use.agingTooltip ?? undefined}
              className="h-[17px] rounded-[3px] border-transparent bg-secondary px-1.5 text-[11px] font-medium text-secondary-foreground shadow-none"
            >
              requires 10+ day hold
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <SalesOrderMetaLabel label={use.label} />
          <span className="text-muted-foreground">·</span>
          <span>due {formatShortDate(use.dueDate)}</span>
        </div>
      </div>
    </div>
  );
}

function ProductionPlanningView({
  items,
  horizonStart,
  search,
  onSearchChange,
  isPending,
  onOpenRow,
}: {
  items: ProductionWorkItem[];
  horizonStart: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  isPending: boolean;
  onOpenRow: (row: OperationalRow) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [bucketOrders, setBucketOrders] = useState<Record<ProductionBucketKey, string[]>>({
    now: [],
    "this-week": [],
    "next-week": [],
    later: [],
  });
  const buckets: ProductionBucketKey[] = ["now", "this-week", "next-week", "later"];
  const byBucket = new Map<ProductionBucketKey, ProductionWorkItem[]>(
    buckets.map((bucket) => [bucket, []])
  );

  for (const item of items) {
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
  const blockedCount = items.filter((item) => item.urgency === "blocked").length;
  const rowsByItemId = new Map(items.map((item) => [item.entry.row.item.id, item.entry]));
  const subAssemblyCount = items.filter((item) =>
    downstreamUses(item.entry, rowsByItemId).some(
      (use) => use.relationship === "feeds-another-mo"
    )
  );
  const salesOrderTotal = new Set(
    items.flatMap((item) => uniqueSalesOrderLabels(item.entry.demandFacts))
  ).size;
  const orderedBucketItems = (bucket: ProductionBucketKey, bucketItems: ProductionWorkItem[]) => {
    const order = bucketOrders[bucket];
    if (order.length === 0) return bucketItems;
    const itemIds = bucketItems.map((item) => item.entry.row.item.id);
    const activeOrder = order.filter((id) => itemIds.includes(id));
    const byId = new Map(bucketItems.map((item) => [item.entry.row.item.id, item]));
    const ordered = activeOrder
      .map((id) => byId.get(id))
      .filter((item): item is ProductionWorkItem => Boolean(item));
    const missing = bucketItems.filter((item) => !activeOrder.includes(item.entry.row.item.id));
    return [...ordered, ...missing];
  };

  const moveWithinBucket = (
    bucket: ProductionBucketKey,
    draggedItemId: string,
    targetItemId: string
  ) => {
    if (draggedItemId === targetItemId) return;
    const bucketItems = byBucket.get(bucket) ?? [];
    const currentOrder = orderedBucketItems(bucket, bucketItems).map(
      (item) => item.entry.row.item.id
    );
    const fromIndex = currentOrder.indexOf(draggedItemId);
    const toIndex = currentOrder.indexOf(targetItemId);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, moved);
    setBucketOrders((current) => ({ ...current, [bucket]: nextOrder }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
        <div className="relative w-full lg:w-80">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search planning"
            placeholder="Search production..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-8 w-full pl-8"
          />
        </div>
      </div>

      <StatStrip
        items={[
          {
            label: "Must start today",
            value: String(criticalCount),
            suffix: "production items",
            icon: Alert01Icon,
            danger: criticalCount > 0,
          },
          {
            label: "Sub-assembly batches",
            value: String(subAssemblyCount.length),
            suffix: "queued",
            icon: Layers01Icon,
          },
          {
            label: "Open sales orders",
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

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No production items match the current search.
        </div>
      ) : null}

      {buckets.map((bucket) => {
        const bucketItems = orderedBucketItems(bucket, byBucket.get(bucket) ?? []);
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
                {`${formatCount(bucketItems.length, "production item")} queued`}
              </p>
            </div>
            <div className="space-y-2" role="list">
              {bucketItems.map((item) => (
                <ProductionWorkCard
                  key={planningRowKey(item.entry)}
                  item={item}
                  expanded={expandedIds.has(item.entry.row.item.id)}
                  draggable={bucketItems.length > 1}
                  rowsByItemId={rowsByItemId}
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
                  onDragStart={(event) => {
                    setDraggedId(item.entry.row.item.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.entry.row.item.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggedId || draggedId === item.entry.row.item.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = draggedId ?? event.dataTransfer.getData("text/plain");
                    moveWithinBucket(bucket, id, item.entry.row.item.id);
                    setDraggedId(null);
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
    return (
      <Badge variant="destructive" className="rounded-[4px]">
        <span className="size-1.5 rounded-full bg-current" />
        Order now
      </Badge>
    );
  }

  if (status === "order-soon") {
    return (
      <Badge variant="secondary" className="rounded-[4px]">
        <span className="size-1.5 rounded-full bg-current" />
        Order soon
      </Badge>
    );
  }

  if (status === "unknown") {
    return (
      <Badge variant="outline" className="rounded-[4px]">
        <span className="size-1.5 rounded-full bg-current" />
        Review
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="rounded-[4px]">
      <span className="size-1.5 rounded-full bg-current" />
      Stocked
    </Badge>
  );
}

function StockMeter({ item }: { item: ReplenishmentItem }) {
  const max = Math.max(item.onHand, item.reorderAt * 2, 1);
  const fillPct = Math.min(100, (item.onHand / max) * 100);
  const markerPct = Math.min(100, (item.reorderAt / max) * 100);
  const fillClass =
    item.status === "order-now"
      ? "bg-destructive"
      : item.status === "order-soon"
        ? "bg-foreground"
        : "bg-muted-foreground";

  return (
    <div className="w-40 space-y-1.5">
      <div className="relative h-1.5 rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] ${fillClass}`}
          style={{ width: `${fillPct}%` }}
        />
        <div
          className="absolute -top-1 h-3.5 w-px bg-foreground"
          style={{ left: `${markerPct}%` }}
        />
      </div>
      <div className="flex justify-between gap-3 text-[0.68rem] text-muted-foreground">
        <span className="font-mono tabular-nums">
          <b className="text-foreground">{formatQuantity(String(item.onHand))}</b>{" "}
          {itemUnit(item.entry.row)}
        </span>
        <span>reorder at {formatQuantity(String(item.reorderAt))}</span>
      </div>
    </div>
  );
}

function ReplenishmentPlanningView({
  items,
  filter,
  search,
  onSearchChange,
  onFilterChange,
  selectedIds,
  onToggleSelected,
  onClearSelected,
  permissions,
  isPending,
  onOpenItem,
  onCreatePurchaseOrders,
}: {
  items: ReplenishmentItem[];
  filter: ReplenishmentFilter;
  search: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (filter: ReplenishmentFilter) => void;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onClearSelected: () => void;
  permissions: PlanningPermissions;
  isPending: boolean;
  onOpenItem: (row: OperationalRow) => void;
  onCreatePurchaseOrders: (payloads: CreatePurchaseOrderDraftActionPayload[]) => void;
}) {
  const orderNow = items.filter((item) => item.status === "order-now");
  const orderSoon = items.filter((item) => item.status === "order-soon");
  const stocked = items.filter((item) => item.status === "stocked");
  const suppliers = new Set(items.map((item) => item.supplierName)).size;
  const shortest = items.reduce<ReplenishmentItem | null>(
    (current, item) => {
      if (item.daysCover == null) return current;
      return !current || current.daysCover == null || item.daysCover < current.daysCover
        ? item
        : current;
    },
    null
  );
  const visible =
    filter === "all"
      ? items
      : items.filter((item) =>
          filter === "stocked" ? item.status === "stocked" : item.status === filter
        );
  const selectedItems = items.filter((item) => selectedIds.has(item.entry.row.item.id));
  const selectedPayloads = selectedItems
    .map((item) => item.entry.recommendation?.actionPayload)
    .filter(
      (payload): payload is CreatePurchaseOrderDraftActionPayload =>
        payload?.actionType === "create_purchase_order"
    );
  const selectedSuppliers = new Set(selectedItems.map((item) => item.supplierName)).size;

  return (
    <div className="space-y-5">
      <StatStrip
        items={[
          {
            label: "Order now",
            value: String(orderNow.length),
            suffix: "at or below reorder point",
            icon: Alert01Icon,
            danger: orderNow.length > 0,
          },
          {
            label: "Order soon",
            value: String(orderSoon.length),
            suffix: "approaching reorder",
            icon: Calendar01Icon,
          },
          {
            label: "Materials tracked",
            value: String(items.length),
            suffix: `across ${suppliers} suppliers`,
            icon: Layers01Icon,
          },
          {
            label: "Shortest cover",
            value: shortest ? formatDaysCover(shortest.daysCover) : "—",
            suffix: shortest?.entry.row.item.name ?? "No materials",
            icon: Package01Icon,
          },
        ]}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:w-72">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search planning"
            placeholder="Search materials, suppliers..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-8 w-full pl-8"
          />
        </div>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(next) => {
            if (
              next === "all" ||
              next === "order-now" ||
              next === "order-soon" ||
              next === "stocked"
            ) {
              onFilterChange(next);
            }
          }}
          className="rounded-lg bg-muted p-1"
          size="sm"
        >
          {[
            ["all", "All", items.length],
            ["order-now", "Order now", orderNow.length],
            ["order-soon", "Soon", orderSoon.length],
            ["stocked", "Stocked", stocked.length],
          ].map(([key, label, count]) => (
            <ToggleGroupItem
              key={key}
              value={key as ReplenishmentFilter}
              className="data-[state=on]:bg-background data-[state=on]:shadow-xs"
            >
              {label} <span className="text-muted-foreground">{count}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm">
          <HugeiconsIcon icon={Sorting05Icon} data-icon="inline-start" />
          Days of cover
          <HugeiconsIcon icon={ArrowDown01Icon} data-icon="inline-end" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={selectedItems.length !== 1}
          onClick={() => {
            const [selectedItem] = selectedItems;
            if (selectedItem) onOpenItem(selectedItem.entry);
          }}
        >
          <HugeiconsIcon icon={Settings02Icon} data-icon="inline-start" />
          Reorder rules
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-background">
        <Table className="[--table-cell-px:12px] [--table-cell-py:10px] [--table-head-height:34px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-9" />
              <TableHead>Material</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>On hand vs reorder</TableHead>
              <TableHead className="text-right">Days of cover</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Suggested</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  No materials match the current filter.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((item) => {
                const payload = item.entry.recommendation?.actionPayload;
                const canOrder =
                  permissions.canCreatePurchaseOrders &&
                  payload?.actionType === "create_purchase_order";

                return (
                  <TableRow
                    key={item.entry.row.item.id}
                    data-state={selectedIds.has(item.entry.row.item.id) ? "selected" : undefined}
                    aria-label={`${item.entry.row.item.name}, ${item.supplierName}`}
                    {...openablePanelProps(() => onOpenItem(item.entry))}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(item.entry.row.item.id)}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={() => onToggleSelected(item.entry.row.item.id)}
                        aria-label={`Select ${item.entry.row.item.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{item.entry.row.item.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {demandSku(item.entry.row)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={item.status} />
                    </TableCell>
                    <TableCell>
                      <StockMeter item={item} />
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        item.status === "order-now" ? "font-medium text-destructive" : ""
                      }`}
                    >
                      {formatDaysCover(item.daysCover)}
                    </TableCell>
                    <TableCell>
                      <div>{item.supplierName}</div>
                      <div className="text-xs text-muted-foreground">
                        {leadTimeLabel(item.entry.row)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {item.suggestedQuantity
                        ? `${formatRowQuantity(item.entry.row, item.suggestedQuantity)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant={canOrder ? "outline" : "ghost"}
                        size="xs"
                        disabled={isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (canOrder && payload?.actionType === "create_purchase_order") {
                            onCreatePurchaseOrders([payload]);
                            return;
                          }
                          onOpenItem(item.entry);
                        }}
                      >
                        {canOrder ? "Order" : "Adjust"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {selectedIds.size > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg">
          <span>
            <b>{selectedIds.size}</b> materials selected
          </span>
          <span className="opacity-60">·</span>
          <span>{formatCount(selectedSuppliers, "supplier")}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onClearSelected}>
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-background text-foreground hover:bg-background/90"
            disabled={selectedPayloads.length === 0 || isPending}
            onClick={() => onCreatePurchaseOrders(selectedPayloads)}
          >
            <HugeiconsIcon icon={ShoppingCart01Icon} data-icon="inline-start" />
            Create {selectedSuppliers} PO{selectedSuppliers === 1 ? "" : "s"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PlanningRulesForm({
  planningRow,
  permissions,
  isPending,
  onSubmit,
}: {
  planningRow: OperationalRow;
  permissions: PlanningPermissions;
  isPending: boolean;
  onSubmit: (itemId: string, payload: PlanningRulesPayload) => void;
}) {
  const row = planningRow.row;
  const supplierId = row.preferredSupplierId ?? planningRow.recommendation?.suggestedSupplierId;
  const [planningEnabled, setPlanningEnabled] = useState(
    !row.reasonCodes.includes("planning_disabled")
  );
  const [reorderPoint, setReorderPoint] = useState(row.reorderPoint ?? "");
  const [targetCoverDays, setTargetCoverDays] = useState(
    row.targetCoverDays == null ? "" : String(row.targetCoverDays)
  );
  const [leadTimeDays, setLeadTimeDays] = useState(
    row.leadTimeDays == null ? "" : String(row.leadTimeDays)
  );
  const [productionLeadTimeDays, setProductionLeadTimeDays] = useState(
    row.productionLeadTimeDays == null ? "" : String(row.productionLeadTimeDays)
  );
  const [unitCost, setUnitCost] = useState(row.unitCost ?? "");
  const [purchaseToStockFactor, setPurchaseToStockFactor] = useState(
    row.purchaseToStockFactor ?? ""
  );
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState(
    row.minimumOrderQuantity ?? ""
  );
  const [orderMultiple, setOrderMultiple] = useState(row.orderMultiple ?? "");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload: PlanningRulesPayload = {
      planningEnabled,
      reorderPoint: emptyToNull(reorderPoint),
      targetCoverDays: emptyToNull(targetCoverDays),
    };

    if (row.planningType === "make") {
      payload.productionLeadTimeDays = emptyToNull(productionLeadTimeDays);
    }

    if (row.planningType === "buy") {
      const leadTimeValue = emptyToNull(leadTimeDays);
      const supplierRuleChanged =
        supplierId != null &&
        (!sameNullableString(row.unitCost, emptyToNull(unitCost)) ||
          !sameNullableString(row.purchaseToStockFactor, emptyToNull(purchaseToStockFactor)) ||
          !sameNullableString(row.minimumOrderQuantity, emptyToNull(minimumOrderQuantity)) ||
          !sameNullableString(row.orderMultiple, emptyToNull(orderMultiple)) ||
          !sameNullableString(
            row.leadTimeDays == null ? null : String(row.leadTimeDays),
            leadTimeValue
          ));

      if (supplierRuleChanged && supplierId) {
        payload.preferredSupplierItem = {
          supplierId,
          supplierSku: row.preferredSupplierSku,
          unitCost: emptyToNull(unitCost),
          purchaseUnitDefinitionId: row.purchaseUnitDefinitionId,
          purchaseToStockFactor: emptyToNull(purchaseToStockFactor),
          leadTimeDaysOverride: leadTimeValue,
          minimumOrderQuantity: emptyToNull(minimumOrderQuantity),
          orderMultiple: emptyToNull(orderMultiple),
          isPreferred: true,
        };
      } else {
        payload.leadTimeDaysOverride = leadTimeValue;
      }
    }

    onSubmit(row.item.id, payload);
  };

  return (
    <form className="space-y-4 rounded-lg border p-3" onSubmit={handleSubmit}>
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium">Planning rules</h2>
          <p className="text-xs text-muted-foreground">
            {row.planningType === "buy"
              ? `${sourceLabel(row.leadTimeSource)} lead time`
              : `${sourceLabel(row.productionLeadTimeSource)} production lead time`}
          </p>
        </div>
        <Switch
          size="sm"
          checked={planningEnabled}
          onCheckedChange={setPlanningEnabled}
          disabled={!permissions.canUpdatePlanningRules || isPending}
          aria-label="Planning enabled"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="planning-reorder-point">Reorder point</Label>
          <Input
            id="planning-reorder-point"
            value={reorderPoint}
            onChange={(event) => setReorderPoint(event.target.value)}
            inputMode="decimal"
            disabled={!permissions.canUpdatePlanningRules || isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="planning-target-cover">Target cover days</Label>
          <Input
            id="planning-target-cover"
            value={targetCoverDays}
            onChange={(event) => setTargetCoverDays(event.target.value)}
            inputMode="numeric"
            disabled={!permissions.canUpdatePlanningRules || isPending}
          />
        </div>

        {row.planningType === "buy" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="planning-lead-time">Lead time</Label>
              <Input
                id="planning-lead-time"
                value={leadTimeDays}
                onChange={(event) => setLeadTimeDays(event.target.value)}
                inputMode="numeric"
                disabled={!permissions.canUpdatePlanningRules || isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planning-unit-cost">Unit cost</Label>
              <Input
                id="planning-unit-cost"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                inputMode="decimal"
                disabled={!permissions.canUpdatePlanningRules || isPending || !supplierId}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planning-minimum-order">MOQ</Label>
              <Input
                id="planning-minimum-order"
                value={minimumOrderQuantity}
                onChange={(event) => setMinimumOrderQuantity(event.target.value)}
                inputMode="decimal"
                disabled={!permissions.canUpdatePlanningRules || isPending || !supplierId}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planning-order-multiple">Order multiple</Label>
              <Input
                id="planning-order-multiple"
                value={orderMultiple}
                onChange={(event) => setOrderMultiple(event.target.value)}
                inputMode="decimal"
                disabled={!permissions.canUpdatePlanningRules || isPending || !supplierId}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="planning-purchase-factor">Purchase conversion</Label>
              <Input
                id="planning-purchase-factor"
                value={purchaseToStockFactor}
                onChange={(event) => setPurchaseToStockFactor(event.target.value)}
                inputMode="decimal"
                disabled={!permissions.canUpdatePlanningRules || isPending || !supplierId}
              />
            </div>
          </>
        ) : null}

        {row.planningType === "make" ? (
          <div className="space-y-1.5">
            <Label htmlFor="planning-production-lead-time">Production lead time</Label>
            <Input
              id="planning-production-lead-time"
              value={productionLeadTimeDays}
              onChange={(event) => setProductionLeadTimeDays(event.target.value)}
              inputMode="numeric"
              disabled={!permissions.canUpdatePlanningRules || isPending}
            />
          </div>
        ) : null}
      </div>

      <Button
        type="submit"
        size="sm"
        disabled={!permissions.canUpdatePlanningRules || isPending}
      >
        Save rules
      </Button>
    </form>
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

  if (salesOrderRefs.length === 0) {
    return <p className="text-sm text-muted-foreground">{summarizeNeededFor(facts)}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Needed for</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sales order</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>Needed by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {salesOrderRefs.slice(0, 6).map((ref) => (
            <TableRow key={sourceRefKey(ref)}>
              <TableCell className="font-medium">{ref.label}</TableCell>
              <TableCell className="text-right">
                {formatQuantityWithUnit(ref.quantity, itemUnit(row))}
              </TableCell>
              <TableCell>{formatShortDate(ref.date ?? null)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {salesOrderRefs.length > 6 ? (
        <p className="text-xs text-muted-foreground">
          Showing 6 of {salesOrderRefs.length} sales orders.
        </p>
      ) : null}
    </div>
  );
}

function ProductionBlockersList({
  planningRow,
}: {
  planningRow: OperationalRow;
}) {
  const blockers = planningRow.productionBlockers;

  if (blockers.length === 0) {
    return <p className="text-sm text-muted-foreground">No production blockers.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        {blockers.length} {blockers.length === 1 ? "blocker" : "blockers"}
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Constraint</TableHead>
            <TableHead className="text-right">Required</TableHead>
            <TableHead className="text-right">Short</TableHead>
            <TableHead>Needed by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {blockers.map((blocker) => (
            <TableRow key={blocker.id}>
              <TableCell className="font-medium">
                {blocker.componentItemName ?? productionBlockerLabel(planningRow)}
              </TableCell>
              <TableCell className="text-right">
                {blocker.requiredQuantity
                  ? formatQuantityWithUnit(blocker.requiredQuantity, blocker.componentUnitName)
                  : "—"}
              </TableCell>
              <TableCell className="text-right">
                {blocker.shortageQuantity
                  ? formatQuantityWithUnit(blocker.shortageQuantity, blocker.componentUnitName)
                  : "—"}
              </TableCell>
              <TableCell>
                {formatShortDate(blocker.earliestRequiredDate)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PlanningRowDrawerContent({
  planningRow,
  permissions,
  onAction,
  onUpdateRules,
  isPending,
}: {
  planningRow: OperationalRow;
  permissions: PlanningPermissions;
  onAction: (payload: PlanningActionPayload) => void;
  onUpdateRules: (itemId: string, payload: PlanningRulesPayload) => void;
  isPending: boolean;
}) {
  const canCreate = canExecuteAction(planningRow, permissions);
  const isReadyBuild = isReadyManufacturingRow(planningRow);
  const isBuyRow = planningRow.row.planningType === "buy";
  const showProblemBadge = isBuyRow
    ? !isReadyPurchaseRow(planningRow)
    : !isReadyBuild;
  const isBlockedBuild =
    planningRow.row.planningType === "make" &&
    planningRow.productionBlockers.length > 0;

  return (
    <div className="flex flex-col gap-5">
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
              start {formatShortDate(planningRow.row.latestStartDate)} ·{" "}
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
                      planningRow.row.availableStock
                    ),
                  },
                  {
                    label: "Cover",
                    value: formatDaysCover(planningRow.row.daysOfCover),
                  },
                  {
                    label: "Suggested",
                    value: planningRow.row.suggestedOrderQuantity
                      ? formatRowQuantity(
                          planningRow.row,
                          planningRow.row.suggestedOrderQuantity
                        )
                      : "—",
                  },
                ]
              : isReadyBuild
              ? [
                  {
                    label: "Build",
                    value: formatRowQuantity(planningRow.row, planningRow.row.shortageQuantity),
                  },
                  {
                    label: "Start by",
                    value: formatShortDate(planningRow.row.latestStartDate),
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
        {planningRow.recommendation?.actionPayload && canCreate ? (
          <Button
            className="w-fit"
            disabled={isPending}
            onClick={() => onAction(planningRow.recommendation!.actionPayload!)}
          >
            <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
            {planningRow.actionLabel}
          </Button>
        ) : null}
      </div>

      <PlanningRulesForm
        key={planningRow.row.item.id}
        planningRow={planningRow}
        permissions={permissions}
        isPending={isPending}
        onSubmit={onUpdateRules}
      />

      {isBlockedBuild ? (
        <ProductionBlockersList planningRow={planningRow} />
      ) : (
        <DemandLinesTable
          row={planningRow.row}
          facts={planningRow.demandFacts}
        />
      )}
    </div>
  );
}

function BuyGroupDrawerContent({
  group,
  permissions,
  onCreatePurchaseOrders,
  isPending,
}: {
  group: BuyGroup;
  permissions: PlanningPermissions;
  onCreatePurchaseOrders: (payloads: CreatePurchaseOrderDraftActionPayload[]) => void;
  isPending: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="font-medium">{group.supplierName}</div>
          <p className="text-sm text-muted-foreground">
            {group.rows.length} {group.rows.length === 1 ? "line" : "lines"} ·
            due {formatShortDate(group.earliestRequiredDate)} ·{" "}
            {formatAffects(group.salesOrderCount)}
          </p>
        </div>
        <DrawerSummary
          items={[
            {
              label: "Lines",
              value: formatCount(group.rows.length, "line"),
            },
            {
              label: "Earliest need",
              value: formatShortDate(group.earliestRequiredDate),
            },
            {
              label: "Affected",
              value: formatOrderCount(group.salesOrderCount),
            },
          ]}
        />
        {group.actionPayloads.length > 0 && permissions.canCreatePurchaseOrders ? (
          <Button
            className="w-fit"
            disabled={isPending}
            onClick={() => onCreatePurchaseOrders(group.actionPayloads)}
          >
            <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
            Create PO
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            You have read-only purchasing access.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Lines</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Need</TableHead>
              <TableHead>Needed by</TableHead>
              <TableHead>Needed for</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.rows.map((entry) => (
              <TableRow key={entry.row.item.id}>
                <TableCell className="font-medium">{entry.row.item.name}</TableCell>
                <TableCell className="text-right">
                  {formatRowQuantity(entry.row, entry.row.shortageQuantity)}
                </TableCell>
                <TableCell>
                  <NeededByCell value={entry.row.earliestRequiredDate} />
                </TableCell>
                <TableCell>{entry.neededFor}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
  buyGroups,
  attentionGroups,
  permissions,
  onClose,
  onAction,
  onUpdateRules,
  onCreatePurchaseOrders,
  isPending,
}: {
  target: DetailTarget | null;
  rows: OperationalRow[];
  buyGroups: BuyGroup[];
  attentionGroups: AttentionGroup[];
  permissions: PlanningPermissions;
  onClose: () => void;
  onAction: (payload: PlanningActionPayload) => void;
  onUpdateRules: (itemId: string, payload: PlanningRulesPayload) => void;
  onCreatePurchaseOrders: (payloads: CreatePurchaseOrderDraftActionPayload[]) => void;
  isPending: boolean;
}) {
  const buyGroup =
    target?.kind === "buy"
      ? buyGroups.find((group) => buyGroupKey(group) === target.key) ?? null
      : null;
  const row =
    target?.kind === "row"
      ? rows.find((entry) => planningRowKey(entry) === target.key) ?? null
      : null;
  const attentionGroup =
    target?.kind === "attention"
      ? attentionGroups.find((group) => group.key === target.key) ?? null
      : null;
  const isOpen = Boolean(buyGroup || row || attentionGroup);
  const title = buyGroup
    ? "Create purchase order"
    : attentionGroup
      ? attentionGroup.label
      : row?.row.planningType === "buy"
        ? "Material planning"
        : row && isReadyManufacturingRow(row)
        ? "Create manufacturing order"
        : row?.row.planningType === "make" && row.productionBlockers.length > 0
          ? "Cannot build yet"
          : "Needs attention";
  const description = buyGroup
    ? buyGroup.supplierName
    : attentionGroup
      ? `${formatCount(attentionGroup.rows.length, "item")} · ${formatOrderCount(
          attentionGroup.salesOrderCount
        )}`
      : row
        ? row.row.item.name
        : "";
  const sheetWidthClass = buyGroup
    ? "data-[side=right]:sm:max-w-2xl"
    : "data-[side=right]:sm:max-w-lg";

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className={`w-full gap-0 ${sheetWidthClass}`}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            {buyGroup ? (
              <BuyGroupDrawerContent
                group={buyGroup}
                permissions={permissions}
                onCreatePurchaseOrders={onCreatePurchaseOrders}
                isPending={isPending}
              />
            ) : attentionGroup ? (
              <AttentionGroupDrawerContent group={attentionGroup} />
            ) : row ? (
              <PlanningRowDrawerContent
                planningRow={row}
                permissions={permissions}
                onAction={onAction}
                onUpdateRules={onUpdateRules}
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
  const [search, setSearch] = useState("");
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PlanningTab>("production");
  const [replenishmentFilter, setReplenishmentFilter] =
    useState<ReplenishmentFilter>("all");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(
    () => new Set()
  );

  const { data: snapshot = initialSnapshot } = useQuery<PlanningSnapshot>({
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
    return snapshot.rows.map((row) => {
      const recommendation = row.recommendationId
        ? recommendationsById.get(row.recommendationId) ?? null
        : null;
      const demandFacts = snapshot.demandFacts.filter((fact) => fact.itemId === row.item.id);
      const bomFacts = snapshot.bomRequirementFacts.filter(
        (fact) => fact.parentItemId === row.item.id || fact.componentItemId === row.item.id
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
      const status = getStatus(row, recommendation, componentShortageCount);

      return {
        row,
        recommendation,
        demandFacts,
        bomFacts,
        neededFor: summarizeNeededFor(demandFacts),
        statusLabel: status,
        actionLabel: getActionLabel(row, recommendation, componentShortageCount),
        actionSummary: getActionSummary(row, recommendation, componentShortageCount),
        componentShortageCount,
        productionBlockers,
        isAttention: Boolean(recommendation) || toQuantity(row.shortageQuantity) > 0,
      };
    });
  }, [
    recommendationsById,
    snapshot.bomRequirementFacts,
    snapshot.demandFacts,
    snapshot.productionBlockerFacts,
    snapshot.rows,
  ]);

  const queueRows = useMemo(() => {
    return operationalRows
      .filter(
        (entry) =>
          entry.isAttention &&
          (hasQueueImpact(entry) ||
            entry.row.planningType === "buy" ||
            entry.productionBlockers.length > 0)
      )
      .sort(compareQueuePriority);
  }, [operationalRows]);

  const matchingRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return queueRows.filter((entry) => {
      if (normalizedSearch === "") return true;

      const searchText = [
        entry.row.item.name,
        entry.row.item.sku,
        entry.neededFor,
        entry.actionLabel,
        entry.actionSummary,
        entry.statusLabel,
        entry.recommendation?.suggestedSupplierName,
        entry.row.preferredSupplierName,
        entry.row.preferredSupplierSku,
        entry.row.daysOfCoverStatus,
        entry.row.leadTimeSource,
        ...entry.demandFacts.flatMap((fact) => fact.sourceRefs.map((ref) => ref.label)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchText.includes(normalizedSearch);
    });
  }, [queueRows, search]);

  const buyGroups = useMemo(() => buildBuyGroups(matchingRows), [matchingRows]);

  const attentionGroups = useMemo(
    () => buildAttentionGroups(matchingRows),
    [matchingRows]
  );

  const productionItems = useMemo(
    () => buildProductionWorkItems(matchingRows),
    [matchingRows]
  );

  const replenishmentItems = useMemo(
    () => buildReplenishmentItems(matchingRows),
    [matchingRows]
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
        throw new Error(body?.error ?? "Failed to create draft.");
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
      setActionError(error.message);
    },
  });

  const purchaseGroupMutation = useMutation<
    BulkPurchaseActionResult,
    Error,
    CreatePurchaseOrderDraftActionPayload[]
  >({
    mutationFn: async (actions) => {
      const response = await fetch("/api/planning/actions/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to create purchase drafts.");
      }

      return body;
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["planning"] });
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      if (result.orders.length === 1) {
        router.push(`/purchasing/orders/${result.orders[0].id}`);
        return;
      }

      router.push("/purchasing/orders");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const rulesMutation = useMutation<
    { id: string },
    Error,
    { itemId: string; payload: PlanningRulesPayload }
  >({
    mutationFn: async ({ itemId, payload }) => {
      const response = await fetch(`/api/planning/items/${itemId}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to save planning rules.");
      }

      return body;
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["planning"] });
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isActionPending =
    purchaseGroupMutation.isPending ||
    actionMutation.isPending ||
    rulesMutation.isPending;

  const toggleSelectedMaterial = (id: string) => {
    setSelectedMaterialIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const subtitle =
    activeTab === "production"
      ? "What you need to make next, ordered by what your sales orders demand."
      : "Raw materials approaching reorder. Bulk-order to keep production stocked.";

  return (
    <>
      <PlanningHeader />
      <div className="flex flex-1 flex-col gap-6 p-4 group-has-data-[collapsible=icon]/sidebar-wrapper:pt-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold">Planning</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          <p className="text-xs text-muted-foreground">
            Updated {formatUpdatedAt(snapshot.generatedAt)}
          </p>
        </div>
      </div>

      <PlanningTabs
        value={activeTab}
        productionCount={productionItems.length}
        replenishmentCount={replenishmentItems.length}
        onChange={setActiveTab}
      />

      {actionError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {actionError}
        </div>
      ) : null}

      {activeTab === "production" ? (
        <ProductionPlanningView
          items={productionItems}
          horizonStart={snapshot.horizonStart}
          search={search}
          onSearchChange={setSearch}
          isPending={isActionPending}
          onOpenRow={(row) => setDetailTarget({ kind: "row", key: planningRowKey(row) })}
        />
      ) : (
        <ReplenishmentPlanningView
          items={replenishmentItems}
          filter={replenishmentFilter}
          search={search}
          onSearchChange={setSearch}
          onFilterChange={setReplenishmentFilter}
          selectedIds={selectedMaterialIds}
          onToggleSelected={toggleSelectedMaterial}
          onClearSelected={() => setSelectedMaterialIds(new Set())}
          permissions={permissions}
          isPending={isActionPending}
          onOpenItem={(row) => {
            setDetailTarget({ kind: "row", key: planningRowKey(row) });
          }}
          onCreatePurchaseOrders={(payloads) => purchaseGroupMutation.mutate(payloads)}
        />
      )}

      <PlanningDetailDrawer
        target={detailTarget}
        rows={matchingRows}
        buyGroups={buyGroups}
        attentionGroups={attentionGroups}
        permissions={permissions}
        onClose={() => setDetailTarget(null)}
        onAction={(payload) => actionMutation.mutate(payload)}
        onUpdateRules={(itemId, payload) => rulesMutation.mutate({ itemId, payload })}
        onCreatePurchaseOrders={(payloads) => purchaseGroupMutation.mutate(payloads)}
        isPending={isActionPending}
      />
      </div>
    </>
  );
}
