"use client";

import { Button } from "@/components/ui/button";
import type { AccountPageData } from "./types";
import { EditNameDialog } from "./account/edit-name-dialog";
import { ChangeEmailDialog } from "./account/change-email-dialog";
import { ChangePasswordDialog } from "./account/change-password-dialog";

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
    <div className="flex items-center justify-between gap-(--space-8) border-t py-(--space-6) first:border-t-0">
      <div className="flex min-w-0 flex-1 items-center gap-(--space-8)">
        <span className="w-[calc(var(--space-20)*2)] shrink-0 text-[length:var(--text-sm)] text-muted-foreground">{label}</span>
        <span className="truncate text-[length:var(--text-sm)]">{value}</span>
      </div>
      {action}
    </div>
  );
}

export function AccountSection({ initialData }: { initialData: AccountPageData }) {
  return (
    <section id="account" className="scroll-mt-(--space-24) border p-(--space-12)">
      <h2 className="mb-(--space-8) text-[length:var(--text-base)] leading-[var(--leading-base)] font-semibold tracking-[var(--tracking-tight)]">Account</h2>

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
    </section>
  );
}
