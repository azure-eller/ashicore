import "server-only";

import { getCanonicalAppUrl } from "@/lib/app-url";

export const AGENT_MCP_PATH = "/api/agent/mcp";

export function getAgentMcpUrl() {
  return `${getCanonicalAppUrl()}${AGENT_MCP_PATH}`;
}

export function getAgentMcpProtectedResourceMetadata() {
  return {
    resource: getAgentMcpUrl(),
    authorization_servers: [getCanonicalAppUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: ["production_planning:read"],
  };
}
