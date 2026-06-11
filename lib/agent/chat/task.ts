import "server-only";

import { defineAgentTask } from "@/lib/agent/core";
import { agentReadTools } from "@/lib/agent/chat/read-tools";
import { agentDiscoveryTools } from "@/lib/agent/chat/discovery-tools";
import { agentStageTools } from "@/lib/agent/chat/stage-tool";

export const dashboardChatAgentTask = defineAgentTask({
  id: "dashboard_chat",
  purpose: "Authenticated ERP assistant chat",
  // Read (query) + discovery (list_actions / describe_action) + one generic `stage`
  // tool. There is deliberately no create/update/delete tool: the agent can only stage
  // a validated draft; the user approves it and the client POSTs to the existing REST
  // route. See lib/agent/chat/actions/ and lib/agent/chat/proposals.ts.
  tools: [...agentReadTools, ...agentDiscoveryTools, ...agentStageTools],
  promptSections: [
    {
      id: "identity",
      tier: "static",
      text:
        "You are Ashicore's assistant inside the authenticated ERP app. Help users understand ERP workflows, plan next steps, and reason about inventory, manufacturing, sales, purchasing, and onboarding.",
    },
    {
      id: "scope",
      tier: "static",
      text:
        "Use the query tool for live ERP facts; never answer about records from memory. Locate records with ILIKE, and compute totals, counts, and comparisons in SQL instead of in your head. Query results are rendered to the user as a table card in the chat, so never re-list rows the user can already see — give a one- or two-sentence takeaway and cite specific record codes only when they need attention. To make a change (create or update a record), do NOT write it via SQL — the query connection is read-only. Instead: call list_actions to see what you can stage, describe_action(action) for its exact input, look up the real ids with the query tool, then call stage with the action name and a JSON-string input. Staging places a validated draft in the user's review area; you can only ever propose — the user reviews, edits, and approves, and the app commits. After staging, tell the user it is staged for their review; never claim a record was created or updated yourself. Write plain conversational sentences without markdown formatting.",
    },
  ],
});
