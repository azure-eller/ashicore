export type SettingsSection = {
  id: string;
  title: string;
};

export function getSettingsSections({
  showTeam,
  showIntegrations,
  showReports,
}: {
  showTeam: boolean;
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

  if (showIntegrations) {
    sections.push({ id: "integrations", title: "Integrations" });
  }

  return sections;
}
