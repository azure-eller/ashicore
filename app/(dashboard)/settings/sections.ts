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
  showAddresses,
  showBilling,
  showUnits,
}: {
  showTeam: boolean;
  showAgentAccess: boolean;
  showIntegrations: boolean;
  showTaxes: boolean;
  showReports: boolean;
  showAddresses: boolean;
  showBilling: boolean;
  showUnits: boolean;
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

  if (showBilling) {
    sections.push({ id: "billing", title: "Billing", href: "/settings/billing" });
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

  if (showAddresses) {
    sections.push({
      id: "addresses",
      title: "Addresses",
      href: "/settings/addresses",
    });
  }

  if (showUnits) {
    sections.push({
      id: "units",
      title: "Units",
      href: "/settings/units",
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
