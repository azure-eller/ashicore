import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canManageTeam } from "@/lib/authz";
import { listAgentApiTokens } from "@/lib/agent/external-access/tokens";
import { listMcpOAuthTokenGrants } from "@/lib/agent/mcp-oauth/service";
import { AGENT_MCP_PATH } from "@/lib/agent/mcp-oauth/metadata";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { AgentAccessSection } from "../agent-access-section";
import { getRequestOrigin } from "../request-origin";

export default async function SettingsAgentAccessPage() {
  const context = await getAuthedMemberContext();

  if (!canManageTeam(context.assignedRoles)) {
    redirect("/settings/account");
  }

  const requestHeaders = await headers();
  const requestOrigin = getRequestOrigin(requestHeaders);
  const agentOpenApiUrl = new URL(
    "/.well-known/ashicore-agent-production-planning-openapi.json",
    requestOrigin
  ).toString();
  const agentMcpServerUrl = new URL(AGENT_MCP_PATH, requestOrigin).toString();
  const claudeInstallUrl = new URL("/customize/connectors", "https://claude.ai");
  claudeInstallUrl.searchParams.set("modal", "add-custom-connector");
  claudeInstallUrl.searchParams.set("connectorName", "Ashicore");
  claudeInstallUrl.searchParams.set("connectorUrl", agentMcpServerUrl);
  const [tokens, mcpOAuthGrants] = await Promise.all([
    listAgentApiTokens(),
    listMcpOAuthTokenGrants(),
  ]);

  return (
    <AgentAccessSection
      initialData={{
        tokens,
        mcpOAuthGrants,
        openApiUrl: agentOpenApiUrl,
        mcpServerUrl: agentMcpServerUrl,
        claudeInstallUrl: claudeInstallUrl.toString(),
        chatGptBuilderUrl: "https://chatgpt.com/gpts/editor",
      }}
    />
  );
}
