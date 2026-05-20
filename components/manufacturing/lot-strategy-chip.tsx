"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { patchManufacturingOrderIngredient } from "@/lib/api/clients/manufacturing-orders";
import type { ManufacturingLotStrategy } from "@/lib/schemas/manufacturing-orders";

const STRATEGY_LABEL: Record<ManufacturingLotStrategy, string> = {
  fifo: "FIFO",
  custom: "CUSTOM",
};

const STRATEGY_TONE: Record<ManufacturingLotStrategy, string> = {
  fifo: "text-[var(--color-accent)] bg-[var(--color-accent-soft)]",
  custom: "text-[var(--color-warning)] bg-[var(--color-warning-soft)]",
};

const NEXT_STRATEGY: Record<ManufacturingLotStrategy, ManufacturingLotStrategy> = {
  fifo: "custom",
  custom: "fifo",
};

export type PickedLotSummary = {
  count: number;
  /** first lot id or shorthand like "LOT-2026-05-15" */
  firstLot: string | null;
  /** sum of allocated qty */
  totalQty: string | null;
};

/**
 * Per-ingredient lot allocation control: a strategy chip (FIFO /
 * CUSTOM) plus an inline picked-lot summary. Click the strategy segment to
 * cycle FIFO → CUSTOM; CUSTOM (or clicking the summary) opens the
 * existing lot picker.
 */
export function LotStrategyChip({
  orderId,
  ingredientId,
  strategy,
  summary,
  onOpenPicker,
}: {
  orderId: string;
  ingredientId: string;
  strategy: ManufacturingLotStrategy;
  summary: PickedLotSummary;
  onOpenPicker: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["mo", orderId, "ingredient", ingredientId, "strategy"],
    mutationFn: (next: ManufacturingLotStrategy) =>
      patchManufacturingOrderIngredient(orderId, ingredientId, {
        lotStrategy: next,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-order", orderId] });
    },
  });

  const cycleStrategy = () => {
    const next = NEXT_STRATEGY[strategy];
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

  return (
    <div className="inline-flex h-6 items-stretch border border-[var(--color-line)]">
      <button
        type="button"
        onClick={cycleStrategy}
        disabled={mutation.isPending}
        aria-label={`Lot strategy ${STRATEGY_LABEL[strategy]} (click to cycle)`}
        className={cn(
          "inline-flex items-center px-2 font-mono text-[10px] font-semibold tracking-[0.04em] uppercase",
          STRATEGY_TONE[strategy],
        )}
      >
        {STRATEGY_LABEL[strategy]}
      </button>
      <button
        type="button"
        onClick={onOpenPicker}
        className={cn(
          "inline-flex items-center gap-1.5 border-l border-[var(--color-line)] bg-[var(--color-surface)] px-2",
          "text-[11.5px] text-[var(--color-ink)]",
          summary.count === 0 && "text-[var(--color-muted)]",
          "hover:bg-[var(--color-surface-alt)]",
        )}
      >
        <span className="font-mono">{lotText}</span>
        <HugeiconsIcon
          icon={ArrowUpRight01Icon}
          size={12}
          aria-hidden
          className="text-[var(--color-accent)]"
        />
      </button>
    </div>
  );
}
