"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * One status control, shared by every order type (sales / manufacturing / purchase),
 * used both in the card-page header (size "md") and in list table rows (size "sm").
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

const TONE: Record<OrderStatusTone, { square: string; text: string; bg?: string }> = {
  neutral: { square: "bg-[var(--color-ink-2)]", text: "text-[var(--color-ink-2)]" },
  info: {
    square: "bg-[var(--color-info)]",
    text: "text-[var(--color-info)]",
    bg: "bg-[var(--color-info-soft)]",
  },
  warning: {
    square: "bg-[var(--color-warning)]",
    text: "text-[var(--color-warning)]",
    bg: "bg-[var(--color-warning-soft)]",
  },
  danger: {
    square: "bg-[var(--color-danger)]",
    text: "text-[var(--color-danger)]",
    bg: "bg-[var(--color-danger-soft)]",
  },
  success: {
    square: "bg-[var(--color-success)]",
    text: "text-[var(--color-success)]",
    bg: "bg-[var(--color-success-soft)]",
  },
  accent: {
    square: "bg-[var(--color-accent)]",
    text: "text-[var(--color-accent)]",
    bg: "bg-[var(--color-accent-soft)]",
  },
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
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
  extraMenuItems?: ReactNode;
  /** Called after any successful transition so the caller can invalidate/refetch. */
  onChanged?: () => void;
};

export function OrderStatusControl<Ctx>({
  config,
  ctx,
  size = "md",
  disabled = false,
  ariaLabel,
  extraMenuItems,
  onChanged,
}: OrderStatusControlProps<Ctx>) {
  const [dialogTarget, setDialogTarget] = useState<string | null>(null);

  const current = config.current(ctx);
  const options = config.options(ctx);
  const currentOption = options.find((option) => option.value === current);
  const tone = TONE[currentOption?.tone ?? "neutral"];

  const instant = useMutation({
    mutationKey: ["order-status", config.type, "instant"],
    mutationFn: (to: string) => {
      if (!config.runInstant) {
        return Promise.reject(new Error(`No instant handler for ${config.type}`));
      }
      return config.runInstant(to, ctx);
    },
    onSuccess: () => onChanged?.(),
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

  const heightCls = size === "sm" ? "h-7" : "h-8";
  const minWidthCls = size === "sm" ? "min-w-[140px]" : "min-w-[180px]";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel ?? `Status: ${currentOption?.label ?? current}`}
            disabled={busy}
            onClick={(event) => event.stopPropagation()}
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
            <span className="flex-1 truncate">{currentOption?.label ?? current}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[220px] p-0"
          onClick={(event) => event.stopPropagation()}
        >
          {options.map((option) => {
            const optTone = TONE[option.tone];
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
                <span className={cn("inline-block h-3 w-3", optTone.square)} />
                <span className="flex-1">{option.label}</span>
                {active ? <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden /> : null}
              </DropdownMenuItem>
            );
          })}
          {extraMenuItems}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogTarget && config.renderDialog
        ? config.renderDialog({
            to: dialogTarget,
            ctx,
            onClose: () => setDialogTarget(null),
            onDone: () => {
              setDialogTarget(null);
              onChanged?.();
            },
          })
        : null}
    </>
  );
}
