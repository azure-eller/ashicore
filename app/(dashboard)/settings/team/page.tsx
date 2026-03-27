import { getTeamPageData } from "../queries";
import { TeamPage } from "../team-page";

export default async function SettingsTeamPage() {
  const data = await getTeamPageData();

  return <TeamPage initialData={data} />;
}
