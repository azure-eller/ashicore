import { LoginForm } from "@/components/login-form"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; callbackURL?: string }>
}) {
  const { notice, callbackURL } = await searchParams

  return <LoginForm notice={notice} callbackURL={callbackURL} />
}
