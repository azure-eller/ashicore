"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DataTableLoading from "@/components/data-table-loading";
import {
  getDashboardRouteShell,
  resolveDashboardNavigationHref,
  sanitizeDashboardNavigationPath,
  type DashboardRouteShell,
} from "@/lib/dashboard-navigation";
import { appendSearchParams } from "@/lib/routing/search-params";

type NavigationPendingContextValue = {
  pending: boolean;
  pathname: string;
  optimisticPathname: string | null;
  optimisticShell: DashboardRouteShell | null;
  start: (href?: LinkHref) => string | null;
  navigate: (href: string) => void;
};

type LinkHref = React.ComponentProps<typeof Link>["href"];

type NavigationMetric = {
  navId: string;
  fromPath: string;
  toPath: string;
  startedAt: number;
  sampled: boolean;
  optimisticShellMs: number | null;
  routeCommitMs: number | null;
  timedOut: boolean;
};

const NAVIGATION_TIMEOUT_MS = 10_000;
const NAVIGATION_SETTLE_MS = 150;
const DEFAULT_NAVIGATION_TELEMETRY_SAMPLE_RATE = 0.05;
const NAVIGATION_TELEMETRY_SAMPLE_RATE = parseSampleRate(
  process.env.NEXT_PUBLIC_NAVIGATION_TELEMETRY_SAMPLE_RATE
);

const NavigationPendingContext =
  createContext<NavigationPendingContextValue | null>(null);

export function NavigationPendingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocation = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  const [optimisticShell, setOptimisticShell] =
    useState<DashboardRouteShell | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metricRef = useRef<NavigationMetric | null>(null);
  const previousLocationRef = useRef(currentLocation);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (settleTimeoutRef.current) {
      clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
    }
  }, []);

  const finish = useCallback(
    (timedOut: boolean) => {
      const metric = metricRef.current;

      clearTimers();
      setOptimisticShell(null);
      metricRef.current = null;

      if (!metric?.sampled) {
        return;
      }

      sendNavigationMetric({
        ...metric,
        timedOut,
        routeCommitMs:
          metric.routeCommitMs ??
          Math.max(0, Math.round(performance.now() - metric.startedAt)),
      });
    },
    [clearTimers]
  );

  const start = useCallback(
    (href?: LinkHref) => {
      const target = getComparableLocation(href);

      if (!target) {
        return null;
      }

      const resolvedHref = resolveDashboardNavigationHref(target);

      if (resolvedHref === currentLocation) {
        return null;
      }

      clearTimers();
      const shell = getDashboardRouteShell(resolvedHref);
      const startedAt = performance.now();

      metricRef.current = {
        navId: crypto.randomUUID(),
        fromPath: sanitizeDashboardNavigationPath(pathname),
        toPath: sanitizeDashboardNavigationPath(
          new URL(resolvedHref, window.location.origin).pathname
        ),
        startedAt,
        sampled: Math.random() < NAVIGATION_TELEMETRY_SAMPLE_RATE,
        optimisticShellMs: null,
        routeCommitMs: null,
        timedOut: false,
      };

      setOptimisticShell(shell);
      timeoutRef.current = setTimeout(() => finish(true), NAVIGATION_TIMEOUT_MS);

      requestAnimationFrame(() => {
        if (metricRef.current?.navId) {
          metricRef.current.optimisticShellMs = Math.max(
            0,
            Math.round(performance.now() - startedAt)
          );
        }
      });

      return resolvedHref;
    },
    [clearTimers, currentLocation, finish, pathname]
  );

  const navigate = useCallback(
    (href: string) => {
      const resolvedHref = start(href) ?? resolveDashboardNavigationHref(href);
      router.push(resolvedHref);
    },
    [router, start]
  );

  useEffect(() => {
    if (previousLocationRef.current === currentLocation) {
      return;
    }

    previousLocationRef.current = currentLocation;

    if (!optimisticShell) {
      return;
    }

    const metric = metricRef.current;

    if (metric) {
      metric.routeCommitMs = Math.max(
        0,
        Math.round(performance.now() - metric.startedAt)
      );
    }

    settleTimeoutRef.current = setTimeout(() => finish(false), NAVIGATION_SETTLE_MS);
  }, [currentLocation, finish, optimisticShell]);

  useEffect(() => clearTimers, [clearTimers]);

  const value = useMemo(
    () => ({
      pending: optimisticShell != null,
      pathname,
      optimisticPathname: optimisticShell
        ? new URL(optimisticShell.href, window.location.origin).pathname
        : null,
      optimisticShell,
      start,
      navigate,
    }),
    [navigate, optimisticShell, pathname, start]
  );

  return (
    <NavigationPendingContext.Provider value={value}>
      {children}
    </NavigationPendingContext.Provider>
  );
}

export function useNavigationPending() {
  const context = useContext(NavigationPendingContext);

  if (!context) {
    return {
      pending: false,
      pathname: "",
      optimisticPathname: null,
      optimisticShell: null,
      start: () => null,
      navigate: () => {},
    } satisfies NavigationPendingContextValue;
  }

  return context;
}

export function NavigationLink({
  href,
  onClick,
  target,
  ...props
}: React.ComponentProps<typeof Link>) {
  const { start } = useNavigationPending();

  return (
    <Link
      {...props}
      href={href}
      target={target}
      onClick={(event) => {
        onClick?.(event);

        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (target != null && target !== "_self")
        ) {
          return;
        }

        start(href);
      }}
    />
  );
}

export function DashboardNavigationContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { optimisticShell } = useNavigationPending();

  if (!optimisticShell) {
    return children;
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="optimistic-dashboard-shell"
      aria-busy="true"
      aria-label={`Loading ${optimisticShell.title}`}
    >
      <div data-testid="optimistic-data-region">
        <DataTableLoading />
      </div>
    </div>
  );
}

function getComparableLocation(href?: LinkHref) {
  if (!href) {
    return null;
  }

  if (typeof href === "string") {
    const url = new URL(href, window.location.origin);

    if (url.origin !== window.location.origin) {
      return null;
    }

    return `${url.pathname}${url.search}`;
  }

  const pathname = href.pathname ?? window.location.pathname;
  if (typeof href.query === "string") {
    return href.query ? `${pathname}?${href.query}` : pathname;
  }
  return appendSearchParams(pathname, href.query ?? {});
}

function parseSampleRate(value: string | undefined) {
  if (!value) {
    return DEFAULT_NAVIGATION_TELEMETRY_SAMPLE_RATE;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(0, Math.min(1, parsed));
}

function getUserAgentClass() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    ? "mobile"
    : "desktop";
}

function sendNavigationMetric(metric: NavigationMetric) {
  const payload = JSON.stringify({
    navId: metric.navId,
    fromPath: metric.fromPath,
    toPath: metric.toPath,
    optimisticShellMs: metric.optimisticShellMs,
    routeCommitMs: metric.routeCommitMs,
    timedOut: metric.timedOut,
    userAgentClass: getUserAgentClass(),
  });

  const blob = new Blob([payload], { type: "application/json" });

  if (navigator.sendBeacon?.("/api/observability/navigation", blob)) {
    return;
  }

  void fetch("/api/observability/navigation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}
