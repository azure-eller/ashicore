"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  SortableDragHandle,
  SortableReorder,
  useSortableReorderItem,
} from "@/components/sortable-reorder";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import { OUTPUT_DISPOSITION_TOOLTIP } from "@/lib/tooltip-copy";
import {
  formatMinimumLotAgeRequirement,
  getMinimumLotAgeDays,
} from "@/lib/bom/constraints";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import { ManufacturingPickProgressBadge } from "./pick-progress-badge";
import type {
  ManufacturingExecutionDetail,
  ManufacturingReleaseWarningPayload,
} from "./types";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";

const EXECUTION_SYNC_INTERVAL_MS = 5000;

function getDefaultActualQuantity(execution: ManufacturingExecutionDetail) {
  if (execution.manufacturingMode === "batch" && execution.currentBatch != null) {
    return execution.currentBatch.plannedQuantity;
  }

  return execution.plannedQuantity;
}

function getDiscreteRequirementMath(
  execution: ManufacturingExecutionDetail,
  ingredient: ManufacturingExecutionDetail["ingredients"][number]
) {
  if (execution.manufacturingMode !== "discrete") {
    return null;
  }

  if (!execution.plannedQuantity || !ingredient.quantityPerUnit) {
    return null;
  }

  return `${formatQuantity(execution.plannedQuantity)} x ${formatQuantity(ingredient.quantityPerUnit)} ${ingredient.unitName}`;
}

export type IngredientActualInput = {
  ingredientId: string;
  actualConsumedQuantity: string;
};

type OutputDispositionInput = "available" | "blocked";

type CompleteDialogIngredient = {
  id: string;
  itemName: string;
  itemSku: string | null;
  unitName: string;
  plannedQuantity: string;
  pickedQuantity: string;
};

type ExecutionIngredient = ManufacturingExecutionDetail["ingredients"][number];

