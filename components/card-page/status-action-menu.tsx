"use client";

import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBlock, type StatusBlockTone } from "@/components/ui/status-block";
import { cn } from "@/lib/utils";

export function StatusActionMenu({
  label,
  tone,
  ariaLabel,
  title,
  disabled,
  footer,
  actionVariant = "menu",
  children,
}: {
  label: ReactNode;
  tone: StatusBlockTone;
  ariaLabel: string;
  title?: string | null;
  disabled?: boolean;
  footer?: ReactNode;
  actionVariant?: "menu" | "button";
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusBlock
          actionable
          tone={tone}
          footer={footer}
          actionVariant={actionVariant}
          aria-label={ariaLabel}
          title={title ?? undefined}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
        >
          {label}
        </StatusBlock>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[220px] p-0"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StatusActionMenuItem({
  children,
  active = false,
  disabled = false,
  swatchClassName,
  icon,
  href,
  target,
  rel,
  onSelect,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  swatchClassName?: string;
  icon?: IconSvgElement;
  href?: string;
  target?: string;
  rel?: string;
  onSelect?: () => void;
}) {
  const className = cn(
    "h-(--height-menu-item) cursor-pointer gap-(--space-2) rounded-(--radius-md) px-(--space-3) text-[length:var(--text-control)]",
    active && "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
    disabled && !active && "cursor-not-allowed opacity-50",
  );
  const content = (
    <>
      {swatchClassName ? (
        <span className={cn("inline-block size-(--space-6) rounded-(--radius-full)", swatchClassName)} />
      ) : null}
      {icon ? <HugeiconsIcon icon={icon} size={14} aria-hidden /> : null}
      <span className="flex-1">{children}</span>
      {active ? <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden /> : null}
    </>
  );

  if (href) {
    return (
      <DropdownMenuItem asChild className={className} disabled={disabled}>
        <a
          href={href}
          target={target}
          rel={rel}
          onClick={(event) => event.stopPropagation()}
        >
          {content}
        </a>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      className={className}
      disabled={disabled}
      onSelect={(event) => {
        event.preventDefault();
        if (!disabled) onSelect?.();
      }}
    >
      {content}
    </DropdownMenuItem>
  );
}
