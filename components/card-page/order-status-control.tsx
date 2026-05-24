"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBlock, type StatusBlockTone } from "@/components/ui/status-block";
import { cn } from "@/lib/utils";

/**
 * One status control, shared by every order type (sales / manufacturing / purchase),
 * used both in the card-page header and in list table rows.
 *
 * The component is domain-agnostic: each order type supplies an
 * {@link OrderStatusControlConfig}. Selecting an option either does nothing (current /
 * derived display row), runs an instant transition (PATCH + autosave), or opens a dialog
 * that performs a real-world operation (ship / receive / complete) before advancing.
 */

export type OrderStatusTone =
  | "neutral"
  | "info"
  | "warning"
  | "danger"
  | "success"
  | "accent";

const TONE_SWATCH: Record<OrderStatusTone, string> = {
  neutral: "bg-[var(--color-muted-solid)]",
  info: "bg-[var(--color-muted-solid)]",
  warning: "bg-[var(--color-warning-solid)]",
  danger: "bg-[var(--color-danger-solid)]",
  success: "bg-[var(--color-success-solid)]",
  accent: "bg-[var(--color-warning-solid)]",
};

const TONE_MAP: Record<OrderStatusTone, StatusBlockTone> = {
  neutral: "muted",
  info: "muted",
  warning: "warning",
  danger: "danger",
  success: "success",
  accent: "warning",
};

export type OrderStatusOption = {
  value: string;
  label: string;
  tone: OrderStatusTone;
};

/**
 * How selecting a target option behaves, given the current state:
 * - `instant`   — PATCH immediately, show the saving indicator.
 * - `dialog`    — open the config's dialog; the operation runs on confirm.
 * - `noop`/`disabled` — not user-actionable (current value or derived display row).
 */
export type OrderStatusTransitionKind = "noop" | "instant" | "dialog" | "disabled";

export type OrderStatusDialogArgs<Ctx> = {
  to: string;
  ctx: Ctx;
  /** Close the dialog without advancing. */
  onClose: () => void;
  /** Operation succeeded — close and refresh. */
  onDone: () => void;
};

export type OrderStatusControlConfig<Ctx> = {
  type: "manufacturing" | "sales" | "purchase";
  /** Options to render, given context (dynamic — e.g. SO "partial" only with >1 shipment). */
  options: (ctx: Ctx) => OrderStatusOption[];
  /** Current value to display in the trigger. */
  current: (ctx: Ctx) => string;
  /** Classify a transition from the current value to a target option. */
  transitionKind: (from: string, to: string, ctx: Ctx) => OrderStatusTransitionKind;
  /** Run an instant transition (PATCH). Required if any option is "instant". */
  runInstant?: (to: string, ctx: Ctx) => Promise<void>;
  /** Render the dialog for a "dialog" transition. Required if any option is "dialog". */
  renderDialog?: (args: OrderStatusDialogArgs<Ctx>) => ReactNode;
};

export type OrderStatusControlProps<Ctx> = {
  config: OrderStatusControlConfig<Ctx>;
  ctx: Ctx;
  disabled?: boolean;
  /** Called after any successful transition so the caller can update local state and invalidate/refetch. */
  onChanged?: (status: string) => void;
};

export function OrderStatusControl<Ctx>({
  config,
  ctx,
  disabled = false,
  onChanged,
}: OrderStatusControlProps<Ctx>) {
  const [dialogTarget, setDialogTarget] = useState<string | null>(null);

  const current = config.current(ctx);
  const options = config.options(ctx);
  const currentOption = options.find((option) => option.value === current);
  const tone = TONE_MAP[currentOption?.tone ?? "neutral"];

  const instant = useMutation({
    mutationKey: ["order-status", config.type, "instant"],
    mutationFn: (to: string) => {
      if (!config.runInstant) {
        return Promise.reject(new Error(`No instant handler for ${config.type}`));
      }
      return config.runInstant(to, ctx);
    },
    onSuccess: (_result, to) => onChanged?.(to),
  });

  const busy = disabled || instant.isPending;

  const handleSelect = (to: string) => {
    const kind = config.transitionKind(current, to, ctx);
    if (kind === "noop" || kind === "disabled" || busy) return;
    if (kind === "instant") {
      instant.mutate(to);
      return;
    }
    setDialogTarget(to);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <StatusBlock
            actionable
            tone={tone}
            aria-label={`Status: ${currentOption?.label ?? current}`}
            disabled={busy}
            onClick={(event) => event.stopPropagation()}
          >
            {currentOption?.label ?? current}
          </StatusBlock>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[220px] p-0"
          onClick={(event) => event.stopPropagation()}
        >
          {options.map((option) => {
            const active = option.value === current;
            const kind = config.transitionKind(current, option.value, ctx);
            const selectable = kind === "instant" || kind === "dialog";
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={(event) => {
                  event.preventDefault();
                  handleSelect(option.value);
                }}
                className={cn(
                  "h-8 cursor-pointer gap-2 rounded-none px-3 text-[12.5px]",
                  active && "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
                  !selectable && !active && "cursor-not-allowed opacity-50",
                )}
              >
                <span className={cn("inline-block h-3 w-3", TONE_SWATCH[option.tone])} />
                <span className="flex-1">{option.label}</span>
                {active ? <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogTarget && config.renderDialog
        ? config.renderDialog({
            to: dialogTarget,
            ctx,
            onClose: () => setDialogTarget(null),
            onDone: () => {
              setDialogTarget(null);
              onChanged?.(dialogTarget);
            },
          })
        : null}
    </>
  );
}
