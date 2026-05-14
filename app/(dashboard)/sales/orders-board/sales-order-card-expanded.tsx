"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  Delete02Icon,
  DeliveryTruck02Icon,
  PackageIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiJson } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import { AllocationSheet } from "../allocation-sheet";
import { buildSalesOrderLineRemovalPayload } from "../order-line-removal";
import type { SalesOrderDetail, SalesOrderListRow } from "../types";
import {
  progressPercent,
  readSalesOrderNumber,
  toQuantityString,
} from "./sales-order-lane-model";

type DeleteLineActionPayload = {
  lineId: string;
  lineName: string;
  idempotencyKey: string;
};

export function SalesOrderCardExpanded({
  order,
  onLineDeleted,
}: {
  order: SalesOrderListRow;
  onLineDeleted?: (lineName: string) => void;
}) {
  const [allocationLineId, setAllocationLineId] = useState<string | null>(null);
  const [lineToDelete, setLineToDelete] =
    useState<SalesOrderDetail["lines"][number] | null>(null);
  const [deleteLineIdempotencyKey, setDeleteLineIdempotencyKey] =
    useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sales-order-detail", order.id],
    queryFn: async () =>
      apiJson<SalesOrderDetail>(`/api/sales-orders/${order.id}`, {
        fallbackError: "Failed to fetch order.",
      }),
  });

  const detail = data ?? null;
  const lines = useMemo(() => detail?.lines ?? [], [detail?.lines]);
  const canEdit =
    detail != null &&
    detail.deletedAt == null &&
    (detail.status === "draft" || detail.status === "confirmed");
  const canManageAllocations =
    detail != null &&
    detail.deletedAt == null &&
    ["draft", "confirmed", "partially_shipped"].includes(detail.status);
  const canRemoveLines = canEdit && lines.length > 1;
  const shortQty = readSalesOrderNumber(detail?.fulfillmentSummary.shortQty);
  const allocatedQty = readSalesOrderNumber(
    detail?.fulfillmentSummary.allocatedQty
  );
  const remainingQty = readSalesOrderNumber(
    detail?.fulfillmentSummary.remainingQty
  );
  const percent = progressPercent(allocatedQty, remainingQty);

  const deleteLineMutation = useMutation({
    mutationFn: async ({ lineId, idempotencyKey }: DeleteLineActionPayload) => {
      if (!detail) throw new Error("Order is still loading.");

      await apiJson<void>(`/api/sales-orders/${order.id}`, {
        method: "PUT",
        idempotencyKey,
        body: buildSalesOrderLineRemovalPayload(detail, lineId),
        fallbackError: "Failed to delete line.",
      });
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (_result, variables) => {
      const removedLineName = variables.lineName;
      queryClient.setQueryData<SalesOrderDetail>(
        ["sales-order-detail", order.id],
        (current) =>
          current
            ? {
                ...current,
                lines: current.lines.filter((line) => line.id !== variables.lineId),
              }
            : current
      );
      queryClient.setQueryData<SalesOrderListRow[]>(["sales-orders"], (current) =>
        current?.map((listOrder) => {
          if (listOrder.id !== order.id) return listOrder;
          const lines = listOrder.lines.filter(
            (line) =>
              line.id !== variables.lineId &&
              (removedLineName == null || line.masterName !== removedLineName)
          );
          return {
            ...listOrder,
            lines,
            itemSummary: lines
              .map((line) => `${line.quantity} ${line.masterName}`)
              .join(", "),
          };
        })
      );
      setLineToDelete(null);
      setDeleteLineIdempotencyKey(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-detail", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const openDeleteLineDialog = (line: SalesOrderDetail["lines"][number]) => {
    onLineDeleted?.(line.masterName);
    setLineToDelete(line);
    setDeleteLineIdempotencyKey(`sales-order-line-delete:${crypto.randomUUID()}`);
  };

  return (
    <div
      className="mt-2.5 min-w-0 max-w-full space-y-2.5 overflow-hidden"
      onClick={(event) => event.stopPropagation()}
    >
      <AllocationSheet
        lineId={allocationLineId}
        open={allocationLineId != null}
        onOpenChange={(open) => {
          if (!open) setAllocationLineId(null);
        }}
        onTargetLineChange={setAllocationLineId}
      />
      <AlertDialog
        open={lineToDelete != null}
        onOpenChange={(open) => {
          if (!open) {
            setLineToDelete(null);
            setDeleteLineIdempotencyKey(null);
          }
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this line?</AlertDialogTitle>
            <AlertDialogDescription>
              {lineToDelete
                ? `${lineToDelete.masterName} will be removed from this order.`
                : "This line will be removed from the order."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLineMutation.isPending}
              onClick={() => {
                if (!lineToDelete || !deleteLineIdempotencyKey) return;
                onLineDeleted?.(lineToDelete.masterName);
                deleteLineMutation.mutate({
                  lineId: lineToDelete.id,
                  lineName: lineToDelete.masterName,
                  idempotencyKey: deleteLineIdempotencyKey,
                });
              }}
            >
              {deleteLineMutation.isPending ? "Deleting..." : "Delete Line"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
      {isLoading ? (
        <div className="flex min-h-28 items-center justify-center">
          <Spinner className="text-foreground" />
        </div>
      ) : isError ? (
        <p className="text-xs text-destructive">{error.message}</p>
      ) : detail ? (
        <>
          <LineItemsMiniTable
            order={detail}
            canEdit={canEdit}
            canManageAllocations={canManageAllocations}
            canRemoveLines={canRemoveLines}
            onManageLine={setAllocationLineId}
            onDeleteLine={openDeleteLineDialog}
          />
          <FulfillmentProgress
            allocatedQty={allocatedQty}
            remainingQty={remainingQty}
            shortQty={shortQty}
            percent={percent}
          />
          <ShipmentMiniRows order={detail} />
        </>
      ) : null}
    </div>
  );
}

function ShipmentMiniRows({ order }: { order: SalesOrderDetail }) {
  if (order.shipments.length === 0) return null;

  return (
    <section className="min-w-0 max-w-full">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
          Shipments
        </h3>
        <Badge variant="outline">{order.shipments.length}</Badge>
      </div>
      <div className="space-y-1.5">
        {order.shipments.map((shipment) => {
          const shipped = shipment.status === "shipped";
          const cancelled = shipment.status === "cancelled";

          return (
            <Link
              key={shipment.id}
              href={`/sales/orders/${order.id}`}
              prefetch={false}
              className={cn(
                "flex min-w-0 items-start gap-2 rounded-md border bg-card px-2 py-1.5 text-xs transition hover:bg-accent hover:text-accent-foreground",
                shipped && "border-l-2 border-l-info",
                cancelled && "border-l-2 border-l-destructive",
                !shipped && !cancelled && "border-l-2 border-l-primary"
              )}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded",
                  shipped && "bg-info/20 text-info",
                  cancelled && "bg-destructive/15 text-destructive",
                  !shipped && !cancelled && "bg-primary/15 text-primary"
                )}
              >
                <HugeiconsIcon
                  icon={shipped ? DeliveryTruck02Icon : PackageIcon}
                  strokeWidth={2}
                  className="size-3"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate font-semibold">
                    {shipment.shipmentNumber}
                  </span>
                  <Badge
                    variant={
                      shipped ? "outline" : cancelled ? "destructive" : "secondary"
                    }
                    className="h-5 shrink-0 px-1.5 text-[10px]"
                  >
                    {shipped ? "Shipped" : cancelled ? "Cancelled" : "Draft"}
                  </Badge>
                </span>
                <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} className="size-3" />
                    <span className="truncate">{formatDate(shipment.scheduledDate)}</span>
                  </span>
                  <span className="shrink-0 font-medium text-foreground">
                    {formatPrice(shipment.marginSummary.productRevenue) ?? "\u2014"}
                  </span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function LineItemsMiniTable({
  order,
  canEdit,
  canManageAllocations,
  canRemoveLines,
  onManageLine,
  onDeleteLine,
}: {
  order: SalesOrderDetail;
  canEdit: boolean;
  canManageAllocations: boolean;
  canRemoveLines: boolean;
  onManageLine: (lineId: string) => void;
  onDeleteLine: (line: SalesOrderDetail["lines"][number]) => void;
}) {
  const hasActions = canEdit || canManageAllocations;
  const gridClassName = hasActions
    ? "grid-cols-[minmax(0,1fr)_2rem_2rem_2rem_2.75rem]"
    : "grid-cols-[minmax(0,1fr)_2.2rem_2.2rem_2.2rem]";

  return (
    <section className="min-w-0 max-w-full">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
          Line Items
        </h3>
        <Badge variant="outline">{order.lines.length}</Badge>
      </div>
      <div className="overflow-hidden rounded-md border">
        <div
          className={cn(
            "grid min-w-0 gap-1 bg-muted/60 px-2 py-1.5 text-[10px] font-medium text-muted-foreground",
            gridClassName
          )}
        >
          <span>Item</span>
          <span className="text-right">Demand</span>
          <span className="text-right">Alloc.</span>
          <span className="text-right">Short</span>
          {hasActions ? <span className="text-right">Act.</span> : null}
        </div>
        {order.lines.map((line) => {
          const short = readSalesOrderNumber(line.shortQty);
          const canManageLine =
            canManageAllocations && readSalesOrderNumber(line.remainingQuantity) > 0;

          return (
            <div
              key={line.id}
              data-testid="sales-order-line-row"
              data-line-name={line.masterName}
              className={cn(
                "grid min-w-0 items-center gap-1 border-t px-2 py-1.5 text-xs",
                gridClassName
              )}
            >
              <div className="min-w-0">
                <div className="block truncate font-medium leading-tight">
                  {line.masterName}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {line.attrs.length ? line.attrs.join(" · ") : line.unitName}
                </div>
              </div>
              <span className="text-right">{formatQuantity(line.quantity)}</span>
              <span className="text-right">{formatQuantity(line.allocatedQty)}</span>
              <span
                className={cn(
                  "text-right font-medium",
                  short > 0 ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {short > 0 ? formatQuantity(line.shortQty) : "\u2014"}
              </span>
              {hasActions ? (
                <span className="flex min-w-0 justify-end gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-4"
                        aria-label={`Manage allocation for ${line.masterName}`}
                        disabled={!canManageLine}
                        onClick={(event) => {
                          event.stopPropagation();
                          onManageLine(line.id);
                        }}
                      >
                        <HugeiconsIcon
                          icon={PackageIcon}
                          strokeWidth={2}
                          className="size-3"
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {canManageLine
                        ? "Manage allocation."
                        : "No remaining quantity to allocate."}
                    </TooltipContent>
                  </Tooltip>
                  {canEdit ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-4"
                          aria-label={`Delete ${line.masterName}`}
                          disabled={!canRemoveLines}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteLine(line);
                          }}
                        >
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            strokeWidth={2}
                            className="size-3"
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {canRemoveLines
                          ? "Delete line."
                          : "Orders must keep at least one line."}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FulfillmentProgress({
  allocatedQty,
  remainingQty,
  shortQty,
  percent,
}: {
  allocatedQty: number;
  remainingQty: number;
  shortQty: number;
  percent: number;
}) {
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-md bg-muted/45 p-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">
          {formatQuantity(toQuantityString(allocatedQty))} /{" "}
          {formatQuantity(toQuantityString(remainingQty))} units allocated
        </span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <div className="alloc-progress-track mt-2 h-1.5 rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            shortQty > 0
              ? "alloc-progress-fill-allocated"
              : "alloc-progress-fill-supply"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Available now: {formatQuantity(toQuantityString(allocatedQty))}</span>
        <span className={cn(shortQty > 0 && "font-medium text-destructive")}>
          Remaining short: {formatQuantity(toQuantityString(shortQty))}
        </span>
      </div>
    </section>
  );
}
