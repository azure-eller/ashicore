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
import { apiJson } from "@/lib/client/api";

type EmailMfaFormProps = {
  next: string;
};

export function EmailMfaForm({ next }: EmailMfaFormProps) {
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

    try {
      await apiJson<void>("/api/auth/mfa/send-code", {
        method: "POST",
        fallbackError: "Could not send the email code.",
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not send the email code.",
      );
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
    <Card className="mx-auto w-full max-w-[460px] gap-0 py-0">
      <CardHeader className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-sunk)] py-(--space-10)">
        <CardTitle className="font-display text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold">
          {codeSent ? "Check your email" : "Verify with email"}
        </CardTitle>
        <CardDescription>
          {codeSent
            ? "Enter the 6-digit code from the email we just sent."
            : "Send a one-time code to the email address on this account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-(--space-10)">
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
                    <FieldLabel htmlFor="mfa-trust-device" className="font-[var(--font-body)] text-[length:var(--text-sm)] font-normal normal-case tracking-normal text-[var(--color-ink)]">
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
            <FieldDescription className="text-center">
              Not your account? <Link href="/sign-in">Sign in again</Link>
            </FieldDescription>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
