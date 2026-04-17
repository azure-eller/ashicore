"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Clock04Icon,
  MessageAdd02Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PendingRequestCard } from "@/components/agent/pending-request-card";
import {
  countHiddenAgentMessages,
  getVisibleAgentMessages,
  type AgentMessage,
} from "@/lib/agent/core/messages";
import type {
  AgentPendingRequestResponse,
  AgentSessionSnapshot,
  AgentUploadRecord,
  CreateAgentTurnRequest,
} from "@/lib/agent/erp/types";
import { cn } from "@/lib/utils";

const AGENT_SESSION_STORAGE_KEY = "erp-agent-session-id";
const MAX_COMPOSER_HEIGHT = 200;

const THINKING_VERBS = ["Thinking", "Pondering", "Scheming", "Crunching"];

type StreamToolEvent = {
  kind: "start" | "result";
  toolCallId: string;
  toolName: string;
  summary?: string;
  isError?: boolean;
};

type SseEvent = {
  event: string;
  data: unknown;
};

async function readJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }
  return (await response.json()) as T;
}

async function createSession() {
  const response = await fetch("/api/agent/sessions", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Failed to start an ERP agent thread.");
  }

  return readJsonOrThrow<AgentSessionSnapshot>(response, "Sign in to use the ERP agent.");
}

