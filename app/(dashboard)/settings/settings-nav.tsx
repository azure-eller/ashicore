"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./sections";

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[];

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );

    for (const el of elements) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  function handleClick(id: string) {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <nav
      className="order-first w-full xl:order-none xl:sticky xl:top-(--space-16) xl:self-start"
      aria-label="Settings sections"
    >
      <div className="border bg-card p-(--space-4)">
        <div className="hidden border-b pb-(--space-4) text-[length:var(--text-sm)] font-semibold leading-[var(--leading-sm)] text-foreground xl:block">
          Settings
        </div>
        <div className="flex gap-(--space-2) overflow-x-auto xl:flex-col xl:gap-0 xl:pt-(--space-4)">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => handleClick(section.id)}
            className={cn(
              "shrink-0 px-(--space-6) py-(--space-3) text-left text-[length:var(--text-sm)] leading-[var(--leading-sm)] transition-colors xl:w-full",
              activeId === section.id
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {section.title}
          </button>
        ))}
        </div>
      </div>
    </nav>
  );
}
