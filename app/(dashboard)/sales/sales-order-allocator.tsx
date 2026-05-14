"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { TooltipHeader } from "@/components/tooltip-header";
import { apiJson } from "@/lib/client/api";
import { formatDate, formatQuantity } from "@/lib/format";
import {
  ALLOCATION_ALLOCATE_TOOLTIP,
  ALLOCATION_AVAILABLE_TOOLTIP,
  ALLOCATION_CURRENT_TOOLTIP,
  ALLOCATION_SOURCE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { cn } from "@/lib/utils";
import type {
  AllocationSourceRow,
  AllocationSourceType,
  AllocationWorkspace,
} from "@/lib/inventory/allocation/types";
import type { SalesOrderListLine, SalesOrderListRow } from "./types";

export const ALLOCATOR_PREFERENCE_ENDPOINT =
  "/api/preferences/sales-orders-allocator";

export type AllocatorPreference = {
  hiddenProductIds: string[];
};

export type AllocatorProduct = {
  itemId: string;
  label: string;
  familyLabel: string;
  variantLabel: string;
  sku: string | null;
  unitName: string;
};

export type AllocationTarget = {
  order: SalesOrderListRow;
  line: SalesOrderListLine & { id: string };
  product: AllocatorProduct;
  targetQty: string;
};

type SourceDraft = Record<string, string>;

function parseQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function isAllocationDraft(value: string) {
  return value === "" || /^\d*\.?\d{0,4}$/.test(value);
}

function formatSourceDate(source: AllocationSourceRow) {
  if (source.date == null) return null;

  const date = source.date.includes("T") ? source.date.slice(0, 10) : source.date;
  const label = source.sourceType === "inventory_lot" ? "Received" : "Planned";
  return `${label} ${formatDate(date)}`;
}

export function productLabel(line: SalesOrderListLine) {
  return line.attrs.length > 0
    ? `${line.masterName} ${line.attrs.join(" ")}`
    : line.masterName;
}

function sourceInputKey(source: Pick<AllocationSourceRow, "sourceType" | "sourceId">) {
  return `${source.sourceType}:${source.sourceId}`;
}

function sourceTypeLabel(sourceType: AllocationSourceType) {
  if (sourceType === "inventory_lot") return "Lots";
  return "Manufacturing orders";
}

export function getLineRemainingQty(line: SalesOrderListLine) {
  return line.remainingQty ?? line.quantity;
}

export function getLineAllocatedQty(line: SalesOrderListLine) {
  return line.allocatedQty ?? "0";
}

function getAllocationTone(line: SalesOrderListLine) {
  const remaining = parseQuantity(getLineRemainingQty(line));
  const allocated = parseQuantity(getLineAllocatedQty(line));
  const short = parseQuantity(line.shortQty);

  if (remaining <= 0) return "success";
  if (short <= 0) return "success";
  if (allocated > 0) return "warning";
  return "destructive";
}

function getAllocationCellClass(line: SalesOrderListLine) {
  const tone = getAllocationTone(line);
  if (tone === "success") return "bg-success/10 text-success";
  if (tone === "warning") return "bg-warning/10 text-warning";
  return "bg-destructive/10 text-destructive";
}

function groupSources(sources: AllocationSourceRow[]) {
  return [
    {
      sourceType: "inventory_lot" as const,
      label: sourceTypeLabel("inventory_lot"),
      sources: sources.filter((source) => source.sourceType === "inventory_lot"),
    },
    {
      sourceType: "manufacturing_order" as const,
      label: sourceTypeLabel("manufacturing_order"),
      sources: sources.filter(
        (source) => source.sourceType === "manufacturing_order"
      ),
    },
  ];
}

export function AllocatorCell({
  line,
  label,
  onCommit,
}: {
  line: SalesOrderListLine & { id: string };
  label?: string;
  onCommit: (targetQty: string) => void;
}) {
  const allocatedQty = getLineAllocatedQty(line);
  const remainingQty = getLineRemainingQty(line);
  const [value, setValue] = useState(allocatedQty);
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const next = value.trim();
    const parsed = next === "" || next === "." ? 0 : Number(next);
    const remaining = parseQuantity(remainingQty);

    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter zero or a positive quantity.");
      return;
    }

    if (parsed > remaining) {
      setError(`Cannot allocate more than ${formatQuantity(remainingQty)}.`);
      return;
    }

    const normalized = quantityString(parsed);
    setValue(normalized);
    setError(null);

    if (normalized !== quantityString(parseQuantity(allocatedQty))) {
      onCommit(normalized);
    }
  }

  return (
    <div className="flex min-h-12 flex-col">
      <div
        className={cn(
          "flex min-h-12 w-full min-w-16 flex-col justify-center px-1.5 text-sm tabular-nums",
          getAllocationCellClass(line)
        )}
      >
        {label ? (
          <span className="min-w-0 truncate text-xs font-medium text-foreground">
            {label}
          </span>
        ) : null}
        <div className="grid grid-cols-[2rem_auto_2.75rem] items-center justify-end">
          <Input
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value.trim();
              if (isAllocationDraft(nextValue)) {
                setValue(nextValue);
                setError(null);
              }
            }}
            onBlur={commit}
            onFocus={(event) => event.currentTarget.select()}
            onMouseUp={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            inputMode="decimal"
            aria-label={`Allocated ${label ?? line.masterName}`}
            className="h-8 min-w-0 border-0 bg-transparent px-0 text-right shadow-none focus-visible:ring-0"
          />
          <span className="px-0.5 text-muted-foreground">/</span>
          <span className="min-w-0 text-right">{formatQuantity(remainingQty)}</span>
        </div>
      </div>
      {error ? (
        <p className="px-1 py-0.5 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

export function AllocationSourceDialog({
  target,
  onOpenChange,
}: {
  target: AllocationTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const workspaceQuery = useQuery({
    queryKey: [
      "allocation-workspace",
      target?.line.id ?? null,
      target?.line.itemId ?? null,
    ],
    enabled: target != null,
    queryFn: () => {
      if (!target) {
        throw new Error("Allocation target missing.");
      }
      const params = new URLSearchParams({
        demandType: "sales_order_line",
        demandId: target.line.id,
        itemId: target.line.itemId,
      });
      return apiJson<AllocationWorkspace>(`/api/allocation/workspace?${params}`, {
        fallbackError: "Failed to load allocation sources.",
      });
    },
  });

  const workspace = workspaceQuery.data;

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent size="3xl" className="max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Allocate {target?.product.label}</DialogTitle>
          <DialogDescription>
            {target
              ? `${target.order.customerName} · ${target.order.orderNumber}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {workspaceQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Spinner className="text-foreground" />
          </div>
        ) : workspaceQuery.error ? (
          <p className="text-sm text-destructive">
            {workspaceQuery.error instanceof Error
              ? workspaceQuery.error.message
              : "Failed to load allocation sources."}
          </p>
        ) : (
          target &&
          workspace && (
            <AllocationSourceEditor
              key={`${target.line.id}:${target.targetQty}:${workspace.assignments
                .map((assignment) => `${sourceInputKey(assignment)}:${assignment.quantity}`)
                .join("|")}`}
              target={target}
              workspace={workspace}
              onSaved={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function buildInitialDraft(targetQty: number, workspace: AllocationWorkspace) {
  let remaining = targetQty;
  const nextDraft: SourceDraft = {};

  for (const assignment of workspace.primaryDemand?.assignments ?? []) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, parseQuantity(assignment.quantity));
    if (qty <= 0) continue;
    nextDraft[sourceInputKey(assignment)] = quantityString(qty);
    remaining -= qty;
  }

  return nextDraft;
}

function AllocationSourceEditor({
  target,
  workspace,
  onSaved,
  onCancel,
}: {
  target: AllocationTarget;
  workspace: AllocationWorkspace;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const targetQty = parseQuantity(target.targetQty);
  const [draft, setDraft] = useState(() => buildInitialDraft(targetQty, workspace));
  const [formError, setFormError] = useState<string | null>(null);
  const sourceGroups = groupSources(workspace.sources);
  const selectedTotal = Object.values(draft).reduce(
    (sum, value) => sum + parseQuantity(value),
    0
  );
  const remainingToAssign = targetQty - selectedTotal;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const total = Object.values(draft).reduce(
        (sum, value) => sum + parseQuantity(value),
        0
      );
      if (Math.abs(total - targetQty) > 0.0001) {
        throw new Error("Source quantities must match the target allocation.");
      }

      await apiJson<AllocationWorkspace>("/api/allocation/save", {
        method: "POST",
        body: {
          demandType: "sales_order_line",
          demandId: target.line.id,
          itemId: target.line.itemId,
          allocations: Object.entries(draft)
            .map(([key, value]) => {
              const [sourceType, sourceId] = key.split(":") as [
                AllocationSourceType,
                string,
              ];
              return {
                sourceType,
                sourceId,
                quantity: quantityString(parseQuantity(value)),
              };
            })
            .filter((allocation) => parseQuantity(allocation.quantity) > 0),
        },
        fallbackError: "Failed to save allocation.",
      });
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
        queryClient.invalidateQueries({ queryKey: ["allocation-workspace"] }),
      ]);
      onSaved();
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Failed to save allocation."
      );
    },
  });

  function updateSource(source: AllocationSourceRow, value: string) {
    if (!isAllocationDraft(value.trim())) return;

    const key = sourceInputKey(source);
    setDraft((current) => {
      const next = { ...current };
      const parsed = Number(value);
      if (value.trim() === "" || !Number.isFinite(parsed) || parsed <= 0) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  return (
    <>
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Demand</div>
            <div className="font-medium">
              {formatQuantity(target.line.remainingQty ?? "0")} {target.line.unitName}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Target</div>
            <div className="font-medium">
              {formatQuantity(target.targetQty)} {target.line.unitName}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Remaining</div>
            <div
              className={cn(
                "font-medium",
                Math.abs(remainingToAssign) > 0.0001 && "text-destructive"
              )}
            >
              {formatQuantity(quantityString(remainingToAssign))} {target.line.unitName}
            </div>
          </div>
        </div>

        {sourceGroups.map((group) => (
          <div key={group.sourceType} className="space-y-2">
            <h3 className="text-sm font-medium">{group.label}</h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <TooltipHeader
                        label="Source"
                        tooltip={ALLOCATION_SOURCE_TOOLTIP}
                      />
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex justify-end">
                        <TooltipHeader
                          label="Available"
                          tooltip={ALLOCATION_AVAILABLE_TOOLTIP}
                        />
                      </div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div className="flex justify-end">
                        <TooltipHeader
                          label="Current"
                          tooltip={ALLOCATION_CURRENT_TOOLTIP}
                        />
                      </div>
                    </TableHead>
                    <TableHead className="w-32 text-right">
                      <div className="flex justify-end">
                        <TooltipHeader
                          label="Allocate"
                          tooltip={ALLOCATION_ALLOCATE_TOOLTIP}
                        />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.sources.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-16 text-center text-muted-foreground"
                      >
                        No sources.
                      </TableCell>
                    </TableRow>
                  ) : (
                    group.sources.map((source) => {
                      const key = sourceInputKey(source);
                      const sourceDate = formatSourceDate(source);
                      return (
                        <TableRow key={key}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{source.label}</span>
                              {sourceDate ? (
                                <span className="text-xs text-muted-foreground">
                                  {sourceDate}
                                </span>
                              ) : null}
                              {source.contextLabel ? (
                                <span className="text-xs text-muted-foreground">
                                  {source.contextLabel}
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatQuantity(source.maxQtyForPrimaryDemand)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatQuantity(source.currentPrimaryQty)}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={draft[key] ?? ""}
                              onChange={(event) =>
                                updateSource(source, event.target.value.trim())
                              }
                              onFocus={(event) => event.currentTarget.select()}
                              onMouseUp={(event) => event.preventDefault()}
                              inputMode="decimal"
                              aria-label={`Allocate from ${source.label}`}
                              className="text-right"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}

        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={saveMutation.isPending || Math.abs(remainingToAssign) > 0.0001}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving..." : "Save allocation"}
        </Button>
      </DialogFooter>
    </>
  );
}
