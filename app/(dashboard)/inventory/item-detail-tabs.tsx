"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ItemDetailTab } from "./item-detail";

type DetailTab = {
  value: ItemDetailTab;
  label: string;
  count?: ReactNode;
};

type ItemDetailTabsProps = {
  tabs: DetailTab[];
  initialActiveTab: ItemDetailTab;
  panels: Partial<Record<ItemDetailTab, ReactNode>>;
};

function TabCount({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function ItemDetailTabs({
  tabs,
  initialActiveTab,
  panels,
}: ItemDetailTabsProps) {
  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const [isPending, startTransition] = useTransition();
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setActiveTab(initialActiveTab);
  }, [initialActiveTab]);

  useEffect(() => {
    return () => {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
      }
    };
  }, []);

  const selectTab = (nextTab: ItemDetailTab) => {
    if (nextTab === activeTab) return;

    if (spinnerTimerRef.current) {
      clearTimeout(spinnerTimerRef.current);
    }

    setShowSpinner(true);
    startTransition(() => {
      setActiveTab(nextTab);
    });
    spinnerTimerRef.current = setTimeout(() => {
      setShowSpinner(false);
      spinnerTimerRef.current = null;
    }, 120);
  };

  return (
    <>
      <nav className="flex gap-1 overflow-x-auto px-6" aria-label="Item detail sections">
        {tabs.map((tab) => {
          const isActive = tab.value === activeTab;
          return (
            <button
              id={`item-detail-tab-${tab.value}`}
              key={tab.value}
              type="button"
              aria-current={isActive ? "page" : undefined}
              aria-controls={`item-detail-panel-${tab.value}`}
              className={cn(
                "inline-flex h-10 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              onClick={() => selectTab(tab.value)}
            >
              {tab.label}
              {tab.count != null ? <TabCount>{tab.count}</TabCount> : null}
            </button>
          );
        })}
      </nav>

      <div className="px-6 py-5" aria-busy={isPending || showSpinner}>
        {isPending || showSpinner ? (
          <div className="flex min-h-40 w-full items-center justify-center">
            <Spinner className="text-foreground" />
          </div>
        ) : (
          <section
            id={`item-detail-panel-${activeTab}`}
            aria-labelledby={`item-detail-tab-${activeTab}`}
          >
            {panels[activeTab]}
          </section>
        )}
      </div>
    </>
  );
}
