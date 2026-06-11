"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavigationLink } from "@/components/navigation-pending";
import { cn } from "@/lib/utils";
import type { SettingsGroup } from "./sections";

export function SettingsNav({ groups }: { groups: SettingsGroup[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings sections"
      className="-mx-(--space-4) flex min-w-0 gap-(--space-1) overflow-x-auto border-b border-border px-(--space-4) pb-(--space-3) lg:sticky lg:top-(--space-10) lg:mx-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:px-0 lg:pb-0 lg:self-start"
    >
      <div className="hidden px-(--space-5) pb-(--space-6) text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold tracking-[var(--tracking-tight)] text-[var(--color-ink)] lg:block">
        Settings
      </div>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.label}>
          <div
            className={cn(
              "hidden px-(--space-5) pb-(--space-3) font-mono text-[length:var(--text-3xs)] leading-[var(--leading-2xs)] font-semibold tracking-[0.11em] text-[var(--color-ink-faint)] uppercase lg:block",
              groupIndex > 0 && "pt-(--space-7)"
            )}
          >
            {group.label}
          </div>
          {group.sections.map((section) => {
            const active =
              pathname === section.href || pathname.startsWith(`${section.href}/`);

            return (
              <NavigationLink
                key={section.id}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-(--height-input-sm) shrink-0 items-center gap-(--space-3) rounded-(--radius-md) px-(--space-4) text-[length:var(--text-sm)] leading-[var(--leading-sm)] font-medium whitespace-nowrap text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)] lg:gap-(--space-5) lg:px-(--space-5)",
                  active &&
                    "bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
                )}
              >
                <HugeiconsIcon
                  icon={section.icon}
                  size={16}
                  strokeWidth={1.8}
                  className={cn("shrink-0 opacity-70", active && "opacity-100")}
                  aria-hidden
                />
                {section.title}
              </NavigationLink>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
