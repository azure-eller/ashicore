// Archived provider shim.
//
// The live provider implementation was intentionally made inert when the ERP
// agent was archived so the production dependency can stay removed. Restore the
// original implementation from git history when reactivating the agent.

import type { AgentProvider } from "@/lib/agent/core/api/provider";

export class AnthropicProvider implements AgentProvider {
  async stream(): Promise<never> {
    throw new Error("The ERP agent provider is archived.");
  }
}
