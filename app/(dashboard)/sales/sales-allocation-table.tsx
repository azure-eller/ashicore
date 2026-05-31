"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type {
  ColDef,
  ColGroupDef,
  GridApi,
  GridReadyEvent,
  ICellRendererParams,
  IHeaderGroupParams,
  IHeaderParams,
} from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  LayoutThreeColumnIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { ERPDataGrid } from "@/components/erp-data-grid";
import { SurfacePanel } from "@/components/surface-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiJson } from "@/lib/client/api";
import { formatQuantity, parseQuantity } from "@/lib/format";
import { buildSearchParams } from "@/lib/routing/search-params";
import type { ItemRow } from "@/app/(dashboard)/inventory/types";
import type { ManufacturingAllocationDemandRow } from "@/lib/inventory/allocation/manufacturing-demands";
import {
  AllocationSourceDialog,
  SALES_ORDERS_ALLOCATOR_VIEW_KEY,
  productLabel,
  type AllocationTarget,
  type AllocatorPreference,
  type AllocatorProduct,
} from "./sales-order-allocator";
import type { SalesOrderListLine, SalesOrderListRow } from "./types";
import { usePersistentViewState } from "@/lib/client/use-persistent-view-state";
import styles from "./sales-allocation-table.module.css";

const OPEN_SALES_STATUSES = ["open"] as const;
const STANDALONE_FAMILY_LABEL = "Standalone Products";
const ORDER_COL_WIDTH = 240;
const SHIP_COL_WIDTH = 96;
const PRODUCT_COL_WIDTH = 112;

const POOL_REFRESHED_AT_KEY = "ashicore.allocation.poolRefreshedAt";
const DEFAULT_ALLOCATOR_PREFERENCE: AllocatorPreference = {
  version: 1,
  hiddenProductIds: [],
  collapsedWeeks: [],
  unplannedOpen: true,
  manufacturingOpen: true,
};

type AllocationProduct = AllocatorProduct & {
  stockQty: number;
  incomingQty: number;
  allocatedQty: number;
  totalDemandQty: number;
  reservationSummaries: string[];
  isStandalone: boolean;
  hasActiveDemand: boolean;
};

export type AllocationPoolRow = {
  itemId: string;
  stockQty: string;
  incomingQty: string;
  allocatedQty: string;
  totalDemandQty?: string;
  assignments: Array<{
    demandLabel: string;
    quantity: string;
  }>;
  reservations: Array<{
    demandLabel: string;
    quantity: string;
  }>;
};

type AllocationCell = {
  line: SalesOrderListLine & { id: string };
  product: AllocationProduct;
  demand: number;
  alloc: number;
  manualAlloc: number;
  queueCoveredQty: number;
  queueExpectedQty: number;
  queueShortQty: number;
  pinnedQty: number;
  pinnedDateInvalidQty: number;
};

type AllocationRow = {
  id: string;
  demandSource: "sales" | "manufacturing";
  order?: SalesOrderListRow;
  href?: string | null;
  label: string;
  demandTypeLabel: "Sales order" | "Manufacturing demand";
  demandContext: string;
  customerName: string;
  shipDate: string | null;
  cells: Map<string, AllocationCell>;
};

type RowProgress = {
  state: "empty" | "complete" | "partial" | "unallocated";
  demand: number;
  alloc: number;
};

type ColumnCoverage = {
  product: AllocationProduct;
  demand: number;
  salesDemand: number;
  manufacturingDemand: number;
  alloc: number;
  stock: number;
  incoming: number;
  pool: number;
  surplus: number;
  verdict: "idle" | "ok" | "tight" | "short";
};

type CoverageRowData = {
  id: "coverage";
  rowType: "coverage";
  coverageByProductId: Map<string, ColumnCoverage>;
};

type WeekHeaderRowData = {
  id: string;
  rowType: "weekHeader";
  weekKey: string;
  label: string;
  orderCount: number;
  lineCount: number;
  shortCount: number;
  lateCount: number;
};

type UnplannedHeaderRowData = {
  id: "unplanned-header";
  rowType: "unplannedHeader";
  orderCount: number;
};

type ManufacturingHeaderRowData = {
  id: "manufacturing-header";
  rowType: "manufacturingHeader";
  orderCount: number;
  lineCount: number;
  shortCount: number;
};

type OrderGridRow = {
  id: string;
  rowType: "order";
  demandSource: "sales" | "manufacturing";
  order?: SalesOrderListRow;
  href?: string | null;
  label: string;
  demandTypeLabel: "Sales order" | "Manufacturing demand";
  demandContext: string;
  customerName: string;
  shipDate: string | null;
  cells: Map<string, AllocationCell>;
  progress: RowProgress;
  lateDays: number | null;
  isUnplanned: boolean;
  weekKey: string;
};

type SalesAllocationGridRow =
  | CoverageRowData
  | WeekHeaderRowData
  | UnplannedHeaderRowData
  | ManufacturingHeaderRowData
  | OrderGridRow;

// ============================================================================
// Pure helpers
// ============================================================================

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
}

function sumDemandQueueSegments(
  line: SalesOrderListLine,
  kinds: ReadonlySet<string>
) {
  return (line.demandQueueSegments ?? []).reduce(
    (sum, segment) =>
      kinds.has(segment.kind) ? sum + parseQuantity(segment.qty) : sum,
    0
  );
}

