"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "@/lib/client/api";

const LOCAL_STORAGE_PREFIX = "ashicore.viewPreferences.";

type PersistentViewStateOptions<TValue extends Record<string, unknown>> = {
  viewKey: string;
  defaultValue: TValue;
  debounceMs?: number;
};

function storageKey(viewKey: string) {
  return `${LOCAL_STORAGE_PREFIX}${viewKey}`;
}

function readLocalValue<TValue>(key: string, fallback: TValue): TValue {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed != null ? (parsed as TValue) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalValue<TValue>(key: string, value: TValue) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preference persistence is best-effort.
  }
}

function updatedAtMs(value: Record<string, unknown>) {
  return typeof value.updatedAt === "string" ? Date.parse(value.updatedAt) || 0 : 0;
}

function withUpdatedAt<TValue extends Record<string, unknown>>(value: TValue): TValue {
  return {
    ...value,
    updatedAt: new Date().toISOString(),
  };
}

function valuesDiffer(left: unknown, right: unknown) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export function usePersistentViewState<TValue extends Record<string, unknown>>({
  viewKey,
  defaultValue,
  debounceMs = 3000,
}: PersistentViewStateOptions<TValue>) {
  const endpoint = useMemo(
    () => `/api/preferences/views/${encodeURIComponent(viewKey)}`,
    [viewKey]
  );
  const localStorageKey = useMemo(() => storageKey(viewKey), [viewKey]);
  const [value, setValue] = useState<TValue>(() =>
    readLocalValue(localStorageKey, defaultValue)
  );
  const valueRef = useRef(value);
  const pendingSaveRef = useRef<TValue | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const saveNow = useCallback(
    (nextValue: TValue, keepalive = false) => {
      pendingSaveRef.current = null;
      void fetch(endpoint, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nextValue),
        credentials: "same-origin",
        keepalive,
      }).catch(() => undefined);
    },
    [endpoint]
  );

  const scheduleSave = useCallback(
    (nextValue: TValue) => {
      pendingSaveRef.current = nextValue;
      if (saveTimeoutRef.current != null) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        const pending = pendingSaveRef.current;
        if (pending) {
          saveNow(pending);
        }
      }, debounceMs);
    },
    [debounceMs, saveNow]
  );

  const flushPendingSave = useCallback(
    (keepalive = false) => {
      if (saveTimeoutRef.current != null) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      const pending = pendingSaveRef.current;
      if (pending) {
        saveNow(pending, keepalive);
      }
    },
    [saveNow]
  );

  const setPersistentValue = useCallback(
    (next: TValue | ((current: TValue) => TValue)) => {
      const resolved =
        typeof next === "function"
          ? (next as (current: TValue) => TValue)(valueRef.current)
          : next;
      const stamped = withUpdatedAt(resolved);
      valueRef.current = stamped;
      setValue(stamped);
      writeLocalValue(localStorageKey, stamped);
      scheduleSave(stamped);
    },
    [localStorageKey, scheduleSave]
  );

  useEffect(() => {
    let cancelled = false;

    void apiJson<TValue>(endpoint, {
      fallbackError: "Failed to load view preferences.",
    })
      .then((serverValue) => {
        if (cancelled) return;

        const localValue = valueRef.current;
        const serverTime = updatedAtMs(serverValue);
        const localTime = updatedAtMs(localValue);

        if (
          serverTime > localTime ||
          (serverTime === localTime &&
            localTime === 0 &&
            valuesDiffer(serverValue, localValue))
        ) {
          valueRef.current = serverValue;
          setValue(serverValue);
          writeLocalValue(localStorageKey, serverValue);
          return;
        }

        if (localTime > serverTime) {
          scheduleSave(localValue);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [endpoint, localStorageKey, scheduleSave]);

  useEffect(() => {
    const handlePageHide = () => flushPendingSave(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave(true);
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingSave();
    };
  }, [flushPendingSave]);

  return [value, setPersistentValue] as const;
}
