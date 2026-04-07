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
      className="hidden lg:sticky lg:top-16 lg:block lg:self-start"
      aria-label="Settings sections"
    >
      <div className="flex flex-col">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => handleClick(section.id)}
            className={cn(
              "border-l-2 px-3 py-1.5 text-left text-sm transition-colors",
              activeId === section.id
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {section.title}
          </button>
        ))}
      </div>
    </nav>
  );
}