function compactQuantity(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    return `${(value / 1000).toFixed(absolute >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return formatQuantity(value.toFixed(4).replace(/\.?0+$/, ""));
}

function fullQuantity(value: number) {
  return formatQuantity(value.toFixed(4).replace(/\.?0+$/, ""));
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function productColId(productId: string) {
  return `product:${productId}`;
}

function flattenProducts(items: ItemRow[]) {
  return items.flatMap((item) =>
    item.subRows && item.subRows.length > 0 ? item.subRows : [item]
  );
}

function getInventoryProducts(inventory: ItemRow[]) {
  return flattenProducts(inventory).flatMap((item): AllocationProduct[] => {
    const toStandaloneProduct = (row: ItemRow): AllocationProduct => ({
      itemId: row.id,
      label: row.displayName || row.name,
      familyLabel: row.familyName ?? STANDALONE_FAMILY_LABEL,
      variantLabel:
        row.optionValues && row.optionValues.length > 0
          ? row.optionValues.map((value) => value.valueLabel).join(" ")
          : row.displayName || row.name,
      sku: row.sku ?? null,
      unitName: row.unit ?? "units",
      stockQty: parseQuantity(row.availableQty),
      incomingQty: parseQuantity(row.expectedQty),
      allocatedQty: 0,
      totalDemandQty: 0,
      reservationSummaries: [],
      isStandalone: true,
      hasActiveDemand: false,
    });

    if (item.itemType !== "product" || item.sellable !== true) return [];
    return [toStandaloneProduct(item)];
  });
}

function getInventoryById(items: ItemRow[]) {
  return new Map(flattenProducts(items).map((item) => [item.id, item]));
}

function getAllocatorProducts(
  orders: SalesOrderListRow[],
  inventory: ItemRow[],
  manufacturingDemandRows: ManufacturingAllocationDemandRow[]
) {
  const productsById = new Map(
    getInventoryProducts(inventory).map((product) => [product.itemId, product])
  );
  const inventoryById = getInventoryById(inventory);

  orders.forEach((order) => {
    if (!isOpenSalesOrder(order)) return;

    order.lines.forEach((line) => {
      if (line.itemType !== "product") return;

      const existing = productsById.get(line.itemId);
      const inventoryItem = inventoryById.get(line.itemId);
      if (inventoryItem?.itemType !== "product" || inventoryItem.sellable !== true) {
        return;
      }
      const isStandalone = line.attrs.length === 0;

      productsById.set(line.itemId, {
        ...existing,
        itemId: line.itemId,
        label: productLabel(line),
        familyLabel: isStandalone ? STANDALONE_FAMILY_LABEL : line.masterName,
        variantLabel: isStandalone ? line.masterName : line.attrs.join(" "),
        sku: line.itemSku ?? null,
        unitName: line.unitName,
        stockQty: parseQuantity(inventoryItem?.availableQty),
        incomingQty: parseQuantity(inventoryItem?.expectedQty),
        allocatedQty: 0,
        totalDemandQty: existing?.totalDemandQty ?? 0,
        reservationSummaries: [],
        isStandalone,
        hasActiveDemand: true,
      });
    });
  });

  manufacturingDemandRows.forEach((row) => {
    row.ingredients.forEach((ingredient) => {
      const existing = productsById.get(ingredient.itemId);
      if (!existing) return;
      productsById.set(ingredient.itemId, {
        ...existing,
        hasActiveDemand: true,
      });
    });
  });

  return [...productsById.values()].sort((left, right) => {
    if (left.hasActiveDemand !== right.hasActiveDemand) {
      return left.hasActiveDemand ? -1 : 1;
    }
    if (left.isStandalone !== right.isStandalone) {
      return left.isStandalone ? 1 : -1;
    }
    const familyCompare = left.familyLabel.localeCompare(right.familyLabel);
    if (familyCompare !== 0) return familyCompare;
    return left.label.localeCompare(right.label);
  });
}

function buildRows(
  orders: SalesOrderListRow[],
  products: AllocationProduct[],
  manufacturingDemandRows: ManufacturingAllocationDemandRow[]
) {
  const productById = new Map(products.map((product) => [product.itemId, product]));

  const salesRows = orders
    .filter(isOpenSalesOrder)
    .flatMap((order): AllocationRow[] => {
      const rows: AllocationRow[] = [];

      const fallbackCells = new Map<string, AllocationCell>();
      order.lines.forEach((line) => {
        if (!line.id) return;
        const remainingQty = parseQuantity(line.remainingQty ?? line.quantity);
        if (remainingQty <= 0) return;
        const product = productById.get(line.itemId);
        if (!product) return;
        const demandQuantity = quantityString(remainingQty);
        const demandLine: SalesOrderListLine & { id: string } = {
          ...line,
          id: line.id,
          allocationDemandType: "sales_order_line",
          quantity: demandQuantity,
          remainingQty: demandQuantity,
        };
        const manualAlloc = parseQuantity(demandLine.allocatedQty);
        const segmentPinnedQty = sumDemandQueueSegments(
          demandLine,
          new Set(["pinned_in_stock", "pinned_expected", "pinned_late"])
        );
        const segmentQueueCoveredQty = sumDemandQueueSegments(
          demandLine,
          new Set(["in_stock", "expected"])
        );
        const segmentExpectedQty = sumDemandQueueSegments(
          demandLine,
          new Set(["expected", "pinned_expected"])
        );
        const segmentShortQty = sumDemandQueueSegments(
          demandLine,
          new Set(["short"])
        );
        const segmentPinnedDateInvalidQty = sumDemandQueueSegments(
          demandLine,
          new Set(["pinned_late"])
        );
        const hasDemandQueueCoverage =
          demandLine.demandQueueInStockQty != null ||
          demandLine.demandQueueExpectedQty != null ||
          demandLine.demandQueueShortQty != null ||
          (demandLine.demandQueueSegments?.length ?? 0) > 0;
        const coveredQty = hasDemandQueueCoverage
          ? parseQuantity(demandLine.demandQueueInStockQty) +
            parseQuantity(demandLine.demandQueueExpectedQty)
          : manualAlloc;
        fallbackCells.set(product.itemId, {
          line: demandLine,
          product,
          demand: parseQuantity(demandLine.remainingQty ?? demandLine.quantity),
          alloc: coveredQty,
          manualAlloc,
          queueCoveredQty:
            (demandLine.demandQueueSegments?.length ?? 0) > 0
              ? segmentQueueCoveredQty
              : parseQuantity(demandLine.demandQueueQueueCoveredQty),
          queueExpectedQty:
            (demandLine.demandQueueSegments?.length ?? 0) > 0
              ? segmentExpectedQty
              : parseQuantity(demandLine.demandQueueExpectedQty),
          queueShortQty: hasDemandQueueCoverage
            ? (demandLine.demandQueueSegments?.length ?? 0) > 0
              ? segmentShortQty
              : parseQuantity(demandLine.demandQueueShortQty)
            : Math.max(
                0,
                parseQuantity(demandLine.remainingQty ?? demandLine.quantity) -
                  manualAlloc
              ),
          pinnedQty:
            (demandLine.demandQueueSegments?.length ?? 0) > 0
              ? segmentPinnedQty
              : parseQuantity(demandLine.demandQueuePinnedQty ?? "0"),
          pinnedDateInvalidQty:
            (demandLine.demandQueueSegments?.length ?? 0) > 0
              ? segmentPinnedDateInvalidQty
              : parseQuantity(demandLine.demandQueuePinnedDateInvalidQty),
        });
      });
      if (fallbackCells.size > 0) {
        rows.push({
          id: `order:${order.id}`,
          demandSource: "sales",
          order,
          label: order.orderNumber,
          demandTypeLabel: "Sales order",
          demandContext: "Sales order demand",
          customerName: order.customerName,
          shipDate: order.shipDate,
          cells: fallbackCells,
        });
      }

      return rows;
    });

  const manufacturingRows = manufacturingDemandRows.flatMap((demandRow): AllocationRow[] => {
    const cells = new Map<string, AllocationCell>();

    demandRow.ingredients.forEach((ingredient) => {
      const product = productById.get(ingredient.itemId);
      if (!product) return;
      const demand = parseQuantity(ingredient.openQty);
      if (demand <= 0) return;
      const alloc = parseQuantity(ingredient.allocatedQty);
      const existingCell = cells.get(product.itemId);

      if (existingCell) {
        const nextDemand = existingCell.demand + demand;
        const nextAlloc = existingCell.alloc + alloc;
        const pickedQty =
          parseQuantity(existingCell.line.pickedQty) +
          parseQuantity(ingredient.pickedQty);
        const shortQty =
          parseQuantity(existingCell.line.shortQty) +
          parseQuantity(ingredient.shortQty);
        existingCell.demand = nextDemand;
        existingCell.alloc = nextAlloc;
        existingCell.queueCoveredQty += alloc;
        existingCell.queueShortQty = shortQty;
        existingCell.line.allocationDemandIds = [
          ...(existingCell.line.allocationDemandIds ?? [existingCell.line.id]),
          ingredient.id,
        ];
        existingCell.line.quantity = quantityString(nextDemand);
        existingCell.line.remainingQty = quantityString(nextDemand);
        existingCell.line.allocatedQty = quantityString(nextAlloc);
        existingCell.line.shortQty = quantityString(shortQty);
        existingCell.line.pickedQty = quantityString(pickedQty);
        return;
      }

      const demandLine: SalesOrderListLine & { id: string } = {
        id: ingredient.id,
        allocationDemandIds: [ingredient.id],
        allocationDemandType: "manufacturing_order_ingredient",
        manufacturingOrderId: demandRow.orderId,
        manufacturingOrderNumber: demandRow.orderNumber,
        manufacturingProductName: demandRow.productName,
        pickedQty: ingredient.pickedQty,
        href: demandRow.href,
        itemId: ingredient.itemId,
        itemType: "product",
        masterName: ingredient.itemName,
        attrs: [],
        itemSku: ingredient.itemSku,
        quantity: ingredient.openQty,
        remainingQty: ingredient.openQty,
        allocatedQty: ingredient.allocatedQty,
        shortQty: ingredient.shortQty,
        sourceSummary: "-",
        allocationStatus: "waiting_production",
        unitName: ingredient.unitName,
      };

      cells.set(product.itemId, {
        line: demandLine,
        product,
        demand,
        alloc,
        manualAlloc: 0,
        queueCoveredQty: alloc,
        queueExpectedQty: 0,
        queueShortQty: parseQuantity(ingredient.shortQty),
        pinnedQty: 0,
        pinnedDateInvalidQty: 0,
      });
    });

    if (cells.size === 0) return [];

    return [
      {
        id: demandRow.id,
        demandSource: "manufacturing",
        href: demandRow.href,
        label: demandRow.orderNumber,
        demandTypeLabel: "Manufacturing demand",
        demandContext: `Ingredients for ${demandRow.productName}`,
        customerName: demandRow.productName,
        shipDate: demandRow.plannedDate,
        cells,
      },
    ];
  });

  return [...salesRows, ...manufacturingRows]
    .sort((left, right) => {
      if (left.demandSource !== right.demandSource) {
        return left.demandSource === "sales" ? -1 : 1;
      }
      const leftDate = left.shipDate ?? "";
      const rightDate = right.shipDate ?? "";
      if (!leftDate && rightDate) return 1;
      if (leftDate && !rightDate) return -1;
      const dateCompare = leftDate.localeCompare(rightDate);
      if (dateCompare !== 0) return dateCompare;
      return left.label.localeCompare(right.label, undefined, {
        numeric: true,
      });
    });
}

function rowProgress(row: AllocationRow): RowProgress {
  let demand = 0;
  let alloc = 0;
  let anyDemand = false;

  row.cells.forEach((cell) => {
    if (cell.demand > 0) anyDemand = true;
    demand += cell.demand || 0;
    alloc += cell.alloc || 0;
  });

  if (!anyDemand) return { state: "empty", demand: 0, alloc: 0 };
  if (alloc >= demand) return { state: "complete", demand, alloc };
  if (alloc > 0) return { state: "partial", demand, alloc };
  return { state: "unallocated", demand, alloc };
}

function businessDateToUtcDays(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function todayBusinessDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function daysFromToday(value: string | null) {
  if (!value) return null;
  const target = businessDateToUtcDays(value);
  const today = businessDateToUtcDays(todayBusinessDate());
  if (target == null || today == null) return null;
  return target - today;
}

function formatShipDateCompact(value: string | null) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
}

function getRowLateState(row: AllocationRow) {
  const days = daysFromToday(row.shipDate);
  if (days == null || days >= 0) return null;
  const progress = rowProgress(row);
  if (progress.state === "complete" || progress.state === "empty") return null;
  return { daysLate: Math.abs(days) };
}

function getCoverage(products: AllocationProduct[], rows: AllocationRow[]) {
  return new Map(
    products.map((product): [string, ColumnCoverage] => {
      const salesDemand = rows.reduce((sum, row) => {
        if (row.demandSource !== "sales") return sum;
        const cell = row.cells.get(product.itemId);
        if (!cell) return sum;
        return sum + cell.demand;
      }, 0);
      const manufacturingDemand = rows.reduce((sum, row) => {
        if (row.demandSource !== "manufacturing") return sum;
        const cell = row.cells.get(product.itemId);
        if (!cell) return sum;
        return sum + cell.demand;
      }, 0);
      const totalDemand = salesDemand + manufacturingDemand;
      const alloc = rows.reduce((sum, row) => {
        const cell = row.cells.get(product.itemId);
        return sum + (cell?.alloc ?? 0);
      }, 0);
      const pool = product.stockQty + product.incomingQty;
      const surplus = pool - totalDemand;
      let verdict: ColumnCoverage["verdict"] = "idle";

      if (totalDemand > 0) {
        if (surplus < 0) verdict = "short";
        else if (surplus < totalDemand * 0.05) verdict = "tight";
        else verdict = "ok";
      }

      return [
        product.itemId,
        {
          product,
          demand: totalDemand,
          salesDemand,
          manufacturingDemand,
          alloc,
          stock: product.stockQty,
          incoming: product.incomingQty,
          pool,
          surplus,
          verdict,
        },
      ];
    })
  );
}

type AllocationMarker = {
  shape: "circle" | "square";
  tone: "covered" | "production" | "none";
};

function getCellStatus(cell: AllocationCell | null) {
  if (!cell || cell.demand <= 0) return "empty";
  const isManufacturingDemand =
    cell.line.allocationDemandType === "manufacturing_order_ingredient";
  if (cell.alloc <= 0) return "zero";
  if (
    !isManufacturingDemand &&
    (cell.line.allocationStatus === "waiting_production" || cell.queueExpectedQty > 0)
  ) {
    return "waiting";
  }
  if (cell.alloc >= cell.demand) return "full";
  return "part";
}

function hasCellShortage(cell: AllocationCell | null) {
  if (!cell || cell.demand <= 0) return false;
  return cell.pinnedDateInvalidQty > 0 || cell.queueShortQty > 0 || cell.alloc < cell.demand;
}

function hasExpectedCoverage(cell: AllocationCell) {
  return (
    cell.queueExpectedQty > 0 ||
    (cell.line.allocationDemandType !== "manufacturing_order_ingredient" &&
      cell.line.allocationStatus === "waiting_production")
  );
}

function getCoverageTone(cell: AllocationCell): AllocationMarker["tone"] {
  if (hasExpectedCoverage(cell)) return "production";
  if (cell.alloc > 0) return "covered";
  return "none";
}

function getCellMarkers(cell: AllocationCell | null): AllocationMarker[] {
  if (!cell || cell.demand <= 0) return [];
  const markers: AllocationMarker[] = [];
  if (cell.pinnedQty > 0 || cell.manualAlloc > 0) {
    markers.push({ shape: "square", tone: getCoverageTone(cell) });
  }
  if (cell.queueCoveredQty > 0) {
    markers.push({ shape: "circle", tone: getCoverageTone(cell) });
  }
  if (markers.length === 0) {
    markers.push({ shape: "circle", tone: "none" });
  }
  return markers;
}

function getCellStatusLabels(cell: AllocationCell | null) {
  if (!cell || cell.demand <= 0) return [];
  const labels: string[] = [];
  if (hasCellShortage(cell)) labels.push("short or date issue");
  if (cell.pinnedQty > 0 || cell.manualAlloc > 0) labels.push("manual pin");
  if (cell.queueCoveredQty > 0) labels.push("queue covered");
  if (hasExpectedCoverage(cell)) labels.push("expected MO coverage");
  if (labels.length === 0) labels.push("not allocated");
  return labels;
}

function isoWeekMondayOf(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "no-date";
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  const mondayOffset = (dayOfWeek + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

function weekLabelOf(weekKey: string) {
  if (weekKey === "no-date") return "No ship date";
  const [year, month, day] = weekKey.split("-").map(Number);
  if (!year || !month || !day) return weekKey;
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `Week of ${fmt(start)} – ${fmt(end)}`;
}

function getFilteredRows(rows: AllocationRow[], search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) => {
    if (row.customerName.toLowerCase().includes(normalized)) return true;
    if (row.label.toLowerCase().includes(normalized)) return true;
    if (row.order?.orderNumber.toLowerCase().includes(normalized)) return true;

    return [...row.cells.values()].some((cell) => {
      if (cell.demand <= 0 && cell.alloc <= 0) return false;
      const sku = cell.product.sku?.toLowerCase() ?? "";
      return (
        cell.product.label.toLowerCase().includes(normalized) ||
        cell.product.familyLabel.toLowerCase().includes(normalized) ||
        sku.includes(normalized)
      );
    });
  });
}

function getProductColumnToReveal(
  rows: AllocationRow[],
  visibleProducts: AllocationProduct[],
  search: string
) {
  const visibleProductIds = new Set(visibleProducts.map((product) => product.itemId));
  const normalized = search.trim().toLowerCase();

  if (normalized) {
    for (const product of visibleProducts) {
      const sku = product.sku?.toLowerCase() ?? "";
      const matchesProduct =
        product.label.toLowerCase().includes(normalized) ||
        product.familyLabel.toLowerCase().includes(normalized) ||
        sku.includes(normalized);

      if (!matchesProduct) continue;

      const hasVisibleDemand = rows.some((row) => {
        const cell = row.cells.get(product.itemId);
        return cell != null && (cell.demand > 0 || cell.alloc > 0);
      });

      if (hasVisibleDemand) return product.itemId;
    }
  }

  for (const row of rows) {
    for (const cell of row.cells.values()) {
      if (
        visibleProductIds.has(cell.product.itemId) &&
        (cell.demand > 0 || cell.alloc > 0)
      ) {
        return cell.product.itemId;
      }
    }
  }

  return null;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors — preference is best-effort
  }
}

function buildGridRows({
  rows,
  coverage,
  collapsedWeeks,
  unplannedOpen,
  manufacturingOpen,
}: {
  rows: AllocationRow[];
  coverage: Map<string, ColumnCoverage>;
  collapsedWeeks: Set<string>;
  unplannedOpen: boolean;
  manufacturingOpen: boolean;
}): {
  topRows: SalesAllocationGridRow[];
  bodyRows: SalesAllocationGridRow[];
} {
  const topRows: SalesAllocationGridRow[] = [
    { id: "coverage", rowType: "coverage", coverageByProductId: coverage },
  ];

  const orderRows: OrderGridRow[] = rows.map((row) => {
    const isUnplanned = false;
    return {
      id: row.id,
      rowType: "order",
      demandSource: row.demandSource,
      order: row.order,
      href: row.href,
      label: row.label,
      demandTypeLabel: row.demandTypeLabel,
      demandContext: row.demandContext,
      customerName: row.customerName,
      shipDate: row.shipDate,
      cells: row.cells,
      progress: rowProgress(row),
      lateDays: getRowLateState(row)?.daysLate ?? null,
      isUnplanned,
      weekKey: isUnplanned
        ? "unplanned"
        : row.shipDate
          ? isoWeekMondayOf(row.shipDate)
          : "no-date",
    };
  });

  const bodyRows: SalesAllocationGridRow[] = [];

  const planned = orderRows.filter((row) => !row.isUnplanned);
  const salesPlanned = planned.filter((row) => row.demandSource === "sales");
  const unplanned = orderRows.filter(
    (row) => row.demandSource === "sales" && row.isUnplanned
  );
  const manufacturing = orderRows.filter(
    (row) => row.demandSource === "manufacturing"
  );

  const weekBuckets = new Map<string, OrderGridRow[]>();
  const weekOrder: string[] = [];
  salesPlanned.forEach((row) => {
    if (!weekBuckets.has(row.weekKey)) {
      weekBuckets.set(row.weekKey, []);
      weekOrder.push(row.weekKey);
    }
    weekBuckets.get(row.weekKey)!.push(row);
  });

  weekOrder.forEach((weekKey) => {
    const ordersInWeek = weekBuckets.get(weekKey) ?? [];
    const lineCount = ordersInWeek.reduce(
      (sum, row) =>
        sum + [...row.cells.values()].filter((cell) => cell.demand > 0).length,
      0
    );
    const shortCount = ordersInWeek.reduce(
      (sum, row) =>
        sum +
        [...row.cells.values()].filter((cell) => cell.demand > cell.alloc).length,
      0
    );
    const lateCount = ordersInWeek.filter((row) => row.lateDays != null).length;

    bodyRows.push({
      id: `week-header:${weekKey}`,
      rowType: "weekHeader",
      weekKey,
      label: weekLabelOf(weekKey),
      orderCount: ordersInWeek.length,
      lineCount,
      shortCount,
      lateCount,
    });

    if (!collapsedWeeks.has(weekKey)) {
      ordersInWeek.forEach((row) => bodyRows.push(row));
    }
  });

  if (unplanned.length > 0) {
    bodyRows.push({
      id: "unplanned-header",
      rowType: "unplannedHeader",
      orderCount: unplanned.length,
    });

    if (unplannedOpen) {
      unplanned.forEach((row) => bodyRows.push(row));
    }
  }

  if (manufacturing.length > 0) {
    const lineCount = manufacturing.reduce(
      (sum, row) =>
        sum + [...row.cells.values()].filter((cell) => cell.demand > 0).length,
      0
    );
    const shortCount = manufacturing.reduce(
      (sum, row) =>
        sum +
        [...row.cells.values()].filter((cell) => cell.demand > cell.alloc).length,
      0
    );

    bodyRows.push({
      id: "manufacturing-header",
      rowType: "manufacturingHeader",
      orderCount: manufacturing.length,
      lineCount,
      shortCount,
    });

    if (manufacturingOpen) {
      manufacturing.forEach((row) => bodyRows.push(row));
    }
  }

  return { topRows, bodyRows };
}

function getRowsInScope(
  rows: AllocationRow[],
  collapsedWeeks: Set<string>,
  manufacturingOpen: boolean
) {
  return rows.filter((row) => {
    if (row.demandSource === "manufacturing") return manufacturingOpen;
    if (!row.shipDate) return !collapsedWeeks.has("no-date");
    return !collapsedWeeks.has(isoWeekMondayOf(row.shipDate));
  });
}

function formatRefreshedAgo(ms: number | null) {
  if (ms == null) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hr ago";
  if (hours < 24) return `${hours} hr ago`;
  return "stale";
}

function refreshedStaleness(ms: number | null) {
  if (ms == null) return null;
  if (ms > 60 * 60_000) return "danger";
  if (ms > 10 * 60_000) return "warning";
  return null;
}

// ============================================================================
// Cell renderers
// ============================================================================

function FamilyHeader({ displayName }: IHeaderGroupParams) {
  return (
    <div className={styles.familyHeader}>
      <span className={styles.familyHeaderSwatch} aria-hidden="true" />
      <span className={styles.familyHeaderName}>{displayName}</span>
    </div>
  );
}

function VariantHeader({
  product,
  onHide,
}: IHeaderParams & {
  product: AllocationProduct;
  onHide: (productId: string) => void;
}) {
  return (
    <div className={styles.variantHeader}>
      <span className={styles.variantHeaderLabel}>{product.variantLabel}</span>
      <span className={styles.variantHeaderSku}>
        {product.sku ?? product.unitName}
      </span>
      <button
        type="button"
        className={styles.variantHeaderHide}
        aria-label={`Hide ${product.label}`}
        onClick={(event) => {
          event.stopPropagation();
          onHide(product.itemId);
        }}
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
      </button>
    </div>
  );
}

function OrderIdentityCell({
  data,
}: ICellRendererParams<SalesAllocationGridRow>) {
  if (!data) return null;
  if (data.rowType === "coverage") {
    return (
      <div className={styles.coverageIdentityCell}>
        <span className={styles.coverageIdentityTitle}>Pool coverage</span>
        <span className={styles.coverageIdentitySub}>
          On-hand + expected MO
        </span>
      </div>
    );
  }

  if (
    data.rowType === "weekHeader" ||
    data.rowType === "unplannedHeader" ||
    data.rowType === "manufacturingHeader"
  ) {
    return null;
  }

  if (data.demandSource === "manufacturing") {
    return (
      <div className={styles.orderIdentityCell}>
        <span className={styles.customerName} title={data.demandContext}>
          {data.label}
        </span>
        {data.href ? (
          <Link href={data.href} className={styles.orderNumber}>
            {data.customerName}
          </Link>
        ) : (
          <span className={styles.orderNumber}>{data.customerName}</span>
        )}
      </div>
    );
  }

  return (
    <div className={styles.orderIdentityCell}>
      <span
        className={styles.customerName}
        title={`${data.customerName} · ${data.demandTypeLabel}`}
      >
        {data.customerName}
      </span>
      <Link
        href={`/sales/order/${data.order!.id}`}
        className={styles.orderNumber}
      >
        {data.order?.orderNumber}
      </Link>
    </div>
  );
}

function ShipDateCell({ data }: ICellRendererParams<SalesAllocationGridRow>) {
  if (!data) return null;
  if (data.rowType === "coverage") return null;
  if (
    data.rowType === "weekHeader" ||
    data.rowType === "unplannedHeader" ||
    data.rowType === "manufacturingHeader"
  ) return null;

  const display = formatShipDateCompact(data.shipDate);
  const late = data.lateDays != null;
  const empty = !display;

  return (
    <div className={styles.shipCell}>
      <span
        className={styles.shipDate}
        data-late={late ? "true" : undefined}
        data-empty={empty ? "true" : undefined}
      >
        {empty ? "—" : display}
      </span>
    </div>
  );
}

function CoverageVariantCell({
  data,
  productId,
}: ICellRendererParams<SalesAllocationGridRow> & { productId: string }) {
  if (!data || data.rowType !== "coverage") return null;
  const coverage = data.coverageByProductId.get(productId);
  if (!coverage) return null;

  const tone =
    coverage.verdict === "short"
      ? "short"
      : coverage.verdict === "tight"
        ? "tight"
        : coverage.verdict === "ok"
          ? "ok"
          : "idle";

  const surplusMagnitude = Math.abs(coverage.surplus);
  const deltaText =
    coverage.verdict === "idle"
      ? "—"
      : surplusMagnitude < 0.0001
        ? "0"
      : coverage.verdict === "short"
        ? `−${compactQuantity(surplusMagnitude)}`
        : `+${compactQuantity(surplusMagnitude)}`;

  const meterDenominator = Math.max(coverage.demand, coverage.pool, 1);
  const meterWidth =
    coverage.demand <= 0
      ? 100
      : Math.min(100, (coverage.pool / meterDenominator) * 100);

  const remainingDemand = Math.max(0, coverage.demand - coverage.alloc);
  const tooltipLabel = `Pool ${fullQuantity(coverage.pool)} = on-hand ${fullQuantity(coverage.stock)} + expected production ${fullQuantity(coverage.incoming)}. Demand ${fullQuantity(coverage.demand)} = sales ${fullQuantity(coverage.salesDemand)} + MO ${fullQuantity(coverage.manufacturingDemand)}. Allocated ${fullQuantity(coverage.alloc)}, remaining ${fullQuantity(remainingDemand)}.`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={styles.coverageCell}>
          <span className={styles.coverageDelta} data-tone={tone}>
            {deltaText}
          </span>
          <span className={styles.coverageMeter} aria-hidden="true">
            <span
              className={styles.coverageMeterFill}
              data-tone={tone === "idle" ? "ok" : tone}
              style={{ width: `${meterWidth}%` }}
            />
          </span>
          <span className={styles.coverageSub}>
            {compactQuantity(coverage.pool)}
            <span>/</span>
            {compactQuantity(coverage.demand)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

function AllocationProductCell({
  data,
  product,
  selected,
  onOpenAllocation,
}: ICellRendererParams<SalesAllocationGridRow> & {
  product: AllocationProduct;
  selected: { rowId: string; colId: string } | null;
  onOpenAllocation: (row: OrderGridRow, cell: AllocationCell) => void;
}) {
  if (!data || data.rowType !== "order") return null;

  const cell = data.cells.get(product.itemId) ?? null;
  const status = getCellStatus(cell);

  if (status === "empty") {
    return <div className={styles.allocationCellEmpty} aria-hidden="true" />;
  }

  const isSelected =
    selected?.rowId === data.id && selected.colId === product.itemId;
  const allocationLabel = cell
    ? `${compactQuantity(cell.alloc)} / ${compactQuantity(cell.demand)}`
    : "0 / 0";
  const allocatedText = cell ? compactQuantity(cell.alloc) : "0";
  const demandText = cell ? compactQuantity(cell.demand) : "0";
  const shouldWrapQuantity = `${allocatedText}/${demandText}`.length > 9;
  const markers = getCellMarkers(cell);
  const statusLabel = getCellStatusLabels(cell).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={styles.allocationCell}
          data-selected={isSelected ? "true" : undefined}
          data-production-backed={
            cell && hasExpectedCoverage(cell) ? "true" : undefined
          }
          onClick={() => {
            if (cell) onOpenAllocation(data, cell);
          }}
          aria-label={`Allocate ${product.label}: ${allocationLabel}${
            statusLabel ? `, ${statusLabel}` : ""
          }`}
        >
          <span className={styles.cellMarkers} aria-hidden="true">
            {markers.map((marker, index) => (
              <span
                key={`${marker.shape}-${marker.tone}-${index}`}
                className={styles.cellMarker}
                data-shape={marker.shape}
                data-tone={marker.tone}
              />
            ))}
          </span>
          <span
            className={styles.allocationCellText}
            data-wrap={shouldWrapQuantity ? "true" : undefined}
          >
            <span>{allocatedText}</span>
            <span className={styles.allocationCellQty}>
              / {demandText}
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="flex-col items-start gap-(--space-1) whitespace-nowrap px-(--space-4) py-(--space-2)"
      >
        <span className="font-medium">{product.label}</span>
        <span className="font-mono text-muted-foreground">
          {allocationLabel}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function SectionBannerRow({
  data,
  collapsedWeeks,
  unplannedOpen,
  manufacturingOpen,
  onToggleWeek,
  onToggleUnplanned,
  onToggleManufacturing,
}: {
  data: WeekHeaderRowData | UnplannedHeaderRowData | ManufacturingHeaderRowData;
  collapsedWeeks: Set<string>;
  unplannedOpen: boolean;
  manufacturingOpen: boolean;
  onToggleWeek: (weekKey: string) => void;
  onToggleUnplanned: () => void;
  onToggleManufacturing: () => void;
}) {
  if (data.rowType === "weekHeader") {
    const collapsed = collapsedWeeks.has(data.weekKey);
    return (
      <div className={styles.sectionRow}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${data.label}`}
          aria-expanded={!collapsed}
          aria-controls={`week-section:${data.weekKey}`}
          onClick={() => onToggleWeek(data.weekKey)}
        >
          <HugeiconsIcon
            icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
            className="size-3"
          />
        </button>
        <span className={styles.sectionLabel}>{data.label}</span>
        <span className={styles.sectionCounts}>
          {data.orderCount} orders · {data.lineCount} lines · {data.shortCount} short
        </span>
        {data.lateCount > 0 ? (
          <span className={styles.sectionLate}>{data.lateCount} late</span>
        ) : null}
      </div>
    );
  }

  if (data.rowType === "unplannedHeader") {
    return (
      <div className={styles.sectionRow} data-tone="unplanned">
        <button
          type="button"
          className={styles.sectionToggle}
          aria-label={`${unplannedOpen ? "Collapse" : "Expand"} Unplanned demand`}
          aria-expanded={unplannedOpen}
          aria-controls="unplanned-section"
          onClick={onToggleUnplanned}
        >
          <HugeiconsIcon
            icon={unplannedOpen ? ArrowDown01Icon : ArrowRight01Icon}
            className="size-3"
          />
        </button>
        <span className={styles.sectionLabel}>Unplanned demand</span>
        <span className={styles.sectionCounts}>
          {data.orderCount} orders
        </span>
      </div>
    );
  }

  return (
    <div className={styles.sectionRow} data-tone="unplanned">
      <button
        type="button"
        className={styles.sectionToggle}
        aria-label={`${manufacturingOpen ? "Collapse" : "Expand"} Manufacturing demand`}
        aria-expanded={manufacturingOpen}
        aria-controls="manufacturing-section"
        onClick={onToggleManufacturing}
      >
        <HugeiconsIcon
          icon={manufacturingOpen ? ArrowDown01Icon : ArrowRight01Icon}
          className="size-3"
        />
      </button>
      <span className={styles.sectionLabel}>Manufacturing demand</span>
      <span className={styles.sectionCounts}>
        {data.orderCount} MOs · {data.lineCount} lines · {data.shortCount} short
      </span>
    </div>
  );
}

