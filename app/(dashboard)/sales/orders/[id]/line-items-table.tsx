"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ICellRendererParams,
  ValueSetterParams,
} from "ag-grid-community";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { flushSavedCardOrThrow } from "@/components/card-page/card-action-boundary";
import { FulfillmentStatusBlock } from "@/components/fulfillment-status-block";
import { CardSection } from "@/components/card-page/card-page";
import { formatPercent, formatPrice, formatQuantity, normalizeMoney } from "@/lib/format";
import {
  calculateDiscountPercentValue,
  calculateSalesLineAmounts,
} from "@/lib/sales/order-calculations";
import {
  getIngredientsDisplayState,
  getProductionDisplayState,
  getSalesItemsDisplayState,
  type FulfillmentDisplayState,
} from "@/lib/sales/fulfillment-status";
import {
  ProductionStatusCell,
  StatusDetailCell,
  ingredientsStatusEmptyMessage,
} from "../../sales-order-table-action-cells";
import {
  CreateManufacturingOrdersDialog,
} from "../../create-manufacturing-orders-dialog";
import { apiJson } from "@/lib/client/api";
import type {
  SalesLinePricingResult,
  SalesOrderDetail,
  SalesOrderDetailLine,
  SalesOrderItemOption,
} from "@/lib/sales/types";
import { makeDraftLine } from "./order-draft";
import type { SalesOrderDraftController } from "./use-sales-order-draft-controller";

export type LineItemsTableProps = {
  order: SalesOrderDetail;
  editable: boolean;
  itemOptions?: SalesOrderItemOption[];
  controller: SalesOrderDraftController;
  onActionError?: (error: Error) => void;
};

