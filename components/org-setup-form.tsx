"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import {
  appEntryPathForPlanIntent,
  type BillingPlanIntent,
} from "@/lib/billing/plan-intent"
import { apiJson } from "@/lib/client/api"

const DEFAULT_APP_ENTRY_PATH = "/sales/orders"

type BillingActionResponse = {
  url?: string
}

type OrganizationOption = {
  id: string
  name: string
  slug: string
}

export function OrgSetupForm({
  className,
  organizations,
  plan,
  ...props
}: React.ComponentProps<"div"> & {
  organizations: OrganizationOption[]
  plan?: BillingPlanIntent
}) {
  const router = useRouter()
  const selectedPlan = plan ?? "free"
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [activatingOrgId, setActivatingOrgId] = useState<string | null>(null)

  const finishOnboarding = useCallback(async () => {
    if (selectedPlan !== "paid") {
      router.replace(DEFAULT_APP_ENTRY_PATH)
      return
    }

    const response = await apiJson<BillingActionResponse>("/api/billing/checkout", {
      method: "POST",
      idempotencyKey: "billing-checkout",
      fallbackError: "Could not start billing checkout.",
    })

    if (response.url) {
      window.location.assign(response.url)
      return
    }

    router.replace(appEntryPathForPlanIntent(selectedPlan))
  }, [router, selectedPlan])

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

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {organizations.length === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Opening your organization</CardTitle>
            <CardDescription>
              {organizations[0].name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <FieldDescription className="text-destructive">
                {error}
              </FieldDescription>
            )}
            {!error && (
              <FieldDescription>
                {activatingOrgId ? "Activating your workspace…" : "Preparing your workspace…"}
              </FieldDescription>
            )}
          </CardContent>
        </Card>
      ) : organizations.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Choose your organization</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {organizations.map((organization) => (
                <Field key={organization.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => activateOrganization(organization.id)}
                    disabled={loading || activatingOrgId != null}
                  >
                    {activatingOrgId === organization.id
                      ? `Opening ${organization.name}…`
                      : organization.name}
                  </Button>
                </Field>
              ))}
              {error && (
                <FieldDescription className="text-destructive">
                  {error}
                </FieldDescription>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>Create your organization</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Organization name</FieldLabel>
                <Input
                  id="name"
                  type="text"
                  placeholder="Acme Corp"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              {error && (
                <FieldDescription className="text-destructive">
                  {error}
                </FieldDescription>
              )}
              <Field>
                <Button type="submit" disabled={loading}>
                  {loading
                    ? selectedPlan === "paid"
                      ? "Preparing checkout..."
                      : "Creating..."
                    : "Create Organization"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      )}
    </div>
  )
}