// ============================================================================
// Toolbar components
// ============================================================================

function LegendItem({
  children,
  description,
  marker,
}: {
  children: ReactNode;
  description: string;
  marker: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={styles.legendItem} tabIndex={0}>
          {marker}
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{description}</TooltipContent>
    </Tooltip>
  );
}

function AllocationLegend() {
  return (
    <span className={styles.allocationLegend} aria-label="Allocation legend">
      <span className={styles.legendGroup}>
        <span className={styles.legendGroupLabel}>Type</span>
        <LegendItem
          description="Square means the allocation was manually assigned."
          marker={
            <span
              className={styles.legendMarker}
              data-shape="square"
              data-tone="allocated"
              aria-hidden="true"
            />
          }
        >
          Manual
        </LegendItem>
        <LegendItem
          description="Circle means demand queue coverage."
          marker={
            <span
              className={styles.legendMarker}
              data-shape="circle"
              data-tone="allocated"
              aria-hidden="true"
            />
          }
        >
          Queue
        </LegendItem>
      </span>
      <span className={styles.legendDivider} aria-hidden="true" />
      <LegendItem
        description="Blue cell shading means the allocation is backed by expected manufacturing output."
        marker={
          <span className={styles.legendProduction} aria-hidden="true">
            <span
              className={styles.legendMarker}
              data-shape="circle"
              data-tone="allocated"
            />
          </span>
        }
      >
        MO-backed
      </LegendItem>
    </span>
  );
}

