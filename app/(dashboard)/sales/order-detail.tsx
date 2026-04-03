"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DisabledTooltipButton } from "@/components/disabled-tooltip-button";
import { TooltipHeader } from "@/components/tooltip-header";
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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OVERSELL_TOOLTIP_COPY } from "@/lib/tooltip-copy";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";
import { ManufacturingOrderStatusBadge } from "@/app/(dashboard)/manufacturing/status-badge";
import { SalesOrderStatusBadge } from "./status-badge";
import type {
  OversellWarningPayload,
  SalesOrderDetail as SalesOrderDetailType,
} from "./types";

type ActionError = {
  status?: number;
  error?: string;
  oversell?: OversellWarningPayload;
};

export function OrderDetail({ order }: { order: SalesOrderDetailType }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [oversellWarning, setOversellWarning] =
    useState<OversellWarningPayload | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.push("/sales/orders");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setCancelOpen(false);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (confirmOversell: boolean) => {
      const response = await fetch(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmOversell }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to confirm order.",
          oversell: body?.oversell,
        } satisfies ActionError;
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setOversellWarning(null);
      router.refresh();
    },
    onError: (error: ActionError) => {
      if (error.status === 409 && error.oversell) {
        setOversellWarning(error.oversell);
        return;
      }

      setActionError(error.error ?? "Failed to confirm order.");
    },
  });

  const fulfillMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/sales-orders/${order.id}/fulfill`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to fulfill order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isDeleted = order.deletedAt != null;
  const canEdit = !isDeleted && order.status === "draft";
  const canConfirm = !isDeleted && order.status === "draft";
  const canFulfill = !isDeleted && order.status === "confirmed";
  const canCancel = !isDeleted && order.status === "confirmed";
  const canDelete = !isDeleted;
  const canCreateMOs = !isDeleted && order.status === "confirmed";
  const createMOHref = `/manufacturing/orders/new?salesOrderId=${order.id}`;

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/sales/orders"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to Orders
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
              <SalesOrderStatusBadge status={order.status} />
              {isDeleted && <Badge variant="outline">Deleted</Badge>}
            </div>
          </div>

          <div className="flex gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sales/orders/${order.id}/edit`}>Edit</Link>
              </Button>
            )}
            {canConfirm && (
              <Button
                size="sm"
                onClick={() => confirmMutation.mutate(false)}
                disabled={confirmMutation.isPending}
              >
                {confirmMutation.isPending ? "Confirming..." : "Confirm"}
              </Button>
            )}
            {canFulfill && (
              <Button
                size="sm"
                onClick={() => fulfillMutation.mutate()}
                disabled={fulfillMutation.isPending}
              >
                {fulfillMutation.isPending ? "Fulfilling..." : "Fulfill"}
              </Button>
            )}
            {canCreateMOs &&
              (order.hasManufacturableLines ? (
                <Button size="sm" asChild>
                  <Link href={createMOHref}>Create MOs</Link>
                </Button>
              ) : (
                <DisabledTooltipButton
                  label="Create MOs"
                  tooltip={
                    order.manufacturableDisabledReason ??
                    "No manufacturable lines remain on this order."
                  }
                />
              ))}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCancelOpen(true)}
                disabled={cancelMutation.isPending}
              >
                Cancel
              </Button>
            )}
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMutation.isPending}
              >
                Delete
              </Button>
            )}
          </div>
        </div>

        <Separator />

        {order.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{order.notes}</p>
        )}

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Customer</dt>
            <dd className="mt-1 text-sm">{order.customerName}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Status</dt>
            <dd className="mt-1 text-sm">
              <SalesOrderStatusBadge status={order.status} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Requested Date</dt>
            <dd className="mt-1 text-sm">{formatDate(order.requestedDate)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Manufacturable Lines</dt>
            <dd className="mt-1 text-sm">{order.manufacturableLineCount}</dd>
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
                  <TableHead>Item</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.itemName}</TableCell>
                    <TableCell>{line.itemSku ?? "\u2014"}</TableCell>
                    <TableCell className="text-right">{parseFloat(line.quantity)}</TableCell>
                    <TableCell>{line.unitName}</TableCell>
                    <TableCell className="text-right">
                      <div>
                        <div>{formatPrice(line.unitPrice) ?? "\u2014"}</div>
                        {line.suggestedUnitPrice && (
                          <div className="text-xs text-muted-foreground">
                            Suggested {formatPrice(line.suggestedUnitPrice) ?? "\u2014"}
                            {line.pricingSourceType === "schedule_break" &&
                            line.pricingScheduleName
                              ? ` from ${line.pricingScheduleName}${
                                  line.pricingBreakLabel
                                    ? `, ${line.pricingBreakLabel}`
                                    : ""
                                }`
                              : " from base price"}
                            {line.isPriceOverridden ? " · Manual override" : ""}
                          </div>
                        )}
                      </div>
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

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">
              Linked Manufacturing Orders
            </h2>
            {canCreateMOs &&
              (order.hasManufacturableLines ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={createMOHref}>Open Create MOs</Link>
                </Button>
              ) : (
                <DisabledTooltipButton
                  label="Open Create MOs"
                  tooltip={
                    order.manufacturableDisabledReason ??
                    "No manufacturable lines remain on this order."
                  }
                />
              ))}
          </div>

          {order.linkedManufacturingOrders.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MO</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.linkedManufacturingOrders.map((manufacturingOrder) => (
                    <TableRow key={manufacturingOrder.id}>
                      <TableCell>
                        <Link
                          href={`/manufacturing/orders/${manufacturingOrder.id}`}
                          className="hover:underline"
                        >
                          {manufacturingOrder.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div>{manufacturingOrder.productName}</div>
                          {manufacturingOrder.productSku && (
                            <p className="text-xs text-muted-foreground">
                              {manufacturingOrder.productSku}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {parseFloat(manufacturingOrder.plannedQuantity)}
                      </TableCell>
                      <TableCell>{manufacturingOrder.unitName}</TableCell>
                      <TableCell>
                        <ManufacturingOrderStatusBadge status={manufacturingOrder.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed px-4 py-6">
              <p className="text-sm text-muted-foreground">
                No manufacturing orders have been created from this sales order yet.
              </p>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={oversellWarning != null} onOpenChange={(open) => {
        if (!open) {
          setOversellWarning(null);
        }
      }}>
        <AlertDialogContent className="max-w-5xl bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirming this order would oversell one or more items.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Current Committed"
                      tooltip={OVERSELL_TOOLTIP_COPY.currentCommitted}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Expected"
                      tooltip={OVERSELL_TOOLTIP_COPY.expected}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Safety"
                      tooltip={OVERSELL_TOOLTIP_COPY.safety}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Current Calculated"
                      tooltip={OVERSELL_TOOLTIP_COPY.currentCalculated}
                    />
                  </TableHead>
                  <TableHead>Added Qty</TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Projected Committed"
                      tooltip={OVERSELL_TOOLTIP_COPY.projectedCommitted}
                    />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader
                      label="Projected Calculated"
                      tooltip={OVERSELL_TOOLTIP_COPY.projectedCalculated}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oversellWarning?.products.map((product) => (
                  <TableRow key={product.itemId}>
                    <TableCell>
                      <div className="font-medium">{product.itemName}</div>
                      {product.itemSku && (
                        <div className="text-xs text-muted-foreground">{product.itemSku}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {product.inStock} {product.unitName}
                    </TableCell>
                    <TableCell>
                      {product.committedQty} {product.unitName}
                    </TableCell>
                    <TableCell>
                      {product.expectedQty} {product.unitName}
                    </TableCell>
                    <TableCell>
                      {product.safetyStock} {product.unitName}
                    </TableCell>
                    <TableCell>
                      {product.calculatedStock} {product.unitName}
                    </TableCell>
                    <TableCell>
                      {product.addedQty} {product.unitName}
                    </TableCell>
                    <TableCell>
                      {product.projectedCommittedQty} {product.unitName}
                    </TableCell>
                    <TableCell className="text-destructive">
                      {product.projectedCalculatedStock} {product.unitName}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate(true)}
            >
              {confirmMutation.isPending ? "Confirming..." : "Confirm Anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will remain in history, but it will stop contributing to committed quantity.
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
            <AlertDialogTitle>Delete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will be soft-deleted and removed from normal views while its saved line items remain in history.
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
    </>
  );
}
