"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { OnboardingAuthShell } from "@/components/onboarding-auth-shell"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { authClient } from "@/lib/auth-client"
import {
  billingIntentQueryString,
  type BillingIntent,
} from "@/lib/billing/plan-intent"
import { cn } from "@/lib/utils"

const DEFAULT_APP_ENTRY_PATH = "/sales/orders"
const NEW_ORG_ENTRY_PATH = "/onboarding"

type OrganizationOption = {
  id: string
  name: string
  slug: string
}

export function OrgSetupForm({
  className,
  organizations,
  billingIntent = {
    selectedPlan: "trial",
    locationCapacity: 1,
    addonLookupKeys: [],
  },
  continueToOnboarding = false,
  ...props
}: React.ComponentProps<"div"> & {
  organizations: OrganizationOption[]
  billingIntent?: BillingIntent
  continueToOnboarding?: boolean
}) {
  const router = useRouter()
  const selectedPlan = billingIntent.selectedPlan
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [activatingOrgId, setActivatingOrgId] = useState<string | null>(null)

  const finishOnboarding = useCallback(async () => {
    if (!continueToOnboarding) {
      router.replace(DEFAULT_APP_ENTRY_PATH)
      return
    }

    // Trial and paid enter the same guided onboarding flow. For paid, payment
    // is collected within the flow (at the approve gate), not here.
    router.replace(`${NEW_ORG_ENTRY_PATH}?${billingIntentQueryString(billingIntent)}`)
  }, [billingIntent, continueToOnboarding, router])

  useEffect(() => {
    if (organizations.length !== 1) {
      return
    }

    let cancelled = false
    const [organization] = organizations

    async function activateOnlyOrganization() {
      setError(null)
      setActivatingOrgId(organization.id)
      const { error: setActiveError } = await authClient.organization.setActive({
        organizationId: organization.id,
      })

      if (cancelled) {
        return
      }

      if (setActiveError) {
        setError(setActiveError.message ?? "Failed to activate organization")
        setActivatingOrgId(null)
        return
      }

      try {
        await finishOnboarding()
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not finish organization setup."
        )
        setActivatingOrgId(null)
      }
    }

    void activateOnlyOrganization()

    return () => {
      cancelled = true
    }
  }, [finishOnboarding, organizations])

  async function activateOrganization(organizationId: string) {
    setError(null)
    setActivatingOrgId(organizationId)

    const { error: setActiveError } = await authClient.organization.setActive({
      organizationId,
    })

    if (setActiveError) {
      setError(setActiveError.message ?? "Failed to activate organization")
      setActivatingOrgId(null)
      return
    }

    try {
      await finishOnboarding()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not finish organization setup."
      )
      setActivatingOrgId(null)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const slug = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "")

    if (!slug) {
      setError("Organization name must contain at least one letter or number.")
      setLoading(false)
      return
    }

    const { data, error: createError } = await authClient.organization.create({
      name,
      slug,
    })

    if (createError || !data) {
      setError(createError?.message ?? "Failed to create organization")
      setLoading(false)
      return
    }

    const { error: setActiveError } = await authClient.organization.setActive({
      organizationId: data.id,
    })

    if (setActiveError) {
      setError(setActiveError.message ?? "Failed to activate organization")
      setLoading(false)
      return
    }

    try {
      await finishOnboarding()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not finish organization setup."
      )
      setLoading(false)
    }
  }

  function renderOrganizationPicker({
    buttonClassName,
    errorClassName,
  }: {
    buttonClassName: string
    errorClassName: string
  }) {
    return (
      <div className="grid gap-(--space-4)">
        {organizations.map((organization) => (
          <button
            type="button"
            key={organization.id}
            className={buttonClassName}
            onClick={() => activateOrganization(organization.id)}
            disabled={loading || activatingOrgId != null}
          >
            {activatingOrgId === organization.id
              ? `Opening ${organization.name}…`
              : organization.name}
          </button>
        ))}
        {error ? <p className={errorClassName}>{error}</p> : null}
      </div>
    )
  }

  if (organizations.length > 1 && !continueToOnboarding) {
    return (
      <div
        className={cn(
          "flex min-h-svh items-center justify-center bg-[var(--color-bg)] px-(--space-8) py-(--space-20) text-[var(--color-ink)]",
          className
        )}
        {...props}
      >
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-[length:var(--text-lg)] leading-[var(--leading-lg)]">
              Choose your organization
            </CardTitle>
            <CardDescription>
              Select the workspace you want to open.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {renderOrganizationPicker({
              buttonClassName:
                "flex min-h-(--space-12) w-full items-center rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-4) text-left text-[length:var(--text-sm)] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-alt)] disabled:pointer-events-none disabled:opacity-50",
              errorClassName:
                "text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--status-danger-ink)]",
            })}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <OnboardingAuthShell
      activeStep="workspace"
      plan={selectedPlan}
      guideTitle={
        <>
          Tell us about
          <br />
          your operation
        </>
      }
      guideLines={[
        "Choose the name your team will recognize.",
        "You can change it later.",
        "Then you'll go straight to your workspace.",
      ]}
      className={className}
      {...props}
    >
      {organizations.length === 1 ? (
        <>
          <h1 className="ob-form-title ob-stagger">Opening your organization</h1>
          <p className="ob-form-sub ob-stagger">{organizations[0].name}</p>
          <div className="ob-form-stack">
            {error ? (
              <p className="ob-form-error">{error}</p>
            ) : (
              <p className="ob-field-hint">
                {activatingOrgId ? "Activating your workspace…" : "Preparing your workspace…"}
              </p>
            )}
          </div>
        </>
      ) : organizations.length > 1 ? (
        <>
          <h1 className="ob-form-title ob-stagger">Choose your organization</h1>
          <p className="ob-form-sub ob-stagger">
            Select the workspace you want to open.
          </p>
          {renderOrganizationPicker({
            buttonClassName: "ob-btn ob-btn--ghost ob-btn--block justify-start",
            errorClassName: "ob-form-error",
          })}
        </>
      ) : (
        <>
          <h1 className="ob-form-title ob-stagger">Create your organization</h1>
          <p className="ob-form-sub ob-stagger">
            Use the company name your customers and suppliers know.
          </p>
          <form onSubmit={handleSubmit}>
            <div className="ob-form-stack">
              <label className="ob-field">
                <span className="ob-field-label">Company name</span>
                <input
                  className="ob-input"
                  type="text"
                  aria-label="Organization name"
                  placeholder="High Plains Soil Co."
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {error ? <p className="ob-form-error">{error}</p> : null}
            </div>
            <div className="ob-form-actions">
              <button type="submit" className="ob-btn ob-btn--primary ob-btn--block" disabled={loading}>
                {loading ? "Creating…" : "Continue"}
              </button>
            </div>
          </form>
        </>
      )}
    </OnboardingAuthShell>
  )
}
