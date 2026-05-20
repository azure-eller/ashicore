"use client";

import Link from "next/link";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { apiJson } from "@/lib/client/api";
import { formatDate, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesOrdersAllocatorPreference } from "@/lib/view-preferences";
import styles from "./sales-order-allocator.module.css";
import { demandKey } from "@/lib/inventory/allocation/types";
import type {
  AllocationAssignment,
  AllocationSourceClaim,
  AllocationSourceRow,
  AllocationSourceType,
  AllocationWorkspace,
} from "@/lib/inventory/allocation/types";
import type { SalesOrderListLine, SalesOrderListRow } from "./types";

export const SALES_ORDERS_ALLOCATOR_VIEW_KEY = "sales.orders.allocator";
export const ALLOCATOR_PREFERENCE_ENDPOINT = `/api/preferences/views/${SALES_ORDERS_ALLOCATOR_VIEW_KEY}`;

export type AllocatorPreference = SalesOrdersAllocatorPreference;

export type AllocatorProduct = {
  itemId: string;
  label: string;
  familyLabel: string;
  variantLabel: string;
  sku: string | null;
  unitName: string;
};

export type AllocationTarget = {
  demandType:
    | "sales_order_line"
    | "sales_shipment_line"
    | "manufacturing_order_ingredient";
  demandLabel: string;
  demandContext: string;
  order?: Pick<SalesOrderListRow, "id" | "orderNumber" | "customerName">;
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

function draftSignature(draft: SourceDraft) {
  return Object.entries(draft)
    .filter(([, value]) => parseQuantity(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${quantityString(parseQuantity(value))}`)
    .join("|");
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

function sourceRelativeLabel(source: AllocationSourceRow) {
  if (source.date == null) return null;
  const date = source.date.includes("T") ? source.date.slice(0, 10) : source.date;
  const days = daysFromToday(date);
  if (days == null) return formatSourceDate(source);

  if (source.sourceType === "inventory_lot") {
    if (days === 0) return "Received today";
    if (days === -1) return "Received yesterday";
    if (days < 0) return `Received ${Math.abs(days)}d ago`;
    return `Received ${formatDate(date)}`;
  }

  if (days === 0) return "ETA today";
  if (days > 0) return `ETA in ${days}d`;
  return `ETA ${Math.abs(days)}d late`;
}

function businessDateToUtcDays(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function todayBusinessDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function daysFromToday(value: string) {
  const target = businessDateToUtcDays(value);
  const today = businessDateToUtcDays(todayBusinessDate());
  if (target == null || today == null) return null;
  return target - today;
}

export function productLabel(line: SalesOrderListLine) {
  return line.attrs.length > 0
    ? `${line.masterName} ${line.attrs.join(" ")}`
    : line.masterName;
}

function sourceInputKey(source: Pick<AllocationSourceRow, "sourceType" | "sourceId">) {
  return `${source.sourceType}:${source.sourceId}`;
}

function sourceMetaLabel(source: AllocationSourceRow) {
  const relative = sourceRelativeLabel(source);
  if (source.sourceType === "manufacturing_order") {
    return [source.contextLabel, relative].filter(Boolean).join(" · ");
  }
  return relative;
}

function isPrimaryAssignment(
  assignment: AllocationAssignment | AllocationSourceClaim,
  workspace: AllocationWorkspace
) {
  return (
    workspace.primaryDemand != null &&
    assignment.demandType === workspace.primaryDemand.demandType &&
    assignment.demandId === workspace.primaryDemand.demandId
  );
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
  onSaved,
}: {
  target: AllocationTarget | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const workspaceQuery = useQuery({
    queryKey: [
      "allocation-workspace",
      target?.demandType ?? "sales_order_line",
      target?.line.id ?? null,
      target?.line.itemId ?? null,
    ],
    enabled: target != null,
    queryFn: () => {
      if (!target) {
        throw new Error("Allocation target missing.");
      }
      const params = new URLSearchParams({
        demandType: target.demandType,
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
      <DialogContent size="content" className={styles.sourceDialog}>
        <DialogHeader>
          <DialogTitle>Allocate {target?.product.label}</DialogTitle>
          <DialogDescription>
            {target ? `${target.demandLabel} · ${target.demandContext}` : ""}
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
              onSaved={() => {
                onSaved?.();
                onOpenChange(false);
              }}
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
  const [initialDraft] = useState(() => buildInitialDraft(targetQty, workspace));
  const [draft, setDraft] = useState(initialDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const sources = workspace.sources;
  const selectedTotal = Object.values(draft).reduce(
    (sum, value) => sum + parseQuantity(value),
    0
  );
  const remainingToAssign = targetQty - selectedTotal;
  const progressTone = selectedTotal >= targetQty && targetQty > 0 ? "met" : "neutral";
  const statusTone =
    selectedTotal > targetQty + 0.0001
      ? "over"
      : remainingToAssign > 0.0001
        ? "short"
        : "met";
  const hasChanges = draftSignature(draft) !== draftSignature(initialDraft);

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiJson<{ ok: true }>("/api/allocation/save", {
        method: "POST",
        body: {
          demandType: target.demandType,
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
      }),
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: () => {
      onSaved();
      void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["allocation-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["allocation-pools"] });
      void queryClient.invalidateQueries({
        queryKey: ["allocation-manufacturing-demands"],
      });
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
        const selectedElsewhere = Object.entries(next).reduce(
          (sum, [draftKey, draftValue]) =>
            draftKey === key ? sum : sum + parseQuantity(draftValue),
          0
        );
        const remainingForSource = Math.max(0, targetQty - selectedElsewhere);
        next[key] = quantityString(
          Math.min(
            parsed,
            parseQuantity(source.maxQtyForPrimaryDemand),
            remainingForSource
          )
        );
      }
      return next;
    });
  }

  function autofillFifo() {
    let remaining = targetQty;
    const next: SourceDraft = {};

    for (const source of sources) {
      if (remaining <= 0) break;
      const qty = Math.min(remaining, parseQuantity(source.maxQtyForPrimaryDemand));
      if (qty <= 0) continue;
      next[sourceInputKey(source)] = quantityString(qty);
      remaining -= qty;
    }

    setDraft(next);
  }

  const claimsBySource = (workspace.sourceClaims ?? workspace.assignments).reduce(
    (groups, assignment) => {
      if (isPrimaryAssignment(assignment, workspace)) return groups;
      const bucket = groups.get(sourceInputKey(assignment)) ?? [];
      bucket.push(assignment);
      groups.set(sourceInputKey(assignment), bucket);
      return groups;
    },
    new Map<string, Array<AllocationAssignment | AllocationSourceClaim>>()
  );

  function saveIfAllowed() {
    if (saveMutation.isPending || !hasChanges) return;
    saveMutation.mutate();
  }

  return (
    <>
      <div
        className={styles.modalBody}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (event.target instanceof HTMLInputElement) return;
          event.preventDefault();
          saveIfAllowed();
        }}
      >
        <div className={styles.demandStrip}>
          <div className={styles.demandNeed}>
            <span>Need</span>
            <strong>{formatQuantity(target.line.remainingQty ?? "0")}</strong>
            <span>{target.line.unitName}</span>
            {target.line.pickedQty ? (
              <em>Picked {formatQuantity(target.line.pickedQty)}</em>
            ) : null}
          </div>
          <div className={styles.demandTrack}>
            <span
              className={styles.demandFill}
              data-tone={progressTone}
              style={{
                width: `${targetQty > 0 ? Math.min(100, (selectedTotal / targetQty) * 100) : 0}%`,
              }}
            />
          </div>
          <div className={styles.demandStatus} data-tone={statusTone}>
            <span>Allocated</span>
            <strong>{formatQuantity(quantityString(selectedTotal))}</strong>
            {statusTone === "over" ? (
              <em>+{formatQuantity(quantityString(selectedTotal - targetQty))} over</em>
            ) : remainingToAssign > 0.0001 ? (
              <em>-{formatQuantity(quantityString(remainingToAssign))} short</em>
            ) : (
              <em>✓ complete</em>
            )}
          </div>
        </div>

        <div className={styles.sourcesToolbar}>
          <h3>Sources</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sources.every(
              (source) => parseQuantity(source.maxQtyForPrimaryDemand) <= 0
            )}
            onClick={autofillFifo}
          >
            Auto-fill (FIFO)
          </Button>
        </div>

        <div className={styles.sourcesTable}>
          <div className={styles.sourcesHeader}>
            <span>Source</span>
            <span>On hand</span>
            <span>Claimed by</span>
            <span>Free</span>
            <span>Allocate</span>
          </div>
          <div className={styles.sourcesRows}>
            {sources.length === 0 ? (
              <div className={styles.emptySources}>No sources.</div>
            ) : (
              sources.map((source) => {
                const key = sourceInputKey(source);
                const claims = claimsBySource.get(key) ?? [];
                const free = parseQuantity(source.maxQtyForPrimaryDemand);
                const selectedElsewhere = Object.entries(draft).reduce(
                  (sum, [draftKey, draftValue]) =>
                    draftKey === key ? sum : sum + parseQuantity(draftValue),
                  0
                );
                const maxForSource = Math.max(
                  0,
                  Math.min(free, targetQty - selectedElsewhere)
                );
                const onHand = parseQuantity(source.totalQty);
                const fullyClaimed = onHand > 0 && free <= 0;
                const sourceMeta = sourceMetaLabel(source);

                return (
                  <div
                    key={key}
                    className={styles.sourceRow}
                    data-selected={parseQuantity(draft[key]) > 0}
                  >
                    <div className={styles.sourceCell}>
                      <span
                        className={styles.sourceBadge}
                        data-type={source.sourceType}
                      >
                        {source.sourceType === "inventory_lot" ? "LOT" : "MO"}
                      </span>
                      <div className={styles.sourceIdentity}>
                        <span className={styles.sourceId}>{source.label}</span>
                        {sourceMeta ? (
                          <span className={styles.sourceMeta}>{sourceMeta}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className={styles.onHandCell} data-type={source.sourceType}>
                      <span>{formatQuantity(source.totalQty)}</span>
                      {source.sourceType === "manufacturing_order" ? (
                        <em>incoming</em>
                      ) : null}
                    </div>

                    <div className={styles.claimedCell}>
                      {claims.length === 0 ? (
                        <span className={styles.noClaims}>—</span>
                      ) : (
                        <ul className={styles.claimList} role="list">
                          {claims.map((claim) => {
                            const claimDemandRef =
                              claim.demandType === "sales_order_line" ||
                              claim.demandType === "sales_shipment_line"
                                ? {
                                    demandType: claim.demandType,
                                    demandId: claim.demandId,
                                  }
                                : null;
                            const demand =
                              claimDemandRef != null
                                ? workspace.demands.find(
                                    (row) => demandKey(row) === demandKey(claimDemandRef)
                                  )
                                : null;
                            const due =
                              "requiredDate" in claim && claim.requiredDate
                                ? formatDate(claim.requiredDate)
                                : demand?.requiredDate
                                  ? formatDate(demand.requiredDate)
                                  : null;
                            const customer =
                              "contextLabel" in claim
                                ? claim.contextLabel
                                : demand?.contextLabel ?? null;
                            const orderId =
                              demand?.salesOrderId ??
                              ("salesOrderId" in claim ? claim.salesOrderId : null) ??
                              (claim.demandType === "sales_order_line"
                                ? demand?.parentDemandId ?? null
                                : null);
                            const href =
                              "href" in claim && claim.href
                                ? claim.href
                                : orderId
                                  ? `/sales/orders/${orderId}`
                                  : null;
                            const tooltip = `${formatQuantity(claim.quantity)} reserved for ${claim.demandLabel}${customer ? ` — ${customer}` : ""}${due ? `, due ${due}` : ""}.`;

                            return (
                              <li
                                key={`${claim.demandType}:${claim.demandId}:${claim.sourceType}:${claim.sourceId}`}
                                aria-label={tooltip}
                              >
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={styles.claimChip}>
                                      {formatQuantity(claim.quantity)}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">{tooltip}</TooltipContent>
                                </Tooltip>
                                {href ? (
                                  <Link
                                    href={href}
                                    target="_blank"
                                    className={styles.claimOrder}
                                  >
                                    {claim.demandLabel}
                                  </Link>
                                ) : (
                                  <span className={styles.claimOrder}>
                                    {claim.demandLabel}
                                  </span>
                                )}
                                {customer ? (
                                  <span className={styles.claimCustomer}>
                                    {customer}
                                  </span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    <div className={styles.freeCell} data-claimed={fullyClaimed}>
                      <span>{formatQuantity(source.maxQtyForPrimaryDemand)}</span>
                      {fullyClaimed ? (
                        <em aria-live="polite">fully claimed</em>
                      ) : null}
                    </div>

                    <div className={styles.allocateCell}>
                      <Input
                        type="number"
                        min="0"
                        max={quantityString(maxForSource)}
                        step="any"
                        value={draft[key] ?? ""}
                        placeholder="0"
                        disabled={maxForSource <= 0}
                        onChange={(event) =>
                          updateSource(source, event.target.value.trim())
                        }
                        onFocus={(event) => event.currentTarget.select()}
                        onMouseUp={(event) => event.preventDefault()}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          const inputs = Array.from(
                            event.currentTarget
                              .closest(`.${styles.sourcesRows}`)
                              ?.querySelectorAll<HTMLInputElement>(
                                "input:not(:disabled)"
                              ) ?? []
                          );
                          const index = inputs.indexOf(event.currentTarget);
                          const nextInput = inputs[index + 1];
                          if (nextInput) {
                            nextInput.focus();
                          } else {
                            saveIfAllowed();
                          }
                        }}
                        inputMode="decimal"
                        aria-label={`Allocate quantity for ${source.label}`}
                        className={styles.sourceInput}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      </div>

      <DialogFooter className={styles.sourceFooter}>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <div className={styles.footerHint}>
          Esc to close · ⏎ to save
        </div>
        <Button
          type="button"
          disabled={saveMutation.isPending || !hasChanges}
          onClick={saveIfAllowed}
        >
          {saveMutation.isPending ? "Saving..." : "Save allocation"}
        </Button>
      </DialogFooter>
    </>
  );
}
