"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowUpRight01Icon,
  CheckmarkCircle02Icon,
  CloudLoadingIcon,
  Copy01Icon,
  FileSyncIcon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FieldGroup,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AccountingDocumentPushStatus = "pending" | "pushed" | "failed" | null;
export type AccountingDocumentEmailStatus = "sent" | "failed" | "skipped" | null;
export type AccountingSyncStageState = "waiting" | "active" | "success" | "failed" | "skipped";

export type AccountingSyncDocument = {
  providerName: string;
  documentLabel: string;
  documentNumber: string | null;
  pushStatus: AccountingDocumentPushStatus;
  pushError: string | null;
  pushedAt: Date | string | null;
  retryCount: number;
  emailStatus: AccountingDocumentEmailStatus;
  emailError: string | null;
  emailedAt: Date | string | null;
  emailProviderName: string;
  recipientLabel: string;
  recipientEmail: string | null;
};

export type AccountingSyncStage = {
  id: string;
  label: string;
  detail: string | null;
  state: AccountingSyncStageState;
};

export type AccountingActionOptions = {
  syncAccounting: boolean;
  sendEmail: boolean;
};

export type AccountingProviderAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  pending?: boolean;
};

export type AccountingActionConfirmStep = {
  title: string;
  detail: string;
  meta?: string;
};

export function buildAccountingSyncStages(params: {
  document: AccountingSyncDocument;
  includeAccounting?: boolean;
  includeEmail: boolean;
  isWorking?: boolean;
  localActionLabel?: string;
  activeStage?: "push" | "email";
}): AccountingSyncStage[] {
  const {
    document,
    includeAccounting = true,
    includeEmail,
    isWorking = false,
    activeStage = "push",
  } = params;
  const localActionLabel = params.localActionLabel ?? "Save ERP document";
  const pushLabel = `Create ${document.documentLabel} in ${document.providerName}`;
  const emailLabel = `Email ${document.documentLabel}`;

  const localStage: AccountingSyncStage = {
    id: "local",
    label: localActionLabel,
    detail: null,
    state: "success",
  };

  if (!includeAccounting) {
    return [localStage];
  }

  if (isWorking) {
    const pushStage = buildPushStage(document, pushLabel);

    return [
      localStage,
      {
        id: "push",
        label: pushLabel,
        detail: activeStage === "email" ? pushStage.detail : null,
        state: activeStage === "email" ? pushStage.state : "active",
      },
      ...(includeEmail
        ? [
            {
              id: "email",
              label: emailLabel,
              detail: document.recipientEmail
                ? `To ${document.recipientEmail}`
                : `To ${document.recipientLabel}`,
              state: activeStage === "email" ? ("active" as const) : ("waiting" as const),
            },
          ]
        : []),
    ];
  }

  const pushStage = buildPushStage(document, pushLabel);
  return [
    localStage,
    pushStage,
    ...(includeEmail ? [buildEmailStage(document, emailLabel, pushStage.state)] : []),
  ];
}

