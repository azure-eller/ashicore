import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrgSetupForm } from "@/components/org-setup-form";
import { auth } from "@/lib/auth";

export default async function Page() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    redirect("/sign-in");
  }

  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });

  return <OrgSetupForm organizations={organizations} />;
}