function AllocationToolbar({
  search,
  onSearchChange,
  refreshedAgoMs,
  hiddenFamilies,
  families,
  onToggleFamily,
  onShowAllFamilies,
  hiddenProducts,
  onRestoreColumn,
  onShowAllColumns,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  refreshedAgoMs: number | null;
  hiddenFamilies: Set<string>;
  families: string[];
  onToggleFamily: (family: string) => void;
  onShowAllFamilies: () => void;
  hiddenProducts: AllocationProduct[];
  onRestoreColumn: (productId: string) => void;
  onShowAllColumns: () => void;
}) {
  const [columnsSearch, setColumnsSearch] = useState("");
  const refreshedLabel = formatRefreshedAgo(refreshedAgoMs);
  const staleness = refreshedStaleness(refreshedAgoMs);
  const hiddenFamilyCount = hiddenFamilies.size;
  const hiddenProductCount = hiddenProducts.length;
  const visibleFamilyCount = families.length - hiddenFamilyCount;
  const columnsButtonLabel = "Columns";
  const columnsButtonDetail =
    hiddenProductCount > 0
      ? `${visibleFamilyCount} of ${families.length} families · ${hiddenProductCount} hidden`
      : hiddenFamilyCount > 0
        ? `${visibleFamilyCount} of ${families.length} families`
        : `${families.length} families`;
  const hiddenProductsByFamily = hiddenProducts.reduce((groups, product) => {
    const bucket = groups.get(product.familyLabel) ?? [];
    bucket.push(product);
    groups.set(product.familyLabel, bucket);
    return groups;
  }, new Map<string, AllocationProduct[]>());
  const normalizedColumnsSearch = columnsSearch.trim().toLocaleLowerCase();
  const familyMatchesSearch = (family: string) =>
    family.toLocaleLowerCase().includes(normalizedColumnsSearch);
  const productMatchesSearch = (product: AllocationProduct) =>
    familyMatchesSearch(product.familyLabel) ||
    product.label.toLocaleLowerCase().includes(normalizedColumnsSearch) ||
    product.variantLabel.toLocaleLowerCase().includes(normalizedColumnsSearch) ||
    (product.sku ?? "").toLocaleLowerCase().includes(normalizedColumnsSearch);
  const filteredFamilies =
    normalizedColumnsSearch.length === 0
      ? families
      : families.filter((family) => familyMatchesSearch(family));
  const filteredHiddenProductsByFamily =
    normalizedColumnsSearch.length === 0
      ? hiddenProductsByFamily
      : new Map(
          [...hiddenProductsByFamily.entries()]
            .map(
              ([family, products]) =>
                [
                  family,
                  products.filter((product) => productMatchesSearch(product)),
                ] as const
            )
            .filter(([, products]) => products.length > 0)
        );
  const hiddenProductsMatchCount = [...filteredHiddenProductsByFamily.values()].reduce(
    (total, products) => total + products.length,
    0
  );

  return (
    <div className={styles.toolbar}>
      <label className={styles.toolbarSearch}>
        <HugeiconsIcon icon={Search01Icon} className="size-3.5" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search orders, customers, SKU…"
          aria-label="Search sales allocations"
        />
      </label>
      <span className={styles.toolbarDivider} aria-hidden="true" />
      <AllocationLegend />
      <span className={styles.toolbarSpacer} />
      <span
        className={styles.toolbarRefreshed}
        data-stale={staleness ?? undefined}
      >
        Refreshed <b>{refreshedLabel}</b>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={styles.toolbarButton}
            aria-label={`Columns: ${columnsButtonDetail}`}
            title={columnsButtonDetail}
          >
            <HugeiconsIcon icon={LayoutThreeColumnIcon} className="size-3.5" />
            {columnsButtonLabel}
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[min(560px,calc(100vh-8rem))] w-80 overflow-y-auto">
          <div className="px-2 py-1.5">
            <SurfacePanel
              as="label"
              tone="background"
              className="flex h-8 items-center gap-2 px-2 py-0 text-sm"
            >
              <HugeiconsIcon
                icon={Search01Icon}
                className="size-3.5 text-muted-foreground"
              />
              <input
                value={columnsSearch}
                onChange={(event) => setColumnsSearch(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Search families, variants, SKU..."
                aria-label="Search allocation columns"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </SurfacePanel>
          </div>
          <div className="flex items-center justify-between px-2 py-1">
            <DropdownMenuLabel className="p-0">Visible families</DropdownMenuLabel>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onShowAllFamilies}
              disabled={hiddenFamilyCount === 0}
            >
              Show all
            </Button>
          </div>
          <DropdownMenuSeparator />
          {filteredFamilies.map((family) => (
            <DropdownMenuCheckboxItem
              key={family}
              checked={!hiddenFamilies.has(family)}
              onCheckedChange={() => onToggleFamily(family)}
              onSelect={(event) => event.preventDefault()}
          >
              {family}
            </DropdownMenuCheckboxItem>
          ))}
          {filteredFamilies.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              No visible families match.
            </div>
          ) : null}
          {hiddenProductCount > 0 ? (
            <>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between px-2 py-1">
                <DropdownMenuLabel className="p-0">
                  Hidden columns
                </DropdownMenuLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onShowAllColumns}
                >
                  Show all
                </Button>
              </div>
              {[...filteredHiddenProductsByFamily.entries()].map(([family, products]) => (
                <div key={`hidden:${family}`}>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {family}
                  </DropdownMenuLabel>
                  {products.map((product) => (
                    <DropdownMenuItem
                      key={product.itemId}
                      onClick={() => onRestoreColumn(product.itemId)}
                    >
                      <HugeiconsIcon icon={Tick02Icon} className="size-3" />
                      {product.variantLabel}
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
              {hiddenProductsMatchCount === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  No hidden columns match.
                </div>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function SalesAllocationTable({
  initialData,
  initialPools,
  initialManufacturingDemandRows = [],
  organizationId,
}: {
  initialData: SalesOrderListRow[];
  initialPools?: AllocationPoolRow[];
  initialManufacturingDemandRows?: ManufacturingAllocationDemandRow[];
  organizationId: string;
}) {
  const searchParams = useSearchParams();
  const gridApiRef = useRef<GridApi<SalesAllocationGridRow> | null>(null);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ rowId: string; colId: string } | null>(
    null
  );
  const [allocationTarget, setAllocationTarget] = useState<AllocationTarget | null>(
    null
  );
  const [allocatorPreference, setAllocatorPreference] = usePersistentViewState({
    viewKey: SALES_ORDERS_ALLOCATOR_VIEW_KEY,
    defaultValue: DEFAULT_ALLOCATOR_PREFERENCE,
  });
  const [hiddenFamilies, setHiddenFamilies] = useState<Set<string>>(new Set());
  const [shownExtraProductIds, setShownExtraProductIds] = useState<Set<string>>(
    () => new Set()
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  const collapsedWeeks = useMemo(
    () => new Set(allocatorPreference.collapsedWeeks),
    [allocatorPreference.collapsedWeeks]
  );
  const unplannedOpen = allocatorPreference.unplannedOpen;
  const manufacturingOpen = allocatorPreference.manufacturingOpen;

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const { data: orders = initialData, dataUpdatedAt: ordersUpdatedAt } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
      }),
    initialData,
  });
  const { data: inventory = [] } = useQuery({
    queryKey: ["items", organizationId, "allocation"],
    queryFn: () =>
      apiJson<ItemRow[]>("/api/items", {
        fallbackError: "Failed to fetch item inventory.",
      }),
    initialData: [] as ItemRow[],
    staleTime: 0,
    refetchOnMount: "always",
  });
  const hiddenProductIds = allocatorPreference.hiddenProductIds;
  const hiddenProductIdSet = useMemo(
    () => new Set(hiddenProductIds),
    [hiddenProductIds]
  );
  const { data: manufacturingDemandRows = initialManufacturingDemandRows } = useQuery({
    queryKey: ["allocation-manufacturing-demands"],
    queryFn: () =>
      apiJson<ManufacturingAllocationDemandRow[]>(
        "/api/allocation/manufacturing-demands",
        {
          fallbackError: "Failed to fetch manufacturing demand.",
        }
      ),
    initialData: initialManufacturingDemandRows,
  });
  const allProducts = useMemo(
    () => getAllocatorProducts(orders, inventory, manufacturingDemandRows),
    [orders, inventory, manufacturingDemandRows]
  );
  const poolParams = useMemo(() => {
    const itemId = allProducts
      .filter(
        (product) =>
          product.hasActiveDemand || shownExtraProductIds.has(product.itemId)
      )
      .map((product) => product.itemId);
    return buildSearchParams({ itemId }).toString();
  }, [allProducts, shownExtraProductIds]);
  const { data: allocationPools = [], dataUpdatedAt: poolsUpdatedAt } = useQuery({
    queryKey: ["allocation-pools", poolParams],
    enabled: poolParams.length > 0,
    queryFn: () =>
      apiJson<AllocationPoolRow[]>(`/api/allocation/pools?${poolParams}`, {
        fallbackError: "Failed to fetch allocation pools.",
      }),
    initialData: initialPools,
  });

  useEffect(() => {
    if (poolsUpdatedAt > 0) {
      writeLocalStorageJson(POOL_REFRESHED_AT_KEY, poolsUpdatedAt);
    }
  }, [poolsUpdatedAt]);

  const productsWithPools = useMemo(() => {
    const poolsByItemId = new Map(
      allocationPools.map((pool) => [pool.itemId, pool])
    );
    return allProducts.map((product) => {
      const pool = poolsByItemId.get(product.itemId);
      if (!pool) return product;
      return {
        ...product,
        stockQty: parseQuantity(pool.stockQty),
        incomingQty: parseQuantity(pool.incomingQty),
        allocatedQty: parseQuantity(pool.allocatedQty),
        totalDemandQty: parseQuantity(pool.totalDemandQty),
        reservationSummaries: [
          ...pool.assignments.map(
            (assignment) =>
              `${compactQuantity(parseQuantity(assignment.quantity))} ${assignment.demandLabel}`
          ),
          ...pool.reservations
            .filter(
              (reservation) =>
                !pool.assignments.some(
                  (assignment) =>
                    assignment.demandLabel === reservation.demandLabel
                )
            )
            .map(
              (reservation) =>
                `${compactQuantity(parseQuantity(reservation.quantity))} reserved ${reservation.demandLabel}`
            ),
        ],
      };
    });
  }, [allProducts, allocationPools]);
  const visibleProducts = useMemo(
    () =>
      productsWithPools.filter(
        (product) =>
          !hiddenProductIdSet.has(product.itemId) &&
          !hiddenFamilies.has(product.familyLabel) &&
          (product.hasActiveDemand || shownExtraProductIds.has(product.itemId))
      ),
    [productsWithPools, hiddenProductIdSet, hiddenFamilies, shownExtraProductIds]
  );
  const allRows = useMemo(
    () => buildRows(orders, productsWithPools, manufacturingDemandRows),
    [manufacturingDemandRows, orders, productsWithPools]
  );
  const searchedRows = useMemo(
    () => getFilteredRows(allRows, search),
    [allRows, search]
  );
  const searchedRowsInScope = useMemo(
    () =>
      getRowsInScope(
        searchedRows,
        collapsedWeeks,
        manufacturingOpen
      ),
    [collapsedWeeks, manufacturingOpen, searchedRows]
  );
  const coverageById = useMemo(
    () => getCoverage(visibleProducts, searchedRowsInScope),
    [visibleProducts, searchedRowsInScope]
  );

  const familiesAll = useMemo(() => {
    const seen = new Set<string>();
    productsWithPools.forEach((product) => seen.add(product.familyLabel));
    return [...seen].sort((left, right) => left.localeCompare(right));
  }, [productsWithPools]);

  const { topRows, bodyRows } = useMemo(
    () =>
      buildGridRows({
        rows: searchedRows,
        coverage: coverageById,
        collapsedWeeks,
        unplannedOpen,
        manufacturingOpen,
      }),
    [searchedRows, coverageById, collapsedWeeks, unplannedOpen, manufacturingOpen]
  );
  const orderRowCount = searchedRowsInScope.length;

  const refreshedAgoMs = useMemo(() => {
    const persisted = readLocalStorageJson<number | null>(POOL_REFRESHED_AT_KEY, null);
    const seenAt =
      poolsUpdatedAt > 0 ? poolsUpdatedAt : (persisted ?? ordersUpdatedAt);
    if (!seenAt) return null;
    return Math.max(0, nowTick - seenAt);
  }, [nowTick, poolsUpdatedAt, ordersUpdatedAt]);

  const highlightedOrderId = searchParams.get("highlightOrderId");
  const hiddenProducts = productsWithPools.filter(
    (product) =>
      hiddenProductIdSet.has(product.itemId) ||
      (!product.hasActiveDemand && !shownExtraProductIds.has(product.itemId))
  );

  const hideColumn = useCallback(
    (productId: string) => {
      setShownExtraProductIds((current) => {
        if (!current.has(productId)) return current;
        const next = new Set(current);
        next.delete(productId);
        return next;
      });
      setAllocatorPreference((current) => ({
        ...current,
        hiddenProductIds: [...new Set([...current.hiddenProductIds, productId])],
      }));
    },
    [setAllocatorPreference]
  );

  const restoreColumn = useCallback(
    (productId: string) => {
      setShownExtraProductIds((current) => new Set([...current, productId]));
      setAllocatorPreference((current) => ({
        ...current,
        hiddenProductIds: current.hiddenProductIds.filter((id) => id !== productId),
      }));
    },
    [setAllocatorPreference]
  );

  const showAllColumns = useCallback(() => {
    setShownExtraProductIds(
      new Set(productsWithPools.map((product) => product.itemId))
    );
    setAllocatorPreference((current) => ({
      ...current,
      hiddenProductIds: [],
    }));
  }, [productsWithPools, setAllocatorPreference]);

  const toggleWeek = useCallback((weekKey: string) => {
    setAllocatorPreference((current) => {
      const next = new Set(current.collapsedWeeks);
      if (next.has(weekKey)) {
        next.delete(weekKey);
      } else {
        next.add(weekKey);
      }
      return {
        ...current,
        collapsedWeeks: [...next],
      };
    });
  }, [setAllocatorPreference]);

  const toggleUnplanned = useCallback(() => {
    setAllocatorPreference((current) => ({
      ...current,
      unplannedOpen: !current.unplannedOpen,
    }));
  }, [setAllocatorPreference]);

  const toggleManufacturing = useCallback(() => {
    setAllocatorPreference((current) => ({
      ...current,
      manufacturingOpen: !current.manufacturingOpen,
    }));
  }, [setAllocatorPreference]);

  const toggleFamily = useCallback((family: string) => {
    setHiddenFamilies((previous) => {
      const next = new Set(previous);
      if (next.has(family)) {
        next.delete(family);
      } else {
        next.add(family);
      }
      return next;
    });
  }, []);

  const showAllFamilies = useCallback(() => {
    setHiddenFamilies(new Set());
  }, []);

  const openAllocation = useCallback(
    (row: OrderGridRow, cell: AllocationCell) => {
      setSelected({ rowId: row.id, colId: cell.product.itemId });
      setAllocationTarget({
        demandType: cell.line.allocationDemandType ?? "sales_order_line",
        demandLabel: row.label,
        demandContext: row.demandContext,
        order: row.order,
        line: cell.line,
        product: cell.product,
        targetQty: quantityString(cell.demand),
      });
    },
    []
  );

  const scrollHighlightedOrderIntoView = useCallback(() => {
    if (!highlightedOrderId) return;
    const api = gridApiRef.current;
    if (!api) return;

    let node = api.getRowNode(`order:${highlightedOrderId}`) ?? null;
    if (!node) {
      api.forEachNode((rowNode) => {
        if (
          !node &&
          rowNode.data?.rowType === "order" &&
          rowNode.data.order?.id === highlightedOrderId
        ) {
          node = rowNode;
        }
      });
    }
    if (node) {
      api.ensureNodeVisible(node, "middle");
    }
  }, [highlightedOrderId]);

  useEffect(() => {
    scrollHighlightedOrderIntoView();
  }, [bodyRows.length, scrollHighlightedOrderIntoView]);

  useEffect(() => {
    if (!search.trim()) return;
    const api = gridApiRef.current;
    if (!api) return;

    const productId = getProductColumnToReveal(
      searchedRowsInScope,
      visibleProducts,
      search
    );
    if (!productId) return;

    api.ensureColumnVisible(productColId(productId), "middle");
  }, [searchedRowsInScope, search, visibleProducts]);

  const columns = useMemo<
    Array<ColDef<SalesAllocationGridRow> | ColGroupDef<SalesAllocationGridRow>>
  >(
    () => {
      const productGroups = new Map<string, AllocationProduct[]>();
      for (const product of visibleProducts) {
        const products = productGroups.get(product.familyLabel) ?? [];
        products.push(product);
        productGroups.set(product.familyLabel, products);
      }

      return [
        {
          colId: "order",
          headerName: `${orderRowCount} rows`,
          pinned: "left",
          lockPinned: true,
          suppressMovable: true,
          width: ORDER_COL_WIDTH,
          minWidth: 200,
          cellRenderer: OrderIdentityCell,
          sortable: false,
          getQuickFilterText: () => "",
        },
        {
          colId: "shipDate",
          headerName: "Ship",
          pinned: "left",
          lockPinned: true,
          suppressMovable: true,
          width: SHIP_COL_WIDTH,
          minWidth: 88,
          cellRenderer: ShipDateCell,
          sortable: false,
          getQuickFilterText: () => "",
        },
        ...[...productGroups.entries()].map(
          ([familyLabel, products]): ColGroupDef<SalesAllocationGridRow> => ({
            headerName: familyLabel,
            groupId: `family:${familyLabel}`,
            marryChildren: true,
            headerGroupComponent: FamilyHeader,
            headerClass: "erp-grid-movable-header",
            children: products.map(
              (product, index): ColDef<SalesAllocationGridRow> => {
                const isFamilyEnd = index === products.length - 1;
                return {
                  colId: productColId(product.itemId),
                  headerName: product.variantLabel,
                  width: PRODUCT_COL_WIDTH,
                  minWidth: 88,
                  sortable: false,
                  suppressMovable: false,
                  headerComponent: VariantHeader,
                  headerComponentParams: { product, onHide: hideColumn },
                  cellRenderer: (
                    params: ICellRendererParams<SalesAllocationGridRow>
                  ) => {
                    if (params.data?.rowType === "coverage") {
                      return (
                        <CoverageVariantCell
                          {...params}
                          productId={product.itemId}
                        />
                      );
                    }
                    return (
                      <AllocationProductCell
                        {...params}
                        product={product}
                        selected={selected}
                        onOpenAllocation={openAllocation}
                      />
                    );
                  },
                  cellClass: isFamilyEnd ? "fam-end" : undefined,
                  headerClass: isFamilyEnd
                    ? "erp-grid-movable-header fam-end"
                    : "erp-grid-movable-header",
                  getQuickFilterText: () => "",
                };
              }
            ),
          })
        ),
      ];
    },
    [
      hideColumn,
      openAllocation,
      orderRowCount,
      selected,
      visibleProducts,
    ]
  );

  const isFullWidthRow = useCallback(
    (row: SalesAllocationGridRow) =>
      row.rowType === "weekHeader" ||
      row.rowType === "unplannedHeader" ||
      row.rowType === "manufacturingHeader",
    []
  );

  const fullWidthCellRenderer = useCallback(
    (row: SalesAllocationGridRow): ReactNode => {
      if (
        row.rowType !== "weekHeader" &&
        row.rowType !== "unplannedHeader" &&
        row.rowType !== "manufacturingHeader"
      ) {
        return null;
      }
      return (
        <SectionBannerRow
          data={row}
          collapsedWeeks={collapsedWeeks}
          unplannedOpen={unplannedOpen}
          manufacturingOpen={manufacturingOpen}
          onToggleWeek={toggleWeek}
          onToggleUnplanned={toggleUnplanned}
          onToggleManufacturing={toggleManufacturing}
        />
      );
    },
    [
      collapsedWeeks,
      manufacturingOpen,
      toggleManufacturing,
      toggleUnplanned,
      toggleWeek,
      unplannedOpen,
    ]
  );

  const rowClassRules = useMemo(
    () => ({
      "unplanned-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" && params.data.isUnplanned,
      "manufacturing-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" &&
        params.data.demandSource === "manufacturing",
      "late-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" && params.data.lateDays != null,
      "complete-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" &&
        params.data.progress.state === "complete",
      "highlighted-row": (params: { data?: SalesAllocationGridRow }) =>
        params.data?.rowType === "order" &&
        params.data.order?.id === highlightedOrderId,
    }),
    [highlightedOrderId]
  );

  return (
    <>
      <div className={styles.shell}>
        <AllocationToolbar
          search={search}
          onSearchChange={setSearch}
          refreshedAgoMs={refreshedAgoMs}
          hiddenFamilies={hiddenFamilies}
          families={familiesAll}
          onToggleFamily={toggleFamily}
          onShowAllFamilies={showAllFamilies}
          hiddenProducts={hiddenProducts}
          onRestoreColumn={restoreColumn}
          onShowAllColumns={showAllColumns}
        />
        <div className={styles.gridShell}>
          <ERPDataGrid
            className={styles.matrixGrid}
            rows={bodyRows}
            columns={columns}
            pinnedTopRows={topRows}
            getRowId={(row) => row.id}
            emptyMessage="No open sales allocations."
            height="100%"
            rowHeight={45}
            headerHeight={54}
            groupHeaderHeight={28}
            enableQuickFilter={false}
            columnHoverHighlight
            defaultColDef={{
              resizable: true,
              suppressHeaderMenuButton: true,
            }}
            rowClassRules={rowClassRules}
            isFullWidthRow={isFullWidthRow}
            fullWidthCellRenderer={fullWidthCellRenderer}
            getRowHeight={(row) =>
              row.rowType === "weekHeader" ||
              row.rowType === "unplannedHeader" ||
              row.rowType === "manufacturingHeader"
                ? 36
                : row.rowType === "coverage"
                  ? 56
                  : null
            }
            onGridReady={(event: GridReadyEvent<SalesAllocationGridRow>) => {
              gridApiRef.current = event.api;
              scrollHighlightedOrderIntoView();
            }}
            onFirstDataRendered={() => {
              scrollHighlightedOrderIntoView();
            }}
          />
        </div>
      </div>

      <AllocationSourceDialog
        target={allocationTarget}
        onOpenChange={(open) => {
          if (!open) setAllocationTarget(null);
        }}
      />
    </>
  );
}
