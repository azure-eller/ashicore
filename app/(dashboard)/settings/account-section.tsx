"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { AutosaveStatus, type AutosaveState } from "@/components/autosave-status";
import { CommitInput } from "@/components/card-page/commit-input";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SettingsBlock,
  SettingsCard,
  SettingsPageHeader,
  SettingsQuietRow,
} from "@/components/settings-panel";
import { apiJson } from "@/lib/client/api";
import type { AccountPageData } from "./types";
import { ChangeEmailDialog } from "./account/change-email-dialog";
import { ChangePasswordDialog } from "./account/change-password-dialog";

export function AccountSection({ initialData }: { initialData: AccountPageData }) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<AutosaveState>("idle");

  const nameMutation = useMutation({
    mutationFn: (name: string) =>
      apiJson<void>("/api/account/profile", {
        method: "PATCH",
        body: { name },
        fallbackError: "Failed to update name.",
      }),
    onMutate: () => setSaveState("saving"),
    onSuccess: () => {
      setSaveState("saved");
      router.refresh();
    },
    onError: () => setSaveState("error"),
  });

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Account"
        sub="Your personal profile and sign-in details."
      />
      <SettingsCard>
        <SettingsBlock title="Profile" actions={<AutosaveStatus state={saveState} />}>
          <div className="grid gap-(--space-8) sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="account-name">Full name</FieldLabel>
              <CommitInput
                id="account-name"
                label="Full name"
                value={initialData.name}
                required
                onCommit={(name) => {
                  if (name) nameMutation.mutate(name);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-email">Email</FieldLabel>
              <Input
                id="account-email"
                value={initialData.email}
                readOnly
                className="border-transparent bg-[var(--color-surface-sunk)] text-[var(--color-ink-soft)]"
              />
            </Field>
          </div>
        </SettingsBlock>
        <SettingsBlock title="Security">
          <div className="flex flex-col gap-(--space-8)">
            <SettingsQuietRow
              title="Password"
              sub="Used together with your email to sign in."
              action={
                <ChangePasswordDialog>
                  <Button variant="outline" size="sm">
                    Change password
                  </Button>
                </ChangePasswordDialog>
              }
            />
            <SettingsQuietRow
              title="Email"
              sub="Changing your email requires verification from the new address."
              action={
                <ChangeEmailDialog currentEmail={initialData.email}>
                  <Button variant="outline" size="sm">
                    Change email
                  </Button>
                </ChangeEmailDialog>
              }
            />
          </div>
        </SettingsBlock>
      </SettingsCard>
    </div>
  );
}