export function LineItemsTable({
  order,
  editable,
  itemOptions,
  controller,
  onActionError,
}: LineItemsTableProps) {
  const [confirmDelete, setConfirmDelete] = useState<SalesOrderDetailLine | null>(null);
  const [lineCreateMo, setLineCreateMo] = useState<{
    strategy: "make_to_order" | "make_to_stock";
    salesOrderLineId: string;
  } | null>(null);
  const persistedLineIds = controller.persistedLineIds;
  const lineGuards = useMemo(() => {
    const isPersistedLine = (line: SalesOrderDetailLine | undefined) =>
      Boolean(line?.id && persistedLineIds.has(line.id) && line.itemId);
    const isDraftLineSaveAttempt = (
      change: EditableLineDataGridChange<SalesOrderDetailLine>,
    ): change is EditableLineDataGridChange<SalesOrderDetailLine> & {
      row: SalesOrderDetailLine;
      field: "itemId" | "sellingQuantity" | "unitPrice" | "taxRateId";
    } =>
      change.type === "cell_edit_committed" &&
      change.row != null &&
      (change.field === "itemId" ||
        change.field === "sellingQuantity" ||
        change.field === "unitPrice" ||
        change.field === "taxRateId") &&
      !isPersistedLine(change.row);
    return { isPersistedLine, isDraftLineSaveAttempt };
  }, [persistedLineIds]);
  const { isPersistedLine, isDraftLineSaveAttempt } = lineGuards;
  const [pricingLookupError, setPricingLookupError] = useState<string | null>(null);
  const [rows, setRows] = useState(order.lines);
  const savedDraftLineIdsRef = useRef(new Set<string>());

  useEffect(() => {
    setRows((current) => mergeUnsentBlankLines(order.lines, current));
    savedDraftLineIdsRef.current = new Set(
      order.lines
        .filter((line) => !persistedLineIds.has(line.id) && !isBlankSalesOrderLine(line))
        .map((line) => line.id),
    );
  }, [order.lines, persistedLineIds]);

  const nonBlankRows = rows.filter((line) => !isBlankSalesOrderLine(line));
  const quantitySummary = summarizeSellingQuantity(nonBlankRows);
  const canAddLine = editable && itemOptions != null;
  const existingItemIds = useMemo(
    () => new Set(rows.filter((line) => !isBlankSalesOrderLine(line)).map((line) => line.itemId)),
    [rows],
  );
  const itemMap = useMemo(
    () => new Map((itemOptions ?? []).map((option) => [option.id, option])),
    [itemOptions],
  );

  const taxRateMap = useMemo(
    () => new Map(order.taxRates.map((rate) => [rate.id, rate])),
    [order.taxRates],
  );
  const defaultTaxRate = order.defaultTaxRateId
    ? taxRateMap.get(order.defaultTaxRateId) ?? null
    : null;

  const applyPatch = (
    lineId: string,
    patch: {
      quantity?: string;
      unitPrice?: string;
      taxRateId?: string | null;
      taxRateName?: string | null;
      taxRatePercent?: string;
    },
  ) => {
    controller.updateLine(lineId, patch);
  };
  const flushBeforeCreateManufacturingOrder = useCallback(
    () =>
      flushSavedCardOrThrow({
        flush: controller.flush,
        blockedMessage: "Fix the highlighted fields.",
      }),
    [controller.flush],
  );
  const openLineCreateManufacturingOrder = useCallback(
    async (
      strategy: "make_to_order" | "make_to_stock",
      line: SalesOrderDetailLine,
    ) => {
      await flushBeforeCreateManufacturingOrder();
      setLineCreateMo({
        strategy,
        salesOrderLineId: line.id,
      });
    },
    [flushBeforeCreateManufacturingOrder],
  );

  const fields = useMemo<LineField<SalesOrderDetailLine>[]>(
    () => [
      {
        field: "itemId",
        headerName: "Item",
        flex: 1,
        minWidth: 240,
        editable: (data) => editable && !isPersistedLine(data),
        kind: "inventory-item",
        options: (itemOptions ?? []).filter((option) => !existingItemIds.has(option.id)),
        placeholder: "Search items...",
        emptyMessage: "No items found",
        requiredMessage: "Item is required",
        createLinks: [
          { href: "/inventory/product", label: "Create product" },
          { href: "/inventory/material", label: "Create material" },
        ],
        getSecondaryText: (current) =>
          [current.sku, current.unitName]
            .filter((part): part is string => part != null && part !== "")
            .join(" · "),
        valueSetter: (params: ValueSetterParams<SalesOrderDetailLine, string | null>) => {
          const itemId = String(params.newValue ?? "");
          const item = itemMap.get(itemId);
          if (!item) return false;
          Object.assign(params.data, lineFromItem(item, params.data.id, undefined, defaultTaxRate));
          return true;
        },
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) =>
          data ? (
            <div className="flex flex-col justify-center leading-tight py-(--space-1)">
              <span className="font-medium">
                {data.itemName || <span className="text-[var(--color-ink-faint)]">Search items...</span>}
              </span>
              <span className="text-[length:var(--text-card-caption)] text-[var(--color-ink-faint)]">
                {data.sellingUnitName}
              </span>
            </div>
          ) : null,
      },
      {
        field: "itemSku",
        kind: "display",
        headerName: "SKU",
        width: 120,
        cellClass: "text-[length:var(--text-base)]",
        mono: true,
        muted: true,
        valueFormatter: ({ value }) => (value ? String(value) : "—"),
      },
      {
        field: "sellingQuantity",
        colId: "quantity",
        kind: "number",
        headerName: "Qty",
        rightAligned: true,
        width: 90,
        editable,
        mono: true,
        tooltipValueGetter: ({ data }) => data ? quantityLockReason(data) : null,
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) => {
          if (!data) return null;
          const shipped = Number(data.sellingShippedQuantity);
          return (
            <div className="flex flex-col items-end justify-center leading-tight py-(--space-1) font-mono tabular-nums">
              <span>{formatQuantity(data.sellingQuantity) ?? "0"}</span>
              {shipped > 0 ? (
                <span className="text-[length:var(--text-card-caption)] text-[var(--color-ink-faint)]">
                  {formatQuantity(data.sellingShippedQuantity)} shipped
                </span>
              ) : null}
            </div>
          );
        },
        valueFormatter: ({ value }) => formatQuantity(String(value ?? "0")) ?? "0",
        valueSetter: numericSetter(
          "sellingQuantity",
          (value, line) => value >= minimumLineQuantity(line)
        ),
      },
      {
        field: "unitPrice",
        kind: "number",
        headerName: "Price per unit",
        rightAligned: true,
        width: 130,
        editable,
        mono: true,
        valueFormatter: ({ value }) => formatPrice(String(value ?? "0")) ?? "—",
        valueSetter: numericSetter("unitPrice", (value) => value > 0),
      },
      {
        colId: "discountPercent",
        kind: "number",
        headerName: "Discount",
        rightAligned: true,
        width: 130,
        editable,
        mono: true,
        valueGetter: ({ data }) => data ? lineDiscountPercent(data, itemMap) : null,
        valueFormatter: ({ value }) => formatPercent(value),
        valueSetter: (params: ValueSetterParams<SalesOrderDetailLine>) => {
          const text = String(params.newValue ?? "").trim();
          const parsed = text === "" ? 0 : Number.parseFloat(text);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 100) return false;
          const baseUnitPrice = lineBaseUnitPrice(params.data, itemMap);
          if (baseUnitPrice == null || baseUnitPrice <= 0) return false;
          const nextUnitPrice = normalizeMoney(baseUnitPrice * (1 - parsed / 100));
          if (nextUnitPrice === normalizeMoney(Number(params.data.unitPrice))) return false;
          params.data.unitPrice = nextUnitPrice;
          params.data.discountPercent = normalizeMoney(parsed);
          recalculateLineTotals(params.data);
          return true;
        },
        getSuffix: () => "%",
        tooltipValueGetter: ({ data }) => data ? pricingSourceLabel(data) : null,
      },
      {
        field: "taxRateId",
        kind: "select",
        headerName: "Tax %",
        rightAligned: true,
        width: 130,
        editable,
        values: ["", ...order.taxRates.map((rate) => rate.id)],
        getSelectLabel: (value) => {
          if (!value) return "0%";
          const rate = taxRateMap.get(value);
          return rate ? `${rate.ratePercent}% - ${rate.name}` : "0%";
        },
        valueFormatter: ({ value }) => {
          if (!value) return "0%";
          const rate = taxRateMap.get(String(value));
          return rate ? `${rate.ratePercent}% - ${rate.name}` : "0%";
        },
        valueSetter: (params: ValueSetterParams<SalesOrderDetailLine, string | null>) => {
          const rateId = params.newValue ? String(params.newValue) : null;
          const rate = rateId ? taxRateMap.get(rateId) ?? null : null;
          params.data.taxRateId = rate?.id ?? null;
          params.data.taxRateName = rate?.name ?? null;
          params.data.taxRatePercent = rate?.ratePercent ?? "0";
          recalculateLineTotals(params.data);
          return true;
        },
      },
      {
        field: "lineTotal",
        kind: "display",
        headerName: "Total price",
        rightAligned: true,
        width: 120,
        mono: true,
        strong: true,
        valueFormatter: ({ value }) => formatPrice(String(value ?? "0")) ?? "—",
      },
      {
        colId: "salesItemsState",
        kind: "display",
        headerName: "Sales items",
        width: 150,
        minWidth: 145,
        cellClass: "statusBlockCell",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) =>
          data ? (
            <FulfillmentStatusBlock
              state={lineSalesItemsState(data, order.status)}
            />
          ) : null,
      },
      {
        colId: "ingredientsState",
        kind: "display",
        headerName: "Ingredients",
        width: 155,
        minWidth: 150,
        cellClass: "statusBlockCell",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) =>
          data ? (
            <StatusDetailCell
              label="Ingredients"
              menuLabel="Short ingredients"
              state={lineIngredientsState(data)}
              emptyMessage={ingredientsStatusEmptyMessage(lineIngredientsState(data), "line")}
              rows={lineIngredientShortageRows(data)}
            />
          ) : null,
      },
      {
        colId: "productionState",
        kind: "display",
        headerName: "Production",
        width: 180,
        minWidth: 175,
        cellClass: "statusBlockCell",
        cellRenderer: ({ data }: ICellRendererParams<SalesOrderDetailLine>) =>
          data ? (
            <ProductionStatusCell
              state={lineProductionState(data)}
              salesOrderId={order.id}
              salesOrderStatus={order.status}
              salesOrderLabel={`${order.orderNumber} - ${order.customerName}`}
              shipDate={order.shipDate}
              openManufacturingOrders={data.linkedManufacturingOrders ?? []}
              onCreateManufacturingOrder={(strategy) => {
                void openLineCreateManufacturingOrder(strategy, data).catch((error) => {
                  onActionError?.(error as Error);
                });
              }}
            />
          ) : null,
      },
    ],
    [
      editable,
      existingItemIds,
      isPersistedLine,
      itemMap,
      itemOptions,
      order.customerName,
      order.id,
      order.orderNumber,
      order.shipDate,
      order.status,
      order.taxRates,
      onActionError,
      openLineCreateManufacturingOrder,
      taxRateMap,
      defaultTaxRate,
    ],
  );

  const handleRowsChange = async (
    nextRows: SalesOrderDetailLine[],
    change: EditableLineDataGridChange<SalesOrderDetailLine>,
  ) => {
    setRows(nextRows);
    if (change.type === "row_reordered") {
      controller.reorderLines(
        nextRows.filter((row) => !isBlankSalesOrderLine(row)).map((row) => row.id),
      );
      return;
    }
    if (isDraftLineSaveAttempt(change)) {
      const picked = itemMap.get(change.row.itemId);
      if (!picked || !isSavableDraftLine(change.row)) return;
      if (savedDraftLineIdsRef.current.has(change.row.id)) {
        return;
      }
      const pricingResult = await resolveLinePricing({
        customerId: order.customerId,
        itemId: picked.id,
        quantity: change.row.sellingQuantity,
      });
      setPricingLookupError(pricingResult.error);
      controller.addLine(
        lineFromItem(picked, change.row.id, {
          quantity: change.row.sellingQuantity,
          unitPrice:
            pricingResult.pricing?.suggestedUnitPrice ?? change.row.unitPrice,
          taxRateId: change.row.taxRateId,
          pricing: pricingResult.pricing,
        }, taxRateMap.get(change.row.taxRateId ?? "") ?? defaultTaxRate ?? null),
      );
      savedDraftLineIdsRef.current.add(change.row.id);
      return;
    }
    if (change.type === "cell_edit_committed" && change.row && change.field && isPersistedLine(change.row)) {
      if (change.field === "sellingQuantity") {
        applyPatch(change.row.id, {
          quantity: change.row.sellingQuantity,
        });
      } else if (change.field === "unitPrice") {
        applyPatch(change.row.id, { unitPrice: change.row.unitPrice });
      } else if (change.field === "taxRateId") {
        applyPatch(change.row.id, {
          taxRateId: change.row.taxRateId,
          taxRateName: change.row.taxRateName,
          taxRatePercent: change.row.taxRatePercent,
        });
      }
    } else if (
      change.type === "cell_edit_committed" &&
      change.row &&
      change.colId === "discountPercent" &&
      isPersistedLine(change.row)
    ) {
      applyPatch(change.row.id, { unitPrice: change.row.unitPrice });
    }
  };

  const requestDelete = (line: SalesOrderDetailLine) => {
    if (deleteLineLockedReason(line)) return;
    if (Number(line.sellingShippedQuantity) > 0) {
      setConfirmDelete(line);
      return;
    }
    controller.removeLine(line.id);
  };

  const lineCount = nonBlankRows.length;

  return (
    <>
      <CardSection
        title="Line items"
        count={`· ${lineCount} ${lineCount === 1 ? "line" : "lines"}${
          quantitySummary ? ` · ${quantitySummary}` : ""
        }`}
      >

        <MutableLines<SalesOrderDetailLine>
          rows={rows}
          fields={fields}
          getRowId={(row) => row.id}
          createRow={() => makeBlankLine(defaultTaxRate)}
          onRowsChange={handleRowsChange}
          addLabel="Add line"
          readOnly={!canAddLine}
          addDisabledReason={null}
          emptyMessage="No line items yet."
          canDeleteRow={() => true}
          getDeleteDisabledReason={(row) =>
            isPersistedLine(row) ? deleteLineLockedReason(row) : null
          }
          onDeleteRow={(row) => {
            if (!isPersistedLine(row)) {
              setRows((current) => current.filter((line) => line.id !== row.id));
              return;
            }
            requestDelete(row);
          }}
        />

        {pricingLookupError ? (
          <div className="px-(--space-3) pt-(--space-2) text-[length:var(--text-card-caption)] text-[var(--status-danger-ink)]">
            {pricingLookupError}
          </div>
        ) : null}

        <AlertDialog
          open={confirmDelete != null}
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(null);
          }}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete line?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDelete
                  ? `${confirmDelete.itemName} has covered or shipped quantity. Removing it will update demand coverage. This cannot be undone.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="danger"
                onClick={(event) => {
                  event.preventDefault();
                  if (confirmDelete) controller.removeLine(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardSection>
      {lineCreateMo ? (
        <CreateManufacturingOrdersDialog
          salesOrderId={order.id}
          open
          onOpenChange={(open) => {
            if (!open) setLineCreateMo(null);
          }}
          showTrigger={false}
          initialOrder={order}
          manufacturingStrategy={lineCreateMo.strategy}
          lineScopeSalesOrderLineId={lineCreateMo.salesOrderLineId}
        />
      ) : null}
    </>
  );

  function numericSetter(
    field: "sellingQuantity" | "unitPrice",
    valid: (value: number, line: SalesOrderDetailLine) => boolean,
  ) {
    return (params: ValueSetterParams<SalesOrderDetailLine>) => {
      const parsed = Number.parseFloat(String(params.newValue).trim());
      if (!Number.isFinite(parsed) || !valid(parsed, params.data)) return false;
      const normalized = parsed.toString();
      if (normalized === Number.parseFloat(params.data[field]).toString()) return false;
      params.data[field] = normalized;
      recalculateLineTotals(params.data);
      return true;
    };
  }
}

function recalculateLineTotals(line: SalesOrderDetailLine) {
  Object.assign(
    line,
    calculateSalesLineAmounts({
      quantity: line.sellingQuantity,
      unitPrice: line.unitPrice,
      taxRatePercent: line.taxRatePercent,
    }),
  );
}

function makeBlankLine(
  defaultTaxRate: { id: string; name: string; ratePercent: string } | null,
) {
  return makeDraftLine({
    itemId: "",
    itemName: "",
    itemSku: null,
    unitName: "",
    quantity: "1",
    unitPrice: "0",
    taxRateId: defaultTaxRate?.id ?? null,
    taxRateName: defaultTaxRate?.name ?? null,
    taxRatePercent: defaultTaxRate?.ratePercent ?? "0",
    estimatedUnitCost: null,
  });
}

function lineFromItem(
  item: SalesOrderItemOption,
  id?: string,
  values?: {
    quantity?: string;
    unitPrice?: string;
    taxRateId?: string | null;
    pricing?: SalesLinePricingResult | null;
  },
  selectedTaxRate?: { id: string; name: string; ratePercent: string } | null,
) {
  const taxRate = selectedTaxRate ?? null;
  const line = makeDraftLine({
    itemId: item.id,
    itemName: item.displayName || item.name,
    itemSku: item.sku,
    unitName: item.unitName,
    stockingUnitName: item.stockingUnitName,
    salesToStockFactor: item.salesToStockFactor,
    quantity: values?.quantity ?? "1",
    unitPrice: values?.unitPrice ?? item.defaultSellingPrice ?? "0",
    taxRateId: values?.taxRateId ?? taxRate?.id ?? null,
    taxRateName: taxRate?.name ?? null,
    taxRatePercent: taxRate?.ratePercent ?? "0",
    estimatedUnitCost: item.estimatedUnitCost,
  });
  const pricedLine = values?.pricing
    ? {
        ...line,
        listUnitPrice: values.pricing.baseUnitPrice ?? line.unitPrice,
        discountPercent: normalizeMoney(
          lineDiscountPercentFromPrices(
            values.pricing.baseUnitPrice ?? line.unitPrice,
            line.unitPrice,
          ) ?? 0,
        ),
        suggestedUnitPrice: values.pricing.suggestedUnitPrice,
        pricingSourceType: values.pricing.pricingSourceType,
        pricingScheduleName: values.pricing.pricingScheduleName,
        pricingBreakLabel: values.pricing.pricingBreakLabel,
        isPriceOverridden:
          values.pricing.suggestedUnitPrice != null &&
          normalizeMoney(Number(line.unitPrice)) !== values.pricing.suggestedUnitPrice,
      }
    : line;
  return id ? { ...pricedLine, id } : pricedLine;
}

function isBlankSalesOrderLine(line: SalesOrderDetailLine | undefined) {
  return !line?.itemId;
}

function mergeUnsentBlankLines(
  incoming: SalesOrderDetailLine[],
  current: SalesOrderDetailLine[],
) {
  const incomingIds = new Set(incoming.map((line) => line.id));
  const unsentBlankRows = current.filter(
    (line) => isBlankSalesOrderLine(line) && !incomingIds.has(line.id),
  );
  return unsentBlankRows.length > 0 ? [...incoming, ...unsentBlankRows] : incoming;
}

function isSavableDraftLine(line: SalesOrderDetailLine) {
  const quantity = Number(line.sellingQuantity);
  const unitPrice = Number(line.unitPrice);
  return (
    Boolean(line.itemId) &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    Number.isFinite(unitPrice) &&
    unitPrice >= 0
  );
}

function minimumLineQuantity(line: SalesOrderDetailLine) {
  return (
    Number(line.sellingShippedQuantity) +
    Number(line.sellingCancelledQuantity)
  );
}

function quantityLockReason(line: SalesOrderDetailLine) {
  const minimum = minimumLineQuantity(line);
  if (minimum <= 0) return null;
  return `Quantity cannot be reduced below ${formatQuantity(String(minimum))} because quantity has already shipped or been cancelled.`;
}

function deleteLineLockedReason(line: SalesOrderDetailLine) {
  if (Number(line.sellingShippedQuantity) > 0) {
    return "This line has shipped quantity, so it cannot be removed.";
  }
  if (Number(line.sellingCancelledQuantity) > 0) {
    return "This line has cancelled quantity, so it cannot be removed.";
  }
  return null;
}

function lineSalesItemsState(
  line: SalesOrderDetailLine,
  orderStatus: SalesOrderDetail["status"],
): FulfillmentDisplayState {
  if (isBlankSalesOrderLine(line)) {
    return { label: "Not applicable", tone: "muted" };
  }

  if (orderStatus === "done") {
    return { label: "Complete", tone: "success" };
  }

  if (Number(line.remainingQuantity) <= 0) {
    return getSalesItemsDisplayState("complete", null);
  }

  if (Number(line.demandQueueShortQty) > 0) {
    return getSalesItemsDisplayState("not_available", null);
  }

  if (Number(line.demandQueueExpectedQty) > 0) {
    return getSalesItemsDisplayState("expected", line.demandQueueExpectedDate);
  }

  return getSalesItemsDisplayState("available", null);
}

function lineIngredientsState(line: SalesOrderDetailLine): FulfillmentDisplayState {
  if (isBlankSalesOrderLine(line)) {
    return { label: "Not applicable", tone: "muted" };
  }

  return getIngredientsDisplayState(
    line.fulfillmentSummary.ingredientsState,
    line.fulfillmentSummary.ingredientsExpectedDate,
  );
}

function lineIngredientShortageRows(line: SalesOrderDetailLine) {
  return line.fulfillmentSummary.ingredientShortages.map((shortage) => ({
    id: shortage.itemId,
    item: shortage.itemName,
    needed: formatQuantity(shortage.requiredQty),
    available: formatQuantity(shortage.availableQty),
    expected: formatQuantity(shortage.expectedQty),
    short: shortage.availabilityStatus === "missing",
  }));
}

function lineProductionState(line: SalesOrderDetailLine): FulfillmentDisplayState {
  if (isBlankSalesOrderLine(line)) {
    return { label: "Not applicable", tone: "muted" };
  }

  return getProductionDisplayState(line.fulfillmentSummary.productionState);
}

function summarizeSellingQuantity(lines: SalesOrderDetailLine[]) {
  const unitNames = new Set(lines.map((line) => line.sellingUnitName));
  if (lines.length === 0 || unitNames.size !== 1) return null;

  const total = lines.reduce((sum, line) => {
    const quantity = Number(line.sellingQuantity);
    return Number.isFinite(quantity) ? sum + quantity : sum;
  }, 0);
  return `${formatQuantity(String(total))} ${lines[0].sellingUnitName}`;
}

function lineBaseUnitPrice(
  line: SalesOrderDetailLine,
  itemMap: Map<string, SalesOrderItemOption>,
) {
  const itemBasePrice = line.listUnitPrice ?? itemMap.get(line.itemId)?.defaultSellingPrice;
  const parsed = itemBasePrice == null ? NaN : Number(itemBasePrice);
  return Number.isFinite(parsed) ? parsed : null;
}

function lineDiscountPercent(
  line: SalesOrderDetailLine,
  itemMap: Map<string, SalesOrderItemOption>,
) {
  const parsed = Number(line.discountPercent);
  if (Number.isFinite(parsed)) return parsed;
  return lineDiscountPercentFromPrices(lineBaseUnitPrice(line, itemMap), line.unitPrice);
}

function lineDiscountPercentFromPrices(
  baseUnitPrice: number | string | null,
  unitPriceValue: string,
) {
  const base = baseUnitPrice == null ? NaN : Number(baseUnitPrice);
  const unitPrice = Number(unitPriceValue);
  if (base <= 0 || !Number.isFinite(base) || !Number.isFinite(unitPrice)) return null;
  return calculateDiscountPercentValue(baseUnitPrice, unitPriceValue);
}

function pricingSourceLabel(line: SalesOrderDetailLine) {
  if (line.pricingSourceType === "schedule_break" && line.pricingScheduleName) {
    return `${line.pricingScheduleName}${line.pricingBreakLabel ? ` · ${line.pricingBreakLabel}` : ""}`;
  }
  if (line.isPriceOverridden) return "Manual price override";
  return "Base price";
}

async function resolveLinePricing({
  customerId,
  itemId,
  quantity,
}: {
  customerId: string;
  itemId: string;
  quantity: string;
}): Promise<{ pricing: SalesLinePricingResult | null; error: string | null }> {
  if (!customerId || !itemId) return { pricing: null, error: null };
  try {
    const pricing = await apiJson<SalesLinePricingResult>("/api/sales-orders/price", {
      method: "POST",
      body: { customerId, itemId, quantity },
      fallbackError:
        "Could not check customer pricing. The line was added at list price; review the discount.",
    });
    return {
      pricing,
      error: null,
    };
  } catch {
    return {
      pricing: null,
      error:
        "Could not check customer pricing. The line was added at list price; review the discount.",
    };
  }
}
