"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import { ManufacturingPickProgressBadge } from "./pick-progress-badge";
import type { ManufacturingExecutionDetail } from "./types";

function getDefaultActualQuantity(execution: ManufacturingExecutionDetail) {
  if (execution.manufacturingMode === "batch" && execution.currentBatch != null) {
    return execution.currentBatch.plannedQuantity;
  }

  return execution.plannedQuantity;
}

function CompletionCard({
  defaultActualQuantity,
  isBatchMode,
  canComplete,
  isCompleting,
  actionError,
  onComplete,
}: {
  defaultActualQuantity: string;
  isBatchMode: boolean;
  canComplete: boolean;
  isCompleting: boolean;
  actionError: string | null;
  onComplete: (value: string) => void;
}) {
  const [actualQuantity, setActualQuantity] = useState(defaultActualQuantity);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isBatchMode ? "Complete Current Batch" : "Complete Order"}</CardTitle>
        <CardDescription>
          Enter the actual good output from the work that was just produced.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm space-y-2">
          <label className="text-sm font-medium" htmlFor="actual-output">
            Actual Output
          </label>
          <Input
            id="actual-output"
            inputMode="decimal"
            value={actualQuantity}
            onChange={(event) => setActualQuantity(event.target.value)}
          />
        </div>
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        <div className="flex flex-wrap gap-3">
          <Button disabled={!canComplete || isCompleting} onClick={() => onComplete(actualQuantity)}>
            {isCompleting ? "Completing..." : isBatchMode ? "Complete Batch" : "Complete Order"}
          </Button>
          {!canComplete && (
            <p className="self-center text-sm text-muted-foreground">
              Pick every ingredient before completion.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ManufacturingExecution({
  execution,
}: {
  execution: ManufacturingExecutionDetail;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const actualQuantityResetKey =
    execution.manufacturingMode === "batch"
      ? `${execution.id}:${execution.currentBatchId ?? "complete"}`
      : execution.id;
  const defaultActualQuantity = getDefaultActualQuantity(execution);

  const refreshData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    startTransition(() => {
      router.refresh();
    });
  };

  const startBatchMutation = useMutation({
    mutationFn: async () => {
      if (!execution.currentBatchId) {
        throw new Error("No batch is ready to start.");
      }

      const response = await fetch(
        `/api/manufacturing-orders/${execution.id}/batches/${execution.currentBatchId}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to start batch.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: refreshData,
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const pickMutation = useMutation({
    mutationFn: async (ingredientId: string) => {
      const response = await fetch(
        `/api/manufacturing-orders/${execution.id}/ingredients/${ingredientId}/pick`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to pick ingredient.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: refreshData,
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const completeOrderMutation = useMutation({
    mutationFn: async (value: string) => {
      const response = await fetch(`/api/manufacturing-orders/${execution.id}/complete`, {
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
    onSuccess: refreshData,
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const completeBatchMutation = useMutation({
    mutationFn: async (value: string) => {
      if (!execution.currentBatchId) {
        throw new Error("No active batch is ready to complete.");
      }

      const response = await fetch(
        `/api/manufacturing-orders/${execution.id}/batches/${execution.currentBatchId}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actualQuantity: value }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to complete batch.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: refreshData,
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const isCompleting =
    completeOrderMutation.isPending || completeBatchMutation.isPending;

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <div className="space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link href="/manufacturing/execution" className="hover:text-foreground">
                Execution Queue
              </Link>
              <span>/</span>
              <Link
                href={`/manufacturing/orders/${execution.id}`}
                className="hover:text-foreground"
              >
                {execution.orderNumber}
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {execution.manufacturingMode === "batch" ? "Batch Execution" : "Manufacturing Execution"}
              </h1>
              <ManufacturingOrderStatusBadge status={execution.status} />
              <ManufacturingPickProgressBadge status={execution.pickProgressStatus} />
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {execution.productSku
                ? `${execution.productName} (${execution.productSku})`
                : execution.productName}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link href={`/manufacturing/orders/${execution.id}`}>View Order</Link>
            </Button>
          </div>
        </div>

        <Separator />

        <Card>
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
            <CardDescription>
              Work from this screen and use the order page only for audit, notes, and history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Planned</dt>
                <dd className="mt-1 font-medium">
                  {formatQuantity(execution.plannedQuantity)} {execution.unitName}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Actual</dt>
                <dd className="mt-1 font-medium">
                  {formatQuantity(execution.actualQuantity)} {execution.unitName}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Planned Date</dt>
                <dd className="mt-1 font-medium">{formatDate(execution.plannedDate)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sales Order</dt>
                <dd className="mt-1 font-medium">
                  {execution.salesOrderNumber
                    ? `${execution.salesOrderNumber} - ${execution.salesCustomerName ?? "—"}`
                    : "—"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {execution.manufacturingMode === "batch" && (
          <Card>
            <CardHeader>
              <CardTitle>Batch Progress</CardTitle>
              <CardDescription>
                Run one batch at a time. Each completed batch records its own finished lot.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {execution.batches.map((batch) => (
                  <Badge
                    key={batch.id}
                    variant={batch.status === "completed" ? "outline" : batch.id === execution.currentBatchId ? "default" : "secondary"}
                  >
                    Batch {batch.batchNumber}
                  </Badge>
                ))}
              </div>
              {execution.currentBatch ? (
                <div className="rounded-lg border border-border/80 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">
                        Batch {execution.currentBatch.batchNumber}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Planned {formatQuantity(execution.currentBatch.plannedQuantity)}{" "}
                        {execution.unitName}
                        {execution.currentBatch.startedAt && (
                          <> • Started {formatDateTime(execution.currentBatch.startedAt)}</>
                        )}
                      </p>
                    </div>
                    {execution.currentBatch.status === "pending" && (
                      <Button
                        onClick={() => startBatchMutation.mutate()}
                        disabled={startBatchMutation.isPending}
                      >
                        {startBatchMutation.isPending ? "Starting..." : "Start Batch"}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All batches are complete. Review the final order details if needed.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Ingredients</h2>
            <p className="text-sm text-muted-foreground">
              Pick each ingredient at its remaining quantity. FIFO lot selection is automatic.
            </p>
          </div>

          <div className="grid gap-3">
            {execution.ingredients.map((ingredient) => {
              const isPicked = ingredient.remainingQuantity === "0";

              return (
                <Card key={ingredient.id} size="sm" className="border border-border/80">
                  <CardContent className="flex flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {ingredient.itemSku
                            ? `${ingredient.itemName} (${ingredient.itemSku})`
                            : ingredient.itemName}
                        </p>
                        <Badge variant="outline">{ingredient.itemType}</Badge>
                        {isPicked && <Badge variant="outline">Picked</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Planned {formatQuantity(ingredient.plannedQuantity)} {ingredient.unitName}
                        {" • "}
                        Picked {formatQuantity(ingredient.pickedQuantity)} {ingredient.unitName}
                        {" • "}
                        Remaining {formatQuantity(ingredient.remainingQuantity)} {ingredient.unitName}
                      </p>
                    </div>
                    <Button
                      variant={isPicked ? "outline" : "default"}
                      disabled={isPicked || pickMutation.isPending || isCompleting}
                      onClick={() => pickMutation.mutate(ingredient.id)}
                    >
                      {isPicked
                        ? "Picked"
                        : pickMutation.isPending
                          ? "Picking..."
                          : `Pick ${formatQuantity(ingredient.remainingQuantity)} ${ingredient.unitName}`}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <CompletionCard
          key={actualQuantityResetKey}
          defaultActualQuantity={defaultActualQuantity}
          isBatchMode={execution.manufacturingMode === "batch"}
          canComplete={execution.canComplete}
          isCompleting={isCompleting}
          actionError={actionError}
          onComplete={(value) => {
            if (execution.manufacturingMode === "batch") {
              completeBatchMutation.mutate(value);
              return;
            }

            completeOrderMutation.mutate(value);
          }}
        />
      </div>
    </div>
  );
}
