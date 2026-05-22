import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { LoginForm } from "@/components/login-form"
import { auth } from "@/lib/auth"
import { isMfaEnrolled } from "@/lib/dal/auth"

const DEFAULT_SIGN_IN_TARGET = "/sales/orders"

function safeNext(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : undefined
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; callbackURL?: string; next?: string }>
}) {
  const { notice, callbackURL, next } = await searchParams
  const target = safeNext(callbackURL ?? next)
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (session) {
    const nextPath = target ?? DEFAULT_SIGN_IN_TARGET

    if (!isMfaEnrolled(session)) {
      redirect(`/mfa-setup?next=${encodeURIComponent(nextPath)}`)
    }

    if (!session.session.activeOrganizationId) {
      redirect("/org-setup")
    }

    redirect(nextPath)
  }

  return <LoginForm notice={notice} next={target} />
}
