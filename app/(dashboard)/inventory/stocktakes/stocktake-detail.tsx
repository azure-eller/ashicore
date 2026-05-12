"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailPageActions } from "@/components/detail-page-actions";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  formatDateTime,
  formatQuantity,
  getFieldArrayError,
  getFirstFormErrorMessage,
  normalizeNumeric,
} from "@/lib/format";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import {
  type UpdateStocktakeCounts,
  updateStocktakeCountsSchema,
} from "@/lib/schemas/stocktakes";
import {
  ITEM_TYPE_TOOLTIP,
  STOCKTAKE_COUNT_QTY_TOOLTIP,
  STOCKTAKE_CURRENT_QTY_TOOLTIP,
  STOCKTAKE_COUNTED_TOOLTIP,
  STOCKTAKE_ITEM_COUNT_TOOLTIP,
  STOCKTAKE_LINE_VARIANCE_TOOLTIP,
  STOCKTAKE_SCOPE_TOOLTIP,
  STOCKTAKE_SNAPSHOT_QTY_TOOLTIP,
  UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import { TooltipHeader } from "@/components/tooltip-header";
import { StocktakeStatusBadge } from "./status-badge";
import {
  formatScope,
  type StocktakeDetail as StocktakeDetailType,
  type StocktakeStaleWarningPayload,
} from "./types";

type ApiError = {
  status?: number;
  error?: string;
  errors?: Record<string, string[]>;
  stale?: StocktakeStaleWarningPayload;
};

type CountFilter = "all" | "counted" | "uncounted" | "variance";

type CountFormValues = z.input<typeof updateStocktakeCountsSchema>;

function normalizeCountedQtyInput(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function formatSavedCountedQtyInput(value: string | null | undefined) {
  const normalized = normalizeCountedQtyInput(value);

  if (normalized == null) {
    return null;
  }

  return Number(normalized).toFixed(4);
}

export function StocktakeDetail({
  stocktake,
  canViewLedger = false,
}: {
  stocktake: StocktakeDetailType;
  canViewLedger?: boolean;
}) {
  const timeZone = useOrganizationTimeZone();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [staleWarning, setStaleWarning] =
    useState<StocktakeStaleWarningPayload | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [countFilter, setCountFilter] = useState<CountFilter>("all");

  const form = useForm<CountFormValues>({
    resolver: zodResolver(updateStocktakeCountsSchema),
    mode: "onBlur",
    defaultValues: {
      lines: stocktake.lines.map((line) => ({
        lineId: line.id,
        countedQty: line.countedQty,
      })),
      lotLines: stocktake.lines.flatMap((line) =>
        line.lots.map((lotLine) => ({
          lotLineId: lotLine.id,
          countedQty: lotLine.countedQty,
        }))
      ),
    },
  });

  useEffect(() => {
    form.reset({
      lines: stocktake.lines.map((line) => ({
        lineId: line.id,
        countedQty: line.countedQty,
      })),
      lotLines: stocktake.lines.flatMap((line) =>
        line.lots.map((lotLine) => ({
          lotLineId: lotLine.id,
          countedQty: lotLine.countedQty,
        }))
      ),
    });
  }, [form, stocktake.lines]);

  const watchedLines = useWatch({
    control: form.control,
    name: "lines",
  });
  const watchedLotLines = useWatch({
    control: form.control,
    name: "lotLines",
  });

  const refreshStocktakeQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
  };

  const buildDirtyCountPayload = (
    values: CountFormValues
  ): UpdateStocktakeCounts | null => {
    const dirtyLines = form.formState.dirtyFields.lines ?? [];
    const dirtyLotLines = form.formState.dirtyFields.lotLines ?? [];
    const lines = (values.lines ?? []).flatMap((line, index) => {
      if (!dirtyLines[index]?.countedQty) {
        return [];
      }

      return [
        {
          lineId: line.lineId,
          countedQty: normalizeCountedQtyInput(line.countedQty),
        },
      ];
    });
    const lotLines = (values.lotLines ?? []).flatMap((line, index) => {
      if (!dirtyLotLines[index]?.countedQty) {
        return [];
      }

      return [
        {
          lotLineId: line.lotLineId,
          countedQty: normalizeCountedQtyInput(line.countedQty),
        },
      ];
    });

    if (lines.length === 0 && lotLines.length === 0) {
      return null;
    }

    return updateStocktakeCountsSchema.parse({ lines, lotLines });
  };

  const resetFormWithCurrentValues = (values: CountFormValues) => {
    form.reset({
      lines: (values.lines ?? []).map((line) => ({
        lineId: line.lineId,
        countedQty: formatSavedCountedQtyInput(line.countedQty),
      })),
      lotLines: (values.lotLines ?? []).map((line) => ({
        lotLineId: line.lotLineId,
        countedQty: formatSavedCountedQtyInput(line.countedQty),
      })),
    });
  };

  const saveDirtyCounts = async (values: CountFormValues) => {
    const payload = buildDirtyCountPayload(values);

    if (!payload) {
      return false;
    }

    await saveMutation.mutateAsync(payload);
    resetFormWithCurrentValues(values);
    await refreshStocktakeQueries();
    return true;
  };

  const saveMutation = useMutation<void, ApiError, UpdateStocktakeCounts>({
    mutationFn: async (payload) => {
      const response = await fetch(`/api/stocktakes/${stocktake.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to save counts.",
          errors: body?.errors,
        } satisfies ApiError;
      }
    },
    onMutate: () => {
      setActionError(null);
      form.clearErrors();
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        setActionError(error.error ?? "Fix the highlighted fields.");
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as never, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setActionError(error.error ?? "Failed to save counts.");
    },
  });

  const completeMutation = useMutation<void, ApiError, boolean>({
    mutationFn: async (confirmStale = false) => {
      const response = await fetch(`/api/stocktakes/${stocktake.id}/complete`, {
        method: "POST",
        headers: createIdempotencyHeaders("stocktake-complete", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ confirmStale }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to complete stocktake.",
          stale: body?.stale,
        } satisfies ApiError;
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        refreshStocktakeQueries(),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setStaleWarning(null);
      router.refresh();
    },
    onError: (error: ApiError) => {
      if (error.status === 409 && error.stale) {
        setStaleWarning(error.stale);
        return;
      }

      setActionError(error.error ?? "Failed to complete stocktake.");
    },
  });

  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setActionError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  const autosaveCounts = form.handleSubmit(async (values) => {
    try {
      const didSave = await saveDirtyCounts(values);
      if (didSave) router.refresh();
    } catch {
      return;
    }
  }, handleInvalidSubmit);

  const handleComplete = form.handleSubmit(
    async (values) => {
      try {
        if (form.formState.isDirty) {
          await saveDirtyCounts(values);
        }

        await completeMutation.mutateAsync(false);
      } catch {
        return;
      }
    },
    handleInvalidSubmit
  );

  const cancelMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      const response = await fetch(`/api/stocktakes/${stocktake.id}/cancel`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to cancel stocktake.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await refreshStocktakeQueries();
      setCancelOpen(false);
      router.refresh();
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const cloneMutation = useMutation<{ id: string }, Error, void>({
    mutationFn: async () => {
      const response = await fetch(`/api/stocktakes/${stocktake.id}/clone`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to clone stocktake.");
      }
      return body as { id: string };
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (result) => {
      await refreshStocktakeQueries();
      router.push(`/inventory/stocktakes/${result.id}`);
    },
    onError: (error) => {
      setActionError(error.message);
    },
  });

  const displayLines = useMemo(() => {
    const lotLineIndexById = new Map(
      stocktake.lines
        .flatMap((line) => line.lots)
        .map((lotLine, index) => [lotLine.id, index])
    );

    return stocktake.lines.map((line, index) => {
      const watchedLine = watchedLines?.[index];
      const lotLines = line.lots.map((lotLine) => {
        const lotFormIndex = lotLineIndexById.get(lotLine.id) ?? 0;
        const watchedLotLine = watchedLotLines?.[lotFormIndex];
        const currentCountedQty = normalizeCountedQtyInput(
          watchedLotLine?.countedQty
        );
        const currentVarianceQty =
          currentCountedQty == null
            ? null
            : normalizeNumeric(
                Number(currentCountedQty) - parseFloat(lotLine.expectedQty)
              );

        return {
          ...lotLine,
          formIndex: lotFormIndex,
          currentCountedQty,
          currentVarianceQty,
        };
      });
      const currentCountedQty =
        lotLines.length > 0
          ? lotLines.some((lotLine) => lotLine.currentCountedQty != null)
            ? normalizeNumeric(
                lotLines.reduce(
                  (sum, lotLine) => sum + Number(lotLine.currentCountedQty ?? 0),
                  0
                )
              )
            : line.countedQty
          : normalizeCountedQtyInput(watchedLine?.countedQty);
      const currentVarianceQty =
        currentCountedQty == null
          ? null
          : normalizeNumeric(
              Number(currentCountedQty) - parseFloat(line.expectedQty)
            );

      return {
        ...line,
        formIndex: index,
        currentCountedQty,
        currentVarianceQty,
        lots: lotLines,
      };
    });
  }, [stocktake.lines, watchedLines, watchedLotLines]);

  const filteredLines = displayLines.filter((line) => {
    if (countFilter === "counted") {
      return line.currentCountedQty != null;
    }

    if (countFilter === "uncounted") {
      return line.currentCountedQty == null;
    }

    if (countFilter === "variance") {
      return (
        line.currentVarianceQty != null && parseFloat(line.currentVarianceQty) !== 0
      );
    }

    return true;
  });

  const savedCountedCount = stocktake.lines.filter(
    (line) => line.countedQty != null
  ).length;
  const liveCountedCount = displayLines.filter(
    (line) => line.currentCountedQty != null
  ).length;
  const linesError = getFieldArrayError(form.formState.errors.lines);
  const canEditCounts = stocktake.status === "draft";
  const canComplete =
    canEditCounts &&
    liveCountedCount > 0 &&
    !completeMutation.isPending;

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/inventory/stocktakes"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to
              {" "}Stocktakes
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {stocktake.name}
              </h1>
              <StocktakeStatusBadge status={stocktake.status} />
            </div>
          </div>

          {(canEditCounts || canViewLedger) && (
            <DetailPageActions
              menu={[
                ...(canViewLedger
                  ? [
                      {
                        label: "View inventory activity",
                        onSelect: () =>
                          router.push(
                            buildInventoryLedgerHref({
                              documentType: "stocktake",
                              documentId: stocktake.id,
                            })
                          ),
                      },
                    ]
                  : []),
                ...(canEditCounts
                  ? [
                      {
                        label: "Clone stocktake",
                        onSelect: () => cloneMutation.mutate(),
                        disabled: cloneMutation.isPending,
                      },
                      {
                        label: "Cancel stocktake",
                        onSelect: () => setCancelOpen(true),
                        disabled: cancelMutation.isPending,
                        destructive: true,
                      },
                    ]
                  : []),
              ]}
            >
              {canEditCounts ? (
                <>
                  <Button
                    size="sm"
                    onClick={handleComplete}
                    disabled={!canComplete}
                  >
                    {completeMutation.isPending ? "Completing..." : "Complete"}
                  </Button>
                </>
              ) : null}
            </DetailPageActions>
          )}
        </div>

        <Separator />

        {stocktake.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{stocktake.notes}</p>
        )}

        {actionError && <FieldError>{actionError}</FieldError>}
        {linesError && <FieldError>{linesError}</FieldError>}

        {canEditCounts && liveCountedCount === 0 && (
          <p className="text-sm text-muted-foreground">
            Enter at least one available count before completing this stocktake.
          </p>
        )}

        {canEditCounts && liveCountedCount > 0 && form.formState.isDirty && (
          <p className="text-sm text-muted-foreground">
            Completing will save your pending count changes first.
          </p>
        )}

        <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Scope" tooltip={STOCKTAKE_SCOPE_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">{formatScope(stocktake.scope)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Status</dt>
            <dd className="mt-1 text-sm">
              <StocktakeStatusBadge status={stocktake.status} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Items" tooltip={STOCKTAKE_ITEM_COUNT_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">{stocktake.lines.length}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Available Count" tooltip={STOCKTAKE_COUNTED_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">
              {canEditCounts ? liveCountedCount : savedCountedCount} / {stocktake.lines.length}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm">{formatDateTime(stocktake.createdAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm">{formatDateTime(stocktake.updatedAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Completed</dt>
            <dd className="mt-1 text-sm">{formatDateTime(stocktake.completedAt, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Cancelled</dt>
            <dd className="mt-1 text-sm">{formatDateTime(stocktake.cancelledAt, timeZone)}</dd>
          </div>
        </dl>

        <Separator />

        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">Available Counts</h2>
              <p className="text-sm text-muted-foreground">
                Count available stock only. Blocked and rejected stock stay managed
                from lot disposition actions.
              </p>
            </div>

            <ToggleGroup
              type="single"
              value={countFilter}
              onValueChange={(value) => {
                if (value) {
                  setCountFilter(value as CountFilter);
                }
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="counted">Counted</ToggleGroupItem>
              <ToggleGroupItem value="uncounted">Uncounted</ToggleGroupItem>
              <ToggleGroupItem value="variance">Variance Only</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>
                    <TooltipHeader label="Type" tooltip={ITEM_TYPE_TOOLTIP} />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader label="Unit" tooltip={UNIT_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Available Snapshot" tooltip={STOCKTAKE_SNAPSHOT_QTY_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Available Count" tooltip={STOCKTAKE_COUNT_QTY_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Available Variance" tooltip={STOCKTAKE_LINE_VARIANCE_TOOLTIP} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLines.length > 0 ? (
                  filteredLines.map((line) => (
                    <Fragment key={line.id}>
                      <TableRow key={line.id}>
                        <TableCell>
                          <Link
                            href={itemDetailHref(line.itemType, line.itemId)}
                            className="block space-y-0.5 hover:underline"
                          >
                            <div>{line.itemName}</div>
                            {line.itemSku && (
                              <div className="text-xs text-muted-foreground">
                                {line.itemSku}
                              </div>
                            )}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{line.itemType}</Badge>
                        </TableCell>
                        <TableCell>{line.unitName}</TableCell>
                        <TableCell className="text-right">
                          {formatQuantity(line.expectedQty)}
                        </TableCell>
                        <TableCell className="text-right">
                          {line.lots.length > 0 ? (
                            formatQuantity(line.currentCountedQty)
                          ) : canEditCounts ? (
                            <Controller
                              name={`lines.${line.formIndex}.countedQty`}
                              control={form.control}
                              render={({ field, fieldState }) => (
                                <div className="ml-auto max-w-32">
                                  <Input
                                    {...field}
                                    value={field.value ?? ""}
                                    aria-invalid={fieldState.invalid}
                                    inputMode="decimal"
                                    placeholder="Leave blank"
                                    className="text-right"
                                    onBlur={(event) => {
                                      field.onBlur();
                                      autosaveCounts(event);
                                    }}
                                  />
                                  {fieldState.invalid && (
                                    <FieldError className="mt-1" errors={[fieldState.error]} />
                                  )}
                                </div>
                              )}
                            />
                          ) : (
                            formatQuantity(line.countedQty)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatQuantity(
                            canEditCounts ? line.currentVarianceQty : line.varianceQty
                          )}
                        </TableCell>
                      </TableRow>
                      {line.lots.map((lotLine) => (
                        <TableRow key={lotLine.id} className="bg-muted/30">
                          <TableCell className="pl-8 font-mono text-xs">
                            {lotLine.lotNumber}
                          </TableCell>
                          <TableCell />
                          <TableCell>{line.unitName}</TableCell>
                          <TableCell className="text-right">
                            {formatQuantity(lotLine.expectedQty)}
                          </TableCell>
                          <TableCell className="text-right">
                            {canEditCounts ? (
                              <Controller
                                name={`lotLines.${lotLine.formIndex}.countedQty`}
                                control={form.control}
                                render={({ field, fieldState }) => (
                                  <div className="ml-auto max-w-32">
                                    <Input
                                      {...field}
                                      value={field.value ?? ""}
                                      aria-invalid={fieldState.invalid}
                                      inputMode="decimal"
                                      placeholder="Leave blank"
                                      className="text-right"
                                      onBlur={(event) => {
                                        field.onBlur();
                                        autosaveCounts(event);
                                      }}
                                    />
                                    {fieldState.invalid && (
                                      <FieldError className="mt-1" errors={[fieldState.error]} />
                                    )}
                                  </div>
                                )}
                              />
                            ) : (
                              formatQuantity(lotLine.countedQty)
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatQuantity(
                              canEditCounts
                                ? lotLine.currentVarianceQty
                                : lotLine.varianceQty
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No lines match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this stocktake?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelling keeps the snapshot for history but does not change inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                cancelMutation.mutate();
              }}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Stocktake"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={staleWarning != null}
        onOpenChange={(open) => {
          if (!open) {
            setStaleWarning(null);
          }
        }}
      >
        <DialogContent
          size="3xl"
          className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
        >
          <DialogHeader>
            <DialogTitle>Complete with changed stock?</DialogTitle>
            <DialogDescription>
              Some live available stock changed after this stocktake was created.
              Completing now will adjust from current available stock to the saved
              counted totals.
            </DialogDescription>
          </DialogHeader>

          {staleWarning && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Available Snapshot" tooltip={STOCKTAKE_SNAPSHOT_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Available Current" tooltip={STOCKTAKE_CURRENT_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Available Count" tooltip={STOCKTAKE_COUNT_QTY_TOOLTIP} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staleWarning.items.map((item) => (
                    <TableRow key={item.lineId}>
                      <TableCell>{item.itemName}</TableCell>
                      <TableCell className="text-right">
                        <QuantityWithUnit
                          value={item.expectedQty}
                          unitName={item.unitName}
                          className="justify-end"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <QuantityWithUnit
                          value={item.currentQty}
                          unitName={item.unitName}
                          className="justify-end"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <QuantityWithUnit
                          value={item.countedQty}
                          unitName={item.unitName}
                          className="justify-end"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setStaleWarning(null)}>
              Back
            </Button>
            <Button
              onClick={() => completeMutation.mutate(true)}
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending
                ? "Completing..."
                : "Complete With Live Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
