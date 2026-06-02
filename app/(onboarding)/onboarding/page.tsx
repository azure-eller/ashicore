import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { OnboardingImportPage } from "./onboarding-import-page";

export default async function OnboardingPage() {
  const context = await getAuthedMemberContext();
  const canImport =
    context.role === "owner" ||
    (hasModuleAccess(context.assignedRoles, "inventory", "admin") &&
      hasModuleAccess(context.assignedRoles, "sales", "admin") &&
      hasModuleAccess(context.assignedRoles, "purchasing", "admin"));

  if (!canImport) {
    redirect("/");
  }

  return <OnboardingImportPage />;
}
