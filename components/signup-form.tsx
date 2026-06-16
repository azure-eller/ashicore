"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { OnboardingAuthShell } from "@/components/onboarding-auth-shell"
import { authClient } from "@/lib/auth-client"
import {
  isPaidBillingSelection,
  orgSetupPathForBillingIntent,
  type BillingIntent,
} from "@/lib/billing/plan-intent"

export function SignupForm({
  billingIntent = {
    selectedPlan: "trial",
    locationCapacity: 1,
    addonLookupKeys: [],
  },
  ...props
}: React.ComponentProps<"div"> & { billingIntent?: BillingIntent }) {
  const router = useRouter()
  const plan = billingIntent.selectedPlan
  const signInHref =
    isPaidBillingSelection(plan)
      ? `/sign-in?next=${encodeURIComponent(orgSetupPathForBillingIntent(billingIntent))}`
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
    router.push(orgSetupPathForBillingIntent(billingIntent))
  }

  return (
    <OnboardingAuthShell
      activeStep="account"
      plan={plan}
      guideTitle={
        <>
          Let&apos;s set up
          <br />
          your workspace
        </>
      }
      guideLines={[
        "First, your account — about a minute.",
        "Then we read your files and build it for you.",
        "You confirm everything before it's saved.",
      ]}
      {...props}
    >
      <h1 className="ob-form-title ob-stagger">Create your account</h1>
      <p className="ob-form-sub ob-stagger">
        Start with your work email — we&apos;ll set up the rest together.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="ob-form-stack">
          <label className="ob-field">
            <span className="ob-field-label">Full name</span>
            <input
              className="ob-input"
              type="text"
              placeholder="Sam Rivera"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="ob-field">
            <span className="ob-field-label">Work email</span>
            <input
              className="ob-input"
              type="email"
              placeholder="you@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="ob-field">
            <span className="ob-field-label">Password</span>
            <input
              className="ob-input"
              type="password"
              aria-label="Password"
              aria-describedby="signup-password-hint"
              placeholder="••••••••"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span id="signup-password-hint" className="ob-field-hint">
              At least 8 characters
            </span>
          </label>
          <label className="ob-field">
            <span className="ob-field-label">Confirm password</span>
            <input
              className="ob-input"
              type="password"
              aria-label="Confirm Password"
              placeholder="••••••••"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          {error ? <p className="ob-form-error">{error}</p> : null}
        </div>
        <div className="ob-form-actions">
          <button type="submit" className="ob-btn ob-btn--primary ob-btn--block" disabled={loading}>
            {loading ? "Creating account…" : "Continue"}
          </button>
        </div>
        <p className="ob-form-fine">
          By continuing you agree to the <a href="#terms">Terms</a> &amp;{" "}
          <a href="#privacy">Privacy Policy</a>.
          <br />
          Already have an account? <a href={signInHref}>Sign in</a>
        </p>
      </form>
    </OnboardingAuthShell>
  )
}
