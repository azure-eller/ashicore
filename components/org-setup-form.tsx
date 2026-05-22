"use client"

import { useEffect, useState } from "react"
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

const DEFAULT_APP_ENTRY_PATH = "/sales/orders"

type OrganizationOption = {
  id: string
  name: string
  slug: string
}

export function OrgSetupForm({
  className,
  organizations,
  ...props
}: React.ComponentProps<"div"> & {
  organizations: OrganizationOption[]
}) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [activatingOrgId, setActivatingOrgId] = useState<string | null>(null)

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

      router.replace(DEFAULT_APP_ENTRY_PATH)
    }

    void activateOnlyOrganization()

    return () => {
      cancelled = true
    }
  }, [organizations, router])

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

    router.replace(DEFAULT_APP_ENTRY_PATH)
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

    router.replace(DEFAULT_APP_ENTRY_PATH)
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
                  {loading ? "Creating…" : "Create Organization"}
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
