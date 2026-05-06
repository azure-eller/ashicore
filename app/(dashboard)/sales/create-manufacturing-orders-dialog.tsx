"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import type { ManufacturingSalesOrderPreview } from "@/app/(dashboard)/manufacturing/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
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

type Props = {
  salesOrderId: string;
  initialOrder?: SalesOrderDetail;
  buttonLabel?: string;
  buttonVariant?: "default" | "outline" | "secondary";
  buttonSize?: "default" | "sm";
};

function orderLabel(count: number) {
  return `${count} order${count === 1 ? "" : "s"}`;
}

export function CreateManufacturingOrdersDialog({
  salesOrderId,
  initialOrder,
  buttonLabel = "Create MOs",
  buttonVariant = "default",
  buttonSize = "sm",
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plannedDate, setPlannedDate] = useState<string | null | undefined>(
    undefined
  );
  const [selectedLineIds, setSelectedLineIds] = useState<string[] | null>(null);

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
  const effectivePlannedDate =
    plannedDate ?? order?.shipDate ?? order?.requestedDate ?? "";
  const creatableLines = useMemo(
    () => previewQuery.data?.lines.filter((line) => line.status === "will_create") ?? [],
    [previewQuery.data]
  );
  const skippedLines = useMemo(
    () => previewQuery.data?.lines.filter((line) => line.status === "skipped") ?? [],
    [previewQuery.data]
  );
  const defaultSelectedLineIds = useMemo(
    () => creatableLines.map((line) => line.salesOrderLineId),
    [creatableLines]
  );
  const effectiveSelectedLineIds = selectedLineIds ?? defaultSelectedLineIds;
  const selectedLineIdSet = useMemo(
    () => new Set(effectiveSelectedLineIds),
    [effectiveSelectedLineIds]
  );
  const showStatusColumns = skippedLines.length > 0;

  const mutation = useMutation({
    mutationFn: () =>
      apiJson(`/api/sales-orders/${salesOrderId}/manufacturing-orders`, {
        method: "POST",
        body: {
          plannedDate: effectivePlannedDate || null,
          salesOrderLineIds: effectiveSelectedLineIds,
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
    !mutation.isPending &&
    !orderQuery.isLoading &&
    !previewQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={buttonVariant} size={buttonSize}>
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        size="3xl"
        className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
      >
        <DialogHeader>
          <DialogTitle>Create Manufacturing Orders</DialogTitle>
          {order ? (
            <DialogDescription>
              {order.orderNumber} - {order.customerName}
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
            <div className="max-w-xs space-y-2">
              <label className="text-sm font-medium" htmlFor="mo-planned-date">
                Planned Date
              </label>
              <DatePicker
                id="mo-planned-date"
                value={effectivePlannedDate}
                onChange={(value) => setPlannedDate(value || null)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Manufacturing Orders</h3>
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
                        <TableHead className="w-10">
                          <span className="sr-only">Select</span>
                        </TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="w-24 text-right">Qty</TableHead>
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
                            <TableCell>
                              <div className="font-medium">{line.itemName}</div>
                              {line.itemSku ? (
                                <div className="text-xs text-muted-foreground">
                                  {line.itemSku}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right">{line.quantity}</TableCell>
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
            {mutation.isPending ? "Creating..." : `Create ${orderLabel(effectiveSelectedLineIds.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
