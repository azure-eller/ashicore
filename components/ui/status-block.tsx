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
  marker?: ReactNode;
  leadingIcon?: IconSvgElement;
  icon?: IconSvgElement;
  className?: string;
  style?: CSSProperties;
};

type StatusBlockDerivedProps = StatusBlockBaseProps & {
  actionable?: false;
  actionVariant?: never;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className" | "onClick" | "style">;

type StatusBlockActionableProps = StatusBlockBaseProps & {
  /** When true, treats this as a button trigger. */
  actionable: true;
  /** Use "button" for command-style actions that open a menu, such as Make. */
  actionVariant?: "menu" | "button";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "style">;

type StatusBlockProps = StatusBlockDerivedProps | StatusBlockActionableProps;

const TONE_FG: Record<StatusBlockTone, string> = {
  success: "#fff",
  warning: "var(--color-ink)",
  danger: "#fff",
  muted: "var(--color-muted-2)",
};

const TONE_ACTIONABLE_FG: Record<StatusBlockTone, string> = {
  success: "#fff",
  warning: "var(--color-ink)",
  danger: "#fff",
  muted: "var(--color-ink-2)",
};

const TONE_DIVIDER: Record<StatusBlockTone, string> = {
  success: "rgba(255,255,255,0.28)",
  warning: "color-mix(in oklab, var(--color-ink), transparent 82%)",
  danger: "rgba(255,255,255,0.28)",
  muted: "color-mix(in oklab, var(--color-muted), transparent 78%)",
};

function statusBlockBg(tone: StatusBlockTone, actionable: boolean) {
  if (tone === "muted" && actionable) {
    return "var(--color-muted-actionable-solid)";
  }
  return `var(--color-${tone}-solid)`;
}

function StatusBlockContent({
  children,
  marker,
  leadingIcon,
  icon,
  actionable,
  actionVariant,
}: {
  children: ReactNode;
  marker?: ReactNode;
  leadingIcon?: IconSvgElement;
  icon?: IconSvgElement;
  actionable: boolean;
  actionVariant: "menu" | "button";
}) {
  const showActionWell = actionable && actionVariant === "menu";

  return (
    <>
      <span className={cn("inline-flex items-center px-(--space-5)", showActionWell && "pr-(--space-3)")}>
        {leadingIcon ? (
          <HugeiconsIcon
            icon={leadingIcon}
            size={11}
            className="mr-(--space-2) opacity-90"
          />
        ) : null}
        {children}
      </span>
      {marker ? (
        <span className="ml-auto inline-flex min-w-(--space-10) items-center justify-center border-l border-[var(--status-block-divider)] px-(--space-2) text-[10px] font-bold">
          {marker}
        </span>
      ) : null}
      {showActionWell ? (
        <span
          aria-hidden
          className="ml-auto inline-flex w-(--space-12) items-center justify-center border-l border-[var(--status-block-divider)]"
        >
          <HugeiconsIcon icon={icon ?? ArrowDown01Icon} size={10} className="opacity-90" />
        </span>
      ) : null}
    </>
  );
}

export function StatusBlock({
  tone,
  children,
  marker,
  leadingIcon,
  icon,
  actionable = false,
  actionVariant = "menu",
  className,
  style,
  ...props
}: StatusBlockProps) {
  const baseClassName = cn(
    "inline-flex h-(--height-block) shrink-0 items-stretch overflow-hidden rounded-(--radius-none)",
    "text-[length:var(--text-xs)] leading-none font-bold uppercase tracking-[var(--tracking-wide)]",
    "text-[color:var(--status-block-fg)]",
    "bg-[var(--tone-bg)]",
    actionable &&
      "cursor-pointer outline-none transition-colors duration-(--duration-1) ease-(--ease-out) " +
        "hover:bg-[color-mix(in_oklab,var(--tone-bg),black_6%)] " +
        "focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--tone-bg)]",
    className
  );
  const baseStyle = {
    "--tone-bg": statusBlockBg(tone, actionable),
    "--status-block-fg": actionable ? TONE_ACTIONABLE_FG[tone] : TONE_FG[tone],
    "--status-block-divider": TONE_DIVIDER[tone],
    ...style,
  } as CSSProperties;
  const content = (
    <StatusBlockContent
      marker={marker}
      leadingIcon={leadingIcon}
      icon={icon}
      actionable={actionable}
      actionVariant={actionVariant}
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
      type="button"
      className={baseClassName}
      style={baseStyle}
    >
      {content}
    </button>
  );
}
