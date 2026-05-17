import { LoginForm } from "@/components/login-form"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; callbackURL?: string; next?: string }>
}) {
  const { notice, callbackURL, next } = await searchParams
  const target = callbackURL ?? next

  return <LoginForm notice={notice} next={target?.startsWith("/") ? target : undefined} />
}
