import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ListFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("border border-border", className)}>{children}</div>;
}

type ListFrameItemProps<TAs extends ElementType = "div"> = {
  as?: TAs;
  children: ReactNode;
  interactive?: boolean;
  className?: string;
} & Omit<ComponentPropsWithoutRef<TAs>, "as" | "children" | "className">;

export function ListFrameItem<TAs extends ElementType = "div">({
  as,
  children,
  interactive = false,
  className,
  ...props
}: ListFrameItemProps<TAs>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn(
        "border-t border-border first:border-t-0",
        interactive &&
          "transition-colors hover:bg-muted focus-visible:bg-muted data-[selected]:bg-accent data-[selected]:text-accent-foreground data-[selected]:hover:bg-accent",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

type SelectableListFrameItemProps<TAs extends ElementType = "button"> = {
  as?: TAs;
  children: ReactNode;
  selected?: boolean;
  indicator?: boolean;
  className?: string;
} & Omit<ComponentPropsWithoutRef<TAs>, "as" | "children" | "className">;

export function SelectableListFrameItem<TAs extends ElementType = "button">({
  as,
  children,
  selected = false,
  indicator = false,
  className,
  ...props
}: SelectableListFrameItemProps<TAs>) {
  const Component = as ?? "button";
  const buttonProps =
    Component === "button" && !("type" in props) ? { type: "button" as const } : {};

  return (
    <Component
      className={cn(
        "flex w-full items-center gap-(--space-4) border border-border p-(--space-5) text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted data-[selected]:border-foreground data-[selected]:shadow-[var(--focus-ring)]",
        className,
      )}
      data-selected={selected ? "" : undefined}
      {...buttonProps}
      {...props}
    >
      {indicator ? <SelectionIndicator selected={selected} /> : null}
      {children}
    </Component>
  );
}

function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-(--space-8) shrink-0 items-center justify-center rounded-full border border-border",
        selected && "border-foreground",
      )}
      aria-hidden
    >
      {selected ? <span className="size-(--space-4) rounded-full bg-foreground" /> : null}
    </span>
  );
}
