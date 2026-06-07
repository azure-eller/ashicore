"use client";

import { useEffect, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiJson } from "@/lib/client/api";
import {
  changePasswordSchema,
  type ChangePasswordInput,
} from "@/lib/schemas/account";

const EMPTY_VALUES: ChangePasswordInput = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export function ChangePasswordDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (open) {
      form.reset(EMPTY_VALUES);
    }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (values: ChangePasswordInput) =>
      apiJson<void>("/api/account/password", {
        method: "POST",
        body: values,
        fallbackError: "Failed to change password.",
      }),
    onSuccess: () => {
      setOpen(false);
    },
    onError: (error) => {
      form.setError("currentPassword", {
        message: error instanceof Error ? error.message : "Failed to change password.",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-(--space-6)"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <Field data-invalid={form.formState.errors.currentPassword != null}>
            <FieldLabel htmlFor="change-password-current">Current password</FieldLabel>
            <Input
              id="change-password-current"
              type="password"
              autoComplete="current-password"
              autoFocus
              aria-invalid={form.formState.errors.currentPassword != null}
              {...form.register("currentPassword")}
            />
            <FieldError errors={[form.formState.errors.currentPassword]} />
          </Field>

          <Field data-invalid={form.formState.errors.newPassword != null}>
            <FieldLabel htmlFor="change-password-new">New password</FieldLabel>
            <Input
              id="change-password-new"
              type="password"
              autoComplete="new-password"
              aria-invalid={form.formState.errors.newPassword != null}
              {...form.register("newPassword")}
            />
            <FieldError errors={[form.formState.errors.newPassword]} />
          </Field>

          <Field data-invalid={form.formState.errors.confirmPassword != null}>
            <FieldLabel htmlFor="change-password-confirm">Confirm new password</FieldLabel>
            <Input
              id="change-password-confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={form.formState.errors.confirmPassword != null}
              {...form.register("confirmPassword")}
            />
            <FieldError errors={[form.formState.errors.confirmPassword]} />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
