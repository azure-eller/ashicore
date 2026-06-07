import * as React from "react";

import { SurfacePanel } from "@/components/surface-panel";
import { cn } from "@/lib/utils";
import { ItemToken } from "./item-token";
import type {
  ItemColorFamily,
  ItemSpriteKind,
  ItemVisualSize,
  ItemVisualState,
} from "./types";

export type ItemTokenStackProps = React.ComponentProps<"div"> & {
  count: number;
  maxVisible?: number;
  kind?: ItemSpriteKind;
  color?: ItemColorFamily;
  state?: ItemVisualState;
  size?: ItemVisualSize;
  quantity?: React.ReactNode;
  lotCode?: React.ReactNode;
};

const STACK_OFFSET_CLASS: Record<ItemVisualSize, string> = {
  xs: "-ml-(--space-4)",
  sm: "-ml-(--space-5)",
  md: "-ml-(--space-7)",
  lg: "-ml-(--space-10)",
};

const OVERFLOW_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "h-(--space-6) min-w-(--space-7) rounded-full px-(--space-2) text-[length:var(--text-xs)]",
  sm: "h-(--space-7) min-w-(--space-8) rounded-full px-(--space-2) text-[length:var(--text-xs)]",
  md: "h-(--space-8) min-w-(--space-10) rounded-full px-(--space-3) text-[length:var(--text-sm)]",
  lg: "h-(--space-10) min-w-(--space-12) rounded-full px-(--space-4) text-[length:var(--text-base)]",
};

export function ItemTokenStack({
  count,
  maxVisible = 4,
  kind = "generic",
  color = "slate",
  state = "available",
  size = "sm",
  quantity,
  lotCode,
  className,
  ...props
}: ItemTokenStackProps) {
  const visibleCount = Math.max(0, Math.min(count, maxVisible));
  const overflowCount = Math.max(0, count - visibleCount);

  return (
    <div
      className={cn("inline-flex items-center", className)}
      aria-label={`${count} inventory item${count === 1 ? "" : "s"}`}
      {...props}
    >
      {Array.from({ length: visibleCount }).map((_, index) => (
        <ItemToken
          key={index}
          kind={kind}
          color={color}
          state={state}
          size={size}
          quantity={index === visibleCount - 1 ? quantity : undefined}
          lotCode={index === visibleCount - 1 ? lotCode : undefined}
          className={cn(index > 0 && STACK_OFFSET_CLASS[size])}
          style={{ zIndex: index + 1 }}
        />
      ))}
      {overflowCount > 0 ? (
        <SurfacePanel
          as="span"
          tone="background"
          className={cn(
            "ml-1 inline-flex items-center justify-center p-0 font-semibold text-[var(--color-ink-faint)] shadow-[var(--shadow-sm)]",
            OVERFLOW_SIZE_CLASS[size]
          )}
          style={{ zIndex: visibleCount + 1 }}
        >
          +{overflowCount}
        </SurfacePanel>
      ) : null}
    </div>
  );
}
