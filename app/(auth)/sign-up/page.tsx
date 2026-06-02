import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/signup-form";
import {
  appEntryPathForPlanIntent,
  orgSetupPathForPlanIntent,
  parseBillingPlanIntent,
} from "@/lib/billing/plan-intent";
import { auth } from "@/lib/auth";
import { isMfaEnrolled } from "@/lib/dal/auth";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const params = await searchParams;
  const plan = parseBillingPlanIntent(params.plan);
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (session) {
    const nextPath = session.session.activeOrganizationId
      ? appEntryPathForPlanIntent(plan)
      : orgSetupPathForPlanIntent(plan);

    if (!isMfaEnrolled(session)) {
      redirect(`/mfa-setup?next=${encodeURIComponent(nextPath)}`);
    }

    redirect(nextPath);
  }

  return <SignupForm plan={plan} />;
}
