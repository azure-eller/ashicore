"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  start: () => void;
};

const NavigationPendingContext =
  createContext<NavigationPendingContextValue | null>(null);

export function NavigationPendingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [pendingPathname, setPendingPathname] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    setPendingPathname(pathname);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setPendingPathname(null);
      timeoutRef.current = null;
    }, 10_000);
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const value = useMemo(() => ({ start }), [start]);
  const pending = pendingPathname === pathname;

  return (
    <NavigationPendingContext.Provider value={value}>
      {children}
      {pending ? (
        <div className="pointer-events-none fixed right-4 top-4 rounded-md border bg-background px-3 py-2 text-muted-foreground shadow-xs">
          <Spinner className="text-foreground" />
        </div>
      ) : null}
    </NavigationPendingContext.Provider>
  );
}

export function useNavigationPending() {
  const context = useContext(NavigationPendingContext);

  if (!context) {
    return { start: () => {} };
  }

  return context;
}

export function NavigationLink({
  onClick,
  target,
  ...props
}: React.ComponentProps<typeof Link>) {
  const { start } = useNavigationPending();

  return (
    <Link
      {...props}
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

        start();
      }}
    />
  );
}
