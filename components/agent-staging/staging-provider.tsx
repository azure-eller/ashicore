"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentProposal, ProposalLineTable } from "@/lib/agent/chat/proposals";
import { ReviewDialog } from "@/components/agent-staging/review-dialog";

export type StagedStatus = "staged" | "applying" | "applied" | "failed" | "discarded";

export type StagedAction = {
  /** Stable id — the agent tool-call that produced the proposal. */
  id: string;
  proposal: AgentProposal;
  status: StagedStatus;
  /** Post-commit subtitle, e.g. "Sales order created". */
  appliedSub?: string;
  error?: string;
};

export type LinePatch = { quantity?: string; unitAmount?: string };

type AgentStagingValue = {
  actions: StagedAction[];
  stagedCount: number;
  reviewOpen: boolean;
  stage: (id: string, proposal: AgentProposal) => void;
  getAction: (id: string) => StagedAction | undefined;
  openReview: () => void;
  closeReview: () => void;
  editLine: (id: string, lineIndex: number, patch: LinePatch) => void;
  discardAll: () => void;
  approveAll: () => void;
};

const AgentStagingContext = createContext<AgentStagingValue | null>(null);

export function useAgentStaging(): AgentStagingValue {
  const value = useContext(AgentStagingContext);
  if (!value) {
    throw new Error("useAgentStaging must be used within AgentStagingProvider");
  }
  return value;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recomputeLineTable(table: ProposalLineTable): ProposalLineTable {
  let total = 0;
  const lines = table.lines.map((line) => {
    const lineTotal = toNumber(line.quantity) * toNumber(line.unitAmount);
    total += lineTotal;
    return { ...line, lineTotal: lineTotal.toFixed(2) };
  });
  return { ...table, lines, total: total.toFixed(2) };
}

/** Apply a line edit to both the preview table and the commit payload, keeping them in sync. */
function applyLineEdit(
  proposal: AgentProposal,
  lineIndex: number,
  patch: LinePatch
): AgentProposal {
  const table = proposal.lineTable;
  if (!table) return proposal;

  const nextTable = recomputeLineTable({
    ...table,
    lines: table.lines.map((line, index) =>
      index === lineIndex ? { ...line, ...patch } : line
    ),
  });

  const commitLines = Array.isArray(proposal.commitPayload[table.commitLinesKey])
    ? [...(proposal.commitPayload[table.commitLinesKey] as unknown[])]
    : [];
  const target = { ...(commitLines[lineIndex] as Record<string, unknown>) };
  if (patch.quantity !== undefined) target[table.commitQuantityKey] = patch.quantity;
  if (patch.unitAmount !== undefined) target[table.commitUnitAmountKey] = patch.unitAmount;
  commitLines[lineIndex] = target;

  return {
    ...proposal,
    lineTable: nextTable,
    commitPayload: { ...proposal.commitPayload, [table.commitLinesKey]: commitLines },
  };
}

function approvalSummary(proposal: AgentProposal): string {
  const table = proposal.lineTable;
  const detail = table
    ? ` (${table.lines.length} line${table.lines.length === 1 ? "" : "s"}, total ${table.total})`
    : "";
  return `committed ${proposal.title}${detail}`;
}

export function AgentStagingProvider({
  children,
  onCloseLoop,
}: {
  children: ReactNode;
  /** Append a short factual line to the transcript so the model stays truthful. */
  onCloseLoop: (text: string) => void;
}) {
  const [actions, setActions] = useState<StagedAction[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const applyingRef = useRef(false);

  const stage = useCallback((id: string, proposal: AgentProposal) => {
    setActions((current) => {
      if (current.some((action) => action.id === id)) return current;
      return [...current, { id, proposal, status: "staged" }];
    });
  }, []);

  const getAction = useCallback(
    (id: string) => actions.find((action) => action.id === id),
    [actions]
  );

  const editLine = useCallback((id: string, lineIndex: number, patch: LinePatch) => {
    setActions((current) =>
      current.map((action) =>
        action.id === id
          ? { ...action, proposal: applyLineEdit(action.proposal, lineIndex, patch) }
          : action
      )
    );
  }, []);

  const discardAll = useCallback(() => {
    setReviewOpen(false);
    setActions((current) => {
      const staged = current.filter((action) => action.status === "staged");
      if (staged.length === 0) return current;
      return current.map((action) =>
        action.status === "staged" ? { ...action, status: "discarded" } : action
      );
    });
    onCloseLoop("(The user discarded the staged changes without applying them.)");
  }, [onCloseLoop]);

  const approveAll = useCallback(() => {
    if (applyingRef.current) return;
    const staged = actions.filter((action) => action.status === "staged");
    if (staged.length === 0) return;
    applyingRef.current = true;
    setReviewOpen(false);
    setActions((current) =>
      current.map((action) =>
        action.status === "staged" ? { ...action, status: "applying" } : action
      )
    );

    void (async () => {
      const applied: string[] = [];
      for (const action of staged) {
        const { proposal } = action;
        try {
          const response = await fetch(proposal.commitPath, {
            method: proposal.method,
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify(proposal.commitPayload),
          });
          if (!response.ok) {
            const detail = await response
              .json()
              .then((data) => (data?.error as string) ?? null)
              .catch(() => null);
            throw new Error(detail ?? `Request failed (${response.status})`);
          }
          applied.push(approvalSummary(proposal));
          setActions((current) =>
            current.map((entry) =>
              entry.id === action.id
                ? { ...entry, status: "applied", appliedSub: proposal.appliedLabel }
                : entry
            )
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to apply.";
          setActions((current) =>
            current.map((entry) =>
              entry.id === action.id ? { ...entry, status: "failed", error: message } : entry
            )
          );
        }
      }
      applyingRef.current = false;
      if (applied.length > 0) {
        onCloseLoop(`(The user approved the staged changes — the app ${applied.join("; ")}.)`);
      }
    })();
  }, [actions, onCloseLoop]);

  const value = useMemo<AgentStagingValue>(
    () => ({
      actions,
      stagedCount: actions.filter((action) => action.status === "staged").length,
      reviewOpen,
      stage,
      getAction,
      openReview: () => setReviewOpen(true),
      closeReview: () => setReviewOpen(false),
      editLine,
      discardAll,
      approveAll,
    }),
    [actions, reviewOpen, stage, getAction, editLine, discardAll, approveAll]
  );

  return (
    <AgentStagingContext.Provider value={value}>
      {children}
      <ReviewDialog />
    </AgentStagingContext.Provider>
  );
}
