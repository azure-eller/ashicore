import { canManageTeam, type AppRole } from "@/lib/authz";

export type SettingsSectionKey = "account" | "appearance" | "team";

export type SettingsSection = {
  key: SettingsSectionKey;
  title: string;
  description: string;
  href: string;
  group: "personal" | "admin";
};

const ALL_SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: "account",
    title: "Account",
    description: "Profile, email, and password",
    href: "/settings/account",
    group: "personal",
  },
  {
    key: "appearance",
    title: "Appearance",
    description: "Theme and display preference",
    href: "/settings/appearance",
    group: "personal",
  },
  {
    key: "team",
    title: "Team",
    description: "Members, roles, and invitations",
    href: "/settings/team",
    group: "admin",
  },
];

export function getSettingsSections(role: AppRole): SettingsSection[] {
  return ALL_SETTINGS_SECTIONS.filter(
    (section) => section.group === "personal" || canManageTeam(role)
  );
}
