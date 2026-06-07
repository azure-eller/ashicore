import * as React from "react";

import { cn } from "@/lib/utils";
import { ItemSprite } from "./item-sprite";
import type {
  ItemColorFamily,
  ItemSpriteKind,
  ItemVisualSize,
  ItemVisualState,
} from "./types";

type ItemTokenProps = React.ComponentProps<"div"> & {
  kind?: ItemSpriteKind;
  color?: ItemColorFamily;
  state?: ItemVisualState;
  selected?: boolean;
  size?: ItemVisualSize;
  quantity?: React.ReactNode;
  lotCode?: React.ReactNode;
  title?: string;
  spriteClassName?: string;
};

const TOKEN_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "h-(--space-10) w-(--space-10) rounded-[var(--radius-sm)] p-(--space-1)",
  sm: "h-(--space-12) w-(--space-12) rounded-[var(--radius-sm)] p-(--space-2)",
  md: "h-(--space-16) w-(--space-16) rounded-[var(--radius-md)] p-(--space-3)",
  lg: "h-[calc(var(--space-24)+var(--space-20))] w-[calc(var(--space-24)+var(--space-20))] rounded-[var(--radius-md)] p-(--space-4)",
};

const BADGE_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "h-(--space-5) min-w-(--space-5) px-(--space-1) text-[0.52rem]",
  sm: "h-(--space-6) min-w-(--space-6) px-(--space-1) text-[0.58rem]",
  md: "h-(--space-7) min-w-(--space-7) px-(--space-2) text-[0.68rem]",
  lg: "h-(--space-8) min-w-(--space-8) px-(--space-2) text-[length:var(--text-xs)]",
};

const LOT_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "hidden",
  sm: "hidden",
  md: "max-w-[calc(var(--space-24)+var(--space-4))] text-[0.62rem]",
  lg: "max-w-[calc(var(--space-20)+var(--space-20))] text-[0.68rem]",
};

const STATE_CLASS: Record<ItemVisualState, string> = {
  available: "border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]",
  allocated: "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--status-warning-ink)] shadow-[var(--shadow-sm)] ring-1 ring-[color-mix(in_oklch,var(--color-warning),transparent_65%)]",
  inbound: "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] shadow-[var(--shadow-sm)] ring-1 ring-[color-mix(in_oklch,var(--color-accent),transparent_65%)]",
  reserved: "border-[var(--color-ink-soft)] bg-[var(--color-surface-alt)] text-[var(--color-ink)] shadow-[var(--shadow-sm)] ring-1 ring-[color-mix(in_oklch,var(--color-ink),transparent_80%)]",
  hold: "border-[var(--color-line)] bg-[var(--color-surface-sunk)] text-[var(--color-ink-faint)] shadow-[var(--shadow-sm)]",
  quarantine: "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--status-warning-ink)] shadow-[var(--shadow-sm)] ring-1 ring-[color-mix(in_oklch,var(--color-warning),transparent_60%)]",
  shortage:
    "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--status-danger-ink)] shadow-[var(--shadow-sm)] ring-2 ring-[color-mix(in_oklch,var(--color-danger),transparent_65%)]",
  selected:
    "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] shadow-[var(--shadow-sm)] ring-2 ring-[color-mix(in_oklch,var(--color-accent),transparent_55%)] ring-offset-2 ring-offset-[var(--color-surface)]",
};

const SELECTED_CLASS =
  "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] shadow-[var(--shadow-sm)] ring-2 ring-[color-mix(in_oklch,var(--color-accent),transparent_55%)] ring-offset-2 ring-offset-[var(--color-surface)]";

const HATCH_STATES = new Set<ItemVisualState>(["inbound", "hold", "quarantine"]);

const HATCH_BACKGROUND: Record<ItemVisualState, React.CSSProperties | undefined> = {
  available: undefined,
  allocated: undefined,
  reserved: undefined,
  shortage: undefined,
  selected: undefined,
  inbound: {
    backgroundImage:
      "repeating-linear-gradient(135deg, transparent 0, transparent 6px, color-mix(in oklch, var(--color-accent-ink) 24%, transparent) 6px, color-mix(in oklch, var(--color-accent-ink) 24%, transparent) 8px)",
  },
  hold: {
    backgroundImage:
      "repeating-linear-gradient(90deg, transparent 0, transparent 7px, color-mix(in oklch, var(--color-ink-faint) 30%, transparent) 7px, color-mix(in oklch, var(--color-ink-faint) 30%, transparent) 9px)",
  },
  quarantine: {
    backgroundImage:
      "repeating-linear-gradient(45deg, transparent 0, transparent 4px, color-mix(in oklch, var(--status-warning-ink) 30%, transparent) 4px, color-mix(in oklch, var(--status-warning-ink) 30%, transparent) 6px)",
  },
};

