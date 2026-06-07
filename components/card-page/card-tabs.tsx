"use client";

import { useEffect, useReducer, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { updateSearchParams } from "@/lib/routing/search-params";
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

type CardTabState = {
  committedTab: string;
  optimisticTab: string;
  requestedRouteTab: string | null;
};

type CardTabAction =
  | { type: "commit"; tab: string; controlled: boolean }
  | { type: "request-route"; tab: string }
  | { type: "select-local"; tab: string };

function cardTabReducer(state: CardTabState, action: CardTabAction): CardTabState {
  switch (action.type) {
    case "commit": {
      if (
        state.committedTab === action.tab &&
        state.optimisticTab === action.tab &&
        state.requestedRouteTab == null
      ) {
        return state;
      }

      const requestedRouteTab =
        state.requestedRouteTab === action.tab ? null : state.requestedRouteTab;

      return {
        committedTab: action.tab,
        optimisticTab:
          action.controlled || requestedRouteTab == null
            ? action.tab
            : state.optimisticTab,
        requestedRouteTab,
      };
    }
    case "request-route":
      return {
        ...state,
        requestedRouteTab: action.tab,
      };
    case "select-local":
      return {
        ...state,
        optimisticTab: action.tab,
      };
  }
}

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
  const [tabState, dispatchTabState] = useReducer(cardTabReducer, activeTab, (tab) => ({
    committedTab: tab,
    optimisticTab: tab,
    requestedRouteTab: null,
  }));
  const visibleTab = controlledActiveTab != null
    ? tabState.requestedRouteTab ?? activeTab
    : tabState.optimisticTab;
  const isRouteTabLoading = controlledActiveTab != null && visibleTab !== activeTab;
  const renderedTab = controlledActiveTab != null ? activeTab : tabState.optimisticTab;

  useEffect(() => {
    dispatchTabState({
      type: "commit",
      tab: activeTab,
      controlled: controlledActiveTab != null,
    });
  }, [activeTab, controlledActiveTab]);

  const selectTab = (next: string) => {
    if (next === activeTab) return;
    if (!isEnabledTab(next)) return;
    dispatchTabState({ type: "select-local", tab: next });
    const params = updateSearchParams(searchParams, { tab: next });
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const requestRouteTab = (event: MouseEvent<HTMLAnchorElement>, next: string) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    dispatchTabState({ type: "request-route", tab: next });
  };

  return (
    <>
      <nav className={styles.tabs} aria-label="Card sections">
        {tabs.map((tab) => {
          const isActive = tab.value === visibleTab;
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
                onClick={(event) => requestRouteTab(event, tab.value)}
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
          id={`card-tab-panel-${visibleTab}`}
          aria-labelledby={`card-tab-${visibleTab}`}
        >
          {isRouteTabLoading ? (
            <div className={styles.tabLoading} role="status" aria-live="polite">
              <Spinner className="size-5" />
            </div>
          ) : (
            children ?? panels?.[renderedTab] ?? null
          )}
        </section>
      </div>
    </>
  );
}
