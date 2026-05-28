"use client";

import { usePathname } from "next/navigation";
import { NavigationLink } from "@/components/navigation-pending";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./sections";

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const pathname = usePathname();

  return (
    <nav
      className="w-full xl:sticky xl:top-(--space-12) xl:self-start"
      aria-label="Settings sections"
    >
      <div className="border bg-card p-(--space-4)">
        <div className="hidden border-b pb-(--space-4) text-[length:var(--text-sm)] font-semibold leading-[var(--leading-sm)] text-foreground xl:block">
          Settings
        </div>
        <div className="flex gap-(--space-2) overflow-x-auto xl:flex-col xl:gap-0 xl:pt-(--space-4)">
          {sections.map((section) => {
            const active =
              pathname === section.href || pathname.startsWith(`${section.href}/`);

            return (
              <NavigationLink
                key={section.id}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 px-(--space-6) py-(--space-3) text-left text-[length:var(--text-sm)] leading-[var(--leading-sm)] transition-colors xl:w-full",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {section.title}
              </NavigationLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
