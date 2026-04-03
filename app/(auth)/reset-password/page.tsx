import { ResetPasswordForm } from "@/components/reset-password-form"

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; token?: string }>
}) {
  const { error, token } = await searchParams

  return <ResetPasswordForm errorCode={error} token={token} />
}
