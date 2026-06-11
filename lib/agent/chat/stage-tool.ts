import "server-only";

import { z } from "zod";
import { buildAgentTool, type AgentToolContext } from "@/lib/agent/core";
import { AuthorizationError } from "@/lib/authz";
import { withOrgContext } from "@/lib/db/with-org-context";
import type { AgentProposal } from "@/lib/agent/chat/proposals";
import {
  getAgentAction,
  listAgentActions,
  memberCanUseAction,
} from "@/lib/agent/chat/actions/registry";

const STAGE_DESCRIPTION = `Stage a write for the user to review, edit, and approve. This does NOT change anything — it places a validated draft into the user's review area; the user (not you) approves it and the app commits it to the real ERP.

Use this whenever the user wants to create or change a record. Workflow:
1. Call list_actions to see what you can stage, then describe_action(action) for the exact input shape of the one you need.
2. Find the real ids with the query tool (customers, items, …) — never guess UUIDs.
3. Call stage with { action: the action name, input: a JSON string of the action's input object }.

It validates the input and the referenced records, resolves names, computes a preview, and stages the draft. After it succeeds, tell the user it is staged for their review — never say the record was created or changed.`;

export const stageTool = buildAgentTool({
  name: "stage",
  description: STAGE_DESCRIPTION,
  inputSchema: z.object({
    action: z.string().min(1).describe('Action name from list_actions, e.g. "sales_order.create"'),
    input: z.string().min(1).describe("JSON string of the action's input object"),
  }),
  execute: async (input, context: AgentToolContext): Promise<AgentProposal> => {
    const member = context.member;
    if (!member) {
      throw new AuthorizationError("You must be signed in to stage a change.", 403);
    }

    const action = getAgentAction(input.action);
    if (!action) {
      const available = listAgentActions(member).map((entry) => entry.name);
      throw new Error(
        `Unknown action "${input.action}". Call list_actions first. Available: ${available.join(", ") || "(none for your access)"}.`
      );
    }

    if (!memberCanUseAction(member, action)) {
      throw new AuthorizationError(
        `Staging "${action.name}" requires ${action.module} ${action.capability} access.`,
        403
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(input.input);
    } catch {
      throw new Error(
        `The input was not valid JSON. Pass the action's input object as a JSON string — call describe_action("${action.name}") for the shape.`
      );
    }

    const parsed = action.inputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Input does not match ${action.name}. ${z.prettifyError(parsed.error)}`);
    }

    // SELECT-only: build validates references and resolves names with org/user RLS
    // pinned. The draft is committed later by the user POSTing to the real route.
    const draft = await withOrgContext(
      member.orgId,
      (tx) => action.build(parsed.data, { tx, member }),
      { userId: member.userId }
    );

    return { kind: action.name, module: action.module, ...draft };
  },
  summarize: (draft) => `staged: ${draft.title}`,
  toModelContent: (draft) =>
    `staged "${draft.title}" for the user's review and approval — not committed.${
      draft.lineTable
        ? ` ${draft.lineTable.lines.length} line(s), total ${draft.lineTable.total}.`
        : ""
    } Tell the user it is staged; do not claim the record was created or changed.`,
  isConcurrencySafe: () => true,
});

export const agentStageTools = [stageTool];
