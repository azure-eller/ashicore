import "server-only";

import type { z } from "zod";
import type { ModuleKey } from "@/lib/authz";
import type { Tx } from "@/lib/db/with-org-context";
import type { AgentToolMemberContext } from "@/lib/agent/core";
import type { AgentProposal } from "@/lib/agent/chat/proposals";

/** SELECT-only context an action's `build` runs in: a transaction with org/user RLS pinned. */
export type AgentActionBuildContext = {
  tx: Tx;
  member: AgentToolMemberContext;
};

/** What `build` returns — the proposal minus the fields the registry already owns. */
export type AgentActionDraft = Omit<AgentProposal, "kind" | "module">;

export type AgentActionCapability = "read" | "operate" | "admin";

/**
 * One allowlisted write the agent may stage. The agent fills `inputSchema`, the
 * `stage` tool validates it, then `build` resolves names + computes the preview and
 * the exact `commitPayload`. Approval replays that payload to `commitPath` — the
 * route is the single source of truth for what actually commits ("validate twice").
 *
 * Only operational create/update actions belong here. Destructive (delete),
 * auth/team, billing, and integration routes are deliberately NOT registered.
 */
export type AgentAction<TInput> = {
  /** Stable name, e.g. "sales_order.create". snake_case module, dot, verb. */
  name: string;
  /** Short catalog title for list_actions, e.g. "Create sales order". */
  title: string;
  /** One-line description of when to use it (list_actions). */
  summary: string;
  module: ModuleKey;
  /** Module access level required to stage AND commit it (almost always "operate"). */
  capability: AgentActionCapability;
  /** Agent-facing input contract — a clean, JSON-Schema-friendly schema. */
  inputSchema: z.ZodType<TInput>;
  /** A concrete valid example, surfaced by describe_action. */
  example: TInput;
  build: (input: TInput, ctx: AgentActionBuildContext) => Promise<AgentActionDraft>;
};

/** Type-erased action as stored in the registry (input collapses to `unknown`). */
export type RegisteredAction = {
  name: string;
  title: string;
  summary: string;
  module: ModuleKey;
  capability: AgentActionCapability;
  inputSchema: z.ZodTypeAny;
  example: unknown;
  build: (input: unknown, ctx: AgentActionBuildContext) => Promise<AgentActionDraft>;
};

/** Author an action with full input typing; store it erased in the registry. */
export function defineAgentAction<TInput>(action: AgentAction<TInput>): RegisteredAction {
  return action as unknown as RegisteredAction;
}
