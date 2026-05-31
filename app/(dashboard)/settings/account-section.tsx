"use client";

import { Button } from "@/components/ui/button";
import type { AccountPageData } from "./types";
import { EditNameDialog } from "./account/edit-name-dialog";
import { ChangeEmailDialog } from "./account/change-email-dialog";
import { ChangePasswordDialog } from "./account/change-password-dialog";
import {
  SettingsPanel,
  SettingsPanelHeader,
  SettingsPanelSection,
} from "./settings-panel";

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
    <SettingsPanelSection className="py-(--space-5)">
      <div className="grid max-w-3xl gap-(--space-4) sm:grid-cols-[9rem_minmax(12rem,24rem)_auto] sm:items-center">
        <span className="text-[length:var(--text-sm)] text-muted-foreground">
          {label}
        </span>
        <span className="min-w-0 truncate text-[length:var(--text-sm)]">
          {value}
        </span>
        <div className="sm:justify-self-start">{action}</div>
      </div>
    </SettingsPanelSection>
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
