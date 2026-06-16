import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/signup-form";
import {
  appEntryPathForBillingSelection,
  normalizeBillingIntent,
  normalizeBillingSelection,
  orgSetupPathForBillingIntent,
} from "@/lib/billing/plan-intent";
import { auth } from "@/lib/auth";
import { isMfaRequiredForSession } from "@/lib/dal/auth";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; locations?: string; addons?: string }>;
}) {
  const params = await searchParams;
  const intent = normalizeBillingIntent(params);
  const plan = normalizeBillingSelection(intent.selectedPlan);
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (session) {
    const nextPath = session.session.activeOrganizationId
      ? appEntryPathForBillingSelection(plan)
      : orgSetupPathForBillingIntent(intent);

    if (await isMfaRequiredForSession(session)) {
      redirect(`/two-factor?next=${encodeURIComponent(nextPath)}`);
    }

    redirect(nextPath);
  }

  return <SignupForm billingIntent={intent} />;
}
