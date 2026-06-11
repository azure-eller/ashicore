import type { IconSvgElement } from "@hugeicons/react";
import {
  CreditCardIcon,
  Location01Icon,
  PercentIcon,
  Plug01Icon,
  Robot01Icon,
  RulerIcon,
  UserIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";

export type SettingsSection = {
  id: string;
  title: string;
  href: string;
  icon: IconSvgElement;
};

export type SettingsGroup = {
  label: string;
  sections: SettingsSection[];
};

export function getSettingsGroups({
  showTeam,
  showAgentAccess,
  showIntegrations,
  showTaxes,
  showAddresses,
  showBilling,
  showUnits,
}: {
  showTeam: boolean;
  showAgentAccess: boolean;
  showIntegrations: boolean;
  showTaxes: boolean;
  showAddresses: boolean;
  showBilling: boolean;
  showUnits: boolean;
}): SettingsGroup[] {
  const groups: SettingsGroup[] = [
    {
      label: "You",
      sections: [
        { id: "account", title: "Account", href: "/settings/account", icon: UserIcon },
      ],
    },
    {
      label: "Workspace",
      sections: [
        ...(showTeam
          ? [{ id: "team", title: "Team", href: "/settings/team", icon: UserMultiple02Icon }]
          : []),
        ...(showBilling
          ? [{ id: "billing", title: "Billing", href: "/settings/billing", icon: CreditCardIcon }]
          : []),
      ],
    },
    {
      label: "Operations",
      sections: [
        ...(showTaxes
          ? [{ id: "tax-rates", title: "Tax rates", href: "/settings/tax-rates", icon: PercentIcon }]
          : []),
        ...(showAddresses
          ? [{ id: "addresses", title: "Addresses", href: "/settings/addresses", icon: Location01Icon }]
          : []),
        ...(showUnits
          ? [{ id: "units", title: "Units", href: "/settings/units", icon: RulerIcon }]
          : []),
      ],
    },
    {
      label: "Connections",
      sections: [
        ...(showIntegrations
          ? [{ id: "integrations", title: "Integrations", href: "/settings/integrations", icon: Plug01Icon }]
          : []),
        ...(showAgentAccess
          ? [{ id: "agent-access", title: "Agent API", href: "/settings/agent-access", icon: Robot01Icon }]
          : []),
      ],
    },
  ];

  return groups.filter((group) => group.sections.length > 0);
}
