"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicInvitationDetails } from "@/app/(dashboard)/settings/types";
import { formatRoleLabel } from "@/lib/authz";
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

export function AcceptInvitationForm({
  invitation,
}: {
  invitation: PublicInvitationDetails | null;
}) {
  const router = useRouter();
  const session = authClient.useSession();
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!invitation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invitation not found</CardTitle>
          <CardDescription>
            This invite link is missing or no longer valid.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (invitation.status !== "pending" || invitation.isExpired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invitation expired</CardTitle>
          <CardDescription>
            Ask your team admin to resend the invite for {invitation.organizationName}.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const activeInvitation = invitation;
  const sessionEmail = session.data?.user.email?.toLowerCase();
  const invitedEmail = activeInvitation.email.toLowerCase();
  const hasMatchingSession = sessionEmail === invitedEmail;

  async function acceptInvite() {
    const { error: acceptError } = await authClient.organization.acceptInvitation({
      invitationId: activeInvitation.id,
    });

    if (acceptError) {
      setError(acceptError.message ?? "Failed to accept invitation");
      return false;
    }

    window.location.assign("/");
    return true;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "sign-up" && password !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    if (mode === "sign-up") {
      const { error: signUpError } = await authClient.signUp.email({
        name,
        email: activeInvitation.email,
        password,
      });

      if (signUpError) {
        setError(signUpError.message ?? "Failed to create account");
        setLoading(false);
        return;
      }
    } else {
      const { error: signInError } = await authClient.signIn.email({
        email: activeInvitation.email,
        password,
      });

      if (signInError) {
        setError(signInError.message ?? "Failed to sign in");
        setLoading(false);
        return;
      }
    }

    const accepted = await acceptInvite();
    if (!accepted) {
      setLoading(false);
      return;
    }
  }

  async function handleLogout() {
    setError(null);
    setLoading(true);
    await authClient.signOut();
    router.refresh();
  }

  if (session.data && !hasMatchingSession) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Switch accounts to accept this invite</CardTitle>
          <CardDescription>
            You are signed in as {session.data.user.email}, but this invite was sent to {activeInvitation.email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleLogout} disabled={loading}>
            {loading ? "Signing out..." : "Log out"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (hasMatchingSession) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accept invitation</CardTitle>
          <CardDescription>
            Join {activeInvitation.organizationName} as a {formatRoleLabel(activeInvitation.role).toLowerCase()}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <FieldError>{error}</FieldError>}
          <div className="rounded-md border p-4 text-sm text-muted-foreground">
            Signed in as {session.data?.user.email}
          </div>
          <Button onClick={async () => {
            setLoading(true);
            setError(null);
            const accepted = await acceptInvite();
            if (!accepted) {
              setLoading(false);
            }
          }} disabled={loading}>
            {loading ? "Accepting..." : "Accept Invitation"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {activeInvitation.organizationName}</CardTitle>
        <CardDescription>
          This invite is for {activeInvitation.email} and grants {formatRoleLabel(activeInvitation.role).toLowerCase()} access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6 flex gap-2">
          <Button
            type="button"
            variant={mode === "sign-up" ? "default" : "outline"}
            onClick={() => setMode("sign-up")}
          >
            Create Account
          </Button>
          <Button
            type="button"
            variant={mode === "sign-in" ? "default" : "outline"}
            onClick={() => setMode("sign-in")}
          >
            Sign In
          </Button>
        </div>

        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {mode === "sign-up" && (
              <Field>
                <FieldLabel htmlFor="invite-name">Full Name</FieldLabel>
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" value={activeInvitation.email} disabled />
              <FieldDescription>
                Invitations are tied to the invited email address.
              </FieldDescription>
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

            {mode === "sign-up" && (
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
            )}

            {error && <FieldError>{error}</FieldError>}

            <Field>
              <Button type="submit" disabled={loading}>
                {loading
                  ? mode === "sign-up"
                    ? "Creating Account..."
                    : "Signing In..."
                  : mode === "sign-up"
                    ? "Create Account and Join"
                    : "Sign In and Join"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
