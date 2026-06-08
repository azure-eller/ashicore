"use client";

import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

/*
SUCCESS (green)  - the thing is GOOD / READY / FINISHED
  Available · Allocated · Complete · In stock · Picked · Done · Shipped

WARNING (amber) - the thing is IN MOTION / NEEDS WORK / PARTIAL
  Work in progress · Partial · Partially shipped · Expected

DANGER (red)    - the thing is BLOCKED / MISSING
  Not available · Not allocated · Blocked

MUTED (grey)    - the thing is INACTIVE / NOT APPLICABLE
  Not shipped · No production · Not started · Not picked · Not applicable

ACTION PROMPTS use actionable muted with a leading icon.
  Make

If a future state does not fit one of these four buckets, reshape the state
instead of introducing a fifth color.
*/

export type StatusBlockTone = "success" | "warning" | "danger" | "muted";

type StatusBlockBaseProps = {
  tone: StatusBlockTone;
  children: ReactNode;
  footer?: ReactNode;
  marker?: ReactNode;
  leadingIcon?: IconSvgElement;
  icon?: IconSvgElement;
  className?: string;
  style?: CSSProperties;
};

type StatusBlockDerivedProps = StatusBlockBaseProps & {
  actionable?: false;
  actionVariant?: never;
  showCaret?: never;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className" | "onClick" | "style">;

type StatusBlockActionableProps = StatusBlockBaseProps & {
  /** When true, treats this as a button trigger. */
  actionable: true;
  /** Use "button" for command-style actions that open a menu, such as Make. */
  actionVariant?: "menu" | "button";
  showCaret?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "style">;

type StatusBlockProps = StatusBlockDerivedProps | StatusBlockActionableProps;

const TONE_FG: Record<StatusBlockTone, string> = {
  success: "var(--status-success-ink)",
  warning: "var(--status-warning-ink)",
  danger: "var(--status-danger-ink)",
  muted: "var(--status-muted-ink)",
};

const TONE_DIVIDER: Record<StatusBlockTone, string> = {
  success: "var(--status-success-divider)",
  warning: "var(--status-warning-divider)",
  danger: "var(--status-danger-divider)",
  muted: "var(--status-muted-divider)",
};

function statusBlockBg(tone: StatusBlockTone, actionable: boolean) {
  if (tone === "muted" && actionable) return "var(--status-muted-action-bg)";
  return `var(--status-${tone}-bg)`;
}

function StatusBlockContent({
  children,
  footer,
  marker,
  leadingIcon,
  icon,
  actionable,
  showCaret,
}: {
  children: ReactNode;
  footer?: ReactNode;
  marker?: ReactNode;
  leadingIcon?: IconSvgElement;
  icon?: IconSvgElement;
  actionable: boolean;
  showCaret: boolean;
}) {
  const showInlineCaret = actionable && showCaret;

  return (
    <>
      <span
        className={cn(
          footer
            ? "relative inline-flex min-w-0 flex-1 items-center px-(--space-5)"
            : "inline-flex items-center px-(--space-6) py-[8px]",
        )}
      >
        <span className="inline-flex min-w-0 items-center">
          {leadingIcon ? (
            <HugeiconsIcon
              icon={leadingIcon}
              size={11}
              className="mr-(--space-2) opacity-90"
            />
          ) : null}
          <span className="truncate text-[length:var(--text-xs)] font-bold uppercase tracking-[0.03em]">
            {children}
          </span>
          {showInlineCaret ? (
            <HugeiconsIcon
              icon={icon ?? ArrowDown01Icon}
              size={10}
              className="ml-(--space-2) shrink-0 opacity-90"
            />
          ) : null}
        </span>
        {footer ? (
          <span className="absolute inset-x-(--space-5) bottom-(--space-1) min-w-0 normal-case tracking-normal">
            {footer}
          </span>
        ) : null}
      </span>
      {marker ? (
        <span className="ml-auto inline-flex min-w-(--space-10) items-center justify-center border-l border-[var(--status-block-divider)] px-(--space-2) text-[length:var(--text-xs)] font-bold">
          {marker}
        </span>
      ) : null}
    </>
  );
}

export function StatusBlock({
  tone,
  children,
  footer,
  marker,
  leadingIcon,
  icon,
  actionable = false,
  actionVariant = "menu",
  showCaret = actionVariant === "menu",
  className,
  style,
  ...props
}: StatusBlockProps) {
  const framed = Boolean(footer || marker);
  const baseClassName = cn(
    framed
      ? "inline-flex min-h-(--height-input-sm) h-full w-full shrink-0 items-stretch overflow-hidden rounded-(--radius-none)"
      : "inline-flex h-auto w-fit shrink-0 items-center overflow-hidden rounded-(--radius-full)",
    "font-mono text-[length:var(--text-xs)] leading-none font-bold uppercase tracking-[0.03em]",
    "text-[color:var(--status-block-fg)]",
    "bg-[var(--tone-bg)]",
    actionable &&
      "cursor-pointer outline-none transition-colors duration-(--duration-1) ease-(--ease-out) " +
        "hover:bg-[color-mix(in_oklab,var(--tone-bg),black_6%)] " +
        "focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--tone-bg)]",
    className
  );
  const baseStyle = {
    "--tone-bg": statusBlockBg(tone, actionable),
    "--status-block-fg": TONE_FG[tone],
    "--status-block-divider": TONE_DIVIDER[tone],
    ...style,
  } as CSSProperties;
  const content = (
    <StatusBlockContent
      footer={footer}
      marker={marker}
      leadingIcon={leadingIcon}
      icon={icon}
      actionable={actionable}
      showCaret={showCaret}
    >
      {children}
    </StatusBlockContent>
  );

  if (!actionable) {
    return (
      <span
        {...props}
        data-slot="status-block"
        data-tone={tone}
        data-framed={framed ? "true" : undefined}
        className={baseClassName}
        style={baseStyle}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      {...props}
      data-slot="status-block"
      data-tone={tone}
      data-actionable="true"
      data-action-variant={actionVariant}
      data-framed={framed ? "true" : undefined}
      type="button"
      className={baseClassName}
      style={baseStyle}
    >
      {content}
    </button>
  );
}