const STATE_MARK_CLASS: Record<ItemVisualState, string | null> = {
  available: null,
  allocated: "bg-[var(--status-warning-ink)]",
  inbound: "bg-[var(--color-accent-ink)]",
  reserved: "bg-[var(--color-ink)]",
  hold: "bg-[var(--color-ink-faint)]",
  quarantine: "bg-[var(--status-warning-ink)] ring-1 ring-[color-mix(in_oklch,var(--status-warning-ink),transparent_60%)]",
  shortage: "bg-[var(--status-danger-ink)]",
  selected: "bg-[var(--color-accent-ink)]",
};

function StateCue({ state }: { state: ItemVisualState }) {
  if (state === "available") return null;

  if (state === "reserved") {
    return (
      <span
        className="pointer-events-none absolute inset-x-2 bottom-1 flex h-2 items-center justify-center gap-0.5 md:bottom-1.5"
        aria-hidden
      >
        <span className="h-full w-1 rounded-full bg-[color-mix(in_oklch,var(--color-ink),transparent_45%)]" />
        <span className="h-full w-1 rounded-full bg-[color-mix(in_oklch,var(--color-ink),transparent_45%)]" />
        <span className="h-full w-1 rounded-full bg-[color-mix(in_oklch,var(--color-ink),transparent_45%)]" />
      </span>
    );
  }

  if (state === "allocated") {
    return (
      <span
        className="pointer-events-none absolute inset-y-(--space-2) left-0 w-(--space-1) rounded-r-full bg-[color-mix(in_oklch,var(--status-warning-ink),transparent_35%)]"
        aria-hidden
      />
    );
  }

  if (state === "shortage") {
    return (
      <>
        <span
          className="pointer-events-none absolute -top-(--space-3) -right-(--space-3) size-(--space-7) rotate-45 bg-[var(--color-danger-soft)] md:size-(--space-8)"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute right-1 top-0.5 text-[0.62rem] font-black leading-none text-[var(--status-danger-ink)] md:right-1.5 md:top-1 md:text-[length:var(--text-xs)]"
          aria-hidden
        >
          !
        </span>
      </>
    );
  }

  return null;
}

function SelectedCue() {
  return (
    <span
      className="pointer-events-none absolute inset-1 rounded-[calc(var(--radius-sm)-1px)] border border-[color-mix(in_oklch,var(--color-accent),transparent_40%)]"
      aria-hidden
    />
  );
}

function HatchOverlay({ state }: { state: ItemVisualState }) {
  if (!HATCH_STATES.has(state)) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-45"
      style={HATCH_BACKGROUND[state]}
      aria-hidden
    />
  );
}

export function ItemToken({
  kind = "generic",
  color = "slate",
  state = "available",
  selected = false,
  size = "md",
  quantity,
  lotCode,
  title,
  className,
  spriteClassName,
  ...props
}: ItemTokenProps) {
  const effectiveState = state === "selected" ? "available" : state;
  const isSelected = selected || state === "selected";

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border transition-colors",
        TOKEN_SIZE_CLASS[size],
        STATE_CLASS[effectiveState],
        isSelected && SELECTED_CLASS,
        className
      )}
      title={title}
      {...props}
    >
      <ItemSprite
        kind={kind}
        color={color}
        size={size}
        className={cn(
          (size === "xs" || size === "sm") && "scale-115",
          size === "md" && "scale-105",
          effectiveState === "hold" && "opacity-60 saturate-50",
          effectiveState === "shortage" && "opacity-80 saturate-75",
          spriteClassName
        )}
      />
      <HatchOverlay state={effectiveState} />
      <StateCue state={effectiveState} />
      {isSelected ? <SelectedCue /> : null}
      {STATE_MARK_CLASS[effectiveState] ? (
        <span
          className={cn(
            "absolute left-1 top-1 size-1.5 rounded-full shadow-[var(--shadow-sm)] md:size-2",
            STATE_MARK_CLASS[effectiveState]
          )}
          aria-hidden
        />
      ) : null}
      {quantity != null ? (
        <span
          className={cn(
            "absolute right-0.5 top-0.5 inline-flex items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--color-surface),transparent_5%)] font-semibold leading-none text-[var(--color-ink)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--color-line)]",
            BADGE_SIZE_CLASS[size]
          )}
        >
          {quantity}
        </span>
      ) : null}
      {lotCode != null ? (
        <span
          className={cn(
            "absolute bottom-0.5 left-1/2 -translate-x-1/2 truncate rounded-sm bg-[color-mix(in_oklch,var(--color-surface),transparent_10%)] px-1 font-medium leading-tight text-[var(--color-ink-faint)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--color-line)]",
            LOT_SIZE_CLASS[size]
          )}
        >
          {lotCode}
        </span>
      ) : null}
    </div>
  );
}

export { TOKEN_SIZE_CLASS as itemTokenSizeClass };
