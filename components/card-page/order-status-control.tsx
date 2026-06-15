"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import type { StatusBlockTone } from "@/components/ui/status-block";
import {
  StatusActionMenu,
  StatusActionMenuItem,
} from "@/components/card-page/status-action-menu";

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
export type OrderStatusDialogBoundary = "beforeOpen" | "bestEffort" | "none";

export type OrderStatusDialogArgs<Ctx> = {
  to: string;
  ctx: Ctx;
  /** Close the dialog without advancing. */
  onClose: () => void;
  /** Operation succeeded — close and refresh. */
  onDone: (status?: string) => void;
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
  /**
   * Defaults to `beforeOpen` (block until the draft saves). Dialogs that refetch
   * persisted server state use `bestEffort` (persist a valid dirty draft so the
   * refetch reflects it, but still open on an unsavable draft) or `none` (never
   * flush).
   */
  dialogBoundary?: (from: string, to: string, ctx: Ctx) => OrderStatusDialogBoundary;
  /** Render the dialog for a "dialog" transition. Required if any option is "dialog". */
  renderDialog?: (args: OrderStatusDialogArgs<Ctx>) => ReactNode;
};

export type OrderStatusActionBoundary =
  | {
      flushPolicy: "none";
      requiresPersistedId: true;
    }
  | {
      flushPolicy: "requireSaved";
      requiresPersistedId: true;
      beforeTransition: () => Promise<void>;
    }
  | {
      flushPolicy: "tolerateBlocked";
      requiresPersistedId: true;
      beforeTransition: () => Promise<void>;
    };

export type OrderStatusControlProps<Ctx> = {
  config: OrderStatusControlConfig<Ctx>;
  ctx: Ctx;
  disabled?: boolean;
  footer?: ReactNode;
  actionVariant?: "menu" | "button";
  actionBoundary: OrderStatusActionBoundary;
  onTransitionError?: (error: Error) => void;
  /** Called after any successful transition so the caller can update local state and invalidate/refetch. */
  onChanged?: (status: string) => void;
};

export function OrderStatusControl<Ctx>({
  config,
  ctx,
  disabled = false,
  footer,
  actionVariant = "menu",
  actionBoundary,
  onTransitionError,
  onChanged,
}: OrderStatusControlProps<Ctx>) {
  const [dialogTarget, setDialogTarget] = useState<string | null>(null);
  const [preparingTransition, setPreparingTransition] = useState(false);

  const current = config.current(ctx);
  const options = config.options(ctx);
  const currentOption = options.find((option) => option.value === current);
  const tone = TONE_MAP[currentOption?.tone ?? "neutral"];
  const runBoundary = () => {
    if (actionBoundary.flushPolicy === "none") return Promise.resolve();
    return actionBoundary.beforeTransition();
  };

  const instant = useMutation({
    mutationKey: ["order-status", config.type, "instant"],
    mutationFn: async (to: string) => {
      if (!config.runInstant) {
        throw new Error(`No instant handler for ${config.type}`);
      }
      await runBoundary();
      return config.runInstant(to, ctx);
    },
    onError: (error) => {
      onTransitionError?.(transitionError(error, "Failed to change status."));
    },
    onSuccess: (_result, to) => onChanged?.(to),
  });

  const busy = disabled || instant.isPending || preparingTransition;

  const handleSelect = (to: string) => {
    const kind = config.transitionKind(current, to, ctx);
    if (kind === "noop" || kind === "disabled" || busy) return;
    if (kind === "instant") {
      instant.mutate(to);
      return;
    }
    const dialogBoundary = config.dialogBoundary?.(current, to, ctx) ?? "beforeOpen";
    if (actionBoundary.flushPolicy === "none" || dialogBoundary === "none") {
      setDialogTarget(to);
      return;
    }
    setPreparingTransition(true);
    void runBoundary()
      .then(() => setDialogTarget(to))
      .catch((error) => {
        if (dialogBoundary === "bestEffort") {
          setDialogTarget(to);
          return;
        }
        onTransitionError?.(transitionError(error, "Failed to save changes."));
      })
      .finally(() => setPreparingTransition(false));
  };

  return (
    <>
      <StatusActionMenu
        label={currentOption?.label ?? current}
        tone={tone}
        footer={footer}
        actionVariant={actionVariant}
        ariaLabel={`Change status: ${currentOption?.label ?? current}`}
        title="Change status"
        disabled={busy}
      >
        {options.map((option) => {
          const active = option.value === current;
          const kind = config.transitionKind(current, option.value, ctx);
          const selectable = kind === "instant" || kind === "dialog";
          return (
            <StatusActionMenuItem
              key={option.value}
              active={active}
              disabled={!selectable && !active}
              swatchClassName={TONE_SWATCH[option.tone]}
              onSelect={() => handleSelect(option.value)}
            >
              {option.label}
            </StatusActionMenuItem>
          );
        })}
      </StatusActionMenu>
      {dialogTarget && config.renderDialog
        ? config.renderDialog({
            to: dialogTarget,
            ctx,
            onClose: () => setDialogTarget(null),
            onDone: (status) => {
              setDialogTarget(null);
              onChanged?.(status ?? dialogTarget);
            },
          })
        : null}
    </>
  );
}

function transitionError(error: unknown, fallback: string) {
  if (error instanceof Error) return error;
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    typeof error.error === "string"
  ) {
    return new Error(error.error);
  }
  return new Error(fallback);
}
