"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailPageActions } from "@/components/detail-page-actions";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, formatPrice, formatQuantity, getFieldArrayError } from "@/lib/format";
import { receivePurchaseOrderSchema } from "@/lib/schemas/purchase-orders";
import { PurchaseOrderStatusBadge } from "./status-badge";
import type { PurchaseOrderDetail as PurchaseOrderDetailType } from "./types";

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};


type ReceiveFormValues = z.input<typeof receivePurchaseOrderSchema>;

export function PurchaseOrderDetail({
  order,
}: {
  order: PurchaseOrderDetailType;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const receiveForm = useForm<ReceiveFormValues>({
    resolver: zodResolver(receivePurchaseOrderSchema),
    mode: "onBlur",
    defaultValues: {
      lines: order.lines.map((line) => ({
        lineId: line.id,
        quantityReceived: null,
      })),
    },
  });

  useEffect(() => {
    receiveForm.reset({
      lines: order.lines.map((line) => ({
        lineId: line.id,
        quantityReceived: null,
      })),
    });
  }, [order.lines, receiveForm, receiveOpen]);

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/purchase-orders/${order.id}/submit`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-submit"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to submit purchase order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await refreshQueries();
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const receiveMutation = useMutation({
    mutationFn: async (values: ReceiveFormValues) => {
      const response = await fetch(`/api/purchase-orders/${order.id}/receive`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-receive", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to receive purchase order.",
          errors: body?.errors,
        } satisfies ApiError;
      }
    },
    onMutate: () => {
      setActionError(null);
      receiveForm.clearErrors();
    },
    onSuccess: async () => {
      await refreshQueries();
      setReceiveOpen(false);
      router.refresh();
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          receiveForm.setError(field as never, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setActionError(error.error ?? "Failed to receive purchase order.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/purchase-orders/${order.id}/cancel`, {
        method: "POST",
        headers: createIdempotencyHeaders("purchase-order-cancel"),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel purchase order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await refreshQueries();
      setCancelOpen(false);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/purchase-orders/${order.id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete purchase order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setDeleteOpen(false);
      router.push("/purchasing/orders");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isDeleted = order.deletedAt != null;
  const canEdit = !isDeleted && order.status === "draft";
  const canSubmit = !isDeleted && order.status === "draft";
  const canReceive = !isDeleted && ["ordered", "partial"].includes(order.status);
  const canCancel = !isDeleted && ["ordered", "partial"].includes(order.status);
  const canDelete = !isDeleted && !["ordered", "partial"].includes(order.status);
  const receiveLinesError = getFieldArrayError(receiveForm.formState.errors.lines);

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/purchasing/orders"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to Orders
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
              <PurchaseOrderStatusBadge status={order.status} />
              {isDeleted && <Badge variant="outline">Deleted</Badge>}
            </div>
          </div>

          <DetailPageActions
            editHref={canEdit ? `/purchasing/orders/${order.id}/edit` : undefined}
            menu={[
              ...(canCancel
                ? [
                    {
                      label: "Cancel order",
                      onSelect: () => setCancelOpen(true),
                      disabled: cancelMutation.isPending,
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    {
                      label: "Delete",
                      onSelect: () => setDeleteOpen(true),
                      disabled: deleteMutation.isPending,
                      destructive: true,
                    },
                  ]
                : []),
            ]}
          >
            {canSubmit ? (
              <Button
                size="sm"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? "Submitting..." : "Submit"}
              </Button>
            ) : null}
            {canReceive ? (
              <Button
                size="sm"
                onClick={() => setReceiveOpen(true)}
                disabled={receiveMutation.isPending}
              >
                Receive
              </Button>
            ) : null}
          </DetailPageActions>
        </div>

        <Separator />

        {order.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{order.notes}</p>
        )}

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Supplier</dt>
            <dd className="mt-1 text-sm">
              <Link
                href={`/purchasing/suppliers/${order.supplierId}`}
                className="hover:underline"
              >
                {order.supplierName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Status</dt>
            <dd className="mt-1 text-sm">
              <PurchaseOrderStatusBadge status={order.status} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Expected Date</dt>
            <dd className="mt-1 text-sm">{formatDate(order.expectedDate)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Total</dt>
            <dd className="mt-1 text-sm">{formatPrice(order.totalAmount) ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Ordered</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.orderedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Received</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.receivedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Cancelled</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.cancelledAt)}</dd>
          </div>
          {order.deletedAt && (
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Deleted</dt>
              <dd className="mt-1 text-sm">{formatDateTime(order.deletedAt)}</dd>
            </div>
          )}
        </dl>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Lines</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Purchase Unit</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Link
                        href={itemDetailHref("material", line.itemId)}
                        className="hover:underline"
                      >
                        {line.itemName}
                      </Link>
                    </TableCell>
                    <TableCell>{line.itemSku ?? "\u2014"}</TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(line.quantityOrdered)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(line.quantityReceived)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(line.quantityRemaining)}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div>{line.purchaseUnitName}</div>
                        {line.purchaseUnitName !== line.stockingUnitName ? (
                          <p className="text-xs text-muted-foreground">
                            {formatQuantity(line.stockQuantityOrdered)} {line.stockingUnitName} stocked
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(line.unitCost) ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(line.lineTotal) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this purchase order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will remain in history, and its remaining quantity will
              stop contributing to expected inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this purchase order?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft, received, and cancelled orders can be soft-deleted and removed
              from normal views.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Receive Purchase Order</DialogTitle>
            <DialogDescription>
              Enter the quantities received for each line. Blank values are ignored
              and each receipt creates a new internal lot.
            </DialogDescription>
          </DialogHeader>

          <form
            id="receive-purchase-order-form"
            className="space-y-4"
            onSubmit={receiveForm.handleSubmit((values) => receiveMutation.mutate(values))}
          >
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead>Purchase Unit</TableHead>
                    <TableHead className="w-44">Receive Now</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lines.map((line, index) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <Link
                          href={itemDetailHref("material", line.itemId)}
                          className="block space-y-1 hover:underline"
                        >
                          <div className="font-medium">{line.itemName}</div>
                          {line.itemSku && (
                            <p className="text-xs text-muted-foreground">{line.itemSku}</p>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(line.quantityOrdered)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(line.quantityReceived)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(line.quantityRemaining)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div>{line.purchaseUnitName}</div>
                          {line.purchaseUnitName !== line.stockingUnitName ? (
                            <p className="text-xs text-muted-foreground">
                              {formatQuantity(line.stockQuantityRemaining)} {line.stockingUnitName} remaining
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Controller
                          control={receiveForm.control}
                          name={`lines.${index}.quantityReceived`}
                          render={({ field, fieldState }) => (
                            <div>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                onChange={(event) => field.onChange(event.target.value || null)}
                                aria-invalid={fieldState.invalid}
                                inputMode="decimal"
                                placeholder="0"
                                autoComplete="off"
                              />
                              {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                              )}
                            </div>
                          )}
                        />
                        <input
                          type="hidden"
                          value={line.id}
                          {...receiveForm.register(`lines.${index}.lineId`)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {receiveLinesError && <FieldError>{receiveLinesError}</FieldError>}
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReceiveOpen(false)}>
              Back
            </Button>
            <Button
              type="submit"
              form="receive-purchase-order-form"
              disabled={receiveMutation.isPending}
            >
              {receiveMutation.isPending ? "Receiving..." : "Receive Materials"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
