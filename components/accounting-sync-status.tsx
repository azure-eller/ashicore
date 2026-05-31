"use client";

import { useRef } from "react";
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
import {
  ConfiguredBadge,
  type ConfiguredBadgeConfig,
} from "@/components/configured-badge";
import { InsetPanel } from "@/components/inset-panel";
import { SurfacePanel } from "@/components/surface-panel";
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
import { formatDateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";

export type AccountingDocumentPushStatus = "pending" | "pushed" | "failed" | null;
export type AccountingDocumentEmailStatus = "sent" | "failed" | "skipped" | null;
export type AccountingSyncStageState = "waiting" | "active" | "success" | "failed" | "skipped";

const syncBadgeConfig = {
  active: { label: "Working", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
  skipped: { label: "Skipped", variant: "outline" },
  success: { label: "Done" },
  waiting: { label: "Waiting", variant: "secondary" },
} satisfies ConfiguredBadgeConfig<AccountingSyncStageState>;

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

export type AccountingSyncWarning = {
  title: string;
  detail: string;
};

export function buildAccountingSyncStages(params: {
  document: AccountingSyncDocument;
  timeZone: string;
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
    timeZone,
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
    const pushStage = buildPushStage(document, pushLabel, timeZone);

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

  const pushStage = buildPushStage(document, pushLabel, timeZone);
  return [
    localStage,
    pushStage,
    ...(includeEmail ? [buildEmailStage(document, emailLabel, pushStage.state, timeZone)] : []),
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
  const timeZone = useOrganizationTimeZone();

  if (!document.pushStatus) return null;

  const pushStage = buildPushStage(
    document,
    `${document.documentLabel} in ${document.providerName}`,
    timeZone
  );
  const emailStage = buildEmailStage(
    document,
    `${document.documentLabel} email`,
    pushStage.state,
    timeZone
  );
  const canSendEmail =
    onRetryEmail && document.pushStatus === "pushed" && document.emailStatus !== "sent";
  const emailActionLabel =
    document.emailStatus === "failed" ? "Retry email" : `Email ${document.documentLabel}`;

  if (compact) {
    const emailSummary =
      document.emailStatus === "sent"
        ? emailStage.detail
          ? `Email sent · ${emailStage.detail}`
          : "Email sent"
        : document.emailStatus === "failed"
          ? emailStage.detail
            ? `Email failed · ${emailStage.detail}`
            : "Email failed"
          : document.emailStatus === "skipped"
          ? emailStage.detail
            ? `Email skipped · ${emailStage.detail}`
            : "Email skipped"
            : null;
    const documentSummary = document.documentNumber
      ? `${document.providerName} ${document.documentLabel} · ${document.documentNumber}`
      : `${document.providerName} ${document.documentLabel}`;
    const canOpenProviderDocument = providerAction && document.pushStatus === "pushed";

    return (
      <SurfacePanel
        padding="sm"
        className="flex max-w-3xl flex-wrap items-center gap-(--space-4) px-(--space-6) py-(--space-4) text-[length:var(--text-sm)]"
      >
        <span className="font-medium">Accounting Sync</span>
        <SyncBadge state={pushStage.state} />
        {canOpenProviderDocument ? (
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:pointer-events-none disabled:no-underline"
            onClick={() => {
              if (providerAction.href) {
                window.open(providerAction.href, "_blank", "noopener,noreferrer");
                return;
              }
              providerAction.onClick?.();
            }}
            disabled={providerAction.pending}
          >
            {providerAction.pending ? "Opening..." : documentSummary}
          </button>
        ) : (
          <span className="text-muted-foreground">{documentSummary}</span>
        )}
        {emailSummary ? (
          <span className="text-muted-foreground">· {emailSummary}</span>
        ) : null}
        {onRetryPush ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetryPush}
            disabled={retryPushPending}
          >
            {retryPushPending ? "Syncing..." : "Sync accounting"}
          </Button>
        ) : null}
        {canSendEmail ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetryEmail}
            disabled={retryEmailPending}
          >
            {retryEmailPending ? "Sending..." : emailActionLabel}
          </Button>
        ) : null}
      </SurfacePanel>
    );
  }

  return (
    <SurfacePanel className="flex max-w-3xl flex-col gap-(--space-8)">
      <div className="flex flex-col gap-(--space-6) sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-(--space-2)">
          <div className="flex flex-wrap items-center gap-(--space-4)">
            <h2 className="text-[length:var(--text-base)] font-semibold tracking-tight">Accounting Sync</h2>
            <SyncBadge state={pushStage.state} />
          </div>
          <p className="text-[length:var(--text-sm)] text-muted-foreground">
            {document.providerName}
            {document.documentNumber ? ` · ${document.documentNumber}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-(--space-4)">
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
          {onRetryPush ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetryPush}
              disabled={retryPushPending}
            >
              {retryPushPending ? "Syncing..." : "Sync accounting"}
            </Button>
          ) : null}
          {canSendEmail ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetryEmail}
              disabled={retryEmailPending}
            >
              {retryEmailPending ? "Sending..." : emailActionLabel}
            </Button>
          ) : null}
        </div>
      </div>

      <Separator />

      <div className="grid gap-(--space-6) md:grid-cols-2">
        <StatusLine stage={pushStage} />
        {document.emailStatus ? <StatusLine stage={emailStage} /> : null}
      </div>

      {document.retryCount > 1 ? (
        <p className="text-[length:var(--text-xs)] text-muted-foreground">Sync attempts: {document.retryCount}</p>
      ) : null}
    </SurfacePanel>
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
  const emailBeforeDisable = useRef(options.sendEmail);

  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Timeline className="pl-(--space-20)">
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
              if (syncAccounting) {
                onOptionsChange({
                  syncAccounting,
                  sendEmail: emailBeforeDisable.current,
                });
                return;
              }

              emailBeforeDisable.current = options.sendEmail;
              onOptionsChange({ syncAccounting, sendEmail: false });
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
      <SurfacePanel
        tone="background"
        padding="sm"
        className={cn(
          "flex items-center justify-between gap-(--space-8)",
          disabled && "opacity-60"
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-(--space-4)">
            <p className="text-[length:var(--text-sm)] font-medium">{title}</p>
            {badge ? <Badge variant="secondary">{badge}</Badge> : null}
          </div>
          <p className="mt-(--space-2) truncate text-[length:var(--text-sm)] text-muted-foreground">{detail}</p>
          {meta ? (
            <p className="mt-(--space-1) truncate text-[length:var(--text-xs)] text-muted-foreground">{meta}</p>
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
      </SurfacePanel>
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
  documentIdLabel = "Accounting document ID",
  warnings = [],
  stageActions,
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
  warnings?: AccountingSyncWarning[];
  stageActions?: Partial<Record<string, AccountingProviderAction>>;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const showResultActions = !isWorking && !error && (providerAction || documentNumber || documentId);

  return (
    <Dialog open={open} onOpenChange={isWorking ? undefined : onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Timeline className="pl-(--space-20)">
          {stages.map((stage, index) => (
            <StatusTimelineStep
              key={stage.id}
              number={String(index + 1)}
              stage={stage}
              action={stageActions?.[stage.id]}
            />
          ))}
        </Timeline>

        {warnings.length > 0 ? (
          <AccountingSyncWarnings warnings={warnings} />
        ) : null}

        {error ? <p className="text-[length:var(--text-sm)] text-destructive">{error}</p> : null}

        {showResultActions ? (
          <div className="flex flex-col gap-(--space-4) pl-(--space-20)">
            {documentId ? (
              <p className="break-all text-[length:var(--text-xs)] text-muted-foreground">
                {documentIdLabel}: {documentId}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-(--space-4)">
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
                  Copy accounting ID
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

function AccountingSyncWarnings({
  warnings,
}: {
  warnings: AccountingSyncWarning[];
}) {
  return (
    <InsetPanel className="flex flex-col gap-(--space-4) bg-muted/40">
      {warnings.map((warning) => (
        <div key={`${warning.title}-${warning.detail}`} className="flex gap-(--space-4)">
          <HugeiconsIcon
            icon={AlertCircleIcon}
            size={16}
            className="mt-(--space-1) shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[length:var(--text-sm)] font-medium">{warning.title}</p>
            <p className="text-[length:var(--text-sm)] text-muted-foreground">
              {warning.detail}
            </p>
          </div>
        </div>
      ))}
    </InsetPanel>
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
    <FieldGroup className={cn("relative gap-(--space-6)", className)}>
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
        "absolute -left-(--space-20) top-1/2 flex size-(--space-16) -translate-y-1/2 items-center justify-center border bg-background text-[length:var(--text-xs)] font-medium",
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
  action,
}: {
  number: string;
  stage: AccountingSyncStage;
  action?: AccountingProviderAction;
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
      <SurfacePanel
        tone="background"
        padding="sm"
        className={cn(
          "flex items-center justify-between gap-(--space-8)",
          stage.state === "skipped" && "opacity-70"
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-(--space-4)">
            <p className="text-[length:var(--text-sm)] font-medium">{stage.label}</p>
            <SyncBadge state={stage.state} />
          </div>
          {stage.detail ? (
            <p className="mt-(--space-2) break-words text-[length:var(--text-sm)] text-muted-foreground">{stage.detail}</p>
          ) : null}
          {action ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-(--space-4)"
              onClick={() => {
                if (action.href) {
                  window.open(action.href, "_blank", "noopener,noreferrer");
                  return;
                }
                action.onClick?.();
              }}
              disabled={action.pending}
            >
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} data-icon="inline-start" />
              {action.pending ? "Opening..." : action.label}
            </Button>
          ) : null}
        </div>
        <StatusIcon state={stage.state} />
      </SurfacePanel>
    </div>
  );
}

function buildPushStage(
  document: AccountingSyncDocument,
  label: string,
  timeZone: string
): AccountingSyncStage {
  if (document.pushStatus === "pushed") {
    return {
      id: "push",
      label,
      detail: document.documentNumber
        ? `${document.documentNumber}${document.pushedAt ? ` · ${formatDateTimeLabel(document.pushedAt, timeZone)}` : ""}`
        : document.pushedAt
          ? formatDateTimeLabel(document.pushedAt, timeZone)
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
  pushState: AccountingSyncStageState,
  timeZone: string
): AccountingSyncStage {
  if (
    pushState === "failed" ||
    pushState === "waiting" ||
    pushState === "skipped" ||
    pushState === "active"
  ) {
    return {
      id: "email",
      label,
      detail: null,
      state: pushState === "skipped" ? "skipped" : "waiting",
    };
  }

  if (document.emailStatus === "sent") {
    return {
      id: "email",
      label,
      detail: [
        `Accepted by ${document.emailProviderName}`,
        document.recipientEmail ? `To ${document.recipientEmail}` : `To ${document.recipientLabel}`,
        document.emailedAt ? formatDateTimeLabel(document.emailedAt, timeZone) : null,
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

function StatusLine({ stage }: { stage: AccountingSyncStage }) {
  return (
    <SurfacePanel tone="background" padding="sm" className="flex gap-(--space-6)">
      <StatusIcon state={stage.state} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-(--space-4)">
          <p className="text-[length:var(--text-sm)] font-medium">{stage.label}</p>
          <SyncBadge state={stage.state} />
        </div>
        {stage.detail ? (
          <p className="mt-(--space-2) break-words text-[length:var(--text-xs)] text-muted-foreground">{stage.detail}</p>
        ) : null}
      </div>
    </SurfacePanel>
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
        "mt-(--space-1) shrink-0 text-muted-foreground",
        state === "active" && "animate-spin",
        state === "failed" && "text-destructive",
        state === "success" && "text-primary"
      )}
    />
  );
}

function SyncBadge({ state }: { state: AccountingSyncStageState }) {
  return <ConfiguredBadge value={state} config={syncBadgeConfig} />;
}