export function AccountingSyncStatus({
  document,
  onRetryPush,
  retryPushPending = false,
  onRetryEmail,
  retryEmailPending = false,
  providerAction,
  compact = false,
}: {
  document: AccountingSyncDocument;
  onRetryPush?: () => void;
  retryPushPending?: boolean;
  onRetryEmail?: () => void;
  retryEmailPending?: boolean;
  providerAction?: AccountingProviderAction;
  compact?: boolean;
}) {
  if (!document.pushStatus) return null;

  const pushStage = buildPushStage(
    document,
    `${document.documentLabel} in ${document.providerName}`
  );
  const emailStage = buildEmailStage(document, `${document.documentLabel} email`, pushStage.state);

  if (compact) {
    const emailSummary =
      document.emailStatus === "sent"
        ? "Email sent"
        : document.emailStatus === "failed"
          ? "Email failed"
          : document.emailStatus === "skipped"
            ? "Email skipped"
            : null;

    return (
      <div className="flex max-w-3xl flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-card-foreground">
        <span className="font-medium">Accounting Sync</span>
        <SyncBadge state={pushStage.state} label={statusBadgeLabel(pushStage.state)} />
        <span className="text-muted-foreground">
          {document.providerName}
          {document.documentNumber ? ` · ${document.documentNumber}` : ""}
        </span>
        {emailSummary ? (
          <span className="text-muted-foreground">· {emailSummary}</span>
        ) : null}
        {onRetryPush && document.pushStatus === "failed" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetryPush}
            disabled={retryPushPending}
          >
            {retryPushPending ? "Retrying..." : "Retry sync"}
          </Button>
        ) : null}
        {onRetryEmail && document.pushStatus === "pushed" && document.emailStatus === "failed" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetryEmail}
            disabled={retryEmailPending}
          >
            {retryEmailPending ? "Sending..." : "Retry email"}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4 rounded-md border bg-card p-4 text-card-foreground">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">Accounting Sync</h2>
            <SyncBadge state={pushStage.state} label={statusBadgeLabel(pushStage.state)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {document.providerName}
            {document.documentNumber ? ` · ${document.documentNumber}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {providerAction && document.pushStatus === "pushed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (providerAction.href) {
                  window.open(providerAction.href, "_blank", "noopener,noreferrer");
                  return;
                }
                providerAction.onClick?.();
              }}
              disabled={providerAction.pending}
            >
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} data-icon="inline-start" />
              {providerAction.pending ? "Opening..." : providerAction.label}
            </Button>
          ) : null}
          {document.documentNumber && document.pushStatus === "pushed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(document.documentNumber ?? "")}
            >
              <HugeiconsIcon icon={Copy01Icon} size={14} data-icon="inline-start" />
              Copy number
            </Button>
          ) : null}
          {onRetryPush && document.pushStatus === "failed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetryPush}
              disabled={retryPushPending}
            >
              {retryPushPending ? "Retrying..." : "Retry sync"}
            </Button>
          ) : null}
          {onRetryEmail && document.pushStatus === "pushed" && document.emailStatus === "failed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetryEmail}
              disabled={retryEmailPending}
            >
              {retryEmailPending ? "Sending..." : "Retry email"}
            </Button>
          ) : null}
        </div>
      </div>

      <Separator />

      <div className="grid gap-3 md:grid-cols-2">
        <StatusLine stage={pushStage} />
        {document.emailStatus ? <StatusLine stage={emailStage} /> : null}
      </div>

      {document.retryCount > 1 ? (
        <p className="text-xs text-muted-foreground">Sync attempts: {document.retryCount}</p>
      ) : null}
    </div>
  );
}

export function AccountingActionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  localStep,
  accountingStep,
  emailStep,
  options,
  onOptionsChange,
  onConfirm,
  onOpenChange,
  isPending = false,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  localStep: AccountingActionConfirmStep;
  accountingStep: AccountingActionConfirmStep;
  emailStep: AccountingActionConfirmStep;
  options: AccountingActionOptions;
  onOptionsChange: (options: AccountingActionOptions) => void;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  isPending?: boolean;
}) {
  const emailDisabled = !options.syncAccounting;

  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent size="lg" className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Timeline className="pl-10">
          <ActionTimelineStep
            number="1"
            title={localStep.title}
            detail={localStep.detail}
            meta={localStep.meta}
            badge="Required"
          />
          <ActionTimelineStep
            number="2"
            title={accountingStep.title}
            detail={accountingStep.detail}
            meta={accountingStep.meta}
            checked={options.syncAccounting}
            checkboxId="syncAccounting"
            onCheckedChange={(checked) => {
              const syncAccounting = checked === true;
              onOptionsChange({
                syncAccounting,
                sendEmail: syncAccounting ? options.sendEmail : false,
              });
            }}
          />
          <ActionTimelineStep
            number="3"
            title={emailStep.title}
            detail={emailStep.detail}
            meta={emailStep.meta}
            checked={options.sendEmail}
            checkboxId="sendEmail"
            disabled={emailDisabled}
            onCheckedChange={(checked) =>
              onOptionsChange({ ...options, sendEmail: checked === true })
            }
          />
        </Timeline>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Back
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionTimelineStep({
  number,
  title,
  detail,
  meta,
  badge,
  checked,
  checkboxId,
  disabled = false,
  onCheckedChange,
}: {
  number: string;
  title: string;
  detail: string;
  meta?: string;
  badge?: string;
  checked?: boolean;
  checkboxId?: string;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean | "indeterminate") => void;
}) {
  return (
    <div className="relative">
      <TimelineNode active={number === "1"}>
        {number}
      </TimelineNode>
      <div
        className={cn(
          "flex items-center justify-between gap-4 rounded-md border bg-background p-3",
          disabled && "opacity-60"
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            {badge ? <Badge variant="secondary">{badge}</Badge> : null}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{detail}</p>
          {meta ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
          ) : null}
        </div>
        {checkboxId ? (
          <Checkbox
            id={checkboxId}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onCheckedChange}
            aria-label={title}
          />
        ) : null}
      </div>
    </div>
  );
}

export function AccountingSyncDialog({
  open,
  title,
  description,
  stages,
  error,
  isWorking,
  providerAction,
  documentNumber,
  documentId,
  documentIdLabel = "Xero ID",
  onOpenChange,
  onDone,
}: {
  open: boolean;
  title: string;
  description: string;
  stages: AccountingSyncStage[];
  error: string | null;
  isWorking: boolean;
  providerAction?: AccountingProviderAction;
  documentNumber?: string | null;
  documentId?: string | null;
  documentIdLabel?: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const showResultActions = !isWorking && !error && (providerAction || documentNumber || documentId);

  return (
    <Dialog open={open} onOpenChange={isWorking ? undefined : onOpenChange}>
      <DialogContent size="md" className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Timeline className="pl-10">
          {stages.map((stage, index) => (
            <StatusTimelineStep
              key={stage.id}
              number={String(index + 1)}
              stage={stage}
            />
          ))}
        </Timeline>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {showResultActions ? (
          <div className="flex flex-col gap-2 pl-10">
            {documentId ? (
              <p className="break-all text-xs text-muted-foreground">
                {documentIdLabel}: {documentId}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {providerAction ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (providerAction.href) {
                      window.open(providerAction.href, "_blank", "noopener,noreferrer");
                      return;
                    }
                    providerAction.onClick?.();
                  }}
                  disabled={providerAction.pending}
                >
                  <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} data-icon="inline-start" />
                  {providerAction.pending ? "Opening..." : providerAction.label}
                </Button>
              ) : null}
              {documentNumber ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(documentNumber)}
                >
                  <HugeiconsIcon icon={Copy01Icon} size={14} data-icon="inline-start" />
                  Copy number
                </Button>
              ) : null}
              {documentId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(documentId)}
                >
                  <HugeiconsIcon icon={Copy01Icon} size={14} data-icon="inline-start" />
                  Copy Xero ID
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" onClick={onDone} disabled={isWorking}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Timeline({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <FieldGroup className={cn("relative gap-3", className)}>
      <div
        aria-hidden
        className="absolute bottom-8 left-4 top-8 border-l border-border"
      />
      {children}
    </FieldGroup>
  );
}

function TimelineNode({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "absolute -left-10 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-xs font-medium",
        active && "bg-primary text-primary-foreground"
      )}
    >
      {children}
    </div>
  );
}

function StatusTimelineStep({
  number,
  stage,
}: {
  number: string;
  stage: AccountingSyncStage;
}) {
  return (
    <div className="relative">
      <TimelineNode
        active={stage.state === "active" || stage.state === "success" || number === "1"}
      >
        {stage.state === "active" ? (
          <HugeiconsIcon icon={CloudLoadingIcon} size={14} aria-hidden className="animate-spin" />
        ) : (
          number
        )}
      </TimelineNode>
      <div
        className={cn(
          "flex items-center justify-between gap-4 rounded-md border bg-background p-3",
          stage.state === "skipped" && "opacity-70"
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{stage.label}</p>
            <SyncBadge state={stage.state} label={statusBadgeLabel(stage.state)} />
          </div>
          {stage.detail ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">{stage.detail}</p>
          ) : null}
        </div>
        <StatusIcon state={stage.state} />
      </div>
    </div>
  );
}

function buildPushStage(
  document: AccountingSyncDocument,
  label: string
): AccountingSyncStage {
  if (document.pushStatus === "pushed") {
    return {
      id: "push",
      label,
      detail: document.documentNumber
        ? `${document.documentNumber}${document.pushedAt ? ` · ${formatAccountingDateTime(document.pushedAt)}` : ""}`
        : document.pushedAt
          ? formatAccountingDateTime(document.pushedAt)
          : null,
      state: "success",
    };
  }

  if (document.pushStatus === "failed") {
    return {
      id: "push",
      label,
      detail: document.pushError ?? "Sync failed.",
      state: "failed",
    };
  }

  if (document.pushStatus === "pending") {
    return {
      id: "push",
      label,
      detail: null,
      state: "active",
    };
  }

  return {
    id: "push",
    label,
    detail: `${document.providerName} is not connected for this organization.`,
    state: "skipped",
  };
}

function buildEmailStage(
  document: AccountingSyncDocument,
  label: string,
  pushState: AccountingSyncStageState
): AccountingSyncStage {
  if (pushState === "failed" || pushState === "waiting") {
    return {
      id: "email",
      label,
      detail: null,
      state: "waiting",
    };
  }

  if (document.emailStatus === "sent") {
    return {
      id: "email",
      label,
      detail: [
        `Accepted by ${document.emailProviderName}`,
        document.recipientEmail ? `To ${document.recipientEmail}` : `To ${document.recipientLabel}`,
        document.emailedAt ? formatAccountingDateTime(document.emailedAt) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      state: "success",
    };
  }

  if (document.emailStatus === "failed") {
    return {
      id: "email",
      label,
      detail: document.emailError ?? "Email failed.",
      state: "failed",
    };
  }

  if (document.emailStatus === "skipped") {
    return {
      id: "email",
      label,
      detail: document.recipientEmail
        ? "Email was not sent for this sync."
        : `No email address for ${document.recipientLabel}.`,
      state: "skipped",
    };
  }

  return {
    id: "email",
    label,
    detail: null,
    state: pushState === "success" ? "skipped" : "waiting",
  };
}

function formatAccountingDateTime(value: Date | string): string {
  if (value instanceof Date) {
    return formatDateTime(value);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatDateTime(date);
}

function StatusLine({ stage }: { stage: AccountingSyncStage }) {
  return (
    <div className="flex gap-3 rounded-md border bg-background p-3">
      <StatusIcon state={stage.state} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{stage.label}</p>
          <SyncBadge state={stage.state} label={statusBadgeLabel(stage.state)} />
        </div>
        {stage.detail ? (
          <p className="mt-1 break-words text-xs text-muted-foreground">{stage.detail}</p>
        ) : null}
      </div>
    </div>
  );
}

function StatusIcon({ state }: { state: AccountingSyncStageState }) {
  const icon =
    state === "success"
      ? CheckmarkCircle02Icon
      : state === "failed"
        ? AlertCircleIcon
        : state === "active"
          ? CloudLoadingIcon
          : state === "skipped"
            ? MailSend02Icon
            : FileSyncIcon;

  return (
    <HugeiconsIcon
      icon={icon}
      size={18}
      aria-hidden
      className={cn(
        "mt-0.5 shrink-0 text-muted-foreground",
        state === "active" && "animate-spin",
        state === "failed" && "text-destructive",
        state === "success" && "text-primary"
      )}
    />
  );
}

function SyncBadge({
  state,
  label,
}: {
  state: AccountingSyncStageState;
  label: string;
}) {
  return (
    <Badge
      variant={
        state === "failed"
          ? "destructive"
          : state === "success"
            ? "default"
            : state === "skipped"
              ? "outline"
              : "secondary"
      }
    >
      {label}
    </Badge>
  );
}

function statusBadgeLabel(state: AccountingSyncStageState) {
  switch (state) {
    case "active":
      return "Working";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "success":
      return "Done";
    case "waiting":
      return "Waiting";
  }
}
