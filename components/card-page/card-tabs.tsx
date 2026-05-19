"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export type CardTab = {
  value: string;
  label: string;
  count?: ReactNode;
  href?: string;
  disabled?: boolean;
  disabledReason?: string;
};

export type CardTabsProps = {
  tabs: CardTab[];
  defaultTab: string;
  panels?: Record<string, ReactNode>;
  activeTab?: string;
  children?: ReactNode;
  /** Optional persistent caption on the right side of the tab strip (e.g. "Ingredients · $X avg"). */
  caption?: ReactNode;
};

export function CardTabs({
  tabs,
  defaultTab,
  panels,
  activeTab: controlledActiveTab,
  children,
  caption,
}: CardTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qsTab = searchParams.get("tab");
  const isEnabledTab = (value: string) =>
    tabs.some((tab) => tab.value === value && !tab.disabled);
  const activeTab =
    controlledActiveTab ??
    (qsTab && isEnabledTab(qsTab) ? qsTab : defaultTab);
  const [optimisticTab, setOptimisticTab] = useState(activeTab);
  const isRouteTabLoading = controlledActiveTab != null && optimisticTab !== activeTab;
  const renderedTab = controlledActiveTab != null ? activeTab : optimisticTab;

  useEffect(() => {
    setOptimisticTab(activeTab);
  }, [activeTab]);

  const selectTab = (next: string) => {
    if (next === activeTab) return;
    if (!isEnabledTab(next)) return;
    setOptimisticTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <>
      <nav className={styles.tabs} aria-label="Card sections">
        {tabs.map((tab) => {
          const isActive = tab.value === optimisticTab;
          if (tab.disabled) {
            return (
              <button
                key={tab.value}
                type="button"
                aria-current={isActive ? "page" : undefined}
                aria-controls={`card-tab-panel-${tab.value}`}
                aria-disabled="true"
                className={cn(styles.tab, styles.tabDisabled, isActive && styles.tabActive)}
                title={tab.disabledReason}
                disabled
              >
                {tab.label}
                {tab.count != null ? (
                  <span className={styles.tabCount}>{tab.count}</span>
                ) : null}
              </button>
            );
          }

          return (
            tab.href ? (
              <Link
                key={tab.value}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                aria-controls={`card-tab-panel-${tab.value}`}
                className={cn(styles.tab, isActive && styles.tabActive)}
                onClick={() => setOptimisticTab(tab.value)}
                prefetch
              >
                {tab.label}
                {tab.count != null ? (
                  <span className={styles.tabCount}>{tab.count}</span>
                ) : null}
              </Link>
            ) : (
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
            )
          );
        })}
        {caption ? <div className={styles.tabsCaption}>{caption}</div> : null}
      </nav>

      <div className={styles.body}>
        <section
          id={`card-tab-panel-${optimisticTab}`}
          aria-labelledby={`card-tab-${optimisticTab}`}
        >
          {isRouteTabLoading ? (
            <div className={styles.tabLoading} role="status" aria-live="polite">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : (
            children ?? panels?.[renderedTab] ?? null
          )}
        </section>
      </div>
    </>
  );
}
