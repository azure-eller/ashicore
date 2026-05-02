"use client";

import {
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type FilterFn } from "@tanstack/react-table";
import { Line, LineChart } from "recharts";
import {
  Add01Icon,
  ShoppingCart01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
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

type MaterialUsageHistoryBucket = {
  periodStart: string;
  periodEnd: string;
  quantity: string;
};

type MaterialUsageHistory = {
  itemId: string;
  itemName: string;
  unitName: string | null;
  days: number;
  totals: {
    last30Days: string;
    last90Days: string;
    last180Days: string;
    averageWeekly90Days: string;
  };
  buckets: MaterialUsageHistoryBucket[];
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

type DetailTarget = { kind: "row"; key: string };

type ReplenishmentItem = {
  id: string;
  entry: OperationalRow;
  status: "order-now" | "order-soon" | "stocked" | "unknown";
  supplierName: string;
  projectedStock: number;
  safetyStock: number;
};

type ReplenishmentStatusFilter = "all" | ReplenishmentItem["status"];

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
const usageChartConfig = {
  used: {
    label: "Used",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

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

function formatShortDate(value: string | null) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

    return `Make ${formatRowQuantity(row, recommendation.quantity)}.`;
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

function manufacturingRecommendationQuantity(row: OperationalRow) {
  return row.recommendation?.recommendationType === "create_manufacturing_order"
    ? row.recommendation.quantity
    : row.row.shortageQuantity;
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

function DrawerSummary({
  items,
}: {
  items: Array<{ label: string; value: string; tone?: "default" | "danger" }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-y py-3 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0"
        >
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div
            className={cn(
              "mt-1 min-w-0 font-mono text-sm tabular-nums break-words [overflow-wrap:anywhere]",
              item.tone === "danger" && "text-destructive"
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
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
      cell: ({ row }) => {
        const item = row.original.entry.row.item;

        return (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/inventory/materials/${item.id}`}
                  prefetch={false}
                  data-row-click-ignore="true"
                  className="inline-block min-w-0 max-w-full text-left font-medium hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="block truncate">{item.name}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm">
                {item.name}
              </TooltipContent>
            </Tooltip>
            <span className="block min-w-0 truncate font-mono text-xs text-muted-foreground">
              {demandSku(row.original.entry.row)}
            </span>
          </>
        );
      },
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
      onRowClick={(item) => onOpenItem(item.entry)}
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
        demandType: fact.demandType,
      };
    });

  return (
    <div className="min-w-0 flex flex-col gap-3">
      <h2 className="text-sm font-medium">Demand</h2>
      <div className="overflow-hidden rounded-lg border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[52%]">Need</TableHead>
              <TableHead className="w-[28%] text-right">Qty</TableHead>
              <TableHead className="w-[20%]">Date</TableHead>
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
            {otherDemandRows.slice(0, Math.max(0, 6 - salesOrderRefs.length)).map((entry) => {
              const isSafetyStock = entry.demandType === "safety_stock";
              const label = isSafetyStock ? "Safety stock" : entry.sourceType;
              const detail = isSafetyStock
                ? `Target ${formatQuantityWithUnit(entry.quantity, itemUnit(row))}`
                : entry.explanation !== entry.label
                  ? entry.explanation
                  : null;

              return (
                <TableRow key={entry.key}>
                  <TableCell className={cn(drawerTextWrapClass, "font-medium")}>
                    {entry.href && !isSafetyStock ? (
                      <Link href={entry.href} className="hover:underline">
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                    {detail ? (
                      <div className="text-xs font-normal text-muted-foreground">
                        {detail}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className={drawerNumericWrapClass}>
                    {formatQuantityWithUnit(entry.quantity, itemUnit(row))}
                  </TableCell>
                  <TableCell className={drawerTextWrapClass}>
                    {formatShortDate(entry.date)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
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

function formatUsageWithUnit(value: string | null | undefined, unitName: string | null) {
  return [formatQuantity(value), unitName].filter(Boolean).join(" ");
}

async function fetchMaterialUsageHistory(itemId: string) {
  const response = await fetch(`/api/items/${itemId}/usage-history?days=180`);
  if (!response.ok) {
    throw new Error("Failed to load usage history.");
  }

  return (await response.json()) as MaterialUsageHistory;
}

function MaterialUsageHistoryPanel({ itemId }: { itemId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["items", itemId, "usage-history", 180],
    queryFn: () => fetchMaterialUsageHistory(itemId),
  });

  const chartData =
    data?.buckets.map((bucket) => ({
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      label:
        bucket.periodStart === bucket.periodEnd
          ? formatShortDate(bucket.periodStart)
          : `${formatShortDate(bucket.periodStart)} - ${formatShortDate(bucket.periodEnd)}`,
      quantity: bucket.quantity,
      value: Number.parseFloat(bucket.quantity),
    })) ?? [];
  const hasUsage = chartData.some((point) => point.value > 0);

  return (
    <div className="min-w-0 flex flex-col gap-3">
      <h2 className="text-sm font-medium">Historical usage</h2>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading usage...</p>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">Usage history unavailable.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Last 30</div>
                <div className="mt-1 min-w-0 font-mono text-sm tabular-nums break-words [overflow-wrap:anywhere]">
                  {formatUsageWithUnit(data.totals.last30Days, data.unitName)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Last 90</div>
                <div className="mt-1 min-w-0 font-mono text-sm tabular-nums break-words [overflow-wrap:anywhere]">
                  {formatUsageWithUnit(data.totals.last90Days, data.unitName)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Weekly avg</div>
                <div className="mt-1 min-w-0 font-mono text-sm tabular-nums break-words [overflow-wrap:anywhere]">
                  {formatUsageWithUnit(data.totals.averageWeekly90Days, data.unitName)}
                </div>
              </div>
            </div>
            {hasUsage ? (
              <ChartContainer
                config={usageChartConfig}
                className="h-16 w-full aspect-auto"
                initialDimension={{ width: 420, height: 64 }}
              >
                <LineChart
                  data={chartData}
                  margin={{ top: 6, right: 4, bottom: 6, left: 4 }}
                >
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(_value, _name, _item, _index, payload) => {
                          const row = payload as {
                            label?: string;
                            quantity?: string;
                          };
                          return (
                            <>
                              <span className="text-muted-foreground">{row.label}</span>
                              <span className="font-mono font-medium text-foreground tabular-nums">
                                {formatUsageWithUnit(row.quantity, data.unitName)}
                              </span>
                            </>
                          );
                        }}
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--color-used)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground">
                No ledger usage in the last 180 days.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SupplyContextList({ planningRow }: { planningRow: OperationalRow }) {
  const incomingSupply = planningRow.supplyFacts.filter(
    (fact) => fact.supplyType !== "available_inventory"
  );

  return (
    <div className="min-w-0 flex flex-col gap-3">
      <h2 className="text-sm font-medium">Expected supply</h2>
      <div className="overflow-hidden rounded-lg border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Order</TableHead>
              <TableHead className="w-[25%] text-right">Qty</TableHead>
              <TableHead className="w-[20%]">Expected</TableHead>
              <TableHead className="w-[15%]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {incomingSupply.length > 0 ? (
              incomingSupply.map((fact) => {
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
              })
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-16 text-muted-foreground">
                  No open purchase orders or manufacturing orders.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
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
              Build {formatRowQuantity(planningRow.row, manufacturingRecommendationQuantity(planningRow))} ·
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
                    value: formatRowQuantity(
                      planningRow.row,
                      manufacturingRecommendationQuantity(planningRow)
                    ),
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

      {isBuyRow ? (
        <MaterialUsageHistoryPanel itemId={planningRow.row.item.id} />
      ) : null}

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

function PlanningDetailDrawer({
  target,
  rows,
  permissions,
  onClose,
  onAction,
  onCreatePurchaseOrderRows,
  onOpenRow,
  isPending,
}: {
  target: DetailTarget | null;
  rows: OperationalRow[];
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
  const isOpen = Boolean(row);
  const title = row?.row.planningType === "buy"
        ? "Material planning"
        : row && isReadyManufacturingRow(row)
        ? "Create manufacturing order"
        : row?.row.planningType === "make" && row.productionBlockers.length > 0
          ? "Cannot build yet"
          : "Needs attention";
  const description = row
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
            {row ? (
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
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [actionError, setActionError] = useState<PlanningActionErrorState | null>(null);

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

  const matchingOperationalRows = operationalRows;

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
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold">Planning</h1>
            <p className="text-xs text-muted-foreground">
              {isSnapshotFetching ? "Refreshing planning..." : `Updated ${formatUpdatedAt(snapshot.generatedAt)}`}
              {snapshotError ? " · showing stale data" : ""}
              {snapshot.warnings.length > 0 ? ` · ${formatCount(snapshot.warnings.length, "warning")}` : ""}
            </p>
          </div>
        </div>

      {snapshotError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Planning refresh failed. The data below may be stale.
        </div>
      ) : null}

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

      <ReplenishmentPlanningView
        items={replenishmentItems}
        permissions={permissions}
        isPending={isActionPending}
        onOpenItem={(row) => {
          setDetailTarget({ kind: "row", key: planningRowKey(row) });
        }}
        onCreatePurchaseOrder={openPurchaseOrderForm}
      />

      <PlanningDetailDrawer
        target={detailTarget}
        rows={operationalRows}
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
