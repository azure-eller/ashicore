"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import {
  PRODUCTION_STATUSES,
  PRODUCTION_STATUS_LABELS,
  type ProductionStatus,
} from "@/lib/manufacturing/derive-status";
import { patchManufacturingOrder } from "@/lib/api/clients/manufacturing-orders";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<
  ProductionStatus,
  { square: string; text: string; bg?: string }
> = {
  not_started: { square: "bg-[var(--color-ink-2)]", text: "text-[var(--color-ink-2)]" },
  blocked: {
    square: "bg-[var(--color-danger)]",
    text: "text-[var(--color-danger)]",
    bg: "bg-[var(--color-danger-soft)]",
  },
  in_progress: {
    square: "bg-[var(--color-warning)]",
    text: "text-[var(--color-warning)]",
    bg: "bg-[var(--color-warning-soft)]",
  },
  done: {
    square: "bg-[var(--color-success)]",
    text: "text-[var(--color-success)]",
    bg: "bg-[var(--color-success-soft)]",
  },
};

export function StatusPicker({
  orderId,
  current,
  size = "md",
  onChanged,
}: {
  orderId: string;
  current: ProductionStatus;
  size?: "sm" | "md";
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const tone = STATUS_TONE[current];

  const mutation = useMutation({
    mutationKey: ["mo", orderId, "status"],
    mutationFn: async (next: ProductionStatus) => {
      // Map the 4-state picker back to existing DB columns:
      // - done           → status = "done"
      // - blocked        → isBlocked = true
      // - in_progress    → isBlocked = false (clear it), reopen if was done
      // - not_started    → same as in_progress (display-only difference)
      if (next === "done") {
        return patchManufacturingOrder(orderId, { status: "done" });
      }
      if (next === "blocked") {
        if (current === "done") {
          return patchManufacturingOrder(orderId, {
            status: "open",
            isBlocked: true,
          });
        }
        return patchManufacturingOrder(orderId, { isBlocked: true });
      }
      // in_progress or not_started → clear blocked + reopen if needed
      if (current === "done") {
        return patchManufacturingOrder(orderId, {
          status: "open",
          isBlocked: false,
        });
      }
      return patchManufacturingOrder(orderId, { isBlocked: false });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-order", orderId] });
      onChanged?.();
    },
  });

  const heightCls = size === "sm" ? "h-7" : "h-8";
  const minWidthCls = size === "sm" ? "min-w-[140px]" : "min-w-[160px]";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Production status: ${PRODUCTION_STATUS_LABELS[current]}`}
          disabled={mutation.isPending}
          className={cn(
            heightCls,
            minWidthCls,
            tone.bg ?? "bg-[var(--color-surface)]",
            "inline-flex items-center gap-2 border border-[var(--color-line)] px-2.5 text-left",
            "text-[12.5px] font-medium",
            tone.text,
            "hover:bg-[var(--color-surface-alt)] disabled:opacity-60",
          )}
        >
          <span className={cn("inline-block h-2.5 w-2.5", tone.square)} />
          <span className="flex-1">{PRODUCTION_STATUS_LABELS[current]}</span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px] p-0">
        {PRODUCTION_STATUSES.map((option) => {
          const optTone = STATUS_TONE[option];
          const active = option === current;
          return (
            <DropdownMenuItem
              key={option}
              onSelect={(event) => {
                event.preventDefault();
                if (option !== current && !mutation.isPending) {
                  mutation.mutate(option);
                }
              }}
              className={cn(
                "h-8 cursor-pointer gap-2 rounded-none px-3 text-[12.5px]",
                active && "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
              )}
            >
              <span className={cn("inline-block h-3 w-3", optTone.square)} />
              <span className="flex-1">{PRODUCTION_STATUS_LABELS[option]}</span>
              {active ? (
                <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
