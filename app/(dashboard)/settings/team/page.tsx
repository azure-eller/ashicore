import { redirect } from "next/navigation";
import { canManageTeam } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { TeamSection } from "../team-section";
import { getTeamPageData } from "../queries";

export default async function SettingsTeamPage() {
  const context = await getAuthedMemberContext();

  if (!canManageTeam(context.assignedRoles)) {
    redirect("/settings/account");
  }

  const teamData = await getTeamPageData();

  return <TeamSection initialData={teamData} />;
}
