"use client";

import {
  fieldErrorsFromIssues,
  firstFieldErrorMessage,
  isFieldErrorRecord,
  type FieldErrorRecord,
} from "@/lib/api/field-errors";
import {
  applyPaths,
  deepEqual,
  diffDocs,
  setAtPath,
  type CollectionSpec,
} from "./paths";

/**
 * Document-sync kernel for card autosave. One draft document + the last
 * server-confirmed document; "what needs saving" is always the computed diff
 * between them, never a queued log of edits. See docs/card-kernel.md.
 */

export type KernelStatus = "idle" | "dirty" | "saving" | "blocked" | "error";

export type FlushOutcome =
  | { outcome: "saved" }
  | { outcome: "blocked"; fieldErrors: FieldErrorRecord }
  | { outcome: "conflict"; error: string; conflictPaths: string[] }
  | { outcome: "failed"; error: string; fieldErrors: FieldErrorRecord | null };

export type SerializedDoc<TPayload> = {
  payload: TPayload;
  /**
   * Index-keyed payload path → rowId-keyed doc path, recorded while emitting
   * this exact payload (e.g. "lines.3.quantityOrdered" →
   * "lines.<rowId>.quantityOrdered"). Server validation errors come back
   * index-keyed and are translated through this map, so the error always
   * lands on the row the validator actually saw.
   */
  pathAliases?: Record<string, string>;
};

export type CardKernelConfig<TDoc, TPayload> = {
  entityType: string;
  /** Entity uuid — client-generated for never-persisted docs. */
  id: string;
  initialServerDoc: TDoc | null;
  makeNewDoc: (id: string) => TDoc;
  collections?: CollectionSpec;
  /** Pure, idempotent cascade math (totals, derived quantities). */
  derive?: (draft: TDoc) => TDoc;
  /** The SAME Zod schema module the API route parses the payload with. */
  schema: { safeParse: (value: unknown) => SafeParseResult };
  serialize: (draft: TDoc) => SerializedDoc<TPayload>;
  create: (
    payload: TPayload,
    opts: { idempotencyKey: string; keepalive?: boolean },
  ) => Promise<TDoc>;
  update: (
    id: string,
    payload: TPayload,
    opts: {
      expectedVersion: number | null;
      idempotencyKey: string;
      keepalive?: boolean;
    },
  ) => Promise<TDoc>;
  readVersion?: (doc: TDoc) => number | null;
  /**
   * Persisted entity id for update calls when the server assigns ids on
   * create (the kernel's own id stays the client-side registry key).
   * Defaults to the configured id.
   */
  readId?: (doc: TDoc) => string;
  /** Query-cache write-through for every server-confirmed doc. */
  onServerDoc?: (doc: TDoc) => void;
  /** First successful persist of a new doc (reflect URL, etc.). */
  onCreated?: (doc: TDoc) => void;
  debounceMs?: number;
};

type SafeParseResult =
  | { success: true; data: unknown }
  | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };

export type KernelSnapshot<TDoc> = {
  draft: TDoc;
  serverDoc: TDoc | null;
  isPersisted: boolean;
  status: KernelStatus;
  error: string | null;
  fieldErrors: FieldErrorRecord | null;
};

const DEFAULT_DEBOUNCE_MS = 600;
const RETRY_BACKOFF_MS = [1_000, 4_000, 10_000];
const CONFLICT_MESSAGE =
  "This record was changed elsewhere. Saving again will overwrite those changes.";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

