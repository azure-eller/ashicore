"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  DeleteColumnIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiJson } from "@/lib/client/api";
import { formatQuantity } from "@/lib/format";
import type { ItemRow } from "@/app/(dashboard)/inventory/types";
import {
  ALLOCATOR_PREFERENCE_ENDPOINT,
  AllocationSourceDialog,
  productLabel,
  type AllocationTarget,
  type AllocatorPreference,
  type AllocatorProduct,
} from "./sales-order-allocator";
import type { SalesOrderListLine, SalesOrderListRow } from "./types";
import styles from "./sales-allocation-table.module.css";

const OPEN_SALES_STATUSES = ["draft", "confirmed", "partially_shipped"] as const;
const STANDALONE_FAMILY_LABEL = "Standalone Products";
const CUSTOMER_COL_WIDTH = 230;
const SHIP_COL_WIDTH = 96;
const VARIANT_COL_WIDTH = 86;

type AllocationProduct = AllocatorProduct & {
  stockQty: number;
  incomingQty: number;
  allocatedQty: number;
  reservationSummaries: string[];
  isStandalone: boolean;
};

export type AllocationPoolRow = {
  itemId: string;
  stockQty: string;
  incomingQty: string;
  stockAllocatedQty?: string;
  incomingAllocatedQty?: string;
  allocatedQty: string;
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
};

type AllocationRow = {
  order: SalesOrderListRow;
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
  alloc: number;
  stock: number;
  incoming: number;
  pool: number;
  surplus: number;
  verdict: "idle" | "ok" | "tight" | "short";
};

type HoverState = {
  rowId: string | null;
  colId: string | null;
};

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
}

function parseQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactQuantity(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    return `${(value / 1000).toFixed(absolute >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return formatQuantity(value.toFixed(4).replace(/\.?0+$/, ""));
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function flattenProducts(items: ItemRow[]) {
  return items.flatMap((item) => (item.subRows && item.subRows.length > 0 ? item.subRows : [item]));
}

function getInventoryById(items: ItemRow[]) {
  return new Map(flattenProducts(items).map((item) => [item.id, item]));
}

function getAllocatorProducts(orders: SalesOrderListRow[], inventory: ItemRow[]) {
  const inventoryById = getInventoryById(inventory);
  const byId = new Map<string, AllocationProduct>();

  orders.forEach((order) => {
    if (!isOpenSalesOrder(order)) return;

    order.lines.forEach((line) => {
      if (line.itemType !== "product") return;
      if (byId.has(line.itemId)) return;

      const inventoryItem = inventoryById.get(line.itemId);
      const isStandalone = line.attrs.length === 0;

      byId.set(line.itemId, {
        itemId: line.itemId,
        label: productLabel(line),
        familyLabel: isStandalone ? STANDALONE_FAMILY_LABEL : line.masterName,
        variantLabel: isStandalone ? line.masterName : line.attrs.join(" "),
        sku: line.itemSku ?? null,
        unitName: line.unitName,
        stockQty: parseQuantity(inventoryItem?.availableQty),
        incomingQty: parseQuantity(inventoryItem?.expectedQty),
        allocatedQty: 0,
        reservationSummaries: [],
        isStandalone,
      });
    });
  });

  return [...byId.values()].sort((left, right) => {
    if (left.isStandalone !== right.isStandalone) {
      return left.isStandalone ? 1 : -1;
    }
    const familyCompare = left.familyLabel.localeCompare(right.familyLabel);
    if (familyCompare !== 0) return familyCompare;
    return left.label.localeCompare(right.label);
  });
}

function buildRows(orders: SalesOrderListRow[], products: AllocationProduct[]) {
  const productById = new Map(products.map((product) => [product.itemId, product]));

  return orders
    .filter(isOpenSalesOrder)
    .map((order): AllocationRow => {
      const cells = new Map<string, AllocationCell>();

      order.lines.forEach((line) => {
        if (!line.id) return;
        const product = productById.get(line.itemId);
        if (!product) return;

        const cell: AllocationCell = {
          line: line as SalesOrderListLine & { id: string },
          product,
          demand: parseQuantity(line.remainingQty ?? line.quantity),
          alloc: parseQuantity(line.allocatedQty),
        };

        cells.set(product.itemId, cell);
      });

      return { order, cells };
    })
    .sort((left, right) => {
      const leftDate = left.order.shipDate ?? "";
      const rightDate = right.order.shipDate ?? "";
      if (!leftDate && rightDate) return 1;
      if (leftDate && !rightDate) return -1;
      const dateCompare = leftDate.localeCompare(rightDate);
      if (dateCompare !== 0) return dateCompare;
      return left.order.orderNumber.localeCompare(right.order.orderNumber, undefined, {
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

function formatShipDate(value: string | null) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function relativeShipLabel(value: string | null) {
  const days = daysFromToday(value);
  if (days == null) return "";
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)}d late`;
  return `in ${days}d`;
}

