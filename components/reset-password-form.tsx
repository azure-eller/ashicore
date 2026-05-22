"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
      <Card>
        <CardHeader>
          <CardTitle>Reset link unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldDescription>{getResetErrorMessage(errorCode)}</FieldDescription>
          <FieldDescription>
            <a href="/forgot-password">Request a new password reset link.</a>
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
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
      </CardHeader>
      <CardContent>
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
