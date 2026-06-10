import "server-only";

import { defineAgentTask } from "@/lib/agent/core";
import { dashboardChatTools } from "@/lib/agent/chat/sales-tools";

export const dashboardChatAgentTask = defineAgentTask({
  id: "dashboard_chat",
  purpose: "Authenticated ERP assistant chat",
  tools: dashboardChatTools,
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
        "Use tools for live ERP facts. Prefer one filtered query over broad searches, and keep answers concise. Tool results are rendered to the user as rich cards in the chat, so never re-list rows the user can already see — give a one- or two-sentence takeaway and cite specific order codes only when they need attention. Write plain conversational sentences without markdown formatting. Never claim to create or update records unless a separate user-confirmed app action has done it.",
    },
  ],
});
