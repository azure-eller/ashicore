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
    <nav className="w-full xl:sticky xl:top-20 xl:w-[220px] xl:self-start" aria-label="Settings sections">
      <div className="flex gap-2 overflow-x-auto rounded-xl border bg-card p-1 xl:flex-col xl:gap-0 xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => handleClick(section.id)}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors xl:rounded-none xl:border-l-2 xl:px-4",
              activeId === section.id
                ? "bg-muted font-medium text-foreground xl:border-foreground xl:bg-transparent"
                : "text-muted-foreground hover:bg-muted hover:text-foreground xl:border-transparent xl:hover:bg-transparent"
            )}
          >
            {section.title}
          </button>
        ))}
      </div>
    </nav>
  );
}
