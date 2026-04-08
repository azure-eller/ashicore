"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  accountSettingsSchema,
  type AccountSettingsInput,
} from "@/lib/schemas/account";
import type { AccountPageData } from "./types";

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

async function sendAccountRequest(
  path: string,
  method: "PATCH" | "POST",
  body: Record<string, string>,
  fallback: string
) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  await readError(response, fallback);
}

type AccountUpdateKey = "profile" | "email" | "password";
type SavedAccountState = Pick<AccountSettingsInput, "name" | "email">;
type AccountFieldName = "name" | "email" | "currentPassword";

class AccountSaveError extends Error {
  constructor(
    message: string,
    readonly field: AccountFieldName,
    readonly updates: AccountUpdateKey[],
    readonly savedState: SavedAccountState
  ) {
    super(message);
    this.name = "AccountSaveError";
  }
}

function buildSuccessMessage(updates: AccountUpdateKey[]) {
  if (updates.length === 0) {
    return null;
  }

  if (updates.length > 1) {
    return "Account updated.";
  }

  if (updates[0] === "profile") {
    return "Profile updated.";
  }

  if (updates[0] === "email") {
    return "Email updated.";
  }

  return "Password changed.";
}

function normalizeSavedState(data: Pick<AccountPageData, "name" | "email">) {
  return {
    name: data.name,
    email: data.email.toLowerCase(),
  };
}

