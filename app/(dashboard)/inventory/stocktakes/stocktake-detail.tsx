"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
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
import { formatDateTime, formatQuantity, getFieldArrayError, normalizeNumeric } from "@/lib/format";
import { updateStocktakeCountsSchema } from "@/lib/schemas/stocktakes";
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

export function StocktakeDetail({
  stocktake,
}: {
  stocktake: StocktakeDetailType;
}) {
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
    },
  });

  useEffect(() => {
    form.reset({
      lines: stocktake.lines.map((line) => ({
        lineId: line.id,
        countedQty: line.countedQty,
      })),
    });
  }, [form, stocktake.lines]);

  const watchedLines = useWatch({
    control: form.control,
    name: "lines",
  });

  const refreshStocktakeQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
  };

  const saveMutation = useMutation<void, ApiError, CountFormValues>({
    mutationFn: async (values) => {
      const response = await fetch(`/api/stocktakes/${stocktake.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
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
    onSuccess: async () => {
      await refreshStocktakeQueries();
      router.refresh();
    },
    onError: (error: ApiError) => {
      if (error.errors) {
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
        headers: { "Content-Type": "application/json" },
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

  const displayLines = useMemo(() => {
    return stocktake.lines.map((line, index) => {
      const watchedLine = watchedLines?.[index];
      const currentCountedQty =
        watchedLine?.countedQty == null || watchedLine.countedQty === ""
          ? null
          : watchedLine.countedQty;
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
      };
    });
  }, [stocktake.lines, watchedLines]);

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
    !form.formState.isDirty &&
    savedCountedCount > 0 &&
    !completeMutation.isPending &&
    !saveMutation.isPending;

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

          {canEditCounts && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={form.handleSubmit((values) => saveMutation.mutate(values))}
                disabled={!form.formState.isDirty || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : "Save Counts"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => completeMutation.mutate(false)}
                disabled={!canComplete}
              >
                {completeMutation.isPending ? "Completing..." : "Complete"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCancelOpen(true)}
                disabled={cancelMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {stocktake.notes && (
          <p className="max-w-2xl text-sm text-muted-foreground">{stocktake.notes}</p>
        )}

        {actionError && <FieldError>{actionError}</FieldError>}
        {linesError && <FieldError>{linesError}</FieldError>}

        {canEditCounts && form.formState.isDirty && (
          <p className="text-sm text-muted-foreground">
            Save counts before completing this stocktake.
          </p>
        )}

        {canEditCounts && !form.formState.isDirty && savedCountedCount === 0 && (
          <p className="text-sm text-muted-foreground">
            Save at least one counted quantity before completing this stocktake.
          </p>
        )}

        <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Scope</dt>
            <dd className="mt-1 text-sm">{formatScope(stocktake.scope)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Status</dt>
            <dd className="mt-1 text-sm">
              <StocktakeStatusBadge status={stocktake.status} />
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Items</dt>
            <dd className="mt-1 text-sm">{stocktake.lines.length}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Counted</dt>
            <dd className="mt-1 text-sm">
              {canEditCounts ? liveCountedCount : savedCountedCount} / {stocktake.lines.length}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="mt-1 text-sm">{formatDateTime(stocktake.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Updated</dt>
            <dd className="mt-1 text-sm">{formatDateTime(stocktake.updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Completed</dt>
            <dd className="mt-1 text-sm">{formatDateTime(stocktake.completedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Cancelled</dt>
            <dd className="mt-1 text-sm">{formatDateTime(stocktake.cancelledAt)}</dd>
          </div>
        </dl>

        <Separator />

        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">Counts</h2>
              <p className="text-sm text-muted-foreground">
                Expected quantities are the snapshot taken when this stocktake was
                created.
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
                  <TableHead>Type</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLines.length > 0 ? (
                  filteredLines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div>{line.itemName}</div>
                          {line.itemSku && (
                            <div className="text-xs text-muted-foreground">
                              {line.itemSku}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{line.itemType}</Badge>
                      </TableCell>
                      <TableCell>{line.unitName}</TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(line.expectedQty)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEditCounts ? (
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
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Complete with changed stock?</DialogTitle>
            <DialogDescription>
              Some live stock changed after this stocktake was created. Completing now
              will adjust from current live stock to the saved counted totals.
            </DialogDescription>
          </DialogHeader>

          {staleWarning && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Snapshot</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staleWarning.items.map((item) => (
                    <TableRow key={item.lineId}>
                      <TableCell>{item.itemName}</TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(item.expectedQty)} {item.unitName}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(item.currentQty)} {item.unitName}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatQuantity(item.countedQty)} {item.unitName}
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
