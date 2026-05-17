import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MfaSetupForm } from "@/components/mfa-setup-form";
import { auth } from "@/lib/auth";
import { isMfaEnrolled } from "@/lib/dal/auth";

function safeNext(value: string | undefined, fallback: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    redirect("/sign-in");
  }

  const fallbackNext = session.session.activeOrganizationId ? "/" : "/org-setup";
  const { next } = await searchParams;
  const target = safeNext(next, fallbackNext);

  if (isMfaEnrolled(session)) {
    redirect(target);
  }

  return <MfaSetupForm next={target} />;
}
