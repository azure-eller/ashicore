"use client";

import { usePathname } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  ArrowUp02Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChatSparkIcon,
  CheckmarkCircle02Icon,
  Search01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isAgentProposal } from "@/lib/agent/chat/proposals";
import { AgentStagingProvider } from "@/components/agent-staging/staging-provider";
import { AshTray, StagedCard } from "@/components/agent-staging/staged-card";

type AgentChatSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type AgentQueryOutput = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
};

type ToolOutput = {
  summary?: string;
  data?: unknown;
  error?: { message?: string };
};

const ASH_PROMPT_CATEGORIES = [
  {
    label: "At risk",
    icon: Alert02Icon,
    prompts: [
      "Which open sales orders are blocked?",
      "Which orders are late right now?",
      "What is due in the next 7 days and not ready to ship?",
      "Which customers have the most blocked order value?",
    ],
  },
  {
    label: "Plan",
    icon: Calendar03Icon,
    prompts: [
      "What is due to ship in the next two weeks?",
      "What should I check before shipping this week?",
      "Help me prioritize my open orders for this week.",
      "Summarize open order risk by customer.",
    ],
  },
  {
    label: "Explore",
    icon: Search01Icon,
    prompts: [
      "Show me the biggest open orders.",
      "How many open orders do we have right now?",
      "Which open orders have no due date?",
      "Show open orders due this month.",
    ],
  },
];

const ASH_TIPS = [
  "Ash stages changes — nothing is applied without your approval.",
  "Enter sends. Shift+Enter adds a new line.",
  "Ash reads live data, so answers reflect this org right now.",
  "Ask follow-ups — Ash keeps the conversation in mind.",
];

function RotatingTip() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(
      () => setIndex((current) => (current + 1) % ASH_TIPS.length),
      5000
    );
    return () => clearInterval(interval);
  }, []);

  return (
    <p
      key={index}
      className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-(--duration-3)"
    >
      {ASH_TIPS[index]}
    </p>
  );
}

function textParts(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function pageContext(pathname: string | null) {
  if (pathname?.startsWith("/sales/orders")) return "Sales Orders";
  if (pathname?.startsWith("/sales")) return "Sales";
  if (pathname?.startsWith("/purchasing")) return "Purchasing";
  if (pathname?.startsWith("/manufacturing")) return "Manufacturing";
  if (pathname?.startsWith("/inventory")) return "Inventory";
  return "Dashboard";
}

function toolLabel(toolName: string) {
  switch (toolName) {
    case "query":
      return "Querying data";
    case "list_actions":
      return "Finding actions";
    case "describe_action":
      return "Reading action";
    case "stage":
      return "Staging change";
    default:
      return `Running ${toolName}`;
  }
}

function AshGlyph({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-(--radius-md) bg-[var(--color-ink)] text-[var(--color-accent)]",
        className
      )}
    >
      <HugeiconsIcon icon={ChatSparkIcon} strokeWidth={2} />
    </span>
  );
}

function isQueryOutput(value: unknown): value is AgentQueryOutput {
  return (
    typeof value === "object" &&
    value != null &&
    "columns" in value &&
    Array.isArray((value as { columns: unknown }).columns) &&
    Array.isArray((value as { rows?: unknown }).rows)
  );
}

