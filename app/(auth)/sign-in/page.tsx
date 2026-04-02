import { LoginForm } from "@/components/login-form"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  const { notice } = await searchParams

  return <LoginForm notice={notice} />
}
