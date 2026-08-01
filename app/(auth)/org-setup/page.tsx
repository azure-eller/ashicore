import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrgSetupForm } from "@/components/org-setup-form";
import { auth } from "@/lib/auth";
import {
  normalizeBillingIntent,
  orgSetupPathForBillingIntent,
} from "@/lib/billing/plan-intent";
import { getPendingInvitationForEmail, isMfaRequiredForSession } from "@/lib/dal/auth";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; locations?: string; addons?: string }>;
}) {
  const params = await searchParams;
  const intent = params.plan ? normalizeBillingIntent(params) : null;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    redirect("/sign-in");
  }

  if (await isMfaRequiredForSession(session)) {
    redirect(
      `/two-factor?next=${encodeURIComponent(
        intent ? orgSetupPathForBillingIntent(intent) : "/org-setup"
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
      billingIntent={intent ?? undefined}
      continueToOnboarding={false}
    />
  );
}
