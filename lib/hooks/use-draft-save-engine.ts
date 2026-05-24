"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type DraftSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type QueuedDraftOp<TOp> = {
  op: TOp;
  revision: number;
};

export type DraftServerMergeContext<TOp> = {
  savedOps: Array<QueuedDraftOp<TOp>>;
  saveStartedRevision: number;
  currentRevision: number;
  hasNewerLocalEdits: boolean;
  source: "create" | "save" | "refresh";
};

export type DraftSaveEngineConfig<TEntity, TOp, TResult> = {
  initialDraft: TEntity;
  initialServerSnapshot?: TEntity | null;
  initialId?: string | null;
  isSaveable: (draft: TEntity) => boolean;
  applyOp: (draft: TEntity, op: TOp, revision: number) => TEntity;
  coalesceOps?: (
    existing: Array<QueuedDraftOp<TOp>>,
    next: QueuedDraftOp<TOp>,
  ) => Array<QueuedDraftOp<TOp>>;
  create: (draft: TEntity, ops: Array<QueuedDraftOp<TOp>>) => Promise<TResult>;
  save: (
    id: string,
    draft: TEntity,
    ops: Array<QueuedDraftOp<TOp>>,
  ) => Promise<TResult | null>;
  getResultId: (result: TResult) => string;
  applyPersistedIdentity: (draft: TEntity, result: TResult) => TEntity;
  mergeServerOwnedFields: (
    draft: TEntity,
    result: TResult,
    context: DraftServerMergeContext<TOp>,
  ) => TEntity;
  onPersisted?: (id: string) => void;
  onResult?: (result: TResult, draft: TEntity) => void;
  getErrorMessage?: (error: unknown) => string;
};

export type DraftSaveEngine<TEntity, TOp, TResult> = {
  draft: TEntity;
  currentId: string | null;
  hasPersistedEntity: boolean;
  status: DraftSaveStatus;
  error: string | null;
  applyLocalOp: (op: TOp, delayMs?: number) => void;
  flush: () => Promise<void>;
  resetToServer: () => void;
  mergeServerResult: (
    result: TResult,
    source?: DraftServerMergeContext<TOp>["source"],
  ) => void;
  hasPendingOps: () => boolean;
};

