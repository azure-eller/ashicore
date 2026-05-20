export type SettingsSection = {
  id: string;
  title: string;
};

export function getSettingsSections({
  showTeam,
  showAgentAccess,
  showIntegrations,
  showReports,
}: {
  showTeam: boolean;
  showAgentAccess: boolean;
  showIntegrations: boolean;
  showReports: boolean;
}): SettingsSection[] {
  const sections: SettingsSection[] = [{ id: "account", title: "Account" }];

  if (showTeam) {
    sections.push({ id: "team", title: "Team" });
  }

  if (showReports) {
    sections.push({ id: "reports", title: "Reports" });
  }

  if (showAgentAccess) {
    sections.push({ id: "agent-access", title: "Agent API" });
  }

  if (showIntegrations) {
    sections.push({ id: "integrations", title: "Integrations" });
  }

  return sections;
}
