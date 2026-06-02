"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OnboardingAuthShell } from "@/components/onboarding-auth-shell"
import { authClient } from "@/lib/auth-client"
import {
  orgSetupPathForPlanIntent,
  type BillingPlanIntent,
} from "@/lib/billing/plan-intent"

export function SignupForm({
  plan = "free",
  ...props
}: React.ComponentProps<"div"> & { plan?: BillingPlanIntent }) {
  const router = useRouter()
  const signInHref =
    plan === "paid"
      ? `/sign-in?next=${encodeURIComponent(orgSetupPathForPlanIntent(plan))}`
      : "/sign-in"
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }
    setLoading(true)
    const { error } = await authClient.signUp.email({ name, email, password })
    if (error) {
      setError(error.message ?? "Sign up failed")
      setLoading(false)
      return
    }
    router.push(orgSetupPathForPlanIntent(plan))
  }

  return (
    <OnboardingAuthShell
      activeStep="account"
      plan={plan}
      guideTitle="Let's set up your workspace"
      guideLines={[
        "First, your account.",
        "It takes about a minute.",
        "We'll guide every step.",
      ]}
      {...props}
    >
      <div>
        <h2 className="text-[length:var(--text-lg)] font-semibold leading-[var(--leading-lg)]">
          Create your account
        </h2>
        <p className="mt-(--space-2) text-[length:var(--text-sm)] text-muted-foreground">
          Start with your work email — we&apos;ll set up the rest together.
        </p>
      </div>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Full Name</FieldLabel>
            <Input
              id="name"
              type="text"
              placeholder="John Doe"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Work email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="m@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FieldDescription>At least 8 characters</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">Confirm Password</FieldLabel>
            <Input
              id="confirm-password"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          {error && (
            <FieldError>{error}</FieldError>
          )}
          <Field>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating account…" : "Continue"}
            </Button>
            <FieldDescription className="text-center">
              By continuing you agree to the Terms &amp; Privacy Policy.
            </FieldDescription>
            <FieldDescription className="text-center">
              Already have an account?{" "}
              <a href={signInHref}>Sign in</a>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </OnboardingAuthShell>
  )
}
