import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";

export default async function XeroSignupLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; token?: string }>;
}) {
  const { intent, token } = await searchParams;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const query =
    intent && token
      ? `intent=${encodeURIComponent(intent)}&token=${encodeURIComponent(token)}`
      : "";
  const continueHref = query
    ? `/api/auth/xero-signup/link?${query}`
    : "/xero/sign-up/error?reason=expired";
  const signInHref = `/sign-in?callbackURL=${encodeURIComponent(continueHref)}`;

  return (
    <Card className="mx-auto w-full max-w-[460px] gap-0 py-0">
      <CardHeader className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-sunk)] py-(--space-10)">
        <CardTitle className="font-display text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold">
          Connect Xero to Ashicore
        </CardTitle>
        <CardDescription>
          {session
            ? `Continue as ${session.user.email}.`
            : "Sign in to link this Xero organization to your Ashicore account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-(--space-10)">
        <FieldGroup>
          <Button asChild>
            <a href={session ? continueHref : signInHref}>
              {session ? "Continue" : "Sign in"}
            </a>
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