async function fetchSession(sessionId: string) {
  const response = await fetch(`/api/agent/sessions/${sessionId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to restore the ERP agent thread.");
  }

  return readJsonOrThrow<AgentSessionSnapshot>(response, "Sign in to use the ERP agent.");
}

async function uploadFiles(sessionId: string, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch(`/api/agent/sessions/${sessionId}/uploads`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed." }));
    throw new Error(error.error ?? "Upload failed.");
  }
}

function parseSseChunk(chunk: string) {
  const events: SseEvent[] = [];
  const parts = chunk.split("\n\n");

  for (const part of parts) {
    if (!part.trim()) {
      continue;
    }

    const lines = part.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));

    if (!eventLine || !dataLine) {
      continue;
    }

    events.push({
      event: eventLine.slice("event: ".length),
      data: JSON.parse(dataLine.slice("data: ".length)),
    });
  }

  return events;
}

function readPersistedSessionId() {
  try {
    return window.sessionStorage.getItem(AGENT_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistSessionId(sessionId: string) {
  try {
    window.sessionStorage.setItem(AGENT_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Ignore storage failures in restrictive environments.
  }
}

function clearPersistedSessionId() {
  try {
    window.sessionStorage.removeItem(AGENT_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures in restrictive environments.
  }
}

function formatUploadMeta(upload: AgentUploadRecord) {
  const parts = [];

  if (upload.manifest.table) {
    parts.push(
      `${upload.manifest.table.rowCount} rows`,
      `${upload.manifest.table.headers.length} columns`
    );
  }

  if (upload.manifest.pageCount != null) {
    parts.push(`${upload.manifest.pageCount} pages`);
  }

  if (upload.manifest.image) {
    parts.push(`${upload.manifest.image.width}x${upload.manifest.image.height}`);
  }

  parts.unshift(upload.mediaType);

  return parts.join(" • ");
}

function summarizeToolResultContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (content && typeof content === "object") {
    if ("error" in content && typeof content.error === "string") {
      return content.error;
    }

    if ("summary" in content && typeof content.summary === "string") {
      return content.summary;
    }
  }

  return JSON.stringify(content, null, 2);
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn(
        "max-w-[92%] rounded-2xl px-3 py-2 text-[13px] leading-5 shadow-sm",
        isAssistant
          ? "mr-4 border border-sidebar-border/70 bg-sidebar-accent/70 text-sidebar-accent-foreground"
          : "ml-4 self-end bg-sidebar-primary text-sidebar-primary-foreground"
      )}
    >
      {message.parts.map((part, index) => {
        switch (part.type) {
          case "text":
            return (
              <p
                key={`${message.id}-text-${index}`}
                className={cn("whitespace-pre-wrap", index > 0 ? "mt-2" : undefined)}
              >
                {part.text}
              </p>
            );
          case "tool_use":
            return (
              <div
                key={part.id}
                className="mt-2 rounded-xl border border-sidebar-border/70 bg-sidebar/70 px-2.5 py-1.5 text-[11px] text-sidebar-foreground/75"
              >
                Running <span className="font-medium text-sidebar-foreground">{part.name}</span>
              </div>
            );
          case "tool_result":
            return (
              <div
                key={`${message.id}-tool-result-${index}`}
                className="mt-2 rounded-xl border border-sidebar-border/70 bg-sidebar/70 px-2.5 py-1.5 text-[11px] text-sidebar-foreground/75"
              >
                {summarizeToolResultContent(part.content)}
              </div>
            );
          case "attachment":
            return (
              <div
                key={part.attachmentId}
                className="mt-2 rounded-xl border border-sidebar-border/70 bg-sidebar/70 px-2.5 py-1.5 text-[11px] text-sidebar-foreground/75"
              >
                Attached {part.label}
              </div>
            );
        }
      })}
    </div>
  );
}

function OptimisticUserBubble({ text }: { text: string }) {
  return (
    <div className="ml-4 max-w-[92%] self-end rounded-2xl bg-sidebar-primary px-3 py-2 text-[13px] leading-5 text-sidebar-primary-foreground shadow-sm">
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function ThinkingIndicator() {
  const [verbIndex, setVerbIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setVerbIndex((prev) => (prev + 1) % THINKING_VERBS.length);
    }, 1800);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="mr-4 inline-flex items-center gap-2 self-start rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/50 px-3 py-2 text-[12px] italic text-sidebar-foreground/75">
      <span className="relative inline-flex size-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sidebar-foreground/40" />
        <span className="relative inline-flex size-1.5 rounded-full bg-sidebar-foreground/70" />
      </span>
      <span>{THINKING_VERBS[verbIndex]}…</span>
    </div>
  );
}

function LiveTurnPreview({
  assistantText,
  toolEvents,
}: {
  assistantText: string;
  toolEvents: StreamToolEvent[];
}) {
  if (assistantText.length === 0 && toolEvents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {toolEvents.length > 0 ? (
        <div className="rounded-2xl border border-dashed border-sidebar-border/80 bg-sidebar-accent/40 px-3 py-2">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/55">
            Current Turn
          </p>
          <div className="flex flex-col gap-1.5">
            {toolEvents.map((event) => (
              <div
                key={`${event.kind}-${event.toolCallId}`}
                className="rounded-xl bg-sidebar/60 px-2.5 py-1.5 text-[11px] text-sidebar-foreground/75"
              >
                {event.kind === "start"
                  ? `Running ${event.toolName}…`
                  : `${event.toolName}: ${event.summary ?? "Completed."}`}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {assistantText.length > 0 ? (
        <div className="mr-4 rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/70 px-3 py-2 text-[13px] leading-5 text-sidebar-accent-foreground shadow-sm">
          <p className="whitespace-pre-wrap">{assistantText}</p>
        </div>
      ) : null}
    </div>
  );
}

type AgentSessionListItem = {
  id: string;
  title: string | null;
  preview: string | null;
  status: string;
  updatedAt: string;
};

async function fetchSessionList(): Promise<AgentSessionListItem[]> {
  const response = await fetch("/api/agent/sessions", { cache: "no-store" });
  if (!response.ok) return [];
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return [];
  const data = (await response.json()) as { sessions?: AgentSessionListItem[] };
  return data.sessions ?? [];
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

export function AgentChatPanel({
  className,
  expanded = false,
  onComposerFocus,
  onComposerBlur,
}: {
  className?: string;
  expanded?: boolean;
  onComposerFocus?: () => void;
  onComposerBlur?: () => void;
}) {
  const searchParams = useSearchParams();
  const requestedProvider = searchParams.get("agentProvider");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoreAttemptedRef = useRef(false);
  const bootstrapRequestRef = useRef<Promise<AgentSessionSnapshot> | null>(null);
  const providerOverrideRef = useRef<"fake" | "anthropic" | null>(null);
  const [session, setSession] = useState<AgentSessionSnapshot | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [liveToolEvents, setLiveToolEvents] = useState<StreamToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<AgentSessionListItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleMessages = useMemo(
    () => (session ? getVisibleAgentMessages(session.session.messages) : []),
    [session]
  );
  const hiddenMessageCount = session
    ? countHiddenAgentMessages(session.session.messages)
    : 0;

  useEffect(() => {
    if (requestedProvider === "fake" || requestedProvider === "anthropic") {
      providerOverrideRef.current = requestedProvider;
    }
  }, [requestedProvider]);

  function buildTurnHeaders() {
    return {
      "Content-Type": "application/json",
      ...(providerOverrideRef.current
        ? {
            "X-Agent-Provider": providerOverrideRef.current,
          }
        : {}),
    };
  }

  const refreshSession = useCallback(async (targetSessionId?: string | null) => {
    const resolvedSessionId = targetSessionId ?? session?.session.id;
    if (!resolvedSessionId) {
      return null;
    }

    const refreshed = await fetchSession(resolvedSessionId);
    setSession(refreshed);
    return refreshed;
  }, [session?.session.id]);

  const startNewChat = useCallback(async () => {
    if (isSending || isUploading) return;
    try {
      setError(null);
      setComposerText("");
      setPendingUserText(null);
      setLiveAssistantText("");
      setLiveToolEvents([]);
      const created = await createSession();
      setSession(created);
      persistSessionId(created.session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to start a new thread.");
    }
  }, [isSending, isUploading]);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setIsLoadingHistory(true);
    try {
      const items = await fetchSessionList();
      setHistoryItems(items);
    } catch {
      setHistoryItems([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      setError(null);
      setComposerText("");
      setPendingUserText(null);
      setLiveAssistantText("");
      setLiveToolEvents([]);
      const restored = await fetchSession(sessionId);
      setSession(restored);
      persistSessionId(restored.session.id);
      setHistoryOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to restore thread.");
    }
  }, []);

  const handleComposerFocus = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    onComposerFocus?.();
  }, [onComposerFocus]);

  const handleComposerBlur = useCallback(() => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      onComposerBlur?.();
      blurTimerRef.current = null;
    }, 150);
  }, [onComposerBlur]);

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  const ensureSession = useCallback(async () => {
    if (session) {
      return session;
    }

    if (bootstrapRequestRef.current) {
      return bootstrapRequestRef.current;
    }

    const bootstrap = (async () => {
      setIsBootstrapping(true);
      setError(null);

      const storedSessionId = readPersistedSessionId();
      if (storedSessionId) {
        try {
          const restored = await fetchSession(storedSessionId);
          setSession(restored);
          return restored;
        } catch {
          clearPersistedSessionId();
        }
      }

      const created = await createSession();
      setSession(created);
      persistSessionId(created.session.id);
      return created;
    })();

    bootstrapRequestRef.current = bootstrap;

    try {
      return await bootstrap;
    } finally {
      bootstrapRequestRef.current = null;
      setIsBootstrapping(false);
    }
  }, [session]);

  useEffect(() => {
    if (restoreAttemptedRef.current) {
      return;
    }

    restoreAttemptedRef.current = true;

    void ensureSession().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Failed to start the ERP agent.");
    });
  }, [ensureSession]);

  useEffect(() => {
    if (session?.session.id) {
      persistSessionId(session.session.id);
    }
  }, [session?.session.id]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, 40),
      MAX_COMPOSER_HEIGHT
    )}px`;
  }, [composerText]);

  useEffect(() => {
    if (!transcriptRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (!transcriptRef.current) {
        return;
      }

      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    visibleMessages.length,
    hiddenMessageCount,
    pendingUserText,
    liveAssistantText,
    liveToolEvents,
    session?.pendingRequest?.id,
    session?.uploads.length,
  ]);

  async function consumeTurnStream(
    body: CreateAgentTurnRequest,
    options?: {
      sessionId?: string;
    }
  ) {
    const targetSessionId = options?.sessionId ?? session?.session.id;
    if (!targetSessionId) {
      return;
    }

    setIsSending(true);
    setError(null);
    setLiveAssistantText("");
    setLiveToolEvents([]);

    const response = await fetch(`/api/agent/sessions/${targetSessionId}/turns`, {
      method: "POST",
      headers: buildTurnHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({ error: "Turn failed." }));
      throw new Error(payload.error ?? "Turn failed.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      buffer += decoder.decode(next.value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const event of chunks.flatMap(parseSseChunk)) {
        switch (event.event) {
          case "assistant_delta": {
            const data = event.data;
            if (data && typeof data === "object" && "text" in data && typeof data.text === "string") {
              setLiveAssistantText((prev) => prev + data.text);
            }
            break;
          }
          case "tool_start": {
            const data = event.data;
            if (data && typeof data === "object" && "toolCallId" in data && "toolName" in data) {
              setLiveToolEvents((prev) => [
                ...prev,
                {
                  kind: "start",
                  toolCallId: String(data.toolCallId),
                  toolName: String(data.toolName),
                },
              ]);
            }
            break;
          }
          case "tool_result": {
            const data = event.data;
            if (data && typeof data === "object" && "toolCallId" in data && "toolName" in data) {
              setLiveToolEvents((prev) => [
                ...prev,
                {
                  kind: "result",
                  toolCallId: String(data.toolCallId),
                  toolName: String(data.toolName),
                  summary:
                    "summary" in data && typeof data.summary === "string"
                      ? data.summary
                      : undefined,
                  isError:
                    "isError" in data && typeof data.isError === "boolean"
                      ? data.isError
                      : undefined,
                },
              ]);
            }
            break;
          }
          case "error": {
            const data = event.data;
            if (
              data &&
              typeof data === "object" &&
              "message" in data &&
              typeof data.message === "string"
            ) {
              setError(data.message);
            }
            break;
          }
        }
      }
    }

    if (buffer.trim().length > 0) {
      for (const event of parseSseChunk(buffer)) {
        const data = event.data;

        if (
          event.event === "assistant_delta" &&
          data &&
          typeof data === "object" &&
          "text" in data &&
          typeof data.text === "string"
        ) {
          setLiveAssistantText((prev) => prev + data.text);
          continue;
        }

        if (
          event.event === "tool_start" &&
          data &&
          typeof data === "object" &&
          "toolCallId" in data &&
          "toolName" in data
        ) {
          setLiveToolEvents((prev) => [
            ...prev,
            {
              kind: "start",
              toolCallId: String(data.toolCallId),
              toolName: String(data.toolName),
            },
          ]);
          continue;
        }

        if (
          event.event === "tool_result" &&
          data &&
          typeof data === "object" &&
          "toolCallId" in data &&
          "toolName" in data
        ) {
          setLiveToolEvents((prev) => [
            ...prev,
            {
              kind: "result",
              toolCallId: String(data.toolCallId),
              toolName: String(data.toolName),
              summary:
                "summary" in data && typeof data.summary === "string"
                  ? data.summary
                  : undefined,
              isError:
                "isError" in data && typeof data.isError === "boolean"
                  ? data.isError
                  : undefined,
            },
          ]);
          continue;
        }

        if (
          event.event === "error" &&
          data &&
          typeof data === "object" &&
          "message" in data &&
          typeof data.message === "string"
        ) {
          setError(data.message);
        }
      }
    }

    await refreshSession(targetSessionId);
    setLiveAssistantText("");
    setLiveToolEvents([]);
  }

  async function handleSend() {
    const prompt = composerText.trim();
    if (prompt.length === 0 || session?.pendingRequest) {
      return;
    }

    setComposerText("");
    setPendingUserText(prompt);

    try {
      const snapshot = await ensureSession();
      await consumeTurnStream({ text: prompt }, { sessionId: snapshot.session.id });
      setPendingUserText(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Turn failed.");
      setComposerText(prompt);
      setPendingUserText(null);
    } finally {
      setIsSending(false);
    }
  }

  async function handlePendingResolve(response: AgentPendingRequestResponse) {
    if (!session?.pendingRequest) {
      return;
    }

    try {
      await consumeTurnStream({
        text: "",
        pendingRequestResponse: {
          requestId: session.pendingRequest.id,
          response,
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to resolve the pending request.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const snapshot = await ensureSession();
      await uploadFiles(snapshot.session.id, files);
      await refreshSession(snapshot.session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  async function handleBrowse() {
    try {
      await ensureSession();
      fileInputRef.current?.click();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to prepare uploads.");
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void handleSend();
  }

  const statusText = session?.pendingRequest
    ? "Waiting on your answer."
    : isSending
      ? "Working on it."
      : isUploading
        ? "Adding files."
        : null;

  const showThinking =
    isSending && liveAssistantText.length === 0 && liveToolEvents.length === 0;

  return (
    <div
      data-agent-sidebar-root=""
      data-agent-session-id={session?.session.id ?? undefined}
      data-agent-status={session?.session.status ?? "new"}
      data-expanded={expanded ? "true" : "false"}
      className={cn(
        "group/agent mx-2 mb-2 flex min-h-0 flex-col overflow-hidden rounded-xl border transition-[background-color,border-color,box-shadow] duration-300",
        expanded
          ? "border-sidebar-border/70 bg-sidebar-accent/25 shadow-sm"
          : "border-transparent bg-transparent shadow-none",
        className
      )}
    >
      <div
        aria-hidden={!expanded}
        className={cn(
          "flex min-h-0 flex-col overflow-hidden transition-[flex-grow,max-height,opacity] duration-300 ease-out",
          expanded
            ? "max-h-[1000px] flex-1 basis-0 opacity-100"
            : "pointer-events-none max-h-0 flex-none basis-0 opacity-0"
        )}
      >
      <div className="flex items-center gap-1 border-b border-sidebar-border/60 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xs font-medium text-sidebar-foreground">ERP Agent</h2>
            {session?.uploads.length ? (
              <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
                {session.uploads.length}
              </Badge>
            ) : null}
          </div>
          {statusText ? (
            <p className="truncate text-[10px] leading-4 text-sidebar-foreground/55">{statusText}</p>
          ) : null}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="New chat"
              disabled={isBootstrapping || isSending || isUploading}
              onClick={() => void startNewChat()}
              className="size-7 shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <HugeiconsIcon icon={MessageAdd02Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New chat</TooltipContent>
        </Tooltip>
        <Popover
          open={historyOpen}
          onOpenChange={(open) => {
            if (open) void openHistory();
            else setHistoryOpen(false);
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Chat history"
                  className="size-7 shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <HugeiconsIcon icon={Clock04Icon} strokeWidth={2} className="size-3.5" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">History</TooltipContent>
          </Tooltip>
          <PopoverContent
            side="bottom"
            align="end"
            sideOffset={6}
            className="w-72 p-1"
          >
            {isLoadingHistory ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">Loading…</p>
            ) : historyItems.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No past threads.</p>
            ) : (
              <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                {historyItems.map((item) => {
                  const label = item.title?.trim() || item.preview || "Untitled thread";
                  const isCurrent = session?.session.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => void loadSession(item.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent hover:text-accent-foreground",
                          isCurrent && "bg-accent text-accent-foreground"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatRelativeTime(item.updatedAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div
        ref={transcriptRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sidebar-border/60 hover:[&::-webkit-scrollbar-thumb]:bg-sidebar-border"
      >
        {error ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            {error}
          </div>
        ) : null}

        {session?.uploads.length ? (
          <section className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/55">
                Files
              </p>
              {isUploading ? (
                <span className="text-[10px] text-sidebar-foreground/55">Uploading…</span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              {session.uploads.map((upload) => (
                <div
                  key={upload.id}
                  className="rounded-xl border border-sidebar-border/70 bg-sidebar-accent/35 px-2.5 py-1.5"
                >
                  <p className="truncate text-[12px] font-medium text-sidebar-foreground">
                    {upload.sourceFilename}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-4 text-sidebar-foreground/60">
                    {formatUploadMeta(upload)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {session?.pendingRequest ? (
          <PendingRequestCard
            pendingRequest={session.pendingRequest}
            isSubmitting={isSending}
            onResolve={handlePendingResolve}
          />
        ) : null}

        <div className="flex flex-1 flex-col justify-end gap-2">
          {hiddenMessageCount > 0 ? (
            <div className="rounded-xl border border-dashed border-sidebar-border/80 bg-sidebar-accent/20 px-3 py-2 text-[10px] leading-4 text-sidebar-foreground/55">
              Earlier context was compacted.
            </div>
          ) : null}

          {visibleMessages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {pendingUserText ? <OptimisticUserBubble text={pendingUserText} /> : null}

          {showThinking ? <ThinkingIndicator /> : null}

          <LiveTurnPreview
            assistantText={liveAssistantText}
            toolEvents={liveToolEvents}
          />
        </div>
      </div>
      </div>

      <div
        className={cn(
          "mt-auto p-2 transition-colors duration-300",
          expanded ? "border-t border-sidebar-border/70" : "border-t-0"
        )}
      >
        <div className="rounded-xl border border-sidebar-border/80 bg-sidebar-accent/45 p-1.5 shadow-sm">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onFocus={handleComposerFocus}
              onBlur={handleComposerBlur}
              aria-label="ERP Agent message"
              placeholder={
                session?.pendingRequest ? "Resolve the pending request first." : ""
              }
              disabled={isSending || Boolean(session?.pendingRequest)}
              className="min-h-0 resize-none border-0 bg-transparent px-1 py-0.5 font-sans text-sm leading-5 text-sidebar-foreground shadow-none md:text-sm placeholder:text-sidebar-foreground/45 focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent"
            />
            {composerText.length === 0 && !session?.pendingRequest ? (
              <span
                aria-hidden="true"
                className="agent-rainbow-text pointer-events-none absolute left-1 top-0.5 font-sans text-sm font-medium leading-5"
              >
                Talk to the ERP agent...
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Add files to ERP Agent"
                disabled={isUploading || isSending}
                onClick={() => void handleBrowse()}
                className="size-7 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                data-agent-upload-input=""
                className="hidden"
                onChange={handleFileChange}
              />
              {isUploading ? (
                <span className="text-[10px] text-sidebar-foreground/55">Uploading…</span>
              ) : null}
            </div>
            <Button
              type="button"
              size="icon-sm"
              aria-label="Send message to ERP Agent"
              onClick={() => void handleSend()}
              disabled={
                isSending ||
                composerText.trim().length === 0 ||
                Boolean(session?.pendingRequest)
              }
              className="size-7 rounded-full"
            >
              <HugeiconsIcon icon={SentIcon} strokeWidth={2} className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
