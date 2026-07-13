"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import {
  getCardKernel,
  type CardKernel,
  type CardKernelConfig,
  type FlushOutcome,
  type KernelSnapshot,
} from "./kernel";

export type CardKernelHandle<TDoc> = KernelSnapshot<TDoc> & {
  update: CardKernel<TDoc, unknown>["update"];
  flush: () => Promise<FlushOutcome>;
  resetToServer: () => void;
  adoptServerDoc: (doc: TDoc) => void;
  /** Server-known id (differs from the kernel id when the server assigns
   *  ids on create); null until persisted. */
  persistedId: string | null;
  /** Live read of persistedId — safe inside async closures that run after a
   *  flush persisted the doc (snapshot fields would be stale). */
  getPersistedId: () => string | null;
  /** Canonical pill mapping — one place, not one per card. */
  saveState: CardSaveState;
  saveMessage: string | null;
};

export function useCardKernel<TDoc, TPayload>(
  config: CardKernelConfig<TDoc, TPayload>,
): CardKernelHandle<TDoc> {
  // Idempotent registry lookup: same id → same kernel, every render.
  const kernel = getCardKernel(config);
  kernel.setConfig(config);

  const initialServerDoc = config.initialServerDoc;
  useEffect(() => {
    // A remount may carry a fresher RSC doc than the kernel's serverDoc (or a
    // staler one, which adoptServerDoc ignores via the version check).
    if (initialServerDoc != null) kernel.adoptServerDoc(initialServerDoc);
  }, [kernel, initialServerDoc]);

  const snapshot = useSyncExternalStore(
    kernel.subscribe,
    kernel.getSnapshot,
    kernel.getSnapshot,
  );

  return {
    ...snapshot,
    update: kernel.update.bind(kernel),
    flush: kernel.flush,
    resetToServer: kernel.resetToServer,
    adoptServerDoc: kernel.adoptServerDoc,
    persistedId: snapshot.serverDoc
      ? config.readId?.(snapshot.serverDoc) ?? config.id
      : null,
    getPersistedId: () => kernel.persistedId,
    saveState: saveStateFor(snapshot),
    saveMessage: saveMessageFor(snapshot),
  };
}

function saveStateFor(snapshot: KernelSnapshot<unknown>): CardSaveState {
  switch (snapshot.status) {
    case "saving":
      return "saving";
    case "dirty":
      // An unpersisted dirty draft that can't create yet (schema error or
      // create gate — snapshot.error carries the reason) is not en route to
      // being saved; say so instead of "Saving...".
      return snapshot.isPersisted || snapshot.error == null
        ? "saving"
        : "not_saved";
    case "blocked":
      return snapshot.isPersisted ? "failed" : "not_saved";
    case "error":
      return "failed";
    default:
      return snapshot.isPersisted ? "saved" : "not_saved";
  }
}

function saveMessageFor(snapshot: KernelSnapshot<unknown>): string | null {
  if (snapshot.status === "saving") return null;
  if (snapshot.status === "blocked" || snapshot.status === "error") {
    return snapshot.error;
  }
  if (!snapshot.isPersisted) return snapshot.error;
  return snapshot.status === "idle" ? "Saved" : null;
}
