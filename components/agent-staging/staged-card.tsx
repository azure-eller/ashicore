"use client";

import { useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentProposal } from "@/lib/agent/chat/proposals";
import { useAgentStaging, type StagedAction } from "@/components/agent-staging/staging-provider";

function subtitle(action: StagedAction): string {
  switch (action.status) {
    case "staged":
      return "Staged · not applied";
    case "applying":
      return "Applying…";
    case "applied":
      return action.appliedSub ?? "Applied";
    case "failed":
      return action.error ?? "Failed to apply";
    case "discarded":
      return "Discarded";
  }
}

/**
 * In-stream card anchored where the agent staged the action. It is a live view of
 * the staging store entry — registers the proposal on first render and reflects
 * the entry's status in place (amber while staged → green applied → muted discarded).
 */
export function StagedCard({ id, proposal }: { id: string; proposal: AgentProposal }) {
  const { stage, getAction, openReview } = useAgentStaging();

  useEffect(() => {
    stage(id, proposal);
  }, [id, proposal, stage]);

  const action = getAction(id) ?? { id, proposal, status: "staged" as const };
  const status = action.status;

  return (
    <div
      className={cn(
        "flex items-center gap-(--space-4) rounded-(--radius-lg) border border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-4) py-(--space-3)",
        (status === "staged" || status === "applying") &&
          "border-[var(--status-warning-divider)]",
        status === "applied" && "border-[var(--status-success-divider)] bg-[var(--status-success-bg)]",
        status === "failed" && "border-[var(--status-danger-divider)] bg-[var(--status-danger-bg)]",
        status === "discarded" && "opacity-70"
      )}
    >
      <span
        className={cn(
          "flex size-(--space-12) shrink-0 items-center justify-center rounded-(--radius-md)",
          status === "staged" && "bg-[var(--status-warning-bg)]",
          status === "applying" && "bg-[var(--status-warning-bg)]",
          status === "applied" && "bg-[var(--status-success-bg)]",
          status === "failed" && "bg-[var(--status-danger-bg)]",
          status === "discarded" && "bg-[var(--color-surface-sunk)]"
        )}
      >
        {status === "applied" ? (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            className="size-(--space-5) text-[var(--status-success-ink)]"
          />
        ) : status === "failed" ? (
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="size-(--space-5) text-[var(--status-danger-ink)]"
          />
        ) : status === "discarded" ? (
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-(--space-5) text-[var(--color-ink-faint)]"
          />
        ) : (
          <span className="size-(--space-3) rounded-(--radius-full) bg-[var(--status-warning-ink)] motion-safe:animate-pulse" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)]">
          {action.proposal.title}
        </div>
        <div className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
          {subtitle(action)}
        </div>
      </div>

      {status === "staged" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-(--radius-full)"
          onClick={openReview}
        >
          Review
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Persistent amber tray above the composer — the minimal notification that
 * survives scrollback. Visible only while there is something staged.
 */
export function AshTray() {
  const { stagedCount, openReview } = useAgentStaging();
  if (stagedCount === 0) return null;

  return (
    <button
      type="button"
      onClick={openReview}
      className="flex w-full items-center gap-(--space-3) rounded-(--radius-lg) border-[1.5px] border-[var(--status-warning-divider)] bg-[color-mix(in_oklch,var(--status-warning-bg),var(--color-surface)_68%)] px-(--space-4) py-(--space-3) text-left"
    >
      <span className="size-(--space-3) shrink-0 rounded-(--radius-full) bg-[var(--status-warning-ink)] motion-safe:animate-pulse" />
      <span className="min-w-0 flex-1 truncate text-[length:var(--text-xs)] font-semibold text-[var(--status-warning-ink)]">
        {stagedCount} change{stagedCount === 1 ? "" : "s"} staged for review
      </span>
      <span className="shrink-0 font-mono text-[length:var(--text-2xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--status-warning-ink)] uppercase">
        Review ›
      </span>
    </button>
  );
}
