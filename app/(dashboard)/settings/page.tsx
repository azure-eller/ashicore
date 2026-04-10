import type { Metadata } from "next";
import { canManageTeam } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getAccountPageData, getTeamPageData } from "./queries";
import { getSettingsSections } from "./sections";
import { SettingsNav } from "./settings-nav";
import { AppearanceSection } from "./appearance-section";
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
    <div className="mx-auto w-full max-w-7xl">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Manage your profile, team access, and workspace configuration.
        </p>
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-start">
        <div className="order-2 min-w-0 xl:order-1">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <ProfileSection initialData={accountData} />
            <AppearanceSection />
            {teamData ? <TeamSection initialData={teamData} /> : null}
          </div>
        </div>

        <div className="order-1 xl:order-2 xl:justify-self-end">
          <SettingsNav sections={sections} />
        </div>
      </div>
    </div>
  );
}