function errorBody(error: unknown): Record<string, unknown> | null {
  const body = (error as { body?: unknown } | null)?.body;
  return typeof body === "object" && body != null
    ? (body as Record<string, unknown>)
    : null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function translateErrorPaths(
  errors: FieldErrorRecord,
  aliases: Record<string, string> | undefined,
): FieldErrorRecord {
  if (!aliases) return errors;
  const translated: FieldErrorRecord = {};
  for (const [key, messages] of Object.entries(errors)) {
    translated[aliases[key] ?? key] = messages;
  }
  return translated;
}

export class CardKernel<TDoc, TPayload> {
  readonly key: string;
  private config: CardKernelConfig<TDoc, TPayload>;
  private readonly pristineDoc: TDoc;

  private serverDoc: TDoc | null;
  private draft: TDoc;
  private version: number | null;
  private status: KernelStatus;
  private error: string | null = null;
  private fieldErrors: FieldErrorRecord | null = null;

  private snapshot: KernelSnapshot<TDoc>;
  private listeners = new Set<() => void>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<FlushOutcome> | null = null;
  private lastAttempt: { key: string; payloadJson: string } | null = null;

  constructor(config: CardKernelConfig<TDoc, TPayload>) {
    this.key = `${config.entityType}:${config.id}`;
    this.config = config;
    this.pristineDoc = this.derive(config.makeNewDoc(config.id));
    // serverDoc must never share structure with the live draft: grids mutate
    // row objects in place, and an aliased row would change both sides of
    // the dirty diff at once (edits would look clean and never save).
    this.serverDoc = config.initialServerDoc
      ? structuredClone(config.initialServerDoc)
      : null;
    this.draft = this.derive(config.initialServerDoc ?? structuredClone(this.pristineDoc));
    this.version = config.initialServerDoc
      ? this.readVersion(config.initialServerDoc)
      : null;
    this.status = "idle";
    this.snapshot = this.buildSnapshot();
  }

  /** Refresh config-captured callbacks (query client, router) each render. */
  setConfig(config: CardKernelConfig<TDoc, TPayload>) {
    this.config = config;
  }

  get id() {
    return this.config.id;
  }

  /** The id the server knows this doc by (differs from `id` when the server
   *  assigns ids on create). Null until persisted. */
  get persistedId(): string | null {
    if (!this.serverDoc) return null;
    return this.config.readId?.(this.serverDoc) ?? this.config.id;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): KernelSnapshot<TDoc> => this.snapshot;

  hasListeners() {
    return this.listeners.size > 0;
  }

  isBusy() {
    return this.inFlight != null || this.isPayloadDirty();
  }

  update(mutate: (draft: TDoc) => TDoc, opts?: { debounceMs?: number }): void;
  update(path: string, value: unknown, opts?: { debounceMs?: number }): void;
  update(
    pathOrFn: string | ((draft: TDoc) => TDoc),
    valueOrOpts?: unknown,
    maybeOpts?: { debounceMs?: number },
  ): void {
    let opts: { debounceMs?: number } | undefined;
    if (typeof pathOrFn === "function") {
      this.draft = this.derive(pathOrFn(this.draft));
      opts = valueOrOpts as { debounceMs?: number } | undefined;
    } else {
      this.draft = this.derive(
        applyPathValue(this.draft, pathOrFn, valueOrOpts, this.config.collections),
      );
      opts = maybeOpts;
    }

    if (this.status !== "saving" && this.status !== "blocked") {
      this.status = this.isPayloadDirty() ? "dirty" : "idle";
    }
    this.notify();

    const delay =
      opts?.debounceMs ?? this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    if (Number.isFinite(delay)) this.scheduleFlush(delay);
  }

  flush = (): Promise<FlushOutcome> => {
    this.cancelScheduledFlush();
    if (!this.inFlight) {
      this.inFlight = this.runFlushLoop().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  };

  resetToServer = () => {
    this.draft = this.derive(
      structuredClone(this.serverDoc ?? this.pristineDoc),
    );
    this.status = "idle";
    this.error = null;
    this.fieldErrors = null;
    this.notify();
  };

  /**
   * Integrate an externally fetched doc (RSC remount, refresh, bespoke
   * actions). Safe while dirty: dirty paths are reapplied on top. Equal
   * versions still rebase — server-owned satellites (activity streams) can
   * change without bumping the document version.
   */
  adoptServerDoc = (doc: TDoc) => {
    const incoming = this.readVersion(doc);
    if (
      this.serverDoc != null &&
      this.version != null &&
      incoming != null &&
      incoming < this.version
    ) {
      return;
    }
    this.rebaseOnto(doc);
    if (this.status !== "saving") {
      this.status = this.isPayloadDirty() ? "dirty" : "idle";
    }
    this.notify();
  };

  /** Fire-and-forget save for pagehide; skips invalid or clean drafts. */
  flushForPagehide() {
    if (this.inFlight || !this.isPayloadDirty()) return;
    const { payload } = this.config.serialize(this.draft);
    if (!this.config.schema.safeParse(payload).success) return;
    const idempotencyKey = `${this.key}:${crypto.randomUUID()}`;
    const request = this.serverDoc
      ? this.config.update(
          this.config.readId?.(this.serverDoc) ?? this.config.id,
          payload,
          { expectedVersion: this.version, idempotencyKey, keepalive: true },
        )
      : this.config.create(payload, { idempotencyKey, keepalive: true });
    void request.catch(() => undefined);
  }

  private derive(doc: TDoc) {
    return this.config.derive ? this.config.derive(doc) : doc;
  }

  private readVersion(doc: TDoc): number | null {
    if (this.config.readVersion) return this.config.readVersion(doc);
    const version = (doc as { version?: unknown }).version;
    return typeof version === "number" ? version : null;
  }

  private isPayloadDirty(): boolean {
    const draftSide = this.config.serialize(this.draft).payload;
    const baseSide = this.config.serialize(
      this.derive(this.serverDoc ?? this.pristineDoc),
    ).payload;
    const draftParsed = this.config.schema.safeParse(draftSide);
    const baseParsed = this.config.schema.safeParse(baseSide);
    if (draftParsed.success && baseParsed.success) {
      return !deepEqual(draftParsed.data, baseParsed.data);
    }
    return !deepEqual(draftSide, baseSide);
  }

  private dirtyPaths(): Set<string> {
    return diffDocs(
      this.derive(this.serverDoc ?? this.pristineDoc),
      this.draft,
      this.config.collections,
    );
  }

  private rebaseOnto(fresh: TDoc) {
    const stillDirty = this.dirtyPaths();
    this.serverDoc = structuredClone(fresh);
    this.version = this.readVersion(fresh);
    this.draft = this.derive(
      applyPaths(fresh, stillDirty, this.draft, this.config.collections),
    );
  }

  private scheduleFlush(delayMs: number) {
    this.cancelScheduledFlush();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, delayMs);
  }

  private cancelScheduledFlush() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private async runFlushLoop(): Promise<FlushOutcome> {
    let outcome = await this.attempt();
    while (outcome.outcome === "saved" && this.isPayloadDirty()) {
      outcome = await this.attempt();
    }
    return outcome;
  }

  private async attempt(retriedAfterConflict = false): Promise<FlushOutcome> {
    const { payload, pathAliases } = this.config.serialize(this.draft);
    const parsed = this.config.schema.safeParse(payload);
    if (!parsed.success) {
      const errors = translateErrorPaths(
        fieldErrorsFromIssues(parsed.error.issues),
        pathAliases,
      );
      this.fieldErrors = errors;
      this.error = firstFieldErrorMessage(errors, "Fix the highlighted fields.");
      this.status = "blocked";
      this.notify();
      return { outcome: "blocked", fieldErrors: errors };
    }

    if (!this.isPayloadDirty()) {
      if (this.status !== "error") this.status = "idle";
      this.notify();
      return { outcome: "saved" };
    }

    this.status = "saving";
    this.error = null;
    this.fieldErrors = null;
    this.notify();

    const draftAtSend = this.draft;
    const serverDocAtSend = this.serverDoc;
    const versionAtSend = this.version;
    const payloadJson = JSON.stringify(payload);
    const idempotencyKey =
      this.lastAttempt?.payloadJson === payloadJson
        ? this.lastAttempt.key
        : `${this.key}:${crypto.randomUUID()}`;
    this.lastAttempt = { key: idempotencyKey, payloadJson };

    let lastError: unknown;
    for (let attemptIndex = 0; attemptIndex <= RETRY_BACKOFF_MS.length; attemptIndex += 1) {
      try {
        const fresh = serverDocAtSend
          ? await this.config.update(
              this.config.readId?.(serverDocAtSend) ?? this.config.id,
              payload,
              { expectedVersion: versionAtSend, idempotencyKey },
            )
          : await this.config.create(payload, { idempotencyKey });

        this.lastAttempt = null;
        const editedDuringFlight = diffDocs(
          draftAtSend,
          this.draft,
          this.config.collections,
        );
        this.serverDoc = structuredClone(fresh);
        this.version = this.readVersion(fresh);
        this.draft = this.derive(
          applyPaths(fresh, editedDuringFlight, this.draft, this.config.collections),
        );
        this.status = this.isPayloadDirty() ? "dirty" : "idle";
        this.notify();
        this.config.onServerDoc?.(fresh);
        if (!serverDocAtSend) this.config.onCreated?.(fresh);
        return { outcome: "saved" };
      } catch (error) {
        lastError = error;
        const status = errorStatus(error);
        const body = errorBody(error);

        if (status === 409 && body?.conflict === true && body.current != null) {
          return this.handleConflict(
            body.current as TDoc,
            serverDocAtSend,
            draftAtSend,
            retriedAfterConflict,
          );
        }

        const retryable = status == null || status >= 500;
        if (retryable && attemptIndex < RETRY_BACKOFF_MS.length) {
          await sleep(RETRY_BACKOFF_MS[attemptIndex]);
          continue;
        }
        break;
      }
    }

    const message = errorMessage(lastError, "Failed to save.");
    const serverErrors = errorBody(lastError)?.errors;
    this.fieldErrors = isFieldErrorRecord(serverErrors)
      ? translateErrorPaths(serverErrors, pathAliases)
      : null;
    this.error = message;
    this.status = "error";
    this.notify();
    return { outcome: "failed", error: message, fieldErrors: this.fieldErrors };
  }

  private async handleConflict(
    current: TDoc,
    serverDocAtSend: TDoc | null,
    draftAtSend: TDoc,
    alreadyRetried: boolean,
  ): Promise<FlushOutcome> {
    const dirtyAtSend = serverDocAtSend
      ? diffDocs(this.derive(serverDocAtSend), draftAtSend, this.config.collections)
      : new Set<string>();
    const changedOnServer = serverDocAtSend
      ? diffDocs(
          this.derive(serverDocAtSend),
          this.derive(current),
          this.config.collections,
        )
      : new Set<string>();
    const conflictPaths = [...dirtyAtSend].filter((path) =>
      changedOnServer.has(path),
    );

    this.rebaseOnto(current);
    this.lastAttempt = null;

    if (conflictPaths.length === 0 && !alreadyRetried) {
      return this.attempt(true);
    }

    this.error = CONFLICT_MESSAGE;
    this.status = "error";
    this.notify();
    return { outcome: "conflict", error: CONFLICT_MESSAGE, conflictPaths };
  }

  private buildSnapshot(): KernelSnapshot<TDoc> {
    return {
      draft: this.draft,
      serverDoc: this.serverDoc,
      isPersisted: this.serverDoc != null,
      status: this.status,
      error: this.error,
      fieldErrors: this.fieldErrors,
    };
  }

  private notify() {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}

function applyPathValue<TDoc>(
  draft: TDoc,
  path: string,
  value: unknown,
  collections: CollectionSpec | undefined,
) {
  return setAtPath(draft, path, value, collections ?? {});
}

// ---------------------------------------------------------------------------
// Registry: kernels live outside React so unmount can't drop a pending edit.
// ---------------------------------------------------------------------------

const CLEAN_KERNEL_CAP = 16;
const registry = new Map<string, CardKernel<unknown, unknown>>();

export function getCardKernel<TDoc, TPayload>(
  config: CardKernelConfig<TDoc, TPayload>,
): CardKernel<TDoc, TPayload> {
  const key = `${config.entityType}:${config.id}`;
  const existing = registry.get(key);
  if (existing) {
    registry.delete(key);
    registry.set(key, existing);
    return existing as CardKernel<TDoc, TPayload>;
  }
  const kernel = new CardKernel(config);
  registry.set(key, kernel as CardKernel<unknown, unknown>);
  evictCleanKernels();
  return kernel;
}

function evictCleanKernels() {
  if (registry.size <= CLEAN_KERNEL_CAP) return;
  for (const [key, kernel] of registry) {
    if (registry.size <= CLEAN_KERNEL_CAP) break;
    if (!kernel.hasListeners() && !kernel.isBusy()) registry.delete(key);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const kernel of registry.values()) kernel.flushForPagehide();
  });
}
