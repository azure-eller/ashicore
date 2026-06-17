"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { apiJson } from "@/lib/client/api";
import type { ManufacturingSalesOrderPreview } from "@/lib/manufacturing/types";
import { EmptyState } from "@/components/empty-state";
import {
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableHeaderCell,
  FramedTableHead,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SalesOrderDetail } from "@/lib/sales/types";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/client/query-keys";

type Props = {
  salesOrderId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  initialOrder?: SalesOrderDetail;
  salesOrderLabel?: string;
  buttonLabel?: string;
  buttonVariant?: "default" | "outline" | "secondary";
  buttonSize?: "default" | "sm" | "lg";
  buttonClassName?: string;
  initialPlannedDate?: string;
  manufacturingStrategy?: "make_to_order" | "make_to_stock";
  lineScopeSalesOrderLineId?: string;
  openManufacturingOrders?: Array<{
    id: string;
    orderNumber: string;
    itemName: string;
    quantity: string;
    plannedDate: string | null;
    priorityRank: number | null;
    status: string;
  }>;
  initialLineQuantities?: Array<{
    salesOrderLineId: string;
    quantity: string;
  }>;
};

function orderLabel(count: number) {
  return `${count} order${count === 1 ? "" : "s"}`;
}

function normalizeDecimal(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

export function defaultManufacturingPlannedDate(shipDate: string | null | undefined) {
  if (!shipDate) return undefined;
  const date = new Date(`${shipDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function isBatchLine(line: ManufacturingSalesOrderPreview["lines"][number]) {
  return line.manufacturingMode === "batch" && Number(line.expectedBatchYield) > 0;
}

function defaultLineInputQuantity(
  line: ManufacturingSalesOrderPreview["lines"][number],
  initialQuantity: string | undefined
) {
  const quantity = Number(initialQuantity ?? line.quantity);
  if (!isBatchLine(line)) return initialQuantity ?? line.quantity;
  const expectedBatchYield = Number(line.expectedBatchYield);
  if (!Number.isFinite(quantity) || !Number.isFinite(expectedBatchYield) || expectedBatchYield <= 0) {
    return "1";
  }
  return String(Math.max(1, Math.ceil(quantity / expectedBatchYield)));
}

function resolveLinePlannedOutput(
  line: ManufacturingSalesOrderPreview["lines"][number],
  inputQuantity: string
) {
  const quantity = Number(inputQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!isBatchLine(line)) return normalizeDecimal(quantity);

  const batchCount = Math.round(quantity);
  if (Math.abs(quantity - batchCount) > 0.0001) return null;
  return normalizeDecimal(batchCount * Number(line.expectedBatchYield));
}

function displayMakeQuantity(
  line: ManufacturingSalesOrderPreview["lines"][number],
  inputQuantity: string,
  canEditQuantity: boolean
) {
  if (canEditQuantity && isBatchLine(line)) {
    return defaultLineInputQuantity(line, inputQuantity);
  }
  if (!isBatchLine(line)) return line.quantity;
  return resolveLinePlannedOutput(
    line,
    defaultLineInputQuantity(line, inputQuantity)
  ) ?? line.quantity;
}

function formatOpenManufacturingOrders(
  orders: SalesOrderDetail["linkedManufacturingOrders"]
): NonNullable<Props["openManufacturingOrders"]> {
  return orders
    .filter((order) => order.status === "open")
    .map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      itemName: order.productName,
      quantity: `${order.plannedQuantity} ${order.unitName}`,
      plannedDate: order.plannedDate,
      priorityRank: order.priorityRank,
      status: order.status,
    }));
}

export function CreateManufacturingOrdersDialog({
  salesOrderId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showTrigger = true,
  initialOrder,
  salesOrderLabel,
  buttonLabel = "Create MOs",
  buttonVariant = "default",
  buttonSize = "sm",
  buttonClassName,
  initialPlannedDate,
  manufacturingStrategy = "make_to_order",
  lineScopeSalesOrderLineId,
  openManufacturingOrders,
  initialLineQuantities,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const submitInFlightRef = useRef(false);
  const idempotencyKeyRef = useRef(`create-sales-order-mos:${crypto.randomUUID()}`);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [plannedDate, setPlannedDate] = useState<string | null | undefined>(
    undefined
  );
  const [selectedLineIds, setSelectedLineIds] = useState<string[] | null>(null);
  const [lineQuantities, setLineQuantities] = useState<Record<string, string>>({});
  const initialLineQuantityMap = useMemo(
    () =>
      new Map(
        initialLineQuantities?.map((lineQuantity) => [
          lineQuantity.salesOrderLineId,
          lineQuantity.quantity,
        ]) ?? []
      ),
    [initialLineQuantities]
  );
  const initialSelectedLineIds = useMemo(
    () =>
      (lineScopeSalesOrderLineId ? [lineScopeSalesOrderLineId] : null) ??
      initialLineQuantities?.map((lineQuantity) => lineQuantity.salesOrderLineId) ??
      [],
    [initialLineQuantities, lineScopeSalesOrderLineId]
  );

  const orderQuery = useQuery<SalesOrderDetail>({
    queryKey: queryKeys.salesOrders.detail(salesOrderId),
    queryFn: () =>
      apiJson<SalesOrderDetail>(`/api/sales-orders/${salesOrderId}`, {
        fallbackError: "Failed to load sales order.",
      }),
    enabled: open,
    initialData: initialOrder,
  });

  const previewQuery = useQuery<ManufacturingSalesOrderPreview>({
    queryKey: queryKeys.salesOrders.manufacturingPreview(salesOrderId),
    queryFn: () =>
      apiJson<ManufacturingSalesOrderPreview>(
        `/api/sales-orders/${salesOrderId}/manufacturing-orders`,
        { fallbackError: "Failed to load manufacturing preview." }
      ),
    enabled: open,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const order = orderQuery.data ?? null;
  const effectiveSalesOrderLabel =
    salesOrderLabel ??
    (order ? `${order.orderNumber} - ${order.customerName}` : "");
  const effectiveOpenManufacturingOrders =
    openManufacturingOrders !== undefined
      ? openManufacturingOrders
      : order
        ? formatOpenManufacturingOrders(
            lineScopeSalesOrderLineId
              ? order.linkedManufacturingOrders.filter(
                  (linkedOrder) =>
                    linkedOrder.salesOrderLineId === lineScopeSalesOrderLineId
                )
              : order.linkedManufacturingOrders
          )
        : [];
  const effectivePlannedDate =
    plannedDate ??
    initialPlannedDate ??
    defaultManufacturingPlannedDate(order?.shipDate);
  const previewLines = useMemo(
    () =>
      lineScopeSalesOrderLineId
        ? previewQuery.data?.lines.filter(
            (line) => line.salesOrderLineId === lineScopeSalesOrderLineId,
          ) ?? []
        : previewQuery.data?.lines ?? [],
    [lineScopeSalesOrderLineId, previewQuery.data],
  );
  const creatableLines = useMemo(
    () => previewLines.filter((line) => line.status === "will_create"),
    [previewLines]
  );
  const skippedLines = useMemo(
    () => previewLines.filter((line) => line.status === "skipped"),
    [previewLines]
  );
  const defaultSelectedLineIds = useMemo(
    () =>
      initialLineQuantityMap.size > 0
        ? creatableLines
            .filter((line) => initialLineQuantityMap.has(line.salesOrderLineId))
            .map((line) => line.salesOrderLineId)
        : initialSelectedLineIds.length > 0
          ? creatableLines
              .filter((line) => initialSelectedLineIds.includes(line.salesOrderLineId))
              .map((line) => line.salesOrderLineId)
        : creatableLines.map((line) => line.salesOrderLineId),
    [creatableLines, initialLineQuantityMap, initialSelectedLineIds]
  );
  const effectiveSelectedLineIds = selectedLineIds ?? defaultSelectedLineIds;
  const selectedLineIdSet = useMemo(
    () => new Set(effectiveSelectedLineIds),
    [effectiveSelectedLineIds]
  );
  const isSingleLineMode =
    initialLineQuantityMap.size === 1 || initialSelectedLineIds.length === 1;
  const showStatusColumns = skippedLines.length > 0;
  const mutation = useMutation({
    mutationFn: () =>
      apiJson(`/api/sales-orders/${salesOrderId}/manufacturing-orders`, {
        method: "POST",
        idempotencyKey: idempotencyKeyRef.current,
        body: {
          plannedDate: effectivePlannedDate || null,
          manufacturingStrategy,
          salesOrderLineIds: effectiveSelectedLineIds,
          priorityRank: null,
          lineQuantities: effectiveSelectedLineIds.map((lineId) => ({
            salesOrderLineId: lineId,
            quantity: (() => {
              const line = creatableLines.find((candidate) => candidate.salesOrderLineId === lineId);
              if (!line) return "0";
              if (manufacturingStrategy === "make_to_order") {
                return line.quantity;
              }
              const inputQuantity =
                lineQuantities[lineId] ??
                defaultLineInputQuantity(line, initialLineQuantityMap.get(lineId));
              return resolveLinePlannedOutput(line, inputQuantity) ?? "0";
            })(),
          })),
          notes: null,
        },
        fallbackError: "Failed to create manufacturing orders.",
      }),
    onSuccess: async () => {
      controlledOnOpenChange?.(false);
      if (controlledOpen === undefined) setUncontrolledOpen(false);
      resetForm();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.salesOrders.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.salesOrders.detail(salesOrderId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.salesOrders.manufacturingPreview(salesOrderId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.manufacturingOrders.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.root }),
      ]);
      router.refresh();
    },
  });

  const resetForm = () => {
    setPlannedDate(undefined);
    setSelectedLineIds(null);
    setLineQuantities({});
    submitInFlightRef.current = false;
    idempotencyKeyRef.current = `create-sales-order-mos:${crypto.randomUUID()}`;
    mutation.reset();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    controlledOnOpenChange?.(nextOpen);
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    if (!nextOpen) {
      resetForm();
    }
  };

  const toggleLine = (lineId: string, checked: boolean) => {
    setSelectedLineIds((current) => {
      const selected = current ?? effectiveSelectedLineIds;
      return checked
        ? selected.includes(lineId)
          ? selected
          : [...selected, lineId]
        : selected.filter((currentLineId) => currentLineId !== lineId);
    });
  };

  const canSubmit =
    effectiveSelectedLineIds.length > 0 &&
    effectiveSelectedLineIds.every((lineId) => {
      const line = creatableLines.find((candidate) => candidate.salesOrderLineId === lineId);
      if (!line) return false;
      if (manufacturingStrategy === "make_to_order") {
        return Number(line.quantity) > 0;
      }
      const value =
        lineQuantities[lineId] ??
        defaultLineInputQuantity(line, initialLineQuantityMap.get(lineId));
      return resolveLinePlannedOutput(line, value) != null;
    }) &&
    !mutation.isPending &&
    !orderQuery.isLoading &&
    !previewQuery.isLoading &&
    !previewQuery.isFetching;
  const submit = () => {
    if (!canSubmit || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    mutation.mutate(undefined, {
      onSettled: () => {
        submitInFlightRef.current = false;
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger ? (
        <DialogTrigger asChild>
          <Button
            variant={buttonVariant}
            size={buttonSize}
            className={cn(buttonClassName)}
          >
            <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" strokeWidth={2} />
            {buttonLabel}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        size="3xl"
        className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-[var(--color-bg)] text-[var(--color-ink)]"
      >
        <DialogHeader>
          <DialogTitle>
            {isSingleLineMode
              ? manufacturingStrategy === "make_to_stock"
                ? "Create Make-to-Stock Order"
                : "Create Manufacturing Order"
              : manufacturingStrategy === "make_to_stock"
                ? "Create Make-to-Stock Orders"
                : "Create Manufacturing Orders"}
          </DialogTitle>
          {effectiveSalesOrderLabel ? (
            <DialogDescription>
              {effectiveSalesOrderLabel}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {orderQuery.isLoading ? (
          <EmptyState>Loading sales order...</EmptyState>
        ) : orderQuery.isError ? (
          <p className="text-sm text-[var(--status-danger-ink)]">{orderQuery.error.message}</p>
        ) : order ? (
          <div className="flex flex-col gap-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mo-planned-date">
                  Production deadline
                </label>
                <DatePicker
                  id="mo-planned-date"
                  value={effectivePlannedDate}
                  onChange={(value) => setPlannedDate(value || null)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mo-sales-order">
                  Sales Order
                </label>
                <Input
                  id="mo-sales-order"
                  value={effectiveSalesOrderLabel}
                  readOnly
                  disabled
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">
                  {isSingleLineMode
                    ? manufacturingStrategy === "make_to_stock"
                      ? "New Make-to-Stock Order"
                      : "New Manufacturing Order"
                    : manufacturingStrategy === "make_to_stock"
                      ? "New Make-to-Stock Orders"
                      : "New Manufacturing Orders"}
                </h3>
                <span className="text-sm text-[var(--color-ink-faint)]">
                  {orderLabel(effectiveSelectedLineIds.length)}
                </span>
              </div>
              {previewQuery.isLoading || previewQuery.isFetching ? (
                <EmptyState>Loading manufacturing preview...</EmptyState>
              ) : previewQuery.isError ? (
                <p className="text-sm text-[var(--status-danger-ink)]">
                  {previewQuery.error.message}
                </p>
              ) : previewQuery.data ? (
                <TableFrame>
                  <FramedTable>
                    <FramedTableHead>
                      <FramedTableRow>
                        {!isSingleLineMode ? (
                          <FramedTableHeaderCell className="w-10">
                            <span className="sr-only">Select</span>
                          </FramedTableHeaderCell>
                        ) : null}
                        <FramedTableHeaderCell>Product</FramedTableHeaderCell>
                        <FramedTableHeaderCell className="w-32 text-right">Make</FramedTableHeaderCell>
                        <FramedTableHeaderCell className="w-36">Unit</FramedTableHeaderCell>
                        {showStatusColumns ? (
                          <>
                            <FramedTableHeaderCell className="w-32">Status</FramedTableHeaderCell>
                            <FramedTableHeaderCell>Reason</FramedTableHeaderCell>
                          </>
                        ) : null}
                      </FramedTableRow>
                    </FramedTableHead>
                    <FramedTableBody>
                      {previewLines.map((line) => {
                        const isCreatable = line.status === "will_create";
                        const lineIsBatch = isBatchLine(line);
                        const canEditQuantity = manufacturingStrategy === "make_to_stock";
                        const inputQuantity =
                          lineQuantities[line.salesOrderLineId] ??
                          defaultLineInputQuantity(
                            line,
                            initialLineQuantityMap.get(line.salesOrderLineId)
                          );
                        return (
                          <FramedTableRow key={line.salesOrderLineId}>
                            {!isSingleLineMode ? (
                              <FramedTableCell>
                                <Checkbox
                                  aria-label={`Create MO for ${line.itemName}`}
                                  checked={
                                    isCreatable &&
                                    selectedLineIdSet.has(line.salesOrderLineId)
                                  }
                                  disabled={!isCreatable || mutation.isPending}
                                  onCheckedChange={(checked) =>
                                    toggleLine(line.salesOrderLineId, checked === true)
                                  }
                                />
                              </FramedTableCell>
                            ) : null}
                            <FramedTableCell>
                              <div className="font-medium">{line.itemName}</div>
                              {line.itemSku ? (
                                <div className="text-xs text-[var(--color-ink-faint)]">
                                  {line.itemSku}
                                </div>
                              ) : null}
                            </FramedTableCell>
                            <FramedTableCell>
                              {isCreatable && canEditQuantity ? (
                                <Input
                                  inputMode={lineIsBatch ? "numeric" : "decimal"}
                                  value={inputQuantity}
                                  onChange={(event) =>
                                    setLineQuantities((current) => ({
                                      ...current,
                                      [line.salesOrderLineId]: event.target.value,
                                    }))
                                  }
                                  className="text-right"
                                  aria-label={`${lineIsBatch ? "Batches" : "Quantity"} for ${line.itemName}`}
                                  disabled={
                                    !selectedLineIdSet.has(line.salesOrderLineId) ||
                                    mutation.isPending
                                  }
                                />
                              ) : (
                                <span className="block text-right">
                                  {displayMakeQuantity(
                                    line,
                                    initialLineQuantityMap.get(line.salesOrderLineId) ??
                                      line.quantity,
                                    canEditQuantity
                                  )}
                                </span>
                              )}
                            </FramedTableCell>
                            <FramedTableCell>
                              {canEditQuantity && lineIsBatch ? (
                                <div>
                                  <div>batches</div>
                                  <div className="text-xs text-[var(--color-ink-faint)]">
                                    {line.expectedBatchYield} {line.unitName} each
                                  </div>
                                </div>
                              ) : (
                                line.unitName
                              )}
                            </FramedTableCell>
                            {showStatusColumns ? (
                              <>
                                <FramedTableCell>
                                  <Badge variant={isCreatable ? "secondary" : "outline"}>
                                    {isCreatable ? "Will create" : "Skipped"}
                                  </Badge>
                                </FramedTableCell>
                                <FramedTableCell className="text-sm text-[var(--color-ink-faint)]">
                                  {line.skipMessage ?? "-"}
                                </FramedTableCell>
                              </>
                            ) : null}
                          </FramedTableRow>
                        );
                      })}
                    </FramedTableBody>
                  </FramedTable>
                </TableFrame>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Open Manufacturing Orders</h3>
                <span className="text-sm text-[var(--color-ink-faint)]">
                  {orderLabel(effectiveOpenManufacturingOrders.length)}
                </span>
              </div>
              {effectiveOpenManufacturingOrders.length ? (
                <TableFrame>
                  <FramedTable>
                    <FramedTableHead>
                      <FramedTableRow>
                        <FramedTableHeaderCell>Order</FramedTableHeaderCell>
                        <FramedTableHeaderCell>Item</FramedTableHeaderCell>
                        <FramedTableHeaderCell className="w-28 text-right">Qty</FramedTableHeaderCell>
                        <FramedTableHeaderCell className="w-32">Production deadline</FramedTableHeaderCell>
                        <FramedTableHeaderCell className="w-24">Priority</FramedTableHeaderCell>
                      </FramedTableRow>
                    </FramedTableHead>
                    <FramedTableBody>
                      {effectiveOpenManufacturingOrders.map((manufacturingOrder) => (
                        <FramedTableRow key={manufacturingOrder.id}>
                          <FramedTableCell>
                            <div className="font-medium">
                              {manufacturingOrder.orderNumber}
                            </div>
                            <div className="text-xs text-[var(--color-ink-faint)]">
                              {manufacturingOrder.status}
                            </div>
                          </FramedTableCell>
                          <FramedTableCell>{manufacturingOrder.itemName}</FramedTableCell>
                          <FramedTableCell className="text-right">
                            {manufacturingOrder.quantity}
                          </FramedTableCell>
                          <FramedTableCell>{manufacturingOrder.plannedDate ?? "-"}</FramedTableCell>
                          <FramedTableCell>
                            {manufacturingOrder.priorityRank ?? "-"}
                          </FramedTableCell>
                        </FramedTableRow>
                      ))}
                    </FramedTableBody>
                  </FramedTable>
                </TableFrame>
              ) : (
                <EmptyState density="compact">No open manufacturing orders.</EmptyState>
              )}
            </div>

            {mutation.error ? (
              <p className="text-sm text-[var(--status-danger-ink)]">{mutation.error.message}</p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {mutation.isPending
              ? "Creating..."
              : isSingleLineMode
                ? "Create MO"
                : `Create ${orderLabel(effectiveSelectedLineIds.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
