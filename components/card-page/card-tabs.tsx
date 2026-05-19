"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export type CardTab = {
  value: string;
  label: string;
  count?: ReactNode;
};

export type CardTabsProps = {
  tabs: CardTab[];
  defaultTab: string;
  panels: Record<string, ReactNode>;
  /** Optional persistent caption on the right side of the tab strip (e.g. "Ingredients · $X avg"). */
  caption?: ReactNode;
};

export function CardTabs({ tabs, defaultTab, panels, caption }: CardTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qsTab = searchParams.get("tab");
  const activeTab =
    qsTab && tabs.some((t) => t.value === qsTab) ? qsTab : defaultTab;

  // Tab change is instant per design §5: the body content swaps in place with
  // no spinner. URL update is fire-and-forget; React will rerender immediately.
  const selectTab = (next: string) => {
    if (next === activeTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <>
      <nav className={styles.tabs} aria-label="Card sections">
        {tabs.map((tab) => {
          const isActive = tab.value === activeTab;
          return (
            <button
              key={tab.value}
              type="button"
              aria-current={isActive ? "page" : undefined}
              aria-controls={`card-tab-panel-${tab.value}`}
              className={cn(styles.tab, isActive && styles.tabActive)}
              onClick={() => selectTab(tab.value)}
            >
              {tab.label}
              {tab.count != null ? (
                <span className={styles.tabCount}>{tab.count}</span>
              ) : null}
            </button>
          );
        })}
        {caption ? <div className={styles.tabsCaption}>{caption}</div> : null}
      </nav>

      <div className={styles.body}>
        <section
          id={`card-tab-panel-${activeTab}`}
          aria-labelledby={`card-tab-${activeTab}`}
        >
          {panels[activeTab]}
        </section>
      </div>
    </>
  );
}
