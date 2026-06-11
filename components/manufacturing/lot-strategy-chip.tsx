"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { patchManufacturingOrderIngredient } from "@/lib/api/clients/manufacturing-orders";
import type { ManufacturingLotStrategy } from "@/lib/schemas/manufacturing-orders";
import { queryKeys } from "@/lib/client/query-keys";

const STRATEGY_LABEL: Record<ManufacturingLotStrategy, string> = {
  fifo: "FIFO",
  lifo: "LIFO",
  custom: "CUSTOM",
};

const STRATEGY_TONE: Record<ManufacturingLotStrategy, string> = {
  fifo: "text-[var(--color-accent-ink)] bg-[var(--color-accent-soft)]",
  lifo: "text-[color-mix(in_oklch,var(--color-info),var(--color-ink)_38%)] bg-[var(--color-info-soft)]",
  custom: "text-[var(--status-warning-ink)] bg-[var(--color-warning-soft)]",
};

const STRATEGIES: ManufacturingLotStrategy[] = ["fifo", "lifo", "custom"];

export type PickedLotSummary = {
  count: number;
  /** first lot id or shorthand like "LOT-2026-05-15" */
  firstLot: string | null;
  /** inventory item lots tab for the first lot */
  firstLotHref?: string | null;
  /** sum of allocated qty */
  totalQty: string | null;
};

/**
 * Per-ingredient lot allocation control. FIFO/LIFO reallocate automatically;
 * Custom opens the shared allocation picker.
 */
export function LotStrategyChip({
  orderId,
  ingredientId,
  strategy,
  summary,
  onOpenPicker,
  onChanged,
}: {
  orderId: string;
  ingredientId: string;
  strategy: ManufacturingLotStrategy;
  summary: PickedLotSummary;
  onOpenPicker: () => void;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["mo-action", orderId, "ingredient", ingredientId, "strategy"],
    mutationFn: (next: ManufacturingLotStrategy) =>
      patchManufacturingOrderIngredient(orderId, ingredientId, {
        lotStrategy: next,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.manufacturingOrders.detail(orderId) });
      onChanged?.();
    },
  });

  const selectStrategy = (next: ManufacturingLotStrategy) => {
    if (next === strategy) {
      if (next === "custom") onOpenPicker();
      return;
    }
    mutation.mutate(next, {
      onSuccess: () => {
        if (next === "custom") onOpenPicker();
      },
    });
  };

  const lotText =
    summary.count === 0
      ? "— no allocation"
      : summary.count === 1
        ? `${summary.firstLot ?? ""}${summary.totalQty ? ` (${summary.totalQty})` : ""}`
        : `${summary.firstLot ?? ""} +${summary.count - 1} more`;
  const canOpenPicker = strategy === "custom";
  const lotClassName = cn(
    "inline-flex items-center gap-(--space-2) border-l border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-3)",
    "text-[length:var(--text-label)] text-[var(--color-ink)]",
    summary.count === 0 && "text-[var(--color-ink-faint)]",
    canOpenPicker
      ? "hover:bg-[var(--color-surface-alt)]"
      : summary.firstLotHref
        ? "hover:text-[var(--color-accent-ink)] hover:underline"
        : "cursor-default",
  );

  return (
    <div className="inline-flex h-(--space-10) items-stretch overflow-hidden rounded-(--radius-sm) border border-[var(--color-line)]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Lot strategy ${STRATEGY_LABEL[strategy]}`}
            className={cn(
              "inline-flex items-center gap-(--space-1) px-(--space-3) font-mono text-[length:var(--text-3xs)] font-semibold tracking-[0.07em] uppercase",
              STRATEGY_TONE[strategy],
            )}
          >
            {STRATEGY_LABEL[strategy]}
            <HugeiconsIcon icon={ArrowDown01Icon} size={11} aria-hidden />
          </button>
        </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-28 p-(--space-1)">
          {STRATEGIES.map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={(event) => {
                event.preventDefault();
                selectStrategy(option);
              }}
              className="h-(--height-input-sm) rounded-(--radius-sm) px-(--space-3) font-mono text-[length:var(--text-2xs)]"
            >
              {STRATEGY_LABEL[option]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {canOpenPicker ? (
        <button
          type="button"
          onClick={onOpenPicker}
          className={lotClassName}
        >
          <span className="font-mono">{lotText}</span>
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={12}
            aria-hidden
            className="text-[var(--color-accent-ink)]"
          />
        </button>
      ) : summary.firstLotHref ? (
        <Link href={summary.firstLotHref} className={lotClassName}>
          <span className="font-mono">{lotText}</span>
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={12}
            aria-hidden
            className="text-[var(--color-accent-ink)]"
          />
        </Link>
      ) : (
        <span className={lotClassName}>
          <span className="font-mono">{lotText}</span>
        </span>
      )}
    </div>
  );
}
