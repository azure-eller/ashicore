import { canManageTeam } from "@/lib/authz";

export type SettingsSection = {
  id: string;
  title: string;
};

const ALL_SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "profile", title: "Profile" },
  { id: "team", title: "Team" },
];

export function getSettingsSections(role: string | string[] | null | undefined): SettingsSection[] {
  return ALL_SETTINGS_SECTIONS.filter((section) => {
    if (section.id === "team") {
      return canManageTeam(role);
    }

    return true;
  });
}
