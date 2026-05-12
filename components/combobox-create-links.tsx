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
    <div className={cn("border-t border-border p-1", className)}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
          <span>{link.label}</span>
        </Link>
      ))}
    </div>
  );
}
