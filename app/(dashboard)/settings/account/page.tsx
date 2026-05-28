import { AccountSection } from "../account-section";
import { getAccountPageData } from "../queries";

export default async function SettingsAccountPage() {
  const accountData = await getAccountPageData();

  return <AccountSection initialData={accountData} />;
}
