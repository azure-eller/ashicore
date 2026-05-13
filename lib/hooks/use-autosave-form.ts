"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

import type { AutosaveState } from "@/components/autosave-status";

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

type UseAutosaveFormOptions<TValues extends FieldValues, TPayload> = {
  form: UseFormReturn<TValues>;
  enabled?: boolean;
  debounceMs?: number;
  buildPayload: (values: TValues) => TPayload | null;
  save: (payload: TPayload) => Promise<TValues | void>;
  fingerprint?: (payload: TPayload) => string;
  onError?: (error: ApiError) => void;
};

type QueuedSave<TPayload> = {
  payload: TPayload;
  waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>;
};

function defaultFingerprint<TPayload>(payload: TPayload) {
  return JSON.stringify(payload);
}

export function useAutosaveForm<TValues extends FieldValues, TPayload>({
  form,
  enabled = true,
  debounceMs = 1200,
  buildPayload,
  save,
  fingerprint = defaultFingerprint,
  onError,
}: UseAutosaveFormOptions<TValues, TPayload>) {
  const [state, setState] = useState<AutosaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const watchedValues = form.watch();
  const isSavingRef = useRef(false);
  const queuedRef = useRef<QueuedSave<TPayload> | null>(null);
  const lastSavedFingerprintRef = useRef<string | null>(null);
  const saveRef = useRef(save);
  const buildPayloadRef = useRef(buildPayload);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    saveRef.current = save;
    buildPayloadRef.current = buildPayload;
    onErrorRef.current = onError;
  }, [buildPayload, onError, save]);

  const currentPayloadResult = useMemo(() => {
    if (!enabled) {
      return { payload: null, error: null };
    }

    try {
      return {
        payload: buildPayloadRef.current(watchedValues as TValues),
        error: null,
      };
    } catch (error) {
      return { payload: null, error };
    }
  }, [enabled, watchedValues]);
  const currentPayload = currentPayloadResult.payload;

  const runSave = useCallback(async function runSave(payload: TPayload) {
    if (isSavingRef.current) {
      return new Promise<void>((resolve, reject) => {
        queuedRef.current = {
          payload,
          waiters: [...(queuedRef.current?.waiters ?? []), { resolve, reject }],
        };
      });
    }

    isSavingRef.current = true;
    setState("saving");
    setMessage(null);

    try {
      const savedValues = await saveRef.current(payload);
      lastSavedFingerprintRef.current = fingerprint(payload);
      if (savedValues) {
        form.reset(savedValues);
      } else {
        form.reset(form.getValues());
      }
      setState("saved");
      setMessage(null);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.errors) {
        Object.entries(apiError.errors).forEach(([field, messages]) => {
          form.setError(field as Path<TValues>, {
            type: "server",
            message: messages[0],
          });
        });
      }
      setState("error");
      setMessage(apiError.error ?? "Could not save");
      onErrorRef.current?.(apiError);
      throw apiError;
    } finally {
      isSavingRef.current = false;

      const queuedSave = queuedRef.current;
      queuedRef.current = null;
      if (
        queuedSave &&
        fingerprint(queuedSave.payload) !== lastSavedFingerprintRef.current
      ) {
        void runSave(queuedSave.payload)
          .then(() => {
            queuedSave.waiters.forEach((waiter) => waiter.resolve());
          })
          .catch((queuedError) => {
            queuedSave.waiters.forEach((waiter) => waiter.reject(queuedError));
          });
      } else if (queuedSave) {
        queuedSave.waiters.forEach((waiter) => waiter.resolve());
      }
    }
  }, [fingerprint, form]);

  useEffect(() => {
    if (!enabled) {
      setState("blocked");
      return;
    }

    if (currentPayloadResult.error) {
      setState("error");
      setMessage("Fix highlighted fields");
      return;
    }

    if (!form.formState.isDirty || currentPayload == null) {
      if (!isSavingRef.current && state !== "saved") {
        setState("idle");
      }
      return;
    }

    const nextFingerprint = fingerprint(currentPayload);
    if (nextFingerprint === lastSavedFingerprintRef.current) {
      return;
    }

    setState("dirty");
    setMessage(null);
    const timeout = window.setTimeout(() => {
      void form.handleSubmit(
        () => {
          void runSave(currentPayload).catch(() => undefined);
        },
        () => {
          setState("error");
          setMessage("Fix highlighted fields");
        }
      )();
    }, debounceMs);

    return () => window.clearTimeout(timeout);
  }, [
    currentPayload,
    currentPayloadResult.error,
    debounceMs,
    enabled,
    fingerprint,
    form,
    runSave,
    state,
  ]);

  return {
    state,
    message,
    saveNow: () => {
      let payload: TPayload | null;
      try {
        payload = buildPayloadRef.current(form.getValues());
      } catch (error) {
        setState("error");
        setMessage("Fix highlighted fields");
        return Promise.reject(error);
      }
      if (!payload) return Promise.resolve();
      return runSave(payload);
    },
  };
}
