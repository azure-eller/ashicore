"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiJson } from "@/lib/client/api";
import { changeEmailSchema, type ChangeEmailInput } from "@/lib/schemas/account";

export function ChangeEmailDialog({
  currentEmail,
  children,
}: {
  currentEmail: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const form = useForm<ChangeEmailInput>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: { newEmail: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({ newEmail: "" });
    }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: async (values: ChangeEmailInput) => {
      await apiJson<void>("/api/account/email", {
        method: "POST",
        body: values,
        fallbackError: "Failed to update email.",
      });
      return values.newEmail;
    },
    onSuccess: (newEmail) => {
      form.reset({ newEmail: "" });
      setSuccessMessage(`Verification email sent to ${newEmail}.`);
      router.refresh();
    },
    onError: (error) => {
      setSuccessMessage(null);
      form.setError("newEmail", {
        message: error instanceof Error ? error.message : "Failed to update email.",
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setSuccessMessage(null);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Change email</DialogTitle>
          <DialogDescription>Current: {currentEmail}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          {successMessage ? (
            <Field>
              <FieldDescription>{successMessage}</FieldDescription>
            </Field>
          ) : null}

          <Field data-invalid={form.formState.errors.newEmail != null}>
            <FieldLabel htmlFor="change-email-input">New email</FieldLabel>
            <Input
              id="change-email-input"
              type="email"
              autoComplete="email"
              autoFocus
              aria-invalid={form.formState.errors.newEmail != null}
              {...form.register("newEmail")}
            />
            <FieldError errors={[form.formState.errors.newEmail]} />
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
              {mutation.isPending ? "Saving…" : "Update email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
