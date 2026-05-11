"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { apiJson } from "@/lib/client/api";
import type { ManufacturingSalesOrderPreview } from "@/app/(dashboard)/manufacturing/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SalesOrderDetail } from "./types";
import { cn } from "@/lib/utils";

type Props = {
  salesOrderId: string;
  initialOrder?: SalesOrderDetail;
  salesOrderLabel?: string;
  buttonLabel?: string;
  buttonVariant?: "default" | "outline" | "secondary";
  buttonSize?: "default" | "sm" | "lg";
  buttonClassName?: string;
  initialPlannedDate?: string;
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

function formatOpenManufacturingOrders(
  orders: SalesOrderDetail["linkedManufacturingOrders"]
): NonNullable<Props["openManufacturingOrders"]> {
  return orders
    .filter((order) => order.status === "draft" || order.status === "released")
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
  initialOrder,
  salesOrderLabel,
  buttonLabel = "Create MOs",
  buttonVariant = "default",
  buttonSize = "sm",
  buttonClassName,
  initialPlannedDate,
  openManufacturingOrders = [],
  initialLineQuantities,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plannedDate, setPlannedDate] = useState<string | null | undefined>(
    undefined
  );
  const [selectedLineIds, setSelectedLineIds] = useState<string[] | null>(null);
  const [priorityRank, setPriorityRank] = useState("");
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

  const orderQuery = useQuery<SalesOrderDetail>({
    queryKey: ["sales-order", salesOrderId],
    queryFn: () =>
      apiJson<SalesOrderDetail>(`/api/sales-orders/${salesOrderId}`, {
        fallbackError: "Failed to load sales order.",
      }),
    enabled: open,
    initialData: initialOrder,
  });

  const previewQuery = useQuery<ManufacturingSalesOrderPreview>({
    queryKey: ["manufacturing-sales-order-preview", salesOrderId],
    queryFn: () =>
      apiJson<ManufacturingSalesOrderPreview>(
        `/api/sales-orders/${salesOrderId}/manufacturing-orders`,
        { fallbackError: "Failed to load manufacturing preview." }
      ),
    enabled: open,
  });

  const order = orderQuery.data ?? null;
  const effectiveSalesOrderLabel =
    salesOrderLabel ??
    (order ? `${order.orderNumber} - ${order.customerName}` : "");
  const effectiveOpenManufacturingOrders =
    openManufacturingOrders.length > 0
      ? openManufacturingOrders
      : order
        ? formatOpenManufacturingOrders(order.linkedManufacturingOrders)
        : [];
  const effectivePlannedDate =
    plannedDate ?? initialPlannedDate ?? order?.shipDate ?? order?.requestedDate ?? "";
  const creatableLines = useMemo(
    () => previewQuery.data?.lines.filter((line) => line.status === "will_create") ?? [],
    [previewQuery.data]
  );
  const skippedLines = useMemo(
    () => previewQuery.data?.lines.filter((line) => line.status === "skipped") ?? [],
    [previewQuery.data]
  );
  const defaultSelectedLineIds = useMemo(
    () =>
      initialLineQuantityMap.size > 0
        ? creatableLines
            .filter((line) => initialLineQuantityMap.has(line.salesOrderLineId))
            .map((line) => line.salesOrderLineId)
        : creatableLines.map((line) => line.salesOrderLineId),
    [creatableLines, initialLineQuantityMap]
  );
  const effectiveSelectedLineIds = selectedLineIds ?? defaultSelectedLineIds;
  const selectedLineIdSet = useMemo(
    () => new Set(effectiveSelectedLineIds),
    [effectiveSelectedLineIds]
  );
  const isSingleLineMode = initialLineQuantityMap.size === 1;
  const showStatusColumns = skippedLines.length > 0;

  const mutation = useMutation({
    mutationFn: () =>
      apiJson(`/api/sales-orders/${salesOrderId}/manufacturing-orders`, {
        method: "POST",
        body: {
          plannedDate: effectivePlannedDate || null,
          salesOrderLineIds: effectiveSelectedLineIds,
          priorityRank: priorityRank.trim() || null,
          lineQuantities: effectiveSelectedLineIds.map((lineId) => ({
            salesOrderLineId: lineId,
            quantity:
              lineQuantities[lineId] ??
              initialLineQuantityMap.get(lineId) ??
              creatableLines.find((line) => line.salesOrderLineId === lineId)
                ?.quantity ??
              "0",
          })),
          notes: null,
        },
        fallbackError: "Failed to create manufacturing orders.",
      }),
    onSuccess: async () => {
      setOpen(false);
      resetForm();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order", salesOrderId] }),
        queryClient.invalidateQueries({
          queryKey: ["manufacturing-sales-order-preview", salesOrderId],
        }),
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.refresh();
    },
  });

  const resetForm = () => {
    setPlannedDate(undefined);
    setSelectedLineIds(null);
    setPriorityRank("");
    setLineQuantities({});
    mutation.reset();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
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
      const value =
        lineQuantities[lineId] ??
        initialLineQuantityMap.get(lineId) ??
        creatableLines.find((line) => line.salesOrderLineId === lineId)?.quantity ??
        "";
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    }) &&
    !mutation.isPending &&
    !orderQuery.isLoading &&
    !previewQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
      <DialogContent
        size="3xl"
        className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
      >
        <DialogHeader>
          <DialogTitle>
            {isSingleLineMode
              ? "Create Manufacturing Order"
              : "Create Manufacturing Orders"}
          </DialogTitle>
          {effectiveSalesOrderLabel ? (
            <DialogDescription>
              {effectiveSalesOrderLabel}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {orderQuery.isLoading ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
            Loading sales order...
          </div>
        ) : orderQuery.isError ? (
          <p className="text-sm text-destructive">{orderQuery.error.message}</p>
        ) : order ? (
          <div className="flex flex-col gap-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mo-planned-date">
                  Planned Date
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
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mo-priority-rank">
                  Priority Rank
                </label>
                <Input
                  id="mo-priority-rank"
                  value={priorityRank}
                  onChange={(event) => setPriorityRank(event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="None"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">
                  {isSingleLineMode
                    ? "New Manufacturing Order"
                    : "New Manufacturing Orders"}
                </h3>
                <span className="text-sm text-muted-foreground">
                  {orderLabel(effectiveSelectedLineIds.length)}
                </span>
              </div>
              {previewQuery.isLoading ? (
                <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  Loading manufacturing preview...
                </div>
              ) : previewQuery.isError ? (
                <p className="text-sm text-destructive">
                  {previewQuery.error.message}
                </p>
              ) : previewQuery.data ? (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {!isSingleLineMode ? (
                          <TableHead className="w-10">
                            <span className="sr-only">Select</span>
                          </TableHead>
                        ) : null}
                        <TableHead>Product</TableHead>
                        <TableHead className="w-32 text-right">Qty</TableHead>
                        <TableHead className="w-36">Unit</TableHead>
                        {showStatusColumns ? (
                          <>
                            <TableHead className="w-32">Status</TableHead>
                            <TableHead>Reason</TableHead>
                          </>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewQuery.data.lines.map((line) => {
                        const isCreatable = line.status === "will_create";
                        return (
                          <TableRow key={line.salesOrderLineId}>
                            {!isSingleLineMode ? (
                              <TableCell>
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
                              </TableCell>
                            ) : null}
                            <TableCell>
                              <div className="font-medium">{line.itemName}</div>
                              {line.itemSku ? (
                                <div className="text-xs text-muted-foreground">
                                  {line.itemSku}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {isCreatable ? (
                                <Input
                                  inputMode="decimal"
                                  value={
                                    lineQuantities[line.salesOrderLineId] ??
                                    initialLineQuantityMap.get(
                                      line.salesOrderLineId
                                    ) ??
                                    line.quantity
                                  }
                                  onChange={(event) =>
                                    setLineQuantities((current) => ({
                                      ...current,
                                      [line.salesOrderLineId]: event.target.value,
                                    }))
                                  }
                                  className="text-right"
                                  aria-label={`Quantity for ${line.itemName}`}
                                  disabled={
                                    !selectedLineIdSet.has(line.salesOrderLineId) ||
                                    mutation.isPending
                                  }
                                />
                              ) : (
                                <span className="block text-right">
                                  {line.quantity}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{line.unitName}</TableCell>
                            {showStatusColumns ? (
                              <>
                                <TableCell>
                                  <Badge variant={isCreatable ? "secondary" : "outline"}>
                                    {isCreatable ? "Will create" : "Skipped"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {line.skipMessage ?? "-"}
                                </TableCell>
                              </>
                            ) : null}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Open Manufacturing Orders</h3>
                <span className="text-sm text-muted-foreground">
                  {orderLabel(effectiveOpenManufacturingOrders.length)}
                </span>
              </div>
              {effectiveOpenManufacturingOrders.length ? (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead className="w-28 text-right">Qty</TableHead>
                        <TableHead className="w-32">Date</TableHead>
                        <TableHead className="w-24">Priority</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {effectiveOpenManufacturingOrders.map((manufacturingOrder) => (
                        <TableRow key={manufacturingOrder.id}>
                          <TableCell>
                            <div className="font-medium">
                              {manufacturingOrder.orderNumber}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {manufacturingOrder.status}
                            </div>
                          </TableCell>
                          <TableCell>{manufacturingOrder.itemName}</TableCell>
                          <TableCell className="text-right">
                            {manufacturingOrder.quantity}
                          </TableCell>
                          <TableCell>{manufacturingOrder.plannedDate ?? "-"}</TableCell>
                          <TableCell>
                            {manufacturingOrder.priorityRank ?? "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                  No open manufacturing orders.
                </div>
              )}
            </div>

            {mutation.error ? (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}>
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
