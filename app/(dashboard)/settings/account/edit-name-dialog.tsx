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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiJson } from "@/lib/client/api";
import { updateProfileSchema, type UpdateProfileInput } from "@/lib/schemas/account";

export function EditNameDialog({
  currentName,
  children,
}: {
  currentName: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: currentName },
  });

  useEffect(() => {
    if (open) {
      form.reset({ name: currentName });
    }
  }, [open, currentName, form]);

  const mutation = useMutation({
    mutationFn: (values: UpdateProfileInput) =>
      apiJson<void>("/api/account/profile", {
        method: "PATCH",
        body: values,
        fallbackError: "Failed to update name.",
      }),
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: (error) => {
      form.setError("name", {
        message: error instanceof Error ? error.message : "Failed to update name.",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Edit name</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-(--space-6)"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <Field data-invalid={form.formState.errors.name != null}>
            <FieldLabel htmlFor="edit-name-input">Name</FieldLabel>
            <Input
              id="edit-name-input"
              autoComplete="name"
              autoFocus
              aria-invalid={form.formState.errors.name != null}
              {...form.register("name")}
            />
            <FieldError errors={[form.formState.errors.name]} />
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
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
