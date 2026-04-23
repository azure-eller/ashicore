export type SettingsSection = {
  id: string;
  title: string;
};

export function getSettingsSections({
  showTeam,
  showIntegrations,
}: {
  showTeam: boolean;
  showIntegrations: boolean;
}): SettingsSection[] {
  const sections: SettingsSection[] = [{ id: "account", title: "Account" }];

  if (showTeam) {
    sections.push({ id: "team", title: "Team" });
  }

  if (showIntegrations) {
    sections.push({ id: "integrations", title: "Integrations" });
  }

  return sections;
}
