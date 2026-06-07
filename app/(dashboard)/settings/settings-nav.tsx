"use client";

import { usePathname } from "next/navigation";
import { NavigationLink } from "@/components/navigation-pending";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./sections";

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const pathname = usePathname();

  return (
    <nav
      className="-mx-(--space-8) flex h-(--height-subnav) min-w-0 shrink-0 items-center overflow-hidden border-b border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-8) md:-mx-(--space-12) md:px-(--space-12)"
      aria-label="Settings sections"
    >
      <div className="flex min-w-0 flex-1 items-center gap-(--space-2) overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => {
          const active =
            pathname === section.href || pathname.startsWith(`${section.href}/`);

          return (
            <NavigationLink
              key={section.id}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-(--height-subnav) shrink-0 items-center px-(--space-5) text-[length:var(--text-base)] leading-[var(--leading-sm)] font-medium text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]",
                active &&
                  "font-semibold text-[var(--color-ink)] shadow-[inset_0_-2px_0_var(--color-accent)]"
              )}
            >
              {section.title}
            </NavigationLink>
          );
        })}
      </div>
    </nav>
  );
}
