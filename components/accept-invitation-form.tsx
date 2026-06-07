"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PublicInvitationDetails } from "@/app/(dashboard)/settings/types";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const authCardClass = "mx-auto w-full max-w-[460px] gap-0 py-0";
const authCardHeaderClass = "border-b border-[var(--color-line-soft)] bg-[var(--color-surface-sunk)] py-(--space-10)";
const authCardTitleClass = "font-display text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold";
const authCardContentClass = "p-(--space-10)";

function AuthUnavailableCard({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <Card className={`${authCardClass} overflow-hidden`}>
      <CardHeader className={`${authCardHeaderClass} items-center text-center`}>
        <div className="mb-(--space-5) grid h-(--space-14) w-(--space-14) place-items-center justify-self-center rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]">
          <HugeiconsIcon icon={Alert02Icon} size={20} aria-hidden />
        </div>
        <CardTitle className={authCardTitleClass}>{title}</CardTitle>
        <CardDescription className="max-w-sm text-[var(--color-ink-soft)]">
          {description}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export function AcceptInvitationForm({
  invitation,
}: {
  invitation: PublicInvitationDetails | null;
}) {
  const router = useRouter();
  const session = authClient.useSession();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!invitation) {
    return (
      <AuthUnavailableCard
        title="Invitation not found"
        description="This invite link is missing or no longer valid."
      />
    );
  }

  if (invitation.status !== "pending" || invitation.isExpired) {
    return (
      <AuthUnavailableCard
        title="Invitation expired"
        description={`Ask your team admin to resend the invite for ${invitation.organizationName}.`}
      />
    );
  }

  const activeInvitation = invitation;
  const sessionEmail = session.data?.user.email?.toLowerCase();
  const invitedEmail = activeInvitation.email.toLowerCase();
  const hasMatchingSession = sessionEmail === invitedEmail;
  const loginHref = `/sign-in?callbackURL=${encodeURIComponent(
    `/accept-invitation?id=${activeInvitation.id}`
  )}`;

  async function waitForSession(email: string) {
    const normalizedEmail = email.toLowerCase();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { data } = await authClient.getSession();

      if (data?.user.email?.toLowerCase() === normalizedEmail) {
        return true;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    return false;
  }

  async function activateInvitationOrganization(reportError = true) {
    const { error: setActiveError } = await authClient.organization.setActive({
      organizationId: activeInvitation.organizationId,
    });

    if (setActiveError) {
      if (reportError) {
        setError(setActiveError.message ?? "Joined the organization, but failed to activate it.");
      }
      return false;
    }

    router.replace("/settings");
    router.refresh();
    return true;
  }

  async function joinInviteIfNeeded() {
    const activated = await activateInvitationOrganization(false);
    if (activated) {
      return true;
    }

    const { error: acceptError } = await authClient.organization.acceptInvitation({
      invitationId: activeInvitation.id,
    });

    if (acceptError) {
      setError(acceptError.message ?? "Failed to accept invitation");
      return false;
    }

    return activateInvitationOrganization(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    const { error: signUpError } = await authClient.signUp.email({
      name,
      email: activeInvitation.email,
      password,
    });

    if (signUpError) {
      const message = signUpError.message ?? "Failed to create account";
      if (message.toLowerCase().includes("already")) {
        setError(
          "An account already exists for this email. Use Back to login to sign in and continue this invite."
        );
      } else {
        setError(message);
      }
      setLoading(false);
      return;
    }

    const hasSession = await waitForSession(activeInvitation.email);

    if (!hasSession) {
      setError("Signed in, but your session was not ready to join the invitation. Try again.");
      setLoading(false);
      return;
    }

    const accepted = await joinInviteIfNeeded();
    if (!accepted) {
      setLoading(false);
    }
  }

  async function handleContinue() {
    setError(null);
    setLoading(true);

    const accepted = await joinInviteIfNeeded();
    if (!accepted) {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setError(null);
    setLoading(true);

    try {
      const { error: signOutError } = await authClient.signOut();

      if (signOutError) {
        setError(signOutError.message ?? "Failed to log out");
        return;
      }

      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to log out");
    } finally {
      setLoading(false);
    }
  }

  if (session.data && !hasMatchingSession) {
    return (
      <Card className={authCardClass}>
        <CardHeader className={authCardHeaderClass}>
          <CardTitle className={authCardTitleClass}>Switch accounts to continue</CardTitle>
          <CardDescription>
            You are signed in as {session.data.user.email}, but this invite was sent to {activeInvitation.email}.
          </CardDescription>
        </CardHeader>
        <CardContent className={authCardContentClass}>
          <Button onClick={handleLogout} disabled={loading}>
            {loading ? "Signing out..." : "Log out"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (hasMatchingSession) {
    return (
      <Card className={authCardClass}>
        <CardHeader className={authCardHeaderClass}>
          <CardTitle className={authCardTitleClass}>Join {activeInvitation.organizationName}</CardTitle>
          <CardDescription>
            Signed in as {activeInvitation.email}.
          </CardDescription>
        </CardHeader>
        <CardContent className={`${authCardContentClass} space-y-(--space-6)`}>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button onClick={handleContinue} disabled={loading}>
            {loading ? "Opening workspace..." : "Join workspace"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={authCardClass}>
      <CardHeader className={authCardHeaderClass}>
        <CardTitle className={authCardTitleClass}>Set up your account</CardTitle>
        <CardDescription>
          You have been invited to join {activeInvitation.organizationName} on
          Ashicore. Please set up your account.
        </CardDescription>
      </CardHeader>
      <CardContent className={authCardContentClass}>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-name">Full Name</FieldLabel>
              <Input
                id="invite-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" value={activeInvitation.email} disabled />
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-password">Password</FieldLabel>
              <Input
                id="invite-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-confirm-password">
                Confirm Password
              </FieldLabel>
              <Input
                id="invite-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </Field>

            {error && <FieldError>{error}</FieldError>}

            <Field>
              <Button type="submit" disabled={loading}>
                {loading ? "Creating Account..." : "Create Account"}
              </Button>
              <FieldDescription className="text-center">
                <a href={loginHref}>Back to login</a>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
