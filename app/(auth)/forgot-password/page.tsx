import { ForgotPasswordForm } from "@/components/forgot-password-form"
import { getCanonicalAppUrl } from "@/lib/email/config"

export default function ForgotPasswordPage() {
  const redirectTo = new URL("/reset-password", getCanonicalAppUrl()).toString()

  return <ForgotPasswordForm redirectTo={redirectTo} />
}
