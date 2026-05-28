import type { Metadata } from "next";
import { headers } from "next/headers";
import { canManageTeam, hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getQuickBooksConnection } from "@/lib/dal/accounting";
import {
  getRecentXeroExports,
  getRecentXeroImportRuns,
  getRecentXeroSyncEvents,
  getXeroConnection,
} from "@/lib/dal/xero";
import { getAccountPageData, getTeamPageData } from "./queries";
import { getDailyManufacturingReportSchedule } from "@/lib/dal/reports";
import { listAgentApiTokens } from "@/lib/agent/external-access/tokens";
import { AGENT_MCP_PATH } from "@/lib/agent/mcp-oauth/metadata";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getSettingsSections } from "./sections";
import { SettingsNav } from "./settings-nav";
import { AccountSection } from "./account-section";
import { TeamSection } from "./team-section";
import { IntegrationsSection } from "./integrations-section";
import { ReportsSection } from "./reports-section";
import { AgentAccessSection } from "./agent-access-section";

export const metadata: Metadata = {
  title: "Settings",
};

function getRequestOrigin(requestHeaders: Headers) {
  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    requestHeaders.get("host");

  if (!host) {
    return getCanonicalAppUrl();
  }

  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const requestHeaders = await headers();
  const context = await getAuthedMemberContext();
  const showTeam = canManageTeam(context.assignedRoles);
  const canManageSalesXero = hasModuleAccess(
    context.assignedRoles,
    "sales",
    "operate"
  );
  const canManagePurchasingXero = hasModuleAccess(
    context.assignedRoles,
    "purchasing",
    "operate"
  );
  const canManageXero = canManageSalesXero || canManagePurchasingXero;
  const showIntegrations = canManageXero;

  const showReports = showTeam;
  const showAgentAccess = showTeam;
  const agentOpenApiUrl = new URL(
    "/.well-known/ashicore-agent-production-planning-openapi.json",
    getRequestOrigin(requestHeaders)
  ).toString();
  const agentMcpServerUrl = new URL(
    AGENT_MCP_PATH,
    getRequestOrigin(requestHeaders)
  ).toString();
  const claudeInstallUrl = new URL("/customize/connectors", "https://claude.ai");
  claudeInstallUrl.searchParams.set("modal", "add-custom-connector");
  claudeInstallUrl.searchParams.set("connectorName", "Ashicore");
  claudeInstallUrl.searchParams.set("connectorUrl", agentMcpServerUrl);
  const chatGptBuilderUrl = "https://chatgpt.com/gpts/editor";
  const claudePluginDownloadUrl = new URL(
    "/downloads/ashicore-claude-plugin.zip",
    getRequestOrigin(requestHeaders)
  ).toString();
  const sections = getSettingsSections({
    showTeam,
    showAgentAccess,
    showIntegrations,
    showReports,
  });
  const purchaseOrderSyncConfigured = Boolean(
    process.env.ACCOUNTING_PURCHASE_ORDER_SYNC_SECRET ??
      process.env.XERO_RETRY_SECRET ??
      process.env.CRON_SECRET
  );

  const [
    accountData,
    teamData,
    reportScheduleData,
    agentAccessData,
    xeroConnection,
    quickBooksConnection,
    xeroImportRuns,
    xeroSyncEvents,
    xeroExports,
    resolvedSearchParams,
  ] = await Promise.all([
    getAccountPageData(),
    showTeam ? getTeamPageData() : null,
    showReports ? getDailyManufacturingReportSchedule() : null,
    showAgentAccess
      ? listAgentApiTokens().then((tokens) => ({
          tokens,
          openApiUrl: agentOpenApiUrl,
          mcpServerUrl: agentMcpServerUrl,
          claudeInstallUrl: claudeInstallUrl.toString(),
          chatGptBuilderUrl,
          claudePluginDownloadUrl,
        }))
      : null,
    showIntegrations ? getXeroConnection() : null,
    showIntegrations ? getQuickBooksConnection() : null,
    showIntegrations ? getRecentXeroImportRuns() : [],
    showIntegrations ? getRecentXeroSyncEvents() : [],
    showIntegrations
      ? getRecentXeroExports({
          includeSales: canManageSalesXero,
          includePurchasing: false,
        })
      : [],
    searchParams,
  ]);

  return (
    <div className="w-full">
      <div className="grid gap-(--space-10) xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex min-w-0 flex-col gap-(--space-10)">
          <AccountSection initialData={accountData} />
          {teamData ? <TeamSection initialData={teamData} /> : null}
          {reportScheduleData ? (
            <ReportsSection initialData={reportScheduleData} />
          ) : null}
          {agentAccessData ? (
            <AgentAccessSection initialData={agentAccessData} />
          ) : null}
          {showIntegrations ? (
            <IntegrationsSection
              connection={xeroConnection}
              quickBooksConnection={quickBooksConnection}
              importRuns={xeroImportRuns}
              syncEvents={xeroSyncEvents}
              exportRows={xeroExports}
              purchaseOrderSyncConfigured={purchaseOrderSyncConfigured}
              error={resolvedSearchParams.error}
              canManageConnection={canManageSalesXero}
              canManageSalesXero={canManageSalesXero}
              canManagePurchasingXero={canManagePurchasingXero}
              canImportCustomers={canManageSalesXero}
              canImportSuppliers={canManagePurchasingXero}
            />
          ) : null}
        </div>

        <SettingsNav sections={sections} />
      </div>
    </div>
  );
}
