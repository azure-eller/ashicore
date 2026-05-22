"use client"

import { useState } from "react"
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

export function ForgotPasswordForm({ redirectTo }: { redirectTo: string }) {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const { error: requestError } = await authClient.requestPasswordReset({
      email,
      redirectTo,
    })

    if (requestError) {
      setError(requestError.message ?? "We couldn't send a reset link right now.")
      setLoading(false)
      return
    }

    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldDescription>
            If an account matches that address, we sent a password reset link.
          </FieldDescription>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <FieldDescription>
          We&apos;ll send a reset link if the account exists.
        </FieldDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="forgot-password-email">Email</FieldLabel>
              <Input
                id="forgot-password-email"
                type="email"
                placeholder="m@example.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            {error && (
              <FieldError>{error}</FieldError>
            )}
            <Field>
              <Button type="submit" disabled={loading}>
                {loading ? "Sending reset link…" : "Send reset link"}
              </Button>
              <FieldDescription className="text-center">
                Remembered it? <a href="/sign-in">Sign in</a>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
