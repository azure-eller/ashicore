"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./sections";

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 lg:flex-col lg:gap-1" aria-label="Settings sections">
      {sections.map((section) => {
        const isActive =
          pathname === section.href || pathname.startsWith(`${section.href}/`);

        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {section.title}
          </Link>
        );
      })}
    </nav>
  );
}
