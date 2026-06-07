"use client";

import Link from "next/link";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

export type ComboboxCreateLink = {
  href: string;
  label: string;
};

type ComboboxCreateLinksProps = {
  links: ComboboxCreateLink[];
  className?: string;
};

export function ComboboxCreateLinks({
  links,
  className,
}: ComboboxCreateLinksProps) {
  if (links.length === 0) {
    return null;
  }

  return (
    <div className={cn("border-t border-[var(--color-line)] p-(--space-2)", className)}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center gap-(--space-3) rounded-[var(--radius-md)] px-(--space-3) py-(--space-2) text-[length:var(--text-sm)] text-[var(--color-ink)] outline-none transition-colors duration-(--duration-1) ease-(--ease-out) hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)] focus-visible:bg-[var(--color-accent-soft)] focus-visible:text-[var(--color-accent-ink)]"
          onClick={(event) => event.stopPropagation()}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
          <span>{link.label}</span>
        </Link>
      ))}
    </div>
  );
}