export function useDraftSaveEngine<TEntity, TOp, TResult>({
  initialDraft,
  initialServerSnapshot = null,
  initialId = null,
  isSaveable,
  applyOp,
  coalesceOps,
  create,
  save,
  getResultId,
  applyPersistedIdentity,
  mergeServerOwnedFields,
  onPersisted,
  onResult,
  getErrorMessage = defaultErrorMessage,
}: DraftSaveEngineConfig<TEntity, TOp, TResult>): DraftSaveEngine<TEntity, TOp, TResult> {
  const [draft, setDraft] = useState<TEntity>(initialDraft);
  const [currentId, setCurrentId] = useState<string | null>(initialId);
  const [status, setStatus] = useState<DraftSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const draftRef = useRef(draft);
  const serverSnapshotRef = useRef<TEntity | null>(initialServerSnapshot);
  const currentIdRef = useRef<string | null>(initialId);
  const revisionRef = useRef(0);
  const pendingOpsRef = useRef<Array<QueuedDraftOp<TOp>>>([]);
  const savingRef = useRef(false);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDraftState = useCallback((next: TEntity) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const setPersistedId = useCallback((id: string) => {
    currentIdRef.current = id;
    setCurrentId(id);
  }, []);

  const scheduleFlush = useCallback((delayMs: number) => {
    if (!Number.isFinite(delayMs)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushRef.current().catch(() => undefined);
    }, delayMs);
  }, []);

  const applyLocalOp = useCallback(
    (op: TOp, delayMs = 0) => {
      const revision = revisionRef.current + 1;
      revisionRef.current = revision;
      const queued = { op, revision };
      pendingOpsRef.current = coalesceOps
        ? coalesceOps(pendingOpsRef.current, queued)
        : [...pendingOpsRef.current, queued];
      setStatus((current) => (current === "saving" ? current : "dirty"));
      setDraftState(applyOp(draftRef.current, op, revision));
      scheduleFlush(delayMs);
    },
    [applyOp, coalesceOps, scheduleFlush, setDraftState],
  );

  const hasPendingOps = useCallback(() => pendingOpsRef.current.length > 0, []);

  const applyResult = useCallback(
    (
      result: TResult,
      savedOps: Array<QueuedDraftOp<TOp>>,
      saveStartedRevision: number,
      source: DraftServerMergeContext<TOp>["source"],
    ) => {
      const currentRevision = revisionRef.current;
      let next = draftRef.current;
      if (source === "create") {
        const id = getResultId(result);
        next = applyPersistedIdentity(next, result);
        setDraftState(next);
        setPersistedId(id);
        onPersisted?.(id);
      }

      next = mergeServerOwnedFields(next, result, {
        savedOps,
        saveStartedRevision,
        currentRevision,
        hasNewerLocalEdits: currentRevision > saveStartedRevision,
        source,
      });
      serverSnapshotRef.current = next;
      setDraftState(next);
      onResult?.(result, next);
    },
    [
      applyPersistedIdentity,
      getResultId,
      mergeServerOwnedFields,
      onPersisted,
      onResult,
      setDraftState,
      setPersistedId,
    ],
  );

  const runFlush = useCallback(async () => {
    if (savingRef.current) return flushPromiseRef.current ?? Promise.resolve();
    if (!isSaveable(draftRef.current)) {
      flushPromiseRef.current = null;
      return;
    }

    savingRef.current = true;
    setStatus("saving");
    setError(null);
    let activeOps: Array<QueuedDraftOp<TOp>> = [];

    try {
      do {
        const saveStartedRevision = revisionRef.current;
        const ops = pendingOpsRef.current;
        const savedOps = [...ops];
        activeOps = ops;
        pendingOpsRef.current = [];
        const id = currentIdRef.current;
        const draftForSave = draftRef.current;

        if (!id) {
          const result = await create(draftForSave, ops);
          applyResult(result, savedOps, saveStartedRevision, "create");
        } else if (ops.length > 0) {
          const result = await save(id, draftForSave, ops);
          if (result) {
            applyResult(result, savedOps, saveStartedRevision, "save");
          }
        }
        activeOps = [];
      } while (pendingOpsRef.current.length > 0);

      setStatus("saved");
    } catch (flushError) {
      pendingOpsRef.current = [...activeOps, ...pendingOpsRef.current];
      const message = getErrorMessage(flushError);
      setError(message);
      setStatus("error");
      throw flushError;
    } finally {
      savingRef.current = false;
      flushPromiseRef.current = null;
    }
  }, [applyResult, create, getErrorMessage, isSaveable, save]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!flushPromiseRef.current) {
      const nextPromise = runFlush().finally(() => {
        if (flushPromiseRef.current === nextPromise) {
          flushPromiseRef.current = null;
        }
      });
      flushPromiseRef.current = nextPromise;
    }
    return flushPromiseRef.current;
  }, [runFlush]);
  flushRef.current = flush;

  const resetToServer = useCallback(() => {
    const snapshot = serverSnapshotRef.current;
    if (!snapshot) return;
    pendingOpsRef.current = [];
    setDraftState(snapshot);
    setStatus("saved");
    setError(null);
  }, [setDraftState]);

  const mergeServerResult = useCallback(
    (result: TResult, source: DraftServerMergeContext<TOp>["source"] = "refresh") => {
      if (savingRef.current || pendingOpsRef.current.length > 0) return;
      const saveStartedRevision = revisionRef.current;
      applyResult(result, [], saveStartedRevision, source);
    },
    [applyResult],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useMemo(
    () => ({
      draft,
      currentId,
      hasPersistedEntity: currentId != null,
      status,
      error,
      applyLocalOp,
      flush,
      resetToServer,
      mergeServerResult,
      hasPendingOps,
    }),
    [
      applyLocalOp,
      currentId,
      draft,
      error,
      flush,
      hasPendingOps,
      mergeServerResult,
      resetToServer,
      status,
    ],
  );
}

function defaultErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Save failed";
}
