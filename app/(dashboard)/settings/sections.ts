import { canManageTeam, type AppRole } from "@/lib/authz";

export type SettingsSectionKey = "account" | "team";

export type SettingsSection = {
  key: SettingsSectionKey;
  title: string;
  href: string;
};

const ALL_SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: "account",
    title: "Account",
    href: "/settings/account",
  },
  {
    key: "team",
    title: "Team",
    href: "/settings/team",
  },
];

export function getSettingsSections(role: AppRole): SettingsSection[] {
  return ALL_SETTINGS_SECTIONS.filter((section) => {
    if (section.key === "team") {
      return canManageTeam(role);
    }

    return true;
  });
}
