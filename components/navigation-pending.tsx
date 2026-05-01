"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner } from "@/components/ui/spinner";

type NavigationPendingContextValue = {
  pending: boolean;
  start: (href?: React.ComponentProps<typeof Link>["href"]) => void;
};

const NavigationPendingContext =
  createContext<NavigationPendingContextValue | null>(null);

export function NavigationPendingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocation = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  const [pending, setPending] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLocationRef = useRef(currentLocation);

  const start = useCallback((href?: React.ComponentProps<typeof Link>["href"]) => {
    const targetLocation = getComparableLocation(href);

    if (targetLocation === currentLocation) {
      return;
    }

    setPending(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (settleTimeoutRef.current) {
      clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
    }
    timeoutRef.current = setTimeout(() => {
      setPending(false);
      timeoutRef.current = null;
    }, 10_000);
  }, [currentLocation]);

  useEffect(() => {
    if (previousLocationRef.current === currentLocation) {
      return;
    }

    previousLocationRef.current = currentLocation;

    if (!pending) {
      return;
    }

    settleTimeoutRef.current = setTimeout(() => {
      setPending(false);
      settleTimeoutRef.current = null;
    }, 250);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [currentLocation, pending]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
      }
    };
  }, []);

  const value = useMemo(() => ({ pending, start }), [pending, start]);

  return (
    <NavigationPendingContext.Provider value={value}>
      {children}
      {pending ? (
        <div className="pointer-events-none fixed right-4 top-4 z-50 rounded-md border bg-background p-3 shadow-xs">
          <Spinner className="text-foreground" />
        </div>
      ) : null}
    </NavigationPendingContext.Provider>
  );
}

export function useNavigationPending() {
  const context = useContext(NavigationPendingContext);

  if (!context) {
    return { pending: false, start: () => {} };
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

function getComparableLocation(href?: React.ComponentProps<typeof Link>["href"]) {
  if (!href) {
    return null;
  }

  if (typeof href === "string") {
    const url = new URL(href, window.location.origin);
    return `${url.pathname}${url.search}`;
  }

  const pathname = href.pathname ?? window.location.pathname;
  const params = new URLSearchParams();

  if (href.query) {
    for (const [key, value] of Object.entries(href.query)) {
      if (value == null) {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, String(item)));
        continue;
      }

      params.set(key, String(value));
    }
  }

  const query = params.size > 0 ? `?${params.toString()}` : "";

  return `${pathname}${query}`;
}
