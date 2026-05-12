"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { Spinner } from "@/components/ui/spinner";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
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
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice, formatQuantity } from "@/lib/format";
import {
  ITEM_SKU_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
  SALES_LINE_ALLOCATION_TOOLTIP,
  SALES_LINE_AVAILABLE_TOOLTIP,
  SALES_LINE_CAN_MAKE_TOOLTIP,
  SALES_LINE_DEMAND_TOOLTIP,
  SALES_LINE_SHORT_TOOLTIP,
  SALES_UNIT_PRICE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { OrderLineAttributeBadges } from "./order-line-attribute-badges";
import { AllocationSheet } from "./allocation-sheet";
import type { SalesOrderDetail } from "./types";
import { buildSalesOrderLineRemovalPayload } from "./order-line-removal";

type DeleteLineActionPayload = {
  lineId: string;
  idempotencyKey: string;
};

function ShortCell({ value }: { value: string | null }) {
  if (value === null) return <span className="text-muted-foreground">{"\u2014"}</span>;
  const qty = parseFloat(value);
  const hasShortage = qty > 0;
  if (!hasShortage) return <span className="text-muted-foreground">{"\u2014"}</span>;
  return (
    <span className="font-medium text-amber-700 dark:text-amber-300">
      {formatQuantity(value)}
    </span>
  );
}

function AllocationChips({
  line,
  canManage,
  onOpen,
}: {
  line: SalesOrderDetail["lines"][number];
  canManage: boolean;
  onOpen: () => void;
}) {
  if (line.allocationSources.length === 0) {
    if (!canManage) {
      return <span className="text-muted-foreground">{"\u2014"}</span>;
    }

    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md border border-dashed bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Allocate ${line.masterName}`}
      >
        Allocate
      </button>
    );
  }

  const stockQty = line.allocationSources
    .filter((source) => source.sourceType === "stock_pool")
    .reduce((sum, source) => sum + Number(source.quantity), 0);
  const lotSources = line.allocationSources.filter(
    (source) => source.sourceType === "lot"
  );
  const productionSources = line.allocationSources.filter(
    (source) => source.sourceType === "manufacturing_order"
  );
  const productionQty = productionSources.reduce(
    (sum, source) => sum + Number(source.quantity),
    0
  );
  const chips: string[] = [];

  if (stockQty > 0) {
    chips.push(`${formatQuantity(stockQty.toString())} Stock`);
  }
  for (const source of lotSources) {
    chips.push(`${source.label} · ${formatQuantity(source.quantity)}`);
  }
  if (productionQty > 0) {
    const uniqueLabels = [...new Set(productionSources.map((source) => source.label))];
    const suffix =
      uniqueLabels.length === 1
        ? ` · ${uniqueLabels[0]}`
        : uniqueLabels.length > 1
          ? ` · ${uniqueLabels.length} MOs`
          : "";
    chips.push(`${formatQuantity(productionQty.toString())} Production${suffix}`);
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-wrap gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`Manage allocation for ${line.masterName}`}
    >
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          {chip}
        </span>
      ))}
    </button>
  );
}

export function OrderExpandedDetail({ orderId }: { orderId: string }) {
  const [allocationLineId, setAllocationLineId] = useState<string | null>(null);
  const [lineToDelete, setLineToDelete] =
    useState<SalesOrderDetail["lines"][number] | null>(null);
  const [deleteLineIdempotencyKey, setDeleteLineIdempotencyKey] =
    useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["sales-order-detail", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/sales-orders/${orderId}`);
      if (!res.ok) throw new Error("Failed to fetch order");
      return res.json() as Promise<SalesOrderDetail>;
    },
  });
  const canEdit =
    data != null &&
    data.deletedAt == null &&
    (data.status === "draft" || data.status === "confirmed");
  const canRemoveLines = canEdit && (data?.lines.length ?? 0) > 1;
  const deleteLineMutation = useMutation({
    mutationFn: async ({ lineId, idempotencyKey }: DeleteLineActionPayload) => {
      if (!data) throw new Error("Order is still loading.");

      const res = await fetch(`/api/sales-orders/${orderId}`, {
        method: "PUT",
        headers: {
          "Idempotency-Key": idempotencyKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildSalesOrderLineRemovalPayload(data, lineId)),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to delete line.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-detail", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setLineToDelete(null);
      setDeleteLineIdempotencyKey(null);
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const openDeleteLineDialog = (line: SalesOrderDetail["lines"][number]) => {
    setLineToDelete(line);
    setDeleteLineIdempotencyKey(`sales-order-line-delete:${crypto.randomUUID()}`);
  };

  return (
    <div className="bg-muted/50 px-8 py-3">
      <AllocationSheet
        lineId={allocationLineId}
        open={allocationLineId != null}
        onOpenChange={(open) => {
          if (!open) setAllocationLineId(null);
        }}
        onTargetLineChange={setAllocationLineId}
      />
      {actionError ? (
        <p className="mb-2 text-sm text-destructive">{actionError}</p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Item</TableHead>
            <TableHead className="text-xs">
              <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Demand" tooltip={SALES_LINE_DEMAND_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader
                label="Available"
                tooltip={SALES_LINE_AVAILABLE_TOOLTIP}
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader
                label="Can Make"
                tooltip={SALES_LINE_CAN_MAKE_TOOLTIP}
              />
            </TableHead>
            <TableHead className="text-xs">
              <TooltipHeader
                label="Allocation"
                tooltip={SALES_LINE_ALLOCATION_TOOLTIP}
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Short" tooltip={SALES_LINE_SHORT_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader
                label="Unit Price"
                tooltip={SALES_UNIT_PRICE_TOOLTIP}
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Line Total" tooltip={LINE_TOTAL_TOOLTIP} />
            </TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={10}>
                <div className="flex min-h-24 items-center justify-center">
                  <Spinner className="text-foreground" />
                </div>
              </TableCell>
            </TableRow>
          ) : data?.lines.length ? (
            data.lines.map((line) => (
                <TableRow key={line.id} className="group/line">
                  <TableCell className="text-sm">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <Link
                        href={itemDetailHref("product", line.itemId)}
                        className="hover:underline"
                      >
                        {line.masterName}
                      </Link>
                      <OrderLineAttributeBadges attrs={line.attrs} />
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {line.itemSku ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatQuantity(line.quantity)}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {line.availableQty == null ? "\u2014" : formatQuantity(line.availableQty)}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {line.potential == null ? "\u2014" : formatQuantity(line.potential)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <AllocationChips
                      line={line}
                      canManage={
                        ["draft", "confirmed", "partially_shipped"].includes(data.status) &&
                        Number(line.remainingQuantity) > 0
                      }
                      onOpen={() => setAllocationLineId(line.id)}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    <ShortCell value={line.shortQty} />
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatPrice(line.unitPrice) ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatPrice(line.lineTotal) ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/line:opacity-100 focus-within:opacity-100">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              asChild
                            >
                              <Link
                                href={`/sales/orders/${orderId}/edit`}
                                aria-label={`Edit ${line.masterName}`}
                              >
                                <HugeiconsIcon
                                  icon={PencilEdit02Icon}
                                  size={14}
                                  strokeWidth={2}
                                />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Edit line</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              disabled={!canRemoveLines || deleteLineMutation.isPending}
                              aria-label={`Delete ${line.masterName}`}
                              onClick={() => openDeleteLineDialog(line)}
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                size={14}
                                strokeWidth={2}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {canRemoveLines
                              ? "Delete line"
                              : "Order needs at least one line"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
          ) : (
            <TableRow>
              <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                No line items.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <AlertDialog
        open={lineToDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteLineMutation.isPending) {
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
            <AlertDialogCancel disabled={deleteLineMutation.isPending}>
              Back
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                deleteLineMutation.isPending ||
                !lineToDelete ||
                !deleteLineIdempotencyKey
              }
              onClick={() => {
                if (lineToDelete && deleteLineIdempotencyKey) {
                  deleteLineMutation.mutate({
                    lineId: lineToDelete.id,
                    idempotencyKey: deleteLineIdempotencyKey,
                  });
                }
              }}
            >
              {deleteLineMutation.isPending ? "Deleting..." : "Delete Line"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
