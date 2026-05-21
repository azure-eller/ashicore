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

export function TwoFactorForm({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  async function sendEmailCode() {
    setError(null);
    setNotice(null);
    setSendingEmail(true);

    const response = await fetch("/api/auth/mfa/send-code", {
      method: "POST",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "Failed to send email code.");
      setSendingEmail(false);
      return;
    }

    setCode("");
    setCodeSent(true);
    setNotice("Verification code sent.");
    setSendingEmail(false);
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
    <Card>
      <CardHeader>
        <CardTitle>
          {codeSent ? "Enter your verification code" : "Verify email"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {!codeSent ? (
              <Field>
                <Button
                  type="button"
                  onClick={sendEmailCode}
                  disabled={sendingEmail || verifying}
                >
                  {sendingEmail ? "Sending..." : "Send code"}
                </Button>
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="two-factor-code">Email code</FieldLabel>
                  <Input
                    id="two-factor-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </Field>
                <Field>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={sendEmailCode}
                    disabled={sendingEmail || verifying}
                  >
                    {sendingEmail ? "Sending..." : "Resend code"}
                  </Button>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="two-factor-trust-device"
                    checked={trustDevice}
                    onCheckedChange={(value) => setTrustDevice(value === true)}
                  />
                  <FieldLabel htmlFor="two-factor-trust-device" className="font-normal">
                    Remember this device for 30 days
                  </FieldLabel>
                </Field>
                <Field>
                  <Button
                    type="submit"
                    disabled={verifying || sendingEmail || !code.trim()}
                  >
                    {verifying ? "Verifying..." : "Verify"}
                  </Button>
                </Field>
              </>
            )}
            {notice ? (
              <FieldDescription className="text-center">{notice}</FieldDescription>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
            <Field>
              <FieldDescription className="text-center">
                <a href="/sign-in">Use a different account</a>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
