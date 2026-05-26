"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailSend02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type EmailMfaFormProps = {
  next: string;
  mode: "setup" | "challenge";
};

export function EmailMfaForm({ next, mode }: EmailMfaFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [trustDevice, setTrustDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const busy = sendingCode || verifying;

  async function sendEmailCode() {
    setError(null);
    setNotice(null);
    setSendingCode(true);

    const response = await fetch("/api/auth/mfa/send-code", {
      method: "POST",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "Could not send the email code.");
      setSendingCode(false);
      return;
    }

    setCode("");
    setCodeSent(true);
    setNotice("Code sent. Check the email address on this account.");
    setSendingCode(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setVerifying(true);

    const result = await authClient.twoFactor.verifyOtp({
      code,
      trustDevice,
    });

    if (result.error) {
      setError(result.error.message ?? "Invalid verification code.");
      setVerifying(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-[420px]">
      <CardHeader className="border-b">
        <CardTitle className="text-[length:var(--text-xl)] leading-[var(--leading-xl)]">
          {codeSent ? "Check your email" : "Verify with email"}
        </CardTitle>
        <CardDescription>
          {codeSent
            ? "Enter the 6-digit code from the email we just sent."
            : mode === "setup"
              ? "To finish setup, send a one-time code to the email address on this account."
              : "Send a one-time code to the email address on this account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup className="gap-(--space-6)">
            {!codeSent ? (
              <Button
                type="button"
                size="lg"
                onClick={sendEmailCode}
                disabled={busy}
                className="w-full"
              >
                <HugeiconsIcon icon={MailSend02Icon} data-icon="inline-start" />
                {sendingCode ? "Sending..." : "Email me a code"}
              </Button>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="mfa-email-code">6-digit email code</FieldLabel>
                  <Input
                    id="mfa-email-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    aria-invalid={!!error}
                    className="h-(--height-input-lg) font-mono text-[length:var(--text-lg)] tabular-nums"
                  />
                  {notice ? <FieldDescription>{notice}</FieldDescription> : null}
                </Field>
                <Field orientation="horizontal" className="items-start">
                  <Checkbox
                    id="mfa-trust-device"
                    checked={trustDevice}
                    onCheckedChange={(value) => setTrustDevice(value === true)}
                    disabled={busy}
                    className="mt-(--space-1)"
                  />
                  <div className="flex flex-col gap-(--space-1)">
                    <FieldLabel htmlFor="mfa-trust-device" className="font-normal">
                      Trust this device for 30 days
                    </FieldLabel>
                    <FieldDescription>
                      Leave this off on shared computers.
                    </FieldDescription>
                  </div>
                </Field>
                <div className="grid gap-(--space-4) sm:grid-cols-[1fr_auto]">
                  <Button
                    type="submit"
                    size="lg"
                    disabled={busy || code.length !== 6}
                    className="w-full"
                  >
                    {verifying ? "Verifying..." : "Verify and continue"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={sendEmailCode}
                    disabled={busy}
                    className="w-full sm:w-auto"
                  >
                    <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
                    {sendingCode ? "Sending..." : "Resend"}
                  </Button>
                </div>
              </>
            )}
            {error ? <FieldError>{error}</FieldError> : null}
            {mode === "challenge" ? (
              <FieldDescription className="text-center">
                Not your account? <Link href="/sign-in">Sign in again</Link>
              </FieldDescription>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