export function ProfileSection({
  initialData,
}: {
  initialData: AccountPageData;
}) {
  const router = useRouter();
  const [savedState, setSavedState] = useState(() => normalizeSavedState(initialData));
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<AccountSettingsInput>({
    resolver: zodResolver(accountSettingsSchema),
    defaultValues: {
      name: initialData.name,
      email: initialData.email,
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const resetForm = form.reset;
  const clearErrors = form.clearErrors;
  const setError = form.setError;

  useEffect(() => {
    resetForm({
      name: initialData.name,
      email: initialData.email,
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  }, [initialData.email, initialData.name, resetForm]);

  const values = useWatch({
    control: form.control,
  });

  const currentName = values.name ?? "";
  const currentEmail = values.email ?? "";
  const wantsPasswordChange =
    (values.currentPassword?.length ?? 0) > 0 ||
    (values.newPassword?.length ?? 0) > 0 ||
    (values.confirmPassword?.length ?? 0) > 0;
  const hasChanges =
    currentName.trim() !== savedState.name ||
    currentEmail.trim().toLowerCase() !== savedState.email ||
    wantsPasswordChange;

  const mutation = useMutation({
    mutationFn: async (input: AccountSettingsInput) => {
      const updates: AccountUpdateKey[] = [];
      const passwordChangeRequested =
        input.currentPassword.length > 0 ||
        input.newPassword.length > 0 ||
        input.confirmPassword.length > 0;
      let nextSavedState: SavedAccountState = savedState;

      if (input.name !== savedState.name) {
        try {
          await sendAccountRequest(
            "/api/account/profile",
            "PATCH",
            { name: input.name },
            "Failed to update profile."
          );
          updates.push("profile");
          nextSavedState = {
            ...nextSavedState,
            name: input.name,
          };
        } catch (error) {
          throw new AccountSaveError(
            error instanceof Error ? error.message : "Failed to update profile.",
            "name",
            updates,
            nextSavedState
          );
        }
      }

      if (input.email !== savedState.email) {
        try {
          await sendAccountRequest(
            "/api/account/email",
            "POST",
            { newEmail: input.email },
            "Failed to update email."
          );
          updates.push("email");
          nextSavedState = {
            ...nextSavedState,
            email: input.email,
          };
        } catch (error) {
          throw new AccountSaveError(
            error instanceof Error ? error.message : "Failed to update email.",
            "email",
            updates,
            nextSavedState
          );
        }
      }

      if (passwordChangeRequested) {
        try {
          await sendAccountRequest(
            "/api/account/password",
            "POST",
            {
              currentPassword: input.currentPassword,
              newPassword: input.newPassword,
              confirmPassword: input.confirmPassword,
            },
            "Failed to change password."
          );
          updates.push("password");
        } catch (error) {
          throw new AccountSaveError(
            error instanceof Error ? error.message : "Failed to change password.",
            "currentPassword",
            updates,
            nextSavedState
          );
        }
      }

      return {
        updates,
        savedState: nextSavedState,
      };
    },
    onMutate: () => {
      clearErrors();
      setSubmitError(null);
      setSubmitSuccess(null);
    },
    onSuccess: ({ updates, savedState: nextSavedState }) => {
      setSavedState(nextSavedState);
      resetForm({
        name: nextSavedState.name,
        email: nextSavedState.email,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setSubmitSuccess(buildSuccessMessage(updates));

      if (updates.includes("profile") || updates.includes("email")) {
        router.refresh();
      }
    },
    onError: (error, input) => {
      if (error instanceof AccountSaveError) {
        const nextName = error.field === "name" ? input.name : error.savedState.name;
        const nextEmail =
          error.field === "email" ? input.email : error.savedState.email;

        setSavedState(error.savedState);
        setSubmitSuccess(buildSuccessMessage(error.updates));
        resetForm({
          name: nextName,
          email: nextEmail,
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          confirmPassword: input.confirmPassword,
        });
        setError(error.field, {
          message: error.message,
        });

        if (error.updates.includes("profile") || error.updates.includes("email")) {
          router.refresh();
        }

        return;
      }

      setSubmitError(error instanceof Error ? error.message : "Failed to save changes.");
    },
  });

  return (
    <section id="profile" className="rounded-xl border bg-card p-6">
      <form
        className="flex flex-col gap-6"
        onSubmit={form.handleSubmit((input) => mutation.mutate(input))}
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
          <p className="text-sm text-muted-foreground">
            Manage your name, email, and password.
          </p>
        </div>

        <FieldGroup className="gap-4 md:grid md:grid-cols-2 md:gap-4">
          <Field data-invalid={form.formState.errors.name != null}>
            <FieldLabel htmlFor="settings-name">Name</FieldLabel>
            <Input
              id="settings-name"
              autoComplete="name"
              aria-invalid={form.formState.errors.name != null}
              {...form.register("name")}
            />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>

          <Field data-invalid={form.formState.errors.email != null}>
            <FieldLabel htmlFor="settings-email">Email</FieldLabel>
            <Input
              id="settings-email"
              type="email"
              autoComplete="email"
              aria-invalid={form.formState.errors.email != null}
              {...form.register("email")}
            />
            <FieldError errors={[form.formState.errors.email]} />
          </Field>
        </FieldGroup>

        <Separator />

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Password</h2>
            <FieldDescription>
              Leave these blank to keep your current password.
            </FieldDescription>
          </div>

          <FieldGroup className="gap-4 md:grid md:grid-cols-2 md:gap-4">
            <Field data-invalid={form.formState.errors.currentPassword != null}>
              <FieldLabel htmlFor="settings-current-password">
                Current password
              </FieldLabel>
              <Input
                id="settings-current-password"
                type="password"
                autoComplete="current-password"
                aria-invalid={form.formState.errors.currentPassword != null}
                {...form.register("currentPassword")}
              />
              <FieldError errors={[form.formState.errors.currentPassword]} />
            </Field>

            <Field data-invalid={form.formState.errors.newPassword != null}>
              <FieldLabel htmlFor="settings-new-password">New password</FieldLabel>
              <Input
                id="settings-new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={form.formState.errors.newPassword != null}
                {...form.register("newPassword")}
              />
              <FieldError errors={[form.formState.errors.newPassword]} />
            </Field>

            <Field
              className="md:col-span-2"
              data-invalid={form.formState.errors.confirmPassword != null}
            >
              <FieldLabel htmlFor="settings-confirm-password">
                Confirm new password
              </FieldLabel>
              <Input
                id="settings-confirm-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={form.formState.errors.confirmPassword != null}
                {...form.register("confirmPassword")}
              />
              <FieldError errors={[form.formState.errors.confirmPassword]} />
            </Field>
          </FieldGroup>
        </div>

        <Separator />

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-h-5 flex-col gap-1">
            {submitError ? <FieldError>{submitError}</FieldError> : null}
            {submitSuccess ? (
              <p className="text-sm text-foreground">{submitSuccess}</p>
            ) : null}
          </div>

          <Button
            type="submit"
            variant={hasChanges ? "default" : "outline"}
            disabled={mutation.isPending || !hasChanges}
          >
            {mutation.isPending ? "Saving\u2026" : "Save"}
          </Button>
        </div>
      </form>
    </section>
  );
}
