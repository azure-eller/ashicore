import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrgSetupForm } from "@/components/org-setup-form";
import { auth } from "@/lib/auth";
import { getPendingInvitationForEmail } from "@/lib/dal/auth";

export default async function Page() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    redirect("/sign-in");
  }

  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });

  if (organizations.length === 0) {
    const pendingInvitation = await getPendingInvitationForEmail(session.user.email);

    if (pendingInvitation) {
      redirect(`/accept-invitation?id=${pendingInvitation.id}`);
    }
  }

  return <OrgSetupForm organizations={organizations} />;
}
