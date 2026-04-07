import type { Metadata } from "next";
import { canManageTeam } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getAccountPageData, getTeamPageData } from "./queries";
import { getSettingsSections } from "./sections";
import { SettingsNav } from "./settings-nav";
import { ProfileSection } from "./profile-section";
import { TeamSection } from "./team-section";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const context = await getAuthedMemberContext();
  const sections = getSettingsSections(context.assignedRoles);
  const showTeam = canManageTeam(context.assignedRoles);

  const [accountData, teamData] = await Promise.all([
    getAccountPageData(),
    showTeam ? getTeamPageData() : null,
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <div className="mt-6 flex gap-8">
        <SettingsNav sections={sections} />

        <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-6">
          <ProfileSection initialData={accountData} />
          {teamData ? <TeamSection initialData={teamData} /> : null}
        </div>
      </div>
    </div>
  );
}
