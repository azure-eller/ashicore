"use client";

import { Button } from "@/components/ui/button";
import type { AccountPageData } from "./types";
import { EditNameDialog } from "./account/edit-name-dialog";
import { ChangeEmailDialog } from "./account/change-email-dialog";
import { ChangePasswordDialog } from "./account/change-password-dialog";
import {
  SettingsPanel,
  SettingsPanelHeader,
  SettingsKeyValueRow,
  SettingsRows,
} from "@/components/settings-panel";

export function AccountSection({ initialData }: { initialData: AccountPageData }) {
  return (
    <SettingsPanel id="account">
      <SettingsPanelHeader title="Account" />
      <SettingsRows>
        <SettingsKeyValueRow
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

        <SettingsKeyValueRow
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

        <SettingsKeyValueRow
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
      </SettingsRows>
    </SettingsPanel>
  );
}
