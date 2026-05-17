"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { authClient } from "@/lib/auth-client";

type SetupState = {
  totpURI: string;
  backupCodes: string[];
};

type SetupMethod = "choose" | "authenticator" | "email";

function getManualKey(totpURI: string) {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? totpURI;
  } catch {
    return totpURI;
  }
}

export function MfaSetupForm({
  next = "/org-setup",
}: {
  next?: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [method, setMethod] = useState<SetupMethod>("choose");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const manualKey = useMemo(
    () => (setup ? getManualKey(setup.totpURI) : ""),
    [setup]
  );

  async function handleStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: enableError } = await authClient.twoFactor.enable({
      password,
      issuer: "Ashicore",
    });

    if (enableError || !data) {
      setError(enableError?.message ?? "Failed to start MFA setup.");
      setLoading(false);
      return;
    }

    setSetup({
      totpURI: data.totpURI,
      backupCodes: data.backupCodes,
    });
    setLoading(false);
  }

  async function handleSendEmailCode() {
    setError(null);
    setNotice(null);
    setLoading(true);

    const { error: sendError } = await authClient.twoFactor.sendOtp();

    if (sendError) {
      setError(sendError.message ?? "Failed to send email code.");
      setLoading(false);
      return;
    }

    setMethod("email");
    setCode("");
    setNotice("Verification code sent.");
    setLoading(false);
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { error: verifyError } =
      method === "email"
        ? await authClient.twoFactor.verifyOtp({
            code,
          })
        : await authClient.twoFactor.verifyTotp({
            code,
          });

    if (verifyError) {
      setError(verifyError.message ?? "Invalid verification code.");
      setLoading(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  async function copyManualKey() {
    await navigator.clipboard.writeText(manualKey);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up MFA</CardTitle>
        <CardDescription>
          Required for every Ashicore account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {method === "choose" ? (
          <FieldGroup>
            <Field>
              <Button type="button" onClick={() => setMethod("authenticator")}>
                Use an authenticator app
              </Button>
            </Field>
            <Field>
              <Button
                type="button"
                variant="outline"
                onClick={handleSendEmailCode}
                disabled={loading}
              >
                {loading ? "Sending..." : "Email me a code"}
              </Button>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        ) : method === "authenticator" && !setup ? (
          <form onSubmit={handleStart}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="mfa-password">Password</FieldLabel>
                <Input
                  id="mfa-password"
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Field>
                <Button type="submit" disabled={loading}>
                  {loading ? "Preparing..." : "Continue"}
                </Button>
              </Field>
              <Field>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleSendEmailCode}
                  disabled={loading}
                >
                  Email me a code instead
                </Button>
              </Field>
            </FieldGroup>
          </form>
        ) : method === "email" ? (
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
                <Button type="submit" disabled={loading}>
                  {loading ? "Verifying..." : "Finish setup"}
                </Button>
              </Field>
              <Field>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendEmailCode}
                  disabled={loading}
                >
                  {loading ? "Sending..." : "Resend email code"}
                </Button>
              </Field>
              <Field>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMethod("authenticator");
                    setCode("");
                    setNotice(null);
                    setError(null);
                  }}
                >
                  Use an authenticator app instead
                </Button>
              </Field>
            </FieldGroup>
          </form>
        ) : setup ? (
          <form onSubmit={handleVerify}>
            <FieldGroup>
              <Field>
                <div className="rounded-md border bg-background p-4">
                  <QRCode
                    value={setup.totpURI}
                    className="mx-auto h-44 w-44"
                    aria-label="MFA QR code"
                  />
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="mfa-manual-key">Setup key</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="mfa-manual-key"
                    value={manualKey}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copyManualKey}
                    aria-label="Copy setup key"
                  >
                    <HugeiconsIcon icon={Copy01Icon} size={16} />
                  </Button>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="mfa-code">Verification code</FieldLabel>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Backup codes</FieldLabel>
                <div className="grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-xs">
                  {setup.backupCodes.map((backupCode) => (
                    <span key={backupCode}>{backupCode}</span>
                  ))}
                </div>
                <FieldDescription>
                  Store these before continuing.
                </FieldDescription>
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Field>
                <Button type="submit" disabled={loading}>
                  {loading ? "Verifying..." : "Finish setup"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