function cellText(value: unknown) {
  if (value == null) return "";
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function MessageText({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const segments = text.split(/```/g);
  const lastIndex = segments.length - 1;

  return (
    <div className="space-y-(--space-4)">
      {segments.map((segment, index) => {
        if (segment.length === 0) return null;
        const code = index % 2 === 1;
        if (code) {
          const [, ...body] = segment.split("\n");
          return (
            <pre
              key={`${index}-${segment.slice(0, 12)}`}
              className="max-w-full overflow-x-auto rounded-(--radius-md) border border-[var(--color-line)] bg-[var(--color-surface-sunk)] p-(--space-5) font-mono text-[length:var(--text-xs)] leading-[var(--leading-sm)]"
            >
              <code>{body.join("\n").trim() || segment.trim()}</code>
            </pre>
          );
        }

        return (
          <p
            key={`${index}-${segment.slice(0, 12)}`}
            className="whitespace-pre-wrap text-[length:var(--text-sm)] leading-[var(--leading-md)]"
          >
            {segment}
            {streaming && index === lastIndex ? (
              <span className="ml-(--space-1) inline-block h-(--space-6) w-(--space-2) animate-pulse bg-[var(--color-accent)] align-text-bottom" />
            ) : null}
          </p>
        );
      })}
    </div>
  );
}

function QueryResultCard({ output }: { output: AgentQueryOutput }) {
  const rows = output.rows.slice(0, 5);
  if (output.rowCount === 0 || output.columns.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-(--radius-lg) border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-(--space-4) border-b border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-(--space-5) py-(--space-4)">
        <div className="font-mono text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
          Query result
        </div>
        <Badge variant="outline">
          {output.rowCount}
          {output.truncated ? "+" : ""} rows
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[length:var(--text-xs)]">
          <thead>
            <tr className="border-b border-[var(--color-line-soft)]">
              {output.columns.map((column) => (
                <th
                  key={column}
                  className="px-(--space-4) py-(--space-3) text-left font-mono text-[length:var(--text-2xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line-soft)]">
            {rows.map((row, index) => (
              <tr key={index}>
                {output.columns.map((column) => (
                  <td
                    key={column}
                    className="max-w-[12rem] truncate px-(--space-4) py-(--space-3) font-mono text-[var(--color-ink)]"
                  >
                    {cellText(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {output.rowCount > rows.length ? (
        <div className="border-t border-[var(--color-line)] px-(--space-5) py-(--space-3) text-center font-mono text-[length:var(--text-2xs)] text-[var(--color-ink-faint)]">
          {output.rowCount - rows.length} more rows in result
        </div>
      ) : null}
    </div>
  );
}

function ToolPart({ part }: { part: UIMessage["parts"][number] }) {
  if (part.type !== "dynamic-tool") return null;

  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex items-center gap-(--space-3) font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
        <span className="size-(--space-3) shrink-0 animate-pulse rounded-(--radius-full) bg-[var(--color-accent)]" />
        <span className="animate-pulse">{toolLabel(part.toolName)}...</span>
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <Badge variant="destructive">
        {part.errorText || `${part.toolName} failed`}
      </Badge>
    );
  }

  if (part.state !== "output-available") return null;

  const output = part.output as ToolOutput;
  const data = output.data;

  // The stage tool returns a draft — render the live staged card, not a ✓ chip.
  if (part.toolName === "stage" && isAgentProposal(data)) {
    return <StagedCard id={part.toolCallId} proposal={data} />;
  }

  return (
    <div className="space-y-(--space-3) motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <Badge variant="outline" className="max-w-full">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2}
          className="shrink-0 text-[var(--status-success-ink)]"
        />
        <span className="min-w-0 truncate">
          {output.summary ?? `${part.toolName} complete`}
        </span>
      </Badge>
      {part.toolName === "query" && isQueryOutput(data) ? (
        <QueryResultCard output={data} />
      ) : null}
    </div>
  );
}

function AgentMessage({ message }: { message: UIMessage }) {
  const text = textParts(message);
  const assistant = message.role === "assistant";

  if (!assistant) {
    return (
      <div className="flex w-full justify-end motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
        <div className="max-w-[82%] rounded-t-(--radius-lg) rounded-br-(--radius-sm) rounded-bl-(--radius-lg) bg-[var(--color-surface-alt)] px-(--space-5) py-(--space-4) text-[length:var(--text-sm)] text-[var(--color-ink)]">
          <MessageText text={text} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-(--space-4) motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
      <div className="flex items-center gap-(--space-3) font-mono text-[length:var(--text-2xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
        <AshGlyph className="size-(--space-8) [&_svg]:size-(--space-5)" />
        Ash
      </div>
      <div className="space-y-(--space-4) text-[var(--color-ink)]">
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <MessageText
                key={index}
                text={part.text}
                streaming={part.state === "streaming"}
              />
            );
          }
          if (part.type === "reasoning") {
            if (part.state !== "streaming") return null;
            return (
              <div
                key={index}
                className="animate-pulse font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]"
              >
                Thinking...
              </div>
            );
          }
          return <ToolPart key={index} part={part} />;
        })}
        {!text && message.parts.length === 0 ? null : null}
      </div>
    </div>
  );
}

export function AgentChatSheet({ open, onOpenChange }: AgentChatSheetProps) {
  const [input, setInput] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);
  const pathname = usePathname();
  const context = pageContext(pathname);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/agent/chat" }),
    []
  );
  const { messages, sendMessage, setMessages, status, stop, error } = useChat({
    transport,
    experimental_throttle: 60,
  });
  const busy = status === "submitted" || status === "streaming";
  // Suppress the generic working line whenever a part is already animating
  // (streaming text caret, thinking line, or an in-flight tool line).
  const lastMessage = messages[messages.length - 1];
  const lastMessageActive =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some(
      (part) =>
        ((part.type === "text" || part.type === "reasoning") &&
          part.state === "streaming") ||
        (part.type === "dynamic-tool" &&
          (part.state === "input-streaming" || part.state === "input-available"))
    );
  const showWorking = busy && !lastMessageActive;
  const activePrompts = ASH_PROMPT_CATEGORIES.find(
    (category) => category.label === activeCategory
  );

  useEffect(() => {
    if (!open) return;
    // After the frame so reopening scrolls after Radix settles focus.
    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTo({ top: viewport.scrollHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, status, open]);

  async function submitText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    await sendMessage({ text: trimmed }, { body: { context } });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitText(input);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        id="dashboard-agent-chat-sheet"
        side="right"
        showCloseButton={false}
        showOverlay={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textareaRef.current?.focus();
        }}
        className="gap-0 p-0 data-[side=right]:bottom-0 data-[side=right]:top-(--height-nav) data-[side=right]:h-[calc(100dvh-var(--height-nav))] data-[side=right]:w-[min(100vw,25rem)] data-[side=right]:sm:max-w-[25rem]"
      >
        <SheetHeader className="flex-row items-center justify-between gap-(--space-4) px-(--space-6) py-(--space-5)">
          <div className="flex min-w-0 items-center gap-(--space-4)">
            <AshGlyph className="size-(--space-10) [&_svg]:size-(--space-6)" />
            <div className="flex min-w-0 items-center gap-(--space-3)">
              <SheetTitle>Ash</SheetTitle>
              <Badge variant="outline">AI</Badge>
            </div>
          </div>
          <div className="flex items-center gap-(--space-2)">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="New chat"
              onClick={() => setMessages([])}
              disabled={busy && messages.length === 0}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            </Button>
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close Ash">
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>

        <AgentStagingProvider
          onCloseLoop={(text) => {
            void sendMessage({ text }, { body: { context } });
          }}
        >
        <ScrollArea
          className="min-h-0 flex-1"
          viewportRef={viewportRef}
          viewportClassName="px-(--space-6) py-(--space-6) [&>div]:block! [&>div]:min-w-0!"
        >
          <div className="flex min-h-full flex-col gap-(--space-5)">
            {messages.length === 0 ? (
              <div className="mt-auto space-y-(--space-6)">
                <div className="space-y-(--space-4)">
                  <AshGlyph className="size-(--space-12) [&_svg]:size-(--space-7)" />
                  <div className="text-[length:var(--text-lg)] font-semibold">
                    What can I take off your plate?
                  </div>
                  <p className="mt-(--space-2) text-[length:var(--text-sm)] leading-[var(--leading-md)] text-[var(--color-ink-faint)]">
                    I can read live data in this view and help you plan what to do next.
                  </p>
                </div>
                <div className="space-y-(--space-4)">
                  <div className="flex flex-wrap gap-(--space-3)">
                    {ASH_PROMPT_CATEGORIES.map((category) => (
                      <Button
                        key={category.label}
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-expanded={activeCategory === category.label}
                        onClick={() =>
                          setActiveCategory(
                            activeCategory === category.label ? null : category.label
                          )
                        }
                        className={cn(
                          "rounded-(--radius-full)",
                          activeCategory === category.label &&
                            "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                        )}
                      >
                        <HugeiconsIcon icon={category.icon} strokeWidth={2} />
                        {category.label}
                      </Button>
                    ))}
                  </div>
                  {activePrompts ? (
                    <div className="divide-y divide-[var(--color-line-soft)] rounded-(--radius-lg) border border-[var(--color-line)] bg-[var(--color-surface)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1">
                      <div className="flex items-center justify-between gap-(--space-4) px-(--space-5) py-(--space-2)">
                        <span className="font-mono text-[length:var(--text-2xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
                          {activePrompts.label}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Close suggestions"
                          onClick={() => setActiveCategory(null)}
                        >
                          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                        </Button>
                      </div>
                      {activePrompts.prompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          className="block w-full px-(--space-5) py-(--space-4) text-left text-[length:var(--text-sm)] hover:bg-[var(--color-surface-alt)]"
                          onMouseEnter={() => setPromptPreview(prompt)}
                          onMouseLeave={() => setPromptPreview(null)}
                          onFocus={() => setPromptPreview(prompt)}
                          onBlur={() => setPromptPreview(null)}
                          onClick={() => {
                            setInput(prompt);
                            setPromptPreview(null);
                            setActiveCategory(null);
                            textareaRef.current?.focus();
                          }}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {!input.trim() ? <RotatingTip /> : null}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <AgentMessage key={message.id} message={message} />
              ))
            )}
            {showWorking ? (
              <div className="flex items-center gap-(--space-3) font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                <span className="size-(--space-3) shrink-0 animate-pulse rounded-(--radius-full) bg-[var(--color-accent)]" />
                <span className="animate-pulse">Working</span>
              </div>
            ) : null}
            {error ? (
              <div className="rounded-(--radius-md) border border-[var(--status-danger-line)] bg-[var(--status-danger-bg)] p-(--space-5) text-[length:var(--text-sm)] text-[var(--status-danger-ink)]">
                {error.message}
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 space-y-(--space-3) border-t border-[var(--color-line)] bg-[var(--color-surface-sunk)] p-(--space-5)"
        >
          <AshTray />
          <div className="rounded-(--radius-lg) border border-[var(--color-line)] bg-[var(--color-surface)] p-(--space-4) focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_4px_var(--color-accent-soft)]">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              placeholder={promptPreview ?? "Ask Ash..."}
              className="max-h-40 min-h-(--height-input-lg) resize-none border-0 bg-transparent p-0 shadow-none focus-visible:shadow-none"
            />
            <div className="mt-(--space-4) flex items-center gap-(--space-4)">
              <span className="flex-1" />
              {busy ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  aria-label="Stop response"
                  onClick={stop}
                  className="rounded-(--radius-full)"
                >
                  <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Send message"
                  disabled={!input.trim()}
                  className="rounded-(--radius-full)"
                >
                  <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
                </Button>
              )}
            </div>
          </div>
        </form>
        </AgentStagingProvider>
      </SheetContent>
    </Sheet>
  );
}
