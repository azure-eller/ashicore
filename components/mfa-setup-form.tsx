"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { authClient } from "@/lib/auth-client";

export function MfaSetupForm({
  next = "/org-setup",
}: {
  next?: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function handleSendEmailCode() {
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
      setError(body?.error ?? "Failed to send email code.");
      setSendingCode(false);
      return;
    }

    setCode("");
    setCodeSent(true);
    setNotice("Verification code sent.");
    setSendingCode(false);
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setVerifying(true);

    const { error: verifyError } = await authClient.twoFactor.verifyOtp({
      code,
    });

    if (verifyError) {
      setError(verifyError.message ?? "Invalid verification code.");
      setVerifying(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up MFA</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleVerify}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mfa-email-code">Email code</FieldLabel>
              <Input
                id="mfa-email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              {notice ? <FieldDescription>{notice}</FieldDescription> : null}
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <Field>
              <Button
                type="button"
                variant={codeSent ? "outline" : "default"}
                onClick={handleSendEmailCode}
                disabled={sendingCode || verifying}
              >
                {sendingCode
                  ? "Sending..."
                  : codeSent
                    ? "Resend code"
                    : "Send code to email"}
              </Button>
            </Field>
            <Field>
              <Button
                type="submit"
                disabled={verifying || sendingCode || !code.trim()}
              >
                {verifying ? "Verifying..." : "Finish setup"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
