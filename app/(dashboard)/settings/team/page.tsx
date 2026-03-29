import type { Metadata } from "next";
import { getTeamPageData } from "../queries";
import { TeamPage } from "../team-page";

export const metadata: Metadata = {
  title: "Team",
};

export default async function SettingsTeamPage() {
  const data = await getTeamPageData();

  return <TeamPage initialData={data} />;
}
