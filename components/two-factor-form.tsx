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

type VerificationMethod = "authenticator" | "email" | "backup";

export function TwoFactorForm({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<VerificationMethod>("authenticator");
  const [trustDevice, setTrustDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

    setMethod("email");
    setCode("");
    setNotice("Verification code sent.");
    setSendingEmail(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const result =
      method === "backup"
        ? await authClient.twoFactor.verifyBackupCode({
            code,
            trustDevice,
          })
        : method === "email"
          ? await authClient.twoFactor.verifyOtp({
              code,
              trustDevice,
            })
          : await authClient.twoFactor.verifyTotp({
              code,
              trustDevice,
            });

    if (result.error) {
      setError(result.error.message ?? "Invalid verification code.");
      setLoading(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify MFA</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="two-factor-code">
                {method === "backup" ? "Backup code" : "Verification code"}
              </FieldLabel>
              <Input
                id="two-factor-code"
                inputMode={method === "backup" ? "text" : "numeric"}
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="two-factor-trust-device"
                checked={trustDevice}
                onCheckedChange={(value) => setTrustDevice(value === true)}
              />
              <FieldLabel htmlFor="two-factor-trust-device" className="font-normal">
                Trust this device for 30 days
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="two-factor-email-code"
                checked={method === "email"}
                onCheckedChange={(value) => {
                  if (value === true) {
                    void sendEmailCode();
                    return;
                  }

                  setMethod("authenticator");
                  setCode("");
                  setNotice(null);
                }}
              />
              <FieldLabel htmlFor="two-factor-email-code" className="font-normal">
                Email me a code
              </FieldLabel>
            </Field>
            <Field>
              <Button
                type="button"
                variant="outline"
                onClick={sendEmailCode}
                disabled={sendingEmail}
              >
                {sendingEmail ? "Sending..." : "Send email code"}
              </Button>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="two-factor-backup-code"
                checked={method === "backup"}
                onCheckedChange={(value) => {
                  setMethod(value === true ? "backup" : "authenticator");
                  setCode("");
                  setNotice(null);
                }}
              />
              <FieldLabel htmlFor="two-factor-backup-code" className="font-normal">
                Use a backup code
              </FieldLabel>
            </Field>
            {notice ? (
              <FieldDescription className="text-center">{notice}</FieldDescription>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
            <Field>
              <Button type="submit" disabled={loading}>
                {loading ? "Verifying..." : "Verify"}
              </Button>
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
