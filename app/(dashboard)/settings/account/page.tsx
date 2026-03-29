import type { Metadata } from "next";
import { AccountSettingsPage } from "./account-settings-page";
import { getAccountPageData } from "../queries";

export const metadata: Metadata = {
  title: "Account",
};

export default async function SettingsAccountPage() {
  const data = await getAccountPageData();

  return <AccountSettingsPage initialData={data} />;
}
