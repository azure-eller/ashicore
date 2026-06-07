"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Alert02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"

function getResetErrorMessage(errorCode?: string) {
  if (errorCode === "INVALID_TOKEN") {
    return "This reset link is invalid or has expired. Request a new one."
  }

  return "This reset link is invalid. Request a new one."
}

export function ResetPasswordForm({
  errorCode,
  token,
}: {
  errorCode?: string
  token?: string
}) {
  const router = useRouter()
  const resetToken = token ?? undefined
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!resetToken || errorCode) {
    return (
      <Card className="mx-auto w-full max-w-[460px] gap-0 overflow-hidden py-0">
        <CardHeader className="items-center border-b border-[var(--color-line-soft)] bg-[var(--color-surface-sunk)] py-(--space-10) text-center">
          <div className="mb-(--space-5) grid h-(--space-14) w-(--space-14) place-items-center justify-self-center rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]">
            <HugeiconsIcon icon={Alert02Icon} size={20} aria-hidden />
          </div>
          <CardTitle className="font-display text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold">
            Reset link unavailable
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-(--space-3) p-(--space-10) text-center">
          <FieldDescription className="text-[var(--color-ink-soft)]">{getResetErrorMessage(errorCode)}</FieldDescription>
          <FieldDescription className="text-[var(--color-ink-soft)]">
            <a className="font-medium text-[var(--color-accent-ink)] underline-offset-4 hover:underline" href="/forgot-password">
              Request a new password reset link.
            </a>
          </FieldDescription>
        </CardContent>
      </Card>
    )
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    const { error: resetError } = await authClient.resetPassword({
      newPassword,
      token: resetToken,
    })

    if (resetError) {
      setError(resetError.message ?? "Unable to reset password.")
      setLoading(false)
      return
    }

    router.push("/sign-in?notice=password-reset")
  }

  return (
    <Card className="mx-auto w-full max-w-[460px] gap-0 py-0">
      <CardHeader className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-sunk)] py-(--space-10)">
        <CardTitle className="font-display text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold">
          Choose a new password
        </CardTitle>
      </CardHeader>
      <CardContent className="p-(--space-10)">
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reset-password">New password</FieldLabel>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <FieldDescription>
                Use at least 8 characters.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="reset-password-confirm">
                Confirm new password
              </FieldLabel>
              <Input
                id="reset-password-confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
            {error && (
              <FieldError>{error}</FieldError>
            )}
            <Field>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving new password…" : "Reset password"}
              </Button>
              <FieldDescription className="text-center">
                Back to <a href="/sign-in">sign in</a>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