function CompleteDialog({
  open,
  onOpenChange,
  isBatchMode,
  defaultActualQuantity,
  ingredients,
  isCompleting,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isBatchMode: boolean;
  defaultActualQuantity: string;
  ingredients: CompleteDialogIngredient[];
  isCompleting: boolean;
  error: string | null;
  onSubmit: (
    value: string,
    outputDisposition: OutputDispositionInput,
    ingredientActuals: IngredientActualInput[]
  ) => void;
}) {
  const [actualQuantity, setActualQuantity] = useState(defaultActualQuantity);
  const [outputDisposition, setOutputDisposition] =
    useState<OutputDispositionInput>("available");
  const [actualsById, setActualsById] = useState<Record<string, string>>({});

  const handleConfirm = () => {
    onSubmit(
      actualQuantity,
      outputDisposition,
      ingredients.map((ingredient) => ({
        ingredientId: ingredient.id,
        actualConsumedQuantity:
          actualsById[ingredient.id] ?? ingredient.pickedQuantity,
      }))
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={isBatchMode ? "lg" : "default"}>
        <DialogHeader>
          <DialogTitle>
            {isBatchMode ? "Complete Current Batch" : "Complete Order"}
          </DialogTitle>
          <DialogDescription>
            {isBatchMode
              ? "Enter the actual good output and the actual ingredient consumption from this batch."
              : "Enter the actual good output for this order."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
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

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="output-disposition">
              <TooltipHeader label="Output Disposition" tooltip={OUTPUT_DISPOSITION_TOOLTIP} />
            </label>
            <Select
              value={outputDisposition}
              onValueChange={(value) =>
                setOutputDisposition(value as OutputDispositionInput)
              }
            >
              <SelectTrigger id="output-disposition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {isBatchMode && ingredients.length > 0 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Actual Ingredient Consumption</p>
                <p className="text-xs text-muted-foreground">
                  Defaults to the done quantity. Adjust if the worker used more or less than planned; variance is written as an inventory movement.
                </p>
              </div>
              <div className="grid gap-3">
                {ingredients.map((ingredient) => {
                  const inputId = `actual-consumed-${ingredient.id}`;
                  const value = actualsById[ingredient.id] ?? ingredient.pickedQuantity;
                  return (
                    <div key={ingredient.id} className="space-y-1">
                      <label className="text-sm font-medium" htmlFor={inputId}>
                        {ingredient.itemSku
                          ? `${ingredient.itemName} (${ingredient.itemSku})`
                          : ingredient.itemName}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        <QuantityWithUnit
                          label="Planned"
                          value={ingredient.plannedQuantity}
                          unitName={ingredient.unitName}
                          muted
                        />
                        {" · "}
                        <QuantityWithUnit
                          label="Done"
                          value={ingredient.pickedQuantity}
                          unitName={ingredient.unitName}
                          muted
                        />
                      </p>
                      <Input
                        id={inputId}
                        inputMode="decimal"
                        value={value}
                        onChange={(event) =>
                          setActualsById((prev) => ({
                            ...prev,
                            [ingredient.id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCompleting}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isCompleting}>
            {isCompleting ? "Completing..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function moveIngredient(
  ingredients: ExecutionIngredient[],
  fromIndex: number,
  toIndex: number
) {
  const next = [...ingredients];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return ingredients;
  next.splice(toIndex, 0, moved);
  return next;
}

function ExecutionIngredientCard({
  ingredient,
  index,
  execution,
  canReorder,
  canPick,
  isCompleting,
  isPickPending,
  pickingIngredientId,
  pickError,
  onPick,
}: {
  ingredient: ExecutionIngredient;
  index: number;
  execution: ManufacturingExecutionDetail;
  canReorder: boolean;
  canPick: boolean;
  isCompleting: boolean;
  isPickPending: boolean;
  pickingIngredientId: string | null;
  pickError: { id: string; message: string } | null;
  onPick: (ingredientId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, style } =
    useSortableReorderItem(ingredient.id);
  const isPicked = ingredient.remainingQuantity === "0";
  const minimumLotAgeDays = getMinimumLotAgeDays(ingredient.constraints);
  const discreteRequirementMath = getDiscreteRequirementMath(
    execution,
    ingredient
  );

  return (
    <Card
      ref={setNodeRef}
      style={style}
      size="sm"
      className="border border-border/80 bg-background"
    >
      <CardContent className="flex flex-col gap-2 py-1">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            {canReorder && (
              <div className="pt-0.5">
                <SortableDragHandle
                  attributes={attributes}
                  listeners={listeners}
                  label={`Reorder ingredient ${index + 1}`}
                />
              </div>
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={itemDetailHref(ingredient.itemType, ingredient.itemId)}
                  className="font-medium hover:underline"
                >
                  {ingredient.itemSku
                    ? `${ingredient.itemName} (${ingredient.itemSku})`
                    : ingredient.itemName}
                </Link>
                <Badge variant="outline">{ingredient.itemType}</Badge>
                {isPicked && <Badge variant="outline">Done</Badge>}
              </div>
              {discreteRequirementMath ? (
                <p className="text-sm text-muted-foreground">
                  Total required:{" "}
                  <QuantityWithUnit
                    value={ingredient.plannedQuantity}
                    unitName={ingredient.unitName}
                    muted
                  />
                  {" • "}
                  {discreteRequirementMath}
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                <QuantityWithUnit
                  label="Planned"
                  value={ingredient.plannedQuantity}
                  unitName={ingredient.unitName}
                  muted
                />
                {" • "}
                <QuantityWithUnit
                  label="Done"
                  value={ingredient.pickedQuantity}
                  unitName={ingredient.unitName}
                  muted
                />
                {" • "}
                <QuantityWithUnit
                  label="Remaining"
                  value={ingredient.remainingQuantity}
                  unitName={ingredient.unitName}
                  muted
                />
              </p>
              {minimumLotAgeDays ? (
                <p className="text-sm text-muted-foreground">
                  {formatMinimumLotAgeRequirement(minimumLotAgeDays)}
                </p>
              ) : null}
            </div>
          </div>
          <Button
            variant={isPicked ? "outline" : "default"}
            disabled={isPicked || !canPick || isPickPending || isCompleting}
            onClick={() => onPick(ingredient.id)}
          >
            {isPicked
              ? "Done"
              : pickingIngredientId === ingredient.id
                ? "In Progress"
                : "Mark Done"}
          </Button>
        </div>
        {pickError?.id === ingredient.id && (
          <p className="text-sm text-destructive">{pickError.message}</p>
        )}
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
  const [pickError, setPickError] = useState<{ id: string; message: string } | null>(null);
  const [pickWarning, setPickWarning] = useState<{
    ingredientId: string;
    warning: ManufacturingReleaseWarningPayload;
  } | null>(null);
  const [pickingIngredientId, setPickingIngredientId] = useState<string | null>(null);
  const [startBatchError, setStartBatchError] = useState<string | null>(null);
  const [optimisticStartedBatchId, setOptimisticStartedBatchId] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [optimisticIngredientIds, setOptimisticIngredientIds] = useState<
    string[] | null
  >(null);
  const orderedIngredients = useMemo(() => {
    if (!optimisticIngredientIds) {
      return execution.ingredients;
    }

    const ingredientById = new Map(
      execution.ingredients.map((ingredient) => [ingredient.id, ingredient])
    );
    const optimisticIngredients = optimisticIngredientIds
      .map((ingredientId) => ingredientById.get(ingredientId))
      .filter((ingredient): ingredient is ExecutionIngredient => Boolean(ingredient));

    return optimisticIngredients.length === execution.ingredients.length
      ? optimisticIngredients
      : execution.ingredients;
  }, [execution.ingredients, optimisticIngredientIds]);
  const orderedIngredientIds = orderedIngredients.map(
    (ingredient) => ingredient.id
  );
  const defaultActualQuantity = getDefaultActualQuantity(execution);
  const canPick =
    execution.manufacturingMode === "discrete" ||
    execution.currentBatch?.status === "in_progress" ||
    execution.currentBatchId === optimisticStartedBatchId;
  const canReorderStatus = execution.status === "released";

  const refreshExecutionScreen = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const refreshData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    refreshExecutionScreen();
  }, [queryClient, refreshExecutionScreen]);

  useEffect(() => {
    if (execution.status !== "released") {
      return;
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        refreshExecutionScreen();
      }
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const interval = window.setInterval(
      refreshIfVisible,
      EXECUTION_SYNC_INTERVAL_MS
    );

    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.clearInterval(interval);
    };
  }, [execution.status, refreshExecutionScreen]);

  const startBatchMutation = useMutation({
    mutationFn: async () => {
      if (!execution.currentBatchId) {
        throw new Error("No batch is ready to start.");
      }

      const response = await fetch(
        `/api/manufacturing-orders/${execution.id}/batches/${execution.currentBatchId}/start`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("manufacturing-pick", {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({}),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to start batch.");
      }
    },
    onMutate: () => {
      setStartBatchError(null);
    },
    onSuccess: async () => {
      setOptimisticStartedBatchId(execution.currentBatchId);
      await refreshData();
    },
    onError: (error) => {
      setStartBatchError(error.message);
    },
  });

  const pickMutation = useMutation({
    mutationFn: async (input: {
      ingredientId: string;
      confirmRequirementOverride?: boolean;
    }) => {
      const response = await fetch(
        `/api/manufacturing-orders/${execution.id}/ingredients/${input.ingredientId}/pick`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("manufacturing-pick", {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            confirmRequirementOverride: input.confirmRequirementOverride,
          }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          status: response.status,
          message: body?.error ?? "Failed to mark ingredient done.",
          shortage: body?.shortage as ManufacturingReleaseWarningPayload | undefined,
        };
      }
      return input.ingredientId;
    },
    onMutate: (input) => {
      setPickingIngredientId(input.ingredientId);
      setPickError((prev) => (prev?.id === input.ingredientId ? null : prev));
    },
    onSuccess: async (_data, input) => {
      setPickingIngredientId(null);
      setPickError((prev) => (prev?.id === input.ingredientId ? null : prev));
      setPickWarning(null);
      await refreshData();
    },
    onError: (
      error: {
        status?: number;
        message?: string;
        shortage?: ManufacturingReleaseWarningPayload;
      },
      input
    ) => {
      setPickingIngredientId(null);
      if (error.status === 409 && error.shortage) {
        setPickWarning({
          ingredientId: input.ingredientId,
          warning: error.shortage,
        });
        return;
      }
      setPickError({
        id: input.ingredientId,
        message: error.message ?? "Failed to mark ingredient done.",
      });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (ingredientIds: string[]) => {
      const response = await fetch(
        `/api/manufacturing-orders/${execution.id}/ingredients/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientIds }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to reorder ingredients.");
      }
    },
    onMutate: () => {
      setReorderError(null);
      return { previousIngredientIds: orderedIngredientIds };
    },
    onSuccess: async () => {
      setOptimisticIngredientIds(null);
      await queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      refreshExecutionScreen();
    },
    onError: (error, _ingredientIds, context) => {
      if (context?.previousIngredientIds) {
        setOptimisticIngredientIds(context.previousIngredientIds);
      }
      setReorderError(error.message);
      refreshExecutionScreen();
    },
  });
  const canReorderIngredients = canReorderStatus && !reorderMutation.isPending;

  function handleIngredientMove(fromIndex: number, toIndex: number) {
    if (!canReorderIngredients) {
      return;
    }

    const nextIngredients = moveIngredient(orderedIngredients, fromIndex, toIndex);
    setOptimisticIngredientIds(nextIngredients.map((ingredient) => ingredient.id));
    reorderMutation.mutate(nextIngredients.map((ingredient) => ingredient.id));
  }

  const completeOrderMutation = useMutation({
    mutationFn: async (input: {
      actualQuantity: string;
      outputDisposition: OutputDispositionInput;
      ingredientActuals: IngredientActualInput[];
    }) => {
      const response = await fetch(`/api/manufacturing-orders/${execution.id}/complete`, {
        method: "POST",
        headers: createIdempotencyHeaders("manufacturing-complete", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          actualQuantity: input.actualQuantity,
          outputDisposition: input.outputDisposition,
          ingredientActuals: input.ingredientActuals,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to complete order.");
      }
    },
    onMutate: () => {
      setCompleteError(null);
    },
    onSuccess: async () => {
      setCompleteOpen(false);
      setOptimisticStartedBatchId(null);
      await refreshData();
    },
    onError: (error) => {
      setCompleteError(error.message);
    },
  });

  const completeBatchMutation = useMutation({
    mutationFn: async (input: {
      actualQuantity: string;
      outputDisposition: OutputDispositionInput;
      ingredientActuals: IngredientActualInput[];
    }) => {
      if (!execution.currentBatchId) {
        throw new Error("No active batch is ready to complete.");
      }

      const response = await fetch(
        `/api/manufacturing-orders/${execution.id}/batches/${execution.currentBatchId}/complete`,
        {
          method: "POST",
          headers: createIdempotencyHeaders("manufacturing-batch-complete", {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            actualQuantity: input.actualQuantity,
            outputDisposition: input.outputDisposition,
            ingredientActuals: input.ingredientActuals,
          }),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to complete batch.");
      }
    },
    onMutate: () => {
      setCompleteError(null);
    },
    onSuccess: async () => {
      setCompleteOpen(false);
      setOptimisticStartedBatchId(null);
      await refreshData();
    },
    onError: (error) => {
      setCompleteError(error.message);
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
              <Link href="/manufacturing/orders" className="hover:text-foreground">
                Orders
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
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Planned</dt>
                <dd className="mt-1 font-medium">
                  <QuantityWithUnit
                    value={execution.plannedQuantity}
                    unitName={execution.unitName}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Actual</dt>
                <dd className="mt-1 font-medium">
                  <QuantityWithUnit
                    value={execution.actualQuantity}
                    unitName={execution.unitName}
                  />
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
                One batch at a time; each completion creates a lot.
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
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/80 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">
                          Batch {execution.currentBatch.batchNumber}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <QuantityWithUnit
                            label="Planned"
                            value={execution.currentBatch.plannedQuantity}
                            unitName={execution.unitName}
                            muted
                          />
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
                  {startBatchError && (
                    <p className="text-sm text-destructive">{startBatchError}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All batches complete.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Ingredients</h2>
            <p className="text-sm text-muted-foreground">
              Mark each ingredient done as it is finished.
            </p>
            {execution.manufacturingMode === "batch" &&
              !canPick &&
              execution.currentBatch && (
                <p className="text-sm text-muted-foreground">
                  Start batch {execution.currentBatch.batchNumber} before marking ingredients done.
                </p>
              )}
          </div>

          {reorderError && (
            <p className="text-sm text-destructive">{reorderError}</p>
          )}

          <SortableReorder
            ids={orderedIngredientIds}
            onMove={handleIngredientMove}
          >
            <div className="grid gap-3">
              {orderedIngredients.map((ingredient, index) => (
                <ExecutionIngredientCard
                  key={ingredient.id}
                  ingredient={ingredient}
                  index={index}
                  execution={execution}
                  canReorder={canReorderIngredients}
                  canPick={canPick}
                  isCompleting={isCompleting}
                  isPickPending={pickMutation.isPending || reorderMutation.isPending}
                  pickingIngredientId={pickingIngredientId}
                  pickError={pickError}
                  onPick={(ingredientId) =>
                    pickMutation.mutate({ ingredientId })
                  }
                />
              ))}
            </div>
          </SortableReorder>
        </div>

        <div className="flex justify-end">
          <Button
            size="lg"
            disabled={!execution.canComplete || isCompleting}
            onClick={() => setCompleteOpen(true)}
          >
            {execution.manufacturingMode === "batch" ? "Complete Batch" : "Complete Order"}
          </Button>
        </div>

        <AlertDialog
          open={pickWarning != null}
          onOpenChange={(open) => {
            if (!open) setPickWarning(null);
          }}
        >
          <AlertDialogContent className="bg-background text-foreground">
            <AlertDialogHeader>
              <AlertDialogTitle>Mark done with requirement override?</AlertDialogTitle>
              <AlertDialogDescription>
                One or more ingredient requirements are not fully met.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 text-sm">
              {pickWarning?.warning.ingredients.map((ingredient) => (
                <div key={ingredient.itemId} className="rounded-md border p-3">
                  <p className="font-medium">{ingredient.itemName}</p>
                  <p className="text-muted-foreground">
                    {ingredient.requirement ?? "Ingredient requirement is not met."}
                  </p>
                  <p className="text-muted-foreground">
                    Eligible {ingredient.available} {ingredient.unitName}; needed{" "}
                    {ingredient.needed} {ingredient.unitName}.
                    {ingredient.nextEligibleDate
                      ? ` Next eligible date: ${formatDate(ingredient.nextEligibleDate)}.`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Back</AlertDialogCancel>
              <AlertDialogAction
                disabled={pickMutation.isPending || pickWarning == null}
                onClick={() => {
                  if (!pickWarning) return;
                  pickMutation.mutate({
                    ingredientId: pickWarning.ingredientId,
                    confirmRequirementOverride: true,
                  });
                }}
              >
                {pickMutation.isPending ? "In Progress" : "Mark Done Anyway"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <CompleteDialog
          key={
            completeOpen
              ? `open:${execution.currentBatchId ?? execution.id}:${defaultActualQuantity}`
              : "closed"
          }
          open={completeOpen}
          onOpenChange={(next) => {
            if (isCompleting) return;
            if (!next) {
              setCompleteError(null);
            }
            setCompleteOpen(next);
          }}
          isBatchMode={execution.manufacturingMode === "batch"}
          defaultActualQuantity={defaultActualQuantity}
          ingredients={orderedIngredients.map((ingredient) => ({
            id: ingredient.id,
            itemName: ingredient.itemName,
            itemSku: ingredient.itemSku,
            unitName: ingredient.unitName,
            plannedQuantity: ingredient.plannedQuantity,
            pickedQuantity: ingredient.pickedQuantity,
          }))}
          isCompleting={isCompleting}
          error={completeError}
          onSubmit={(value, outputDisposition, ingredientActuals) => {
            if (execution.manufacturingMode === "batch") {
              completeBatchMutation.mutate({
                actualQuantity: value,
                outputDisposition,
                ingredientActuals,
              });
              return;
            }

            completeOrderMutation.mutate({
              actualQuantity: value,
              outputDisposition,
              ingredientActuals,
            });
          }}
        />
      </div>
    </div>
  );
}
