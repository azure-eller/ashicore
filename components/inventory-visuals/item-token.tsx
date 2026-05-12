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
  xs: "h-10 w-10 rounded-md p-1",
  sm: "h-12 w-12 rounded-md p-1.5",
  md: "h-16 w-16 rounded-lg p-2",
  lg: "h-22 w-22 rounded-lg p-2.5",
};

const BADGE_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "min-w-3.5 h-3.5 px-0.5 text-[0.52rem]",
  sm: "min-w-4 h-4 px-1 text-[0.58rem]",
  md: "min-w-5 h-5 px-1.5 text-[0.68rem]",
  lg: "min-w-6 h-6 px-2 text-xs",
};

const LOT_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "hidden",
  sm: "hidden",
  md: "max-w-14 text-[0.62rem]",
  lg: "max-w-20 text-[0.68rem]",
};

const STATE_CLASS: Record<ItemVisualState, string> = {
  available: "border-border bg-card shadow-xs",
  allocated: "border-warning/70 bg-warning/10 shadow-xs ring-1 ring-warning/30",
  inbound: "border-primary/45 bg-primary/5 shadow-xs ring-1 ring-primary/20",
  reserved: "border-foreground/35 bg-secondary/80 shadow-xs ring-1 ring-foreground/15",
  hold: "border-muted-foreground/25 bg-muted/70 text-muted-foreground shadow-xs",
  quarantine: "border-warning/70 bg-warning/10 shadow-xs ring-1 ring-warning/40",
  shortage:
    "border-destructive/80 bg-background shadow-xs ring-2 ring-destructive/45",
  selected:
    "border-primary bg-primary/10 shadow-sm ring-2 ring-primary/35 ring-offset-2 ring-offset-background",
};

const SELECTED_CLASS =
  "border-primary bg-primary/10 shadow-sm ring-2 ring-primary/35 ring-offset-2 ring-offset-background";

const HATCH_STATES = new Set<ItemVisualState>(["inbound", "hold", "quarantine"]);

const HATCH_BACKGROUND: Record<ItemVisualState, React.CSSProperties | undefined> = {
  available: undefined,
  allocated: undefined,
  reserved: undefined,
  shortage: undefined,
  selected: undefined,
  inbound: {
    backgroundImage:
      "repeating-linear-gradient(135deg, transparent 0, transparent 6px, color-mix(in oklch, var(--primary) 30%, transparent) 6px, color-mix(in oklch, var(--primary) 30%, transparent) 8px)",
  },
  hold: {
    backgroundImage:
      "repeating-linear-gradient(90deg, transparent 0, transparent 7px, color-mix(in oklch, var(--muted-foreground) 30%, transparent) 7px, color-mix(in oklch, var(--muted-foreground) 30%, transparent) 9px)",
  },
  quarantine: {
    backgroundImage:
      "repeating-linear-gradient(45deg, transparent 0, transparent 4px, color-mix(in oklch, var(--warning) 45%, transparent) 4px, color-mix(in oklch, var(--warning) 45%, transparent) 6px)",
  },
};

const STATE_MARK_CLASS: Record<ItemVisualState, string | null> = {
  available: null,
  allocated: "bg-warning",
  inbound: "bg-primary",
  reserved: "bg-foreground",
  hold: "bg-muted-foreground",
  quarantine: "bg-warning ring-1 ring-warning/40",
  shortage: "bg-destructive",
  selected: "bg-primary",
};

function StateCue({ state }: { state: ItemVisualState }) {
  if (state === "available") return null;

  if (state === "reserved") {
    return (
      <span
        className="pointer-events-none absolute inset-x-2 bottom-1 flex h-2 items-center justify-center gap-0.5 md:bottom-1.5"
        aria-hidden
      >
        <span className="h-full w-1 rounded-full bg-foreground/55" />
        <span className="h-full w-1 rounded-full bg-foreground/55" />
        <span className="h-full w-1 rounded-full bg-foreground/55" />
      </span>
    );
  }

  if (state === "allocated") {
    return (
      <span
        className="pointer-events-none absolute inset-y-2 left-0 w-1 rounded-r-full bg-warning/80"
        aria-hidden
      />
    );
  }

  if (state === "shortage") {
    return (
      <>
        <span
          className="pointer-events-none absolute -right-3 -top-3 size-7 rotate-45 bg-destructive/85 md:size-8"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute right-1 top-0.5 text-[0.62rem] font-black leading-none text-destructive-foreground md:right-1.5 md:top-1 md:text-xs"
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
      className="pointer-events-none absolute inset-1 rounded-[calc(var(--radius-sm)-1px)] border border-primary/60"
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
            "absolute left-1 top-1 size-1.5 rounded-full shadow-xs md:size-2",
            STATE_MARK_CLASS[effectiveState]
          )}
          aria-hidden
        />
      ) : null}
      {quantity != null ? (
        <span
          className={cn(
            "absolute right-0.5 top-0.5 inline-flex items-center justify-center rounded-full bg-background/95 font-semibold leading-none text-foreground shadow-xs ring-1 ring-border",
            BADGE_SIZE_CLASS[size]
          )}
        >
          {quantity}
        </span>
      ) : null}
      {lotCode != null ? (
        <span
          className={cn(
            "absolute bottom-0.5 left-1/2 -translate-x-1/2 truncate rounded-sm bg-background/90 px-1 font-medium leading-tight text-muted-foreground shadow-xs ring-1 ring-border",
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
