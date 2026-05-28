export type SettingsSection = {
  id: string;
  title: string;
  href: string;
};

export function getSettingsSections({
  showTeam,
  showAgentAccess,
  showIntegrations,
  showTaxes,
  showReports,
}: {
  showTeam: boolean;
  showAgentAccess: boolean;
  showIntegrations: boolean;
  showTaxes: boolean;
  showReports: boolean;
}): SettingsSection[] {
  const sections: SettingsSection[] = [
    { id: "account", title: "Account", href: "/settings/account" },
  ];

  if (showTeam) {
    sections.push({ id: "team", title: "Team", href: "/settings/team" });
  }

  if (showReports) {
    sections.push({ id: "reports", title: "Reports", href: "/settings/reports" });
  }

  if (showAgentAccess) {
    sections.push({
      id: "agent-access",
      title: "Agent API",
      href: "/settings/agent-access",
    });
  }

  if (showTaxes) {
    sections.push({
      id: "tax-rates",
      title: "Tax rates",
      href: "/settings/tax-rates",
    });
  }

  if (showIntegrations) {
    sections.push({
      id: "integrations",
      title: "Integrations",
      href: "/settings/integrations",
    });
  }

  return sections;
}
