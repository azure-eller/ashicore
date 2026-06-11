import "server-only";

import { z } from "zod";
import { buildAgentTool, type AgentToolContext } from "@/lib/agent/core";
import { AuthorizationError } from "@/lib/authz";
import { getAgentAction, listAgentActions } from "@/lib/agent/chat/actions/registry";

const listActionsTool = buildAgentTool({
  name: "list_actions",
  description:
    "List the changes you can stage for the user with the stage tool. Returns each action's name, title, and a one-line summary. Call describe_action(name) for the exact input shape before staging.",
  inputSchema: z.object({}),
  execute: async (_input, context: AgentToolContext) => {
    const member = context.member;
    if (!member) throw new AuthorizationError("You must be signed in.", 403);
    const actions = listAgentActions(member).map((action) => ({
      name: action.name,
      title: action.title,
      module: action.module,
      summary: action.summary,
    }));
    return { actions };
  },
  summarize: (output) => `${output.actions.length} stageable action(s)`,
  toModelContent: (output) =>
    output.actions.length === 0
      ? "No stageable actions for your access level."
      : output.actions.map((action) => `${action.name} — ${action.title}: ${action.summary}`).join("\n"),
  isConcurrencySafe: () => true,
});

const describeActionTool = buildAgentTool({
  name: "describe_action",
  description:
    "Get the exact input shape (JSON Schema) and an example for one stageable action. Call this before stage so your input validates on the first try.",
  inputSchema: z.object({
    action: z.string().min(1).describe('Action name, e.g. "sales_order.create"'),
  }),
  execute: async (input, context: AgentToolContext) => {
    const member = context.member;
    if (!member) throw new AuthorizationError("You must be signed in.", 403);
    const action = getAgentAction(input.action);
    if (!action) {
      const available = listAgentActions(member).map((entry) => entry.name);
      throw new Error(
        `Unknown action "${input.action}". Available: ${available.join(", ") || "(none for your access)"}.`
      );
    }
    return {
      name: action.name,
      title: action.title,
      summary: action.summary,
      module: action.module,
      inputSchema: z.toJSONSchema(action.inputSchema) as Record<string, unknown>,
      example: action.example,
    };
  },
  summarize: (output) => `schema for ${output.name}`,
  toModelContent: (output) =>
    `${output.name} — ${output.title}\nInput JSON Schema:\n${JSON.stringify(output.inputSchema)}\nExample input:\n${JSON.stringify(output.example)}`,
  isConcurrencySafe: () => true,
});

export const agentDiscoveryTools = [listActionsTool, describeActionTool];
