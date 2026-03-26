"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
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
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import type {
  ManufacturingOrderDetail as ManufacturingOrderDetailType,
  ManufacturingReleaseWarningPayload,
} from "./types";

type ApiError = {
  status?: number;
  error?: string;
  shortage?: ManufacturingReleaseWarningPayload;
};

export function ManufacturingOrderDetail({
  order,
}: {
  order: ManufacturingOrderDetailType;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [releaseWarning, setReleaseWarning] =
    useState<ManufacturingReleaseWarningPayload | null>(null);
  const [actualQuantity, setActualQuantity] = useState(order.plannedQuantity);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}`, {
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
      await refreshQueries();
      setDeleteOpen(false);
      router.push("/manufacturing/orders");
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/cancel`, {
        method: "POST",
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
      await refreshQueries();
      setCancelOpen(false);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async (confirmShortage?: boolean) => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmShortage: confirmShortage ?? false }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to release order.",
          shortage: body?.shortage,
        } satisfies ApiError;
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await refreshQueries();
      setReleaseWarning(null);
      router.refresh();
    },
    onError: (error: ApiError) => {
      if (error.status === 409 && error.shortage) {
        setReleaseWarning(error.shortage);
        return;
      }
      setActionError(error.error ?? "Failed to release order.");
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (value: string) => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualQuantity: value }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to complete order.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await refreshQueries();
      setCompleteOpen(false);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const canEdit = order.status === "draft";
  const canRelease = order.status === "draft";
  const canComplete = order.status === "released";
  const canCancel = order.status === "draft" || order.status === "released";
  const canDelete = order.status !== "released";

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/manufacturing/orders"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to Orders
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
              <ManufacturingOrderStatusBadge status={order.status} />
              {order.deletedAt && <Badge variant="outline">Deleted</Badge>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/manufacturing/orders/${order.id}/edit`}>Edit</Link>
              </Button>
            )}
            {canRelease && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => releaseMutation.mutate(false)}
                disabled={releaseMutation.isPending}
              >
                Release
              </Button>
            )}
            {canComplete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompleteOpen(true)}
                disabled={completeMutation.isPending}
              >
                Complete
              </Button>
            )}
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

        <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Product</dt>
            <dd className="mt-1 text-sm">
              {order.productSku
                ? `${order.productName} (${order.productSku})`
                : order.productName}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Status</dt>
            <dd className="mt-1 text-sm">
              <ManufacturingOrderStatusBadge status={order.status} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Planned Quantity</dt>
            <dd className="mt-1 text-sm">
              {parseFloat(order.plannedQuantity)} {order.unitName}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Actual Quantity</dt>
            <dd className="mt-1 text-sm">
              {order.actualQuantity != null
                ? `${parseFloat(order.actualQuantity)} ${order.unitName}`
                : "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Planned Date</dt>
            <dd className="mt-1 text-sm">{formatDate(order.plannedDate)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Sales Order</dt>
            <dd className="mt-1 text-sm">
              {order.salesOrderNumber
                ? `${order.salesOrderNumber} - ${order.salesCustomerName ?? "\u2014"}`
                : "\u2014"}
            </dd>
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
            <dt className="text-sm font-medium text-muted-foreground">Released</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.releasedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Completed</dt>
            <dd className="mt-1 text-sm">{formatDateTime(order.completedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Material Cost</dt>
            <dd className="mt-1 text-sm">
              {formatPrice(order.actualMaterialCost) ?? "\u2014"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Cost / Unit</dt>
            <dd className="mt-1 text-sm">
              {formatPrice(order.actualCostPerUnit) ?? "\u2014"}
            </dd>
          </div>
        </dl>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Ingredients</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty / Unit</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.ingredients.map((ingredient) => (
                  <TableRow key={ingredient.id}>
                    <TableCell>
                      {ingredient.itemSku
                        ? `${ingredient.itemName} (${ingredient.itemSku})`
                        : ingredient.itemName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ingredient.itemType}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {parseFloat(ingredient.quantityPerUnit)}
                    </TableCell>
                    <TableCell className="text-right">
                      {parseFloat(ingredient.plannedQuantity)}
                    </TableCell>
                    <TableCell className="text-right">
                      {ingredient.actualQuantity != null
                        ? parseFloat(ingredient.actualQuantity)
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(ingredient.actualCostTotal) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Produced Output</h2>
          {order.producedLot ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lot</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Cost / Unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono">{order.producedLot.lotNumber}</TableCell>
                    <TableCell className="text-right">
                      {parseFloat(order.producedLot.quantity)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(order.producedLot.costPerUnit) ?? "\u2014"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No produced lot has been recorded yet.
            </p>
          )}
        </div>
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              The order will remain in history, and released orders will stop
              contributing to expected quantity.
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
              Draft, completed, and cancelled orders can be soft-deleted and removed
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

      <AlertDialog
        open={releaseWarning != null}
        onOpenChange={(open) => {
          if (!open) setReleaseWarning(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Release with shortages?</AlertDialogTitle>
            <AlertDialogDescription>
              Releasing is still allowed, but one or more ingredients are short right now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="text-right">Needed</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Shortage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {releaseWarning?.ingredients.map((ingredient) => (
                  <TableRow key={ingredient.itemId}>
                    <TableCell>{ingredient.itemName}</TableCell>
                    <TableCell className="text-right">
                      {ingredient.needed} {ingredient.unitName}
                    </TableCell>
                    <TableCell className="text-right">
                      {ingredient.available} {ingredient.unitName}
                    </TableCell>
                    <TableCell className="text-right">
                      {ingredient.shortage} {ingredient.unitName}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={releaseMutation.isPending}
              onClick={() => releaseMutation.mutate(true)}
            >
              {releaseMutation.isPending ? "Releasing..." : "Release Anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              Enter the actual finished quantity. Ingredient actuals and lot cost
              will be derived from this value.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label htmlFor="actualQuantity" className="text-sm font-medium">
              Actual Quantity
            </label>
            <Input
              id="actualQuantity"
              value={actualQuantity}
              onChange={(event) => setActualQuantity(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={completeMutation.isPending}
              onClick={() => completeMutation.mutate(actualQuantity)}
            >
              {completeMutation.isPending ? "Completing..." : "Complete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
