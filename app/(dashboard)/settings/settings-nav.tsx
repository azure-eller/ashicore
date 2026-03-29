"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./sections";

function groupLabel(group: SettingsSection["group"]) {
  return group === "admin" ? "Administration" : "Personal";
}

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const pathname = usePathname();
  const groups = sections.reduce<Record<SettingsSection["group"], SettingsSection[]>>(
    (acc, section) => {
      acc[section.group].push(section);
      return acc;
    },
    { personal: [], admin: [] }
  );

  const orderedGroups = (["personal", "admin"] as const).filter(
    (group) => groups[group].length > 0
  );

  return (
    <nav className="space-y-6" aria-label="Settings sections">
      {orderedGroups.map((group) => (
        <div key={group} className="space-y-2">
          <p className="px-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {groupLabel(group)}
          </p>
          <div className="space-y-1">
            {groups[group].map((section) => {
              const isActive =
                pathname === section.href || pathname.startsWith(`${section.href}/`);

              return (
                <Link
                  key={section.key}
                  href={section.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "block rounded-xl px-3 py-2.5 transition-colors",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <div className="text-sm font-medium">{section.title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {section.description}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
