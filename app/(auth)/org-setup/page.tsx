import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrgSetupForm } from "@/components/org-setup-form";
import { auth } from "@/lib/auth";
import { parseBillingPlanIntent } from "@/lib/billing/plan-intent";
import { getPendingInvitationForEmail, isMfaRequiredForSession } from "@/lib/dal/auth";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const params = await searchParams;
  const plan = params.plan ? parseBillingPlanIntent(params.plan) : null;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    redirect("/sign-in");
  }

  if (await isMfaRequiredForSession(session)) {
    redirect(
      `/mfa-setup?next=${encodeURIComponent(
        plan ? `/org-setup?plan=${plan}` : "/org-setup"
      )}`
    );
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

  return (
    <OrgSetupForm
      organizations={organizations}
      plan={plan ?? undefined}
      continueToOnboarding={plan != null}
    />
  );
}
