"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatRoleLabel } from "@/lib/authz";
import { getInitials } from "@/lib/format";
import {
  changeEmailSchema,
  changePasswordSchema,
  updateProfileSchema,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from "@/lib/schemas/account";
import type { AccountPageData } from "../types";

function getFirstFieldError(errors: unknown) {
  if (!errors || typeof errors !== "object") {
    return null;
  }

  for (const value of Object.values(errors as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue;
    }

    const firstMessage = value.find(
      (item): item is string => typeof item === "string" && item.length > 0
    );

    if (firstMessage) {
      return firstMessage;
    }
  }

  return null;
}

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.error ?? getFirstFieldError(body?.errors) ?? fallback);
  }
}

function SuccessMessage({ children }: { children: string | null }) {
  if (!children) {
    return null;
  }

  return (
    <p className="text-sm text-foreground">{children}</p>
  );
}

export function AccountSettingsPage({
  initialData,
}: {
  initialData: AccountPageData;
}) {
  const router = useRouter();
  const initials = useMemo(() => getInitials(initialData.name), [initialData.name]);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const profileForm = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: initialData.name,
    },
  });

  const emailForm = useForm<ChangeEmailInput>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: {
      newEmail: "",
    },
  });

  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const resetProfileForm = profileForm.reset;
  const resetEmailForm = emailForm.reset;

  useEffect(() => {
    resetProfileForm({ name: initialData.name });
    resetEmailForm({ newEmail: "" });
  }, [initialData.email, initialData.name, resetEmailForm, resetProfileForm]);

  const profileMutation = useMutation({
    mutationFn: async (values: UpdateProfileInput) => {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      await readError(response, "Failed to update profile.");
    },
    onMutate: () => {
      setProfileError(null);
      setProfileSuccess(null);
    },
    onSuccess: () => {
      setProfileSuccess("Profile updated.");
      router.refresh();
    },
    onError: (error) => {
      setProfileError(error.message);
    },
  });

  const emailMutation = useMutation({
    mutationFn: async (values: ChangeEmailInput) => {
      const response = await fetch("/api/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      await readError(response, "Failed to update email.");
    },
    onMutate: () => {
      setEmailError(null);
      setEmailSuccess(null);
    },
    onSuccess: () => {
      setEmailSuccess("Email updated.");
      router.refresh();
    },
    onError: (error) => {
      setEmailError(error.message);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async (values: ChangePasswordInput) => {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      await readError(response, "Failed to change password.");
    },
    onMutate: () => {
      setPasswordError(null);
      setPasswordSuccess(null);
    },
    onSuccess: () => {
      passwordForm.reset();
      setPasswordSuccess("Password changed.");
    },
    onError: (error) => {
      setPasswordError(error.message);
    },
  });

  const currentName = useWatch({
    control: profileForm.control,
    name: "name",
  }) ?? "";
  const nextEmail = useWatch({
    control: emailForm.control,
    name: "newEmail",
  }) ?? "";
  const isNameUnchanged = currentName.trim() === initialData.name;
  const normalizedNextEmail = nextEmail.trim().toLowerCase();
  const isEmailUnchanged =
    normalizedNextEmail.length === 0 ||
    normalizedNextEmail === initialData.email.toLowerCase();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Account</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Manage your profile details and sign-in credentials.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar className="size-14">
              {initialData.avatar ? (
                <AvatarImage src={initialData.avatar} alt={initialData.name} />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <div className="text-base font-medium">{initialData.name}</div>
              <div className="text-sm text-muted-foreground">{initialData.email}</div>
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {formatRoleLabel(initialData.role)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Update the name shown across the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={profileForm.handleSubmit((values) =>
              profileMutation.mutate(values)
            )}
          >
            <FieldGroup>
              <Field data-invalid={profileForm.formState.errors.name != null}>
                <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                <Input
                  id="settings-name"
                  autoComplete="name"
                  aria-invalid={profileForm.formState.errors.name != null}
                  {...profileForm.register("name")}
                />
                <FieldDescription>
                  This appears in the sidebar and account menu.
                </FieldDescription>
                <FieldError errors={[profileForm.formState.errors.name]} />
              </Field>
            </FieldGroup>

            {profileError ? <FieldError>{profileError}</FieldError> : null}
            <SuccessMessage>{profileSuccess}</SuccessMessage>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={profileMutation.isPending || isNameUnchanged}
              >
                {profileMutation.isPending ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>
            Change the address you use to sign in to this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={emailForm.handleSubmit((values) => emailMutation.mutate(values))}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settings-current-email">Current email</FieldLabel>
                <Input
                  id="settings-current-email"
                  value={initialData.email}
                  readOnly
                  disabled
                />
              </Field>

              <Field data-invalid={emailForm.formState.errors.newEmail != null}>
                <FieldLabel htmlFor="settings-new-email">New email</FieldLabel>
                <Input
                  id="settings-new-email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={emailForm.formState.errors.newEmail != null}
                  {...emailForm.register("newEmail")}
                />
                <FieldDescription>
                  Use an address you can access before saving this change.
                </FieldDescription>
                <FieldError errors={[emailForm.formState.errors.newEmail]} />
              </Field>
            </FieldGroup>

            {emailError ? <FieldError>{emailError}</FieldError> : null}
            <SuccessMessage>{emailSuccess}</SuccessMessage>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={emailMutation.isPending || isEmailUnchanged}
              >
                {emailMutation.isPending ? "Saving…" : "Update email"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Set a new password for future sign-ins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={passwordForm.handleSubmit((values) =>
              passwordMutation.mutate(values)
            )}
          >
            <FieldGroup>
              <Field data-invalid={passwordForm.formState.errors.currentPassword != null}>
                <FieldLabel htmlFor="settings-current-password">
                  Current password
                </FieldLabel>
                <Input
                  id="settings-current-password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={
                    passwordForm.formState.errors.currentPassword != null
                  }
                  {...passwordForm.register("currentPassword")}
                />
                <FieldError
                  errors={[passwordForm.formState.errors.currentPassword]}
                />
              </Field>

              <Field data-invalid={passwordForm.formState.errors.newPassword != null}>
                <FieldLabel htmlFor="settings-new-password">New password</FieldLabel>
                <Input
                  id="settings-new-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={passwordForm.formState.errors.newPassword != null}
                  {...passwordForm.register("newPassword")}
                />
                <FieldDescription>
                  Use at least 8 characters and avoid reusing the current password.
                </FieldDescription>
                <FieldError errors={[passwordForm.formState.errors.newPassword]} />
              </Field>

              <Field
                data-invalid={passwordForm.formState.errors.confirmPassword != null}
              >
                <FieldLabel htmlFor="settings-confirm-password">
                  Confirm new password
                </FieldLabel>
                <Input
                  id="settings-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={
                    passwordForm.formState.errors.confirmPassword != null
                  }
                  {...passwordForm.register("confirmPassword")}
                />
                <FieldError
                  errors={[passwordForm.formState.errors.confirmPassword]}
                />
              </Field>
            </FieldGroup>

            {passwordError ? <FieldError>{passwordError}</FieldError> : null}
            <SuccessMessage>{passwordSuccess}</SuccessMessage>

            <div className="flex justify-end">
              <Button type="submit" disabled={passwordMutation.isPending}>
                {passwordMutation.isPending ? "Saving…" : "Change password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