function getRowLateState(row: AllocationRow) {
  const days = daysFromToday(row.order.shipDate);
  if (days == null || days >= 0) return null;
  const progress = rowProgress(row);
  if (progress.state === "complete" || progress.state === "empty") return null;
  return { daysLate: Math.abs(days) };
}

function getCoverage(products: AllocationProduct[], rows: AllocationRow[]) {
  return new Map(
    products.map((product): [string, ColumnCoverage] => {
      const demand = rows.reduce((sum, row) => {
        const cell = row.cells.get(product.itemId);
        return sum + (cell?.demand ?? 0);
      }, 0);
      const alloc = rows.reduce((sum, row) => {
        const cell = row.cells.get(product.itemId);
        return sum + (cell?.alloc ?? 0);
      }, 0);
      const pool = product.stockQty + product.incomingQty;
      const surplus = pool - demand;
      let verdict: ColumnCoverage["verdict"] = "idle";

      if (demand > 0) {
        if (surplus < 0) verdict = "short";
        else if (surplus < demand * 0.1) verdict = "tight";
        else verdict = "ok";
      }

      return [
        product.itemId,
        {
          product,
          demand,
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

function getGridTemplate(productCount: number) {
  return [
    `${CUSTOMER_COL_WIDTH}px`,
    `${SHIP_COL_WIDTH}px`,
    ...Array.from({ length: productCount }, () => `${VARIANT_COL_WIDTH}px`),
  ]
    .join(" ");
}

function getCellStatus(cell: Pick<AllocationCell, "alloc" | "demand"> | null) {
  if (!cell || cell.demand <= 0) return "empty";
  if (cell.alloc >= cell.demand) return "met";
  if (cell.alloc > 0) return "partial";
  return "short";
}

function getCoverageLabel(coverage: ColumnCoverage) {
  if (coverage.demand <= 0) return { text: "-", tone: "idle" as const };
  if (coverage.verdict === "short") {
    return { text: `short ${compactQuantity(Math.abs(coverage.surplus))}`, tone: "short" as const };
  }
  if (coverage.verdict === "tight") {
    return { text: `tight +${compactQuantity(coverage.surplus)}`, tone: "partial" as const };
  }
  return { text: `✓ +${compactQuantity(coverage.surplus)}`, tone: "met" as const };
}

function getFilteredRows(rows: AllocationRow[], search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) => {
    if (row.order.customerName.toLowerCase().includes(normalized)) return true;
    if (row.order.orderNumber.toLowerCase().includes(normalized)) return true;

    return [...row.cells.values()].some((cell) => {
      const sku = cell.product.sku?.toLowerCase() ?? "";
      return (
        cell.product.label.toLowerCase().includes(normalized) ||
        cell.product.familyLabel.toLowerCase().includes(normalized) ||
        sku.includes(normalized)
      );
    });
  });
}

function applyProductOrder(
  products: AllocationProduct[],
  productOrder: string[]
) {
  if (productOrder.length === 0) return products;
  const orderIndex = new Map(productOrder.map((id, index) => [id, index]));

  return [...products].sort((left, right) => {
    if (left.familyLabel !== right.familyLabel) {
      return products.indexOf(left) - products.indexOf(right);
    }

    const leftIndex = orderIndex.get(left.itemId) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderIndex.get(right.itemId) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return products.indexOf(left) - products.indexOf(right);
  });
}

function todayLabel() {
  return formatShipDate(todayBusinessDate());
}

function isToday(value: string | null) {
  return value === todayBusinessDate();
}

export function SalesAllocationTable({
  initialData,
  initialPools,
}: {
  initialData: SalesOrderListRow[];
  initialPools?: AllocationPoolRow[];
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [hover, setHover] = useState<HoverState>({ rowId: null, colId: null });
  const [selected, setSelected] = useState<{ rowId: string; colId: string } | null>(
    null
  );
  const [allocationTarget, setAllocationTarget] = useState<AllocationTarget | null>(
    null
  );
  const [productOrder, setProductOrder] = useState<string[]>([]);
  const { data: orders = initialData } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
      }),
    initialData,
  });
  const { data: inventory = [] } = useQuery({
    queryKey: ["items", "product", "products"],
    queryFn: () =>
      apiJson<ItemRow[]>("/api/items?itemType=product&view=products", {
        fallbackError: "Failed to fetch product inventory.",
      }),
    initialData: [] as ItemRow[],
  });
  const preferenceQuery = useQuery({
    queryKey: ["sales-orders-allocator-preference"],
    queryFn: () =>
      apiJson<AllocatorPreference>(ALLOCATOR_PREFERENCE_ENDPOINT, {
        fallbackError: "Failed to load allocator preferences.",
      }),
    initialData: { hiddenProductIds: [] },
  });
  const hiddenProductIds = preferenceQuery.data.hiddenProductIds;
  const hiddenProductIdSet = useMemo(
    () => new Set(hiddenProductIds),
    [hiddenProductIds]
  );
  const preferenceMutation = useMutation({
    mutationFn: (nextHiddenProductIds: string[]) =>
      apiJson<AllocatorPreference>(ALLOCATOR_PREFERENCE_ENDPOINT, {
        method: "PUT",
        body: { hiddenProductIds: nextHiddenProductIds },
        fallbackError: "Failed to save allocator preferences.",
      }),
    onMutate: async (nextHiddenProductIds) => {
      await queryClient.cancelQueries({
        queryKey: ["sales-orders-allocator-preference"],
      });
      const previous = queryClient.getQueryData<AllocatorPreference>([
        "sales-orders-allocator-preference",
      ]);
      queryClient.setQueryData<AllocatorPreference>(
        ["sales-orders-allocator-preference"],
        { hiddenProductIds: nextHiddenProductIds }
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["sales-orders-allocator-preference"],
          context.previous
        );
      }
    },
    onSuccess: (preference) => {
      queryClient.setQueryData(
        ["sales-orders-allocator-preference"],
        preference
      );
    },
  });

  const allProducts = useMemo(
    () => getAllocatorProducts(orders, inventory),
    [orders, inventory]
  );
  const poolParams = useMemo(() => {
    const params = new URLSearchParams();
    allProducts.forEach((product) => params.append("itemId", product.itemId));
    return params.toString();
  }, [allProducts]);
  const { data: allocationPools = [] } = useQuery({
    queryKey: ["allocation-pools", poolParams],
    enabled: poolParams.length > 0,
    queryFn: () =>
      apiJson<AllocationPoolRow[]>(`/api/allocation/pools?${poolParams}`, {
        fallbackError: "Failed to fetch allocation pools.",
      }),
    initialData: initialPools,
  });
  const productsWithPools = useMemo(() => {
    const poolsByItemId = new Map(
      allocationPools.map((pool) => [pool.itemId, pool])
    );
    return allProducts.map((product) => {
      const pool = poolsByItemId.get(product.itemId);
      if (!pool) return product;
      return {
        ...product,
        stockQty:
          parseQuantity(pool.stockQty) + parseQuantity(pool.stockAllocatedQty),
        incomingQty:
          parseQuantity(pool.incomingQty) + parseQuantity(pool.incomingAllocatedQty),
        allocatedQty: parseQuantity(pool.allocatedQty),
        reservationSummaries: [
          ...pool.assignments.map(
            (assignment) =>
              `${compactQuantity(parseQuantity(assignment.quantity))} ${assignment.demandLabel}`
          ),
          ...pool.reservations
            .filter(
              (reservation) =>
                !pool.assignments.some(
                  (assignment) => assignment.demandLabel === reservation.demandLabel
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
  const orderedProducts = useMemo(
    () => applyProductOrder(productsWithPools, productOrder),
    [productsWithPools, productOrder]
  );
  const visibleProducts = useMemo(
    () =>
      orderedProducts.filter((product) => !hiddenProductIdSet.has(product.itemId)),
    [orderedProducts, hiddenProductIdSet]
  );
  const allRows = useMemo(() => buildRows(orders, productsWithPools), [orders, productsWithPools]);
  const rows = useMemo(
    () => getFilteredRows(allRows, search),
    [allRows, search]
  );
  const coverageById = useMemo(
    () => getCoverage(visibleProducts, rows),
    [visibleProducts, rows]
  );
  const familyLastVisibleIds = useMemo(() => {
    const byFamily = new Map<string, string>();
    visibleProducts.forEach((product) => {
      byFamily.set(product.familyLabel, product.itemId);
    });
    return new Set(byFamily.values());
  }, [visibleProducts]);
  const familyFirstVisibleIds = useMemo(() => {
    const ids = new Set<string>();
    const seen = new Set<string>();
    visibleProducts.forEach((product) => {
      if (seen.has(product.familyLabel)) return;
      seen.add(product.familyLabel);
      ids.add(product.itemId);
    });
    return ids;
  }, [visibleProducts]);
  const families = useMemo(() => {
    const groups = new Map<string, AllocationProduct[]>();
    visibleProducts.forEach((product) => {
      const bucket = groups.get(product.familyLabel) ?? [];
      bucket.push(product);
      groups.set(product.familyLabel, bucket);
    });
    return [...groups.entries()];
  }, [visibleProducts]);

  const gridTemplateColumns = getGridTemplate(visibleProducts.length);
  const hiddenProducts = allProducts.filter(
    (product) => hiddenProductIdSet.has(product.itemId)
  );
  const totals = rows.reduce(
    (acc, row) => {
      const progress = rowProgress(row);
      const late = getRowLateState(row);
      acc.alloc += progress.alloc;
      acc.demand += progress.demand;
      if (late) acc.late += 1;
      if (progress.state === "complete") acc.complete += 1;
      row.cells.forEach((cell) => {
        if (cell.demand > cell.alloc) acc.shortLines += 1;
        if (cell.demand > 0) acc.lines += 1;
      });
      return acc;
    },
    { late: 0, complete: 0, shortLines: 0, lines: 0, alloc: 0, demand: 0 }
  );

  function hideColumn(productId: string) {
    preferenceMutation.mutate([...new Set([...hiddenProductIds, productId])]);
  }

  function restoreColumn(productId: string) {
    preferenceMutation.mutate(hiddenProductIds.filter((id) => id !== productId));
  }

  function showAllColumns() {
    preferenceMutation.mutate([]);
  }

  function moveColumn(productId: string, direction: -1 | 1) {
    setProductOrder((current) => {
      const ordered = applyProductOrder(productsWithPools, current);
      const product = ordered.find((entry) => entry.itemId === productId);
      if (!product) return current;
      const familyProducts = ordered.filter(
        (entry) =>
          entry.familyLabel === product.familyLabel &&
          !hiddenProductIdSet.has(entry.itemId)
      );
      const familyIndex = familyProducts.findIndex(
        (entry) => entry.itemId === productId
      );
      const swapWith = familyProducts[familyIndex + direction];
      if (!swapWith) return current;

      const next = [...ordered];
      const currentIndex = next.findIndex((entry) => entry.itemId === productId);
      const swapIndex = next.findIndex((entry) => entry.itemId === swapWith.itemId);
      [next[currentIndex], next[swapIndex]] = [next[swapIndex], next[currentIndex]];
      return next.map((entry) => entry.itemId);
    });
  }

  function openAllocation(row: AllocationRow, cell: AllocationCell) {
    setSelected({ rowId: row.order.id, colId: cell.product.itemId });
    setAllocationTarget({
      order: row.order,
      line: cell.line,
      product: cell.product,
      targetQty: quantityString(cell.demand),
    });
  }

  return (
    <>
      <div className={styles.shell}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <div className={styles.searchWrap}>
              <HugeiconsIcon icon={Search01Icon} className={styles.searchIcon} />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search orders, SKUs, customers..."
                aria-label="Search sales allocations"
                className={styles.searchInput}
              />
            </div>
            <span className={styles.toolbarDivider} />
            <button type="button" className={styles.toolbarButton}>
              Filter <span>·</span> <strong>3</strong>
            </button>
            <button type="button" className={styles.toolbarButton}>
              Sort: Lateness ↓
            </button>
            <button type="button" className={styles.toolbarButton}>
              Group by SKU family
            </button>
          </div>
          <div className={styles.chips}>
            {hiddenProducts.length > 0 ? (
              <HiddenColumnsMenu
                hiddenProducts={hiddenProducts}
                onRestore={restoreColumn}
                onShowAll={showAllColumns}
              />
            ) : null}
            {totals.late > 0 ? <Chip tone="short" label={`${totals.late} late`} /> : null}
            <Chip tone="partial" label={`${totals.shortLines} short of ${totals.lines} lines`} />
            <Chip tone="met" label={`${totals.complete} complete`} />
            <Chip tone="neutral" label={`${compactQuantity(totals.alloc)} / ${compactQuantity(totals.demand)} allocated`} />
            <button type="button" className={styles.allocateButton}>
              Allocate
            </button>
          </div>
        </div>

        <div
          className={styles.gridViewport}
          onMouseLeave={() => setHover({ rowId: null, colId: null })}
        >
          <div
            className={styles.grid}
            style={
              {
                gridTemplateColumns,
                "--col-w-cust": `${CUSTOMER_COL_WIDTH}px`,
                "--col-w-ship": `${SHIP_COL_WIDTH}px`,
                "--row-h": "36px",
              } as React.CSSProperties
            }
          >
            <div className={`${styles.headerCell} ${styles.headerBand} ${styles.stickyCustomerHeader}`} style={{ gridColumn: "1 / span 2" }}>
              <span>{rows.length} ORDERS</span>
            </div>
            {families.map(([familyLabel, products], familyIndex) => (
              <div
                key={familyLabel}
                className={`${styles.headerCell} ${styles.headerBand} ${styles.familyEnd}`}
                data-family-tone={familyIndex % 2 === 1 ? "tint" : "plain"}
                style={{ gridColumn: `span ${products.length}` }}
              >
                {familyLabel}
              </div>
            ))}

            <div className={`${styles.headerCell} ${styles.headerVariant} ${styles.stickyCustomer}`} style={{ gridColumn: "1" }} />
            <div className={`${styles.headerCell} ${styles.headerVariant} ${styles.stickyShip}`} style={{ gridColumn: "2" }} />
            {visibleProducts.map((product) => {
              const familyProducts = visibleProducts.filter(
                (entry) => entry.familyLabel === product.familyLabel
              );
              const familyIndex = familyProducts.findIndex(
                (entry) => entry.itemId === product.itemId
              );

              return (
              <div
                key={product.itemId}
                className={`${styles.headerCell} ${styles.headerVariant} ${familyFirstVisibleIds.has(product.itemId) ? styles.familyStart : ""} ${familyLastVisibleIds.has(product.itemId) ? styles.familyEnd : ""}`}
              >
                <span className={styles.variantName}>{product.variantLabel}</span>
                <span className={styles.sku}>{product.sku ?? product.unitName}</span>
                <div className={styles.columnActions}>
                  <button
                    type="button"
                    className={styles.columnAction}
                    aria-label={`Move ${product.label} left`}
                    onClick={() => moveColumn(product.itemId, -1)}
                    disabled={familyIndex === 0}
                  >
                    <HugeiconsIcon icon={ArrowLeft01Icon} size={12} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className={styles.columnAction}
                    aria-label={`Move ${product.label} right`}
                    onClick={() => moveColumn(product.itemId, 1)}
                    disabled={familyIndex === familyProducts.length - 1}
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className={styles.columnAction}
                    aria-label={`Hide ${product.label}`}
                    onClick={() => hideColumn(product.itemId)}
                  >
                    <HugeiconsIcon icon={DeleteColumnIcon} size={12} strokeWidth={2} />
                  </button>
                </div>
              </div>
              );
            })}

            <div className={`${styles.headerCell} ${styles.headerCoverage} ${styles.stickyCustomer}`} style={{ gridColumn: "1" }}>
              <span>Coverage</span>
              <small>pool vs total demand</small>
            </div>
            <div className={`${styles.headerCell} ${styles.headerCoverage} ${styles.stickyShip}`} style={{ gridColumn: "2" }}>
              <span>Today</span>
              <small>{todayLabel()}</small>
            </div>
            {visibleProducts.map((product) => (
              <CoverageHeader
                key={product.itemId}
                coverage={coverageById.get(product.itemId)}
                isFamilyStart={familyFirstVisibleIds.has(product.itemId)}
                isFamilyEnd={familyLastVisibleIds.has(product.itemId)}
              />
            ))}

            {rows.map((row) => {
              const progress = rowProgress(row);
              const late = getRowLateState(row);
              const isComplete = progress.state === "complete";

              return (
                <AllocationGridRow
                  key={row.order.id}
                  row={row}
                  progress={progress}
                  lateDays={late?.daysLate ?? null}
                  visibleProducts={visibleProducts}
                  familyFirstVisibleIds={familyFirstVisibleIds}
                  familyLastVisibleIds={familyLastVisibleIds}
                  hover={hover}
                  selected={selected}
                  onHover={setHover}
                  onOpenAllocation={openAllocation}
                  isComplete={isComplete}
                />
              );
            })}

            <div className={`${styles.footerCell} ${styles.stickyCustomerFooter}`}>
              <span>Allocated / Demand</span>
            </div>
            <div className={`${styles.footerCell} ${styles.stickyShipFooter}`}>
              <span>vs pool</span>
            </div>
            {visibleProducts.map((product) => (
              <CoverageFooter
                key={product.itemId}
                coverage={coverageById.get(product.itemId)}
                isFamilyStart={familyFirstVisibleIds.has(product.itemId)}
                isFamilyEnd={familyLastVisibleIds.has(product.itemId)}
              />
            ))}
          </div>
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

function AllocationGridRow({
  row,
  progress,
  lateDays,
  visibleProducts,
  familyFirstVisibleIds,
  familyLastVisibleIds,
  hover,
  selected,
  onHover,
  onOpenAllocation,
  isComplete,
}: {
  row: AllocationRow;
  progress: RowProgress;
  lateDays: number | null;
  visibleProducts: AllocationProduct[];
  familyFirstVisibleIds: Set<string>;
  familyLastVisibleIds: Set<string>;
  hover: HoverState;
  selected: { rowId: string; colId: string } | null;
  onHover: (hover: HoverState) => void;
  onOpenAllocation: (row: AllocationRow, cell: AllocationCell) => void;
  isComplete: boolean;
}) {
  const rowTone =
    lateDays != null ? "late" : progress.state === "complete" ? "complete" : progress.state;
  const today = isToday(row.order.shipDate);

  return (
    <>
      <div
        className={`${styles.dataCell} ${styles.customerCell} ${styles.stickyCustomer} ${hover.rowId === row.order.id ? styles.hovered : ""}`}
        data-row-tone={rowTone}
        data-today={today ? "true" : undefined}
        onMouseEnter={() => onHover({ rowId: row.order.id, colId: hover.colId })}
      >
        <span className={styles.rail} />
        <Link href={`/sales/orders/${row.order.id}`} className={styles.customerName}>
          {row.order.customerName}
          {isComplete ? <span className={styles.completeMark} title="Order fully allocated">✓</span> : null}
        </Link>
        <span className={styles.orderNumber}>{row.order.orderNumber}</span>
      </div>
      <div
        className={`${styles.dataCell} ${styles.shipCell} ${styles.stickyShip} ${hover.rowId === row.order.id ? styles.hovered : ""}`}
        data-today={today ? "true" : undefined}
        onMouseEnter={() => onHover({ rowId: row.order.id, colId: hover.colId })}
      >
        <span className={styles.shipDate}>{today ? "Today" : formatShipDate(row.order.shipDate)}</span>
        {lateDays != null ? (
          <span className={styles.relativeBadge} data-ship-tone="late">
            {relativeShipLabel(row.order.shipDate)}
          </span>
        ) : null}
      </div>
      {visibleProducts.map((product) => {
        const cell = row.cells.get(product.itemId) ?? null;
        const isHovered =
          hover.rowId === row.order.id || hover.colId === product.itemId;
        const isIntersection =
          hover.rowId === row.order.id && hover.colId === product.itemId;
        const isSelected =
          selected?.rowId === row.order.id && selected.colId === product.itemId;

        return (
          <AllocationMatrixCell
            key={product.itemId}
            cell={cell}
            row={row}
            product={product}
            isFamilyStart={familyFirstVisibleIds.has(product.itemId)}
            isFamilyEnd={familyLastVisibleIds.has(product.itemId)}
            isHovered={isHovered}
            isIntersection={isIntersection}
            isSelected={isSelected}
            isToday={today}
            onHover={() => onHover({ rowId: row.order.id, colId: product.itemId })}
            onOpenAllocation={onOpenAllocation}
          />
        );
      })}
    </>
  );
}

function AllocationMatrixCell({
  cell,
  row,
  product,
  isFamilyStart,
  isFamilyEnd,
  isHovered,
  isIntersection,
  isSelected,
  isToday,
  onHover,
  onOpenAllocation,
}: {
  cell: AllocationCell | null;
  row: AllocationRow;
  product: AllocationProduct;
  isFamilyStart: boolean;
  isFamilyEnd: boolean;
  isHovered: boolean;
  isIntersection: boolean;
  isSelected: boolean;
  isToday: boolean;
  onHover: () => void;
  onOpenAllocation: (row: AllocationRow, cell: AllocationCell) => void;
}) {
  const status = getCellStatus(cell);
  const progress = cell && cell.demand > 0 ? Math.min(1, cell.alloc / cell.demand) : 0;

  return (
    <button
      type="button"
      className={`${styles.dataCell} ${styles.matrixCell} ${isFamilyStart ? styles.familyStart : ""} ${isFamilyEnd ? styles.familyEnd : ""} ${isHovered ? styles.hovered : ""} ${isIntersection ? styles.intersection : ""} ${isSelected ? styles.selected : ""}`}
      data-status={status}
      data-today={isToday ? "true" : undefined}
      onMouseEnter={onHover}
      onClick={() => {
        if (cell) onOpenAllocation(row, cell);
      }}
      disabled={!cell}
      aria-label={cell ? `Allocate ${product.label}` : `${product.label} not ordered`}
    >
      {cell ? (
        <>
          <span className={styles.cellQty}>
            {status === "met" ? <span className={styles.inlineCheck}>✓</span> : null}
            <strong>{compactQuantity(cell.alloc)}</strong>
            <span className={styles.slash}>/</span>
            <span>{compactQuantity(cell.demand)}</span>
          </span>
          <span className={styles.progressBar} style={{ width: `${progress * 100}%` }} />
        </>
      ) : null}
    </button>
  );
}

function CoverageHeader({
  coverage,
  isFamilyStart,
  isFamilyEnd,
}: {
  coverage: ColumnCoverage | undefined;
  isFamilyStart: boolean;
  isFamilyEnd: boolean;
}) {
  if (!coverage) {
    return <div className={`${styles.headerCell} ${styles.headerCoverage} ${isFamilyStart ? styles.familyStart : ""} ${isFamilyEnd ? styles.familyEnd : ""}`} />;
  }

  const label = getCoverageLabel(coverage);

  return (
    <div className={`${styles.headerCell} ${styles.headerCoverage} ${isFamilyStart ? styles.familyStart : ""} ${isFamilyEnd ? styles.familyEnd : ""}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={styles.coverageSummary}>
            <div className={styles.verdict} data-tone={label.tone}>{label.text}</div>
            <div className={styles.coverageSubline}>
              <span>pool {compactQuantity(coverage.pool)}</span>
              <span>need {compactQuantity(coverage.demand)}</span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="block font-mono text-[11px] leading-4 tabular-nums"
        >
          <div className="grid grid-cols-[auto_auto] gap-x-3">
            <span>STOCK</span>
            <span className="text-right">{compactQuantity(coverage.stock)}</span>
            <span>+ MO</span>
            <span className="text-right">{compactQuantity(coverage.incoming)}</span>
            <span className="col-span-2 my-0.5 border-t border-background/45" />
            <span>= POOL</span>
            <span className="text-right">{compactQuantity(coverage.pool)}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function CoverageFooter({
  coverage,
  isFamilyStart,
  isFamilyEnd,
}: {
  coverage: ColumnCoverage | undefined;
  isFamilyStart: boolean;
  isFamilyEnd: boolean;
}) {
  if (!coverage) {
    return <div className={`${styles.footerCell} ${isFamilyStart ? styles.familyStart : ""} ${isFamilyEnd ? styles.familyEnd : ""}`} />;
  }

  const label = getCoverageLabel(coverage);

  return (
    <div className={`${styles.footerCell} ${styles.totalCell} ${isFamilyStart ? styles.familyStart : ""} ${isFamilyEnd ? styles.familyEnd : ""}`}>
      <div>
        <span>{compactQuantity(coverage.alloc)} / {compactQuantity(coverage.demand)}</span>
        <strong>{compactQuantity(coverage.pool)}</strong>
      </div>
      <span className={styles.footerVerdict} data-tone={label.tone}>
        <span />
        {coverage.demand > 0 ? label.text.replace("✓ ", "surplus ") : "no demand"}
      </span>
    </div>
  );
}

function Chip({
  tone,
  label,
}: {
  tone: "short" | "partial" | "met" | "neutral";
  label: string;
}) {
  return (
    <span className={styles.chip} data-tone={tone}>
      <span />
      {label}
    </span>
  );
}

function HiddenColumnsMenu({
  hiddenProducts,
  onRestore,
  onShowAll,
}: {
  hiddenProducts: AllocationProduct[];
  onRestore: (productId: string) => void;
  onShowAll: () => void;
}) {
  const byFamily = hiddenProducts.reduce((groups, product) => {
    const bucket = groups.get(product.familyLabel) ?? [];
    bucket.push(product);
    groups.set(product.familyLabel, bucket);
    return groups;
  }, new Map<string, AllocationProduct[]>());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={styles.hiddenPill}>
          {hiddenProducts.length} hidden columns
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Hidden columns</DropdownMenuLabel>
          <Button type="button" variant="ghost" size="sm" onClick={onShowAll}>
            Show all
          </Button>
        </div>
        <DropdownMenuSeparator />
        {[...byFamily.entries()].map(([family, products]) => (
          <div key={family}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {family}
            </DropdownMenuLabel>
            {products.map((product) => (
              <DropdownMenuItem
                key={product.itemId}
                onClick={() => onRestore(product.itemId)}
              >
                {product.variantLabel} · {product.familyLabel}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
