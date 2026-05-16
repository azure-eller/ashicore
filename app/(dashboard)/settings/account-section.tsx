"use client";

import { Button } from "@/components/ui/button";
import type { AccountPageData } from "./types";
import { EditNameDialog } from "./account/edit-name-dialog";
import { ChangeEmailDialog } from "./account/change-email-dialog";
import { ChangePasswordDialog } from "./account/change-password-dialog";
import { SettingsPanel, SettingsPanelHeader } from "./settings-panel";

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="grid gap-(--space-4) border-t px-(--space-12) py-(--space-8) first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-(--space-2) sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
        <span className="w-[calc(var(--space-20)*2)] shrink-0 text-[length:var(--text-sm)] text-muted-foreground">{label}</span>
        <span className="truncate text-[length:var(--text-sm)]">{value}</span>
      </div>
      <div className="sm:justify-self-end">{action}</div>
    </div>
  );
}

export function AccountSection({ initialData }: { initialData: AccountPageData }) {
  return (
    <SettingsPanel id="account">
      <SettingsPanelHeader title="Account" />
      <Row
        label="Name"
        value={initialData.name}
        action={
          <EditNameDialog currentName={initialData.name}>
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          </EditNameDialog>
        }
      />

      <Row
        label="Email"
        value={initialData.email}
        action={
          <ChangeEmailDialog currentEmail={initialData.email}>
            <Button variant="ghost" size="sm">
              Change
            </Button>
          </ChangeEmailDialog>
        }
      />

      <Row
        label="Password"
        value={<span className="text-muted-foreground">••••••••••</span>}
        action={
          <ChangePasswordDialog>
            <Button variant="ghost" size="sm">
              Change
            </Button>
          </ChangePasswordDialog>
        }
      />
    </SettingsPanel>
  );
}
