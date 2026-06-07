"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"

const DEFAULT_SIGN_IN_TARGET = "/sales/orders"

export function LoginForm({
  className,
  notice,
  next,
  ...props
}: React.ComponentProps<"div"> & {
  notice?: string
  next?: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const successMessage =
    notice === "password-reset"
      ? "Password updated. Sign in with your new password."
      : notice === "email-updated"
        ? "Email updated. Sign in with your new address."
        : null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { data, error } = await authClient.signIn.email({ email, password, rememberMe })
    if (error) {
      setError(error.message ?? "Sign in failed")
      setLoading(false)
      return
    }
    if (data && "twoFactorRedirect" in data) {
      return
    }

    router.replace(next ?? DEFAULT_SIGN_IN_TARGET)
  }

  return (
    <div className={cn("mx-auto flex w-full max-w-[460px] flex-col gap-6", className)} {...props}>
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-sunk)] py-(--space-10)">
          <CardTitle className="font-display text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold">
            Login to your account
          </CardTitle>
        </CardHeader>
        <CardContent className="p-(--space-10)">
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <a
                    href="/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="remember-me"
                  checked={rememberMe}
                  onCheckedChange={(value) => setRememberMe(value === true)}
                />
                <FieldLabel htmlFor="remember-me" className="font-[var(--font-body)] text-[length:var(--text-sm)] font-normal normal-case tracking-normal text-[var(--color-ink)]">
                  Remember me
                </FieldLabel>
              </Field>
              {successMessage && (
                <FieldDescription className="text-[var(--color-ink)]">
                  {successMessage}
                </FieldDescription>
              )}
              {error && (
                <FieldError>{error}</FieldError>
              )}
              <Field>
                <Button type="submit" disabled={loading}>
                  {loading ? "Signing in…" : "Login"}
                </Button>
                <FieldDescription className="text-center">
                  Don&apos;t have an account?{" "}
                  <a href="/sign-up">Sign up</a>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
