"use client"

import { useState } from "react"
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

export function LoginForm({
  className,
  notice,
  ...props
}: React.ComponentProps<"div"> & {
  notice?: string
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
    const { error } = await authClient.signIn.email({ email, password, rememberMe })
    if (error) {
      setError(error.message ?? "Sign in failed")
      setLoading(false)
      return
    }
    router.push("/")
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Login to your account</CardTitle>
          <CardDescription>
            Enter your email below to login to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                <FieldLabel htmlFor="remember-me" className="font-normal">
                  Remember me
                </FieldLabel>
              </Field>
              {successMessage && (
                <FieldDescription className="text-foreground">
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
