import * as React from "react";

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
  xs: "-ml-4",
  sm: "-ml-5",
  md: "-ml-7",
  lg: "-ml-10",
};

const OVERFLOW_SIZE_CLASS: Record<ItemVisualSize, string> = {
  xs: "h-6 min-w-7 rounded-full px-2 text-xs",
  sm: "h-7 min-w-8 rounded-full px-2 text-xs",
  md: "h-8 min-w-9 rounded-full px-2.5 text-sm",
  lg: "h-9 min-w-10 rounded-full px-3 text-base",
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
        <span
          className={cn(
            "ml-1 inline-flex items-center justify-center border border-border bg-background font-semibold text-muted-foreground shadow-xs",
            OVERFLOW_SIZE_CLASS[size]
          )}
          style={{ zIndex: visibleCount + 1 }}
        >
          +{overflowCount}
        </span>
      ) : null}
    </div>
  );
}
