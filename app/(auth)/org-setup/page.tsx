import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrgSetupForm } from "@/components/org-setup-form";
import { auth } from "@/lib/auth";
import { parseBillingPlanIntent } from "@/lib/billing/plan-intent";
import { getPendingInvitationForEmail, isMfaEnrolled } from "@/lib/dal/auth";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const params = await searchParams;
  const plan = parseBillingPlanIntent(params.plan);
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    redirect("/sign-in");
  }

  if (!isMfaEnrolled(session)) {
    redirect(`/mfa-setup?next=${encodeURIComponent(`/org-setup?plan=${plan}`)}`);
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

  return <OrgSetupForm organizations={organizations} plan={plan} />;
}
