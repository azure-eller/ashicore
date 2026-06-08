"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  Attachment01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  File01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";

export type XeroAccountOption = {
  code: string;
  name: string;
  type: string | null;
  class: string | null;
};

export type PurchaseOrderEmailDialogValues = {
  groups?: PurchaseOrderEmailDialogGroupValues[];
  to: string;
  replyTo: string;
  bcc: string;
  subject: string;
  message: string;
};

export type PurchaseOrderEmailDialogGroupValues = {
  groupKey: string;
  supplierId: string;
  label: string;
  include: boolean;
  isFreight: boolean;
  to: string;
  replyTo: string;
  bcc: string;
  subject: string;
  message: string;
  includePdf: boolean;
  attachmentFileIds: string[];
  sentAt?: Date | string | null;
  status?: "sent" | "failed" | "skipped" | "pending" | null;
};

export type PurchaseBillDialogValues = {
  groups?: PurchaseBillDialogGroupValues[];
  invoiceNumber: string;
  billDate: string;
  dueDate: string;
  accountingPurchaseAccountCode: string;
  confirmAdditionalCostsOmitted: boolean;
};

export type PurchaseBillDialogGroupValues = {
  groupKey: string;
  label: string;
  include: boolean;
  invoiceNumber: string;
  accountingPurchaseAccountCode: string;
  amount: string;
  additionalCostIds?: string[];
  pushedAt?: Date | string | null;
  status?: "pending" | "pushed" | "failed" | null;
  externalNumber?: string | null;
};

type PurchaseOrderEmailDialogProps = {
  open: boolean;
  orderId: string | null;
  orderNumber: string | null;
  attachments?: {
    id: string;
    filename: string;
  }[];
  values: PurchaseOrderEmailDialogValues;
  error?: string | null;
  pending?: boolean;
  uploadPending?: boolean;
  fileError?: string | null;
  onValuesChange: (values: PurchaseOrderEmailDialogValues) => void;
  onOpenChange: (open: boolean) => void;
  onAddDocuments?: (groupKey: string) => void;
  onRemoveDocument?: (groupKey: string, fileId: string) => void;
  onSaveRecipientEmail?: (groupKey: string, supplierId: string, email: string) => void;
  onSend: () => void;
};

type PurchaseBillDialogProps = {
  open: boolean;
  values: PurchaseBillDialogValues;
  hasAdditionalCosts: boolean;
  additionalCostTotal: string;
  xeroAccounts?: XeroAccountOption[];
  providerLabel?: string;
  error?: string | null;
  pending?: boolean;
  onValuesChange: (values: PurchaseBillDialogValues) => void;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
};

export function xeroAccountLabel(
  code: string,
  accounts: XeroAccountOption[] = [],
) {
  const account = accounts.find((row) => row.code === code);
  if (!account) return code;
  const metadata = [account.type, account.class].filter(Boolean).join(" · ");
  return `${account.code} - ${account.name}${metadata ? ` (${metadata})` : ""}`;
}

function AttachmentChip({
  href,
  filename,
  onRemove,
  disabled,
}: {
  href: string;
  filename: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex h-(--height-input-sm) max-w-full items-center gap-(--space-2) rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-alt)] px-(--space-3) font-mono text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink)]">
      <HugeiconsIcon
        icon={Attachment01Icon}
        size={12}
        className="shrink-0 text-muted-foreground"
      />
      <a
        className="min-w-0 truncate hover:text-[var(--color-accent-ink)]"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {filename}
      </a>
      <button
        type="button"
        className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] disabled:opacity-50"
        aria-label={`Remove ${filename}`}
        onClick={onRemove}
        disabled={disabled}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} />
      </button>
    </span>
  );
}

export function PurchaseOrderEmailDialog({
  open,
  orderId,
  orderNumber,
  attachments = [],
  values,
  error,
  pending = false,
  uploadPending = false,
  fileError,
  onValuesChange,
  onOpenChange,
  onAddDocuments = () => {},
  onRemoveDocument = () => {},
  onSaveRecipientEmail,
  onSend,
}: PurchaseOrderEmailDialogProps) {
  const groups = values.groups ?? [
    {
      groupKey: "default",
      supplierId: "",
      label: "Purchase order",
      include: true,
      isFreight: false,
      to: values.to,
      replyTo: values.replyTo,
      bcc: values.bcc,
      subject: values.subject,
      message: values.message,
      includePdf: true,
      attachmentFileIds: attachments.map((file) => file.id),
    },
  ];
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setExpandedGroupKeys(new Set());
    }
    onOpenChange(nextOpen);
  };
  const updateGroup = (
    index: number,
    patch: Partial<PurchaseOrderEmailDialogGroupValues>,
  ) => {
    const nextGroups = groups.map((group, currentIndex) =>
      currentIndex === index ? { ...group, ...patch } : group,
    );
    const first = nextGroups[0];
    onValuesChange({
      ...values,
      groups: nextGroups,
      to: first?.to ?? "",
      replyTo: first?.replyTo ?? "",
      bcc: first?.bcc ?? "",
      subject: first?.subject ?? "",
      message: first?.message ?? "",
    });
  };
  const toggleExpanded = (groupKey: string) => {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };
  const setGroupIncluded = (
    index: number,
    groupKey: string,
    included: boolean,
  ) => {
    updateGroup(index, { include: included });
    if (!included) {
      // Excluded cards collapse as well as dim.
      setExpandedGroupKeys((current) => {
        if (!current.has(groupKey)) return current;
        const next = new Set(current);
        next.delete(groupKey);
        return next;
      });
    }
  };
  const selectedCount = groups.filter((group) => group.include).length;
  const selectedGroupsMissingDocuments = groups.some(
    (group) =>
      group.include &&
      group.includePdf === false &&
      (group.attachmentFileIds?.length ?? 0) === 0,
  );

  return (
    <Sheet open={open} onOpenChange={pending ? undefined : handleOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 overflow-hidden bg-[var(--color-surface)] p-0 data-[side=right]:w-[min(100vw,560px)] data-[side=right]:sm:max-w-[560px]"
      >
        <SheetHeader className="gap-(--space-2) border-b border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-8) pb-(--space-6) pt-(--space-8)">
          <SheetTitle className="text-[length:var(--text-xl)] leading-[var(--leading-lg)]">
            Send documents for {orderNumber ?? "purchase order"}
          </SheetTitle>
          <SheetDescription>
            Emails each supplier their copy of the order.
          </SheetDescription>
        </SheetHeader>
        {orderId ? (
          <div className="grid flex-1 content-start gap-(--space-4) overflow-y-auto bg-[var(--color-surface)] px-(--space-8) py-(--space-6)">
            {groups.map((group, index) => {
              const expanded = expandedGroupKeys.has(group.groupKey);
              const pdfFileName = group.isFreight
                ? `${orderNumber ?? "Purchase order"}-${group.label}.pdf`
                : `${orderNumber ?? "Purchase order"}.pdf`;
              const selectedAttachments = (group.attachmentFileIds ?? [])
                .map((fileId) => attachments.find((file) => file.id === fileId))
                .filter((file): file is { id: string; filename: string } =>
                  Boolean(file),
                );
              const includePdf = group.includePdf !== false;
              const documentCount =
                (includePdf ? 1 : 0) + selectedAttachments.length;
              const recipientLabel = group.to.trim() || "Missing email";
              const subjectLabel = group.subject.trim() || "Missing subject";
              const availableAttachments = attachments.filter(
                (file) => !(group.attachmentFileIds ?? []).includes(file.id),
              );

              return (
                <div
                  key={group.groupKey}
                  className={cn(
                    "overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]",
                    group.include ? null : "opacity-55",
                  )}
                >
                  <div className="flex items-center gap-(--space-4) p-(--space-5)">
                    <Checkbox
                      aria-label={`Include ${group.label}`}
                      checked={group.include}
                      onCheckedChange={(checked) =>
                        setGroupIncluded(index, group.groupKey, checked === true)
                      }
                    />
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleExpanded(group.groupKey)}
                      className="flex min-w-0 flex-1 items-center gap-(--space-4) text-left outline-none focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)]"
                    >
                      {expanded ? (
                        <div className="flex min-w-0 flex-1 items-center gap-(--space-3) text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)]">
                          <span className="truncate">{group.label}</span>
                          {group.isFreight ? (
                            <Badge variant="secondary">Freight</Badge>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center gap-(--space-3) text-[length:var(--text-sm)]">
                          <span
                            className={cn(
                              "shrink-0 font-semibold text-[var(--color-ink)]",
                              group.to.trim() ? null : "text-[var(--status-danger-ink)]",
                            )}
                          >
                            {recipientLabel}
                          </span>
                          <span className="size-(--space-2) shrink-0 rounded-full bg-[var(--color-line)]" />
                          <span className="truncate text-[var(--color-ink-faint)]">
                            {subjectLabel}
                          </span>
                        </div>
                      )}
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]",
                          documentCount === 0 ? "text-[var(--status-danger-ink)]" : null,
                        )}
                      >
                        {documentCount} doc{documentCount === 1 ? "" : "s"}
                      </span>
                      {group.status === "sent" ? (
                        <span className="shrink-0 text-[length:var(--text-xs)] text-muted-foreground">
                          Sent
                          {group.sentAt
                            ? ` ${new Date(group.sentAt).toLocaleDateString()}`
                            : ""}
                        </span>
                      ) : null}
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        size={16}
                        className={cn(
                          "shrink-0 text-muted-foreground transition-transform",
                          expanded ? "rotate-180" : null,
                        )}
                      />
                    </button>
                  </div>

                  {expanded ? (
                    <div className="grid gap-2 px-4 pb-4">
                      <p className="font-mono text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)]">
                        Attachments
                      </p>
                      <div className="flex flex-wrap items-center gap-(--space-3)">
                        {includePdf ? (
                          <AttachmentChip
                            href={`/api/purchase-orders/${orderId}/pdf?groupKey=${encodeURIComponent(group.groupKey)}`}
                            filename={pdfFileName}
                            onRemove={() =>
                              updateGroup(index, { includePdf: false })
                            }
                            disabled={pending}
                          />
                        ) : null}
                        {selectedAttachments.map((file) => (
                          <AttachmentChip
                            key={file.id}
                            href={`/api/purchase-orders/${orderId}/files/${file.id}`}
                            filename={file.filename}
                            onRemove={() =>
                              onRemoveDocument(group.groupKey, file.id)
                            }
                            disabled={pending}
                          />
                        ))}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-xs"
                              className="rounded-[var(--radius-md)]"
                              aria-label={`Add documents to ${group.label}`}
                              disabled={uploadPending || pending}
                            >
                              <HugeiconsIcon icon={Add01Icon} size={15} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="min-w-72">
                            {!includePdf ? (
                              <DropdownMenuItem
                                onSelect={() =>
                                  updateGroup(index, { includePdf: true })
                                }
                              >
                                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
                                Add PO
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem disabled>
                              <HugeiconsIcon icon={File01Icon} size={16} />
                              Request for quote
                            </DropdownMenuItem>
                            {availableAttachments.map((file) => (
                              <DropdownMenuItem
                                key={file.id}
                                onSelect={() =>
                                  updateGroup(index, {
                                    attachmentFileIds: [
                                      ...(group.attachmentFileIds ?? []),
                                      file.id,
                                    ],
                                  })
                                }
                              >
                                <HugeiconsIcon icon={File01Icon} size={16} />
                                {file.filename}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuItem
                              onSelect={() => onAddDocuments(group.groupKey)}
                            >
                              <HugeiconsIcon icon={Upload01Icon} size={16} />
                              Custom attachment
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {documentCount === 0 ? (
                        <p className="text-[length:var(--text-xs)] text-muted-foreground">
                          No documents selected
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {expanded ? (
                    <div className="grid gap-(--space-5) border-t border-[var(--color-line-soft)] bg-[var(--color-surface)] p-(--space-5)">
                      <Field>
                        <div className="flex items-center justify-between gap-3">
                          <FieldLabel htmlFor={`po-email-to-${group.groupKey}`}>
                            To
                          </FieldLabel>
                          {onSaveRecipientEmail && group.supplierId ? (
                            <button
                              type="button"
                              className="text-[length:var(--text-xs)] text-muted-foreground hover:text-foreground disabled:opacity-50"
                              disabled={group.to.trim() === "" || pending}
                              onClick={() =>
                                onSaveRecipientEmail(
                                  group.groupKey,
                                  group.supplierId,
                                  group.to,
                                )
                              }
                            >
                              Save email
                            </button>
                          ) : null}
                        </div>
                        <Input
                          id={`po-email-to-${group.groupKey}`}
                          className="rounded-[var(--radius-md)]"
                          value={group.to}
                          onChange={(event) =>
                            updateGroup(index, { to: event.target.value })
                          }
                        />
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor={`po-email-bcc-${group.groupKey}`}>
                            BCC
                          </FieldLabel>
                          <Input
                            id={`po-email-bcc-${group.groupKey}`}
                            className="rounded-[var(--radius-md)]"
                            value={group.bcc}
                            onChange={(event) =>
                              updateGroup(index, { bcc: event.target.value })
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel
                            htmlFor={`po-email-reply-to-${group.groupKey}`}
                          >
                            Reply-to
                          </FieldLabel>
                          <Input
                            id={`po-email-reply-to-${group.groupKey}`}
                            className="rounded-[var(--radius-md)]"
                            value={group.replyTo}
                            onChange={(event) =>
                              updateGroup(index, { replyTo: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                      <Field>
                        <FieldLabel htmlFor={`po-email-subject-${group.groupKey}`}>
                          Subject
                        </FieldLabel>
                        <Input
                          id={`po-email-subject-${group.groupKey}`}
                          className="rounded-[var(--radius-md)]"
                          value={group.subject}
                          onChange={(event) =>
                            updateGroup(index, { subject: event.target.value })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`po-email-message-${group.groupKey}`}>
                          Body
                        </FieldLabel>
                        <Textarea
                          id={`po-email-message-${group.groupKey}`}
                          rows={8}
                          className="min-h-32 resize-none rounded-[var(--radius-md)]"
                          value={group.message}
                          onChange={(event) =>
                            updateGroup(index, { message: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {fileError ? <FieldError>{fileError}</FieldError> : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </div>
        ) : null}
        <SheetFooter className="mt-auto flex-row items-center justify-between border-t border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-8) py-(--space-5)">
          <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
            {selectedCount} of {groups.length} selected
          </span>
          <div className="flex items-center gap-(--space-3)">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onSend}
              disabled={
                pending ||
                selectedCount === 0 ||
                selectedGroupsMissingDocuments ||
                groups.some(
                  (group) =>
                    group.include &&
                    (group.to.trim() === "" || group.subject.trim() === ""),
                )
              }
            >
              {pending
                ? "Sending..."
                : `Send ${selectedCount} email${selectedCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function PurchaseBillDialog({
  open,
  values,
  hasAdditionalCosts,
  additionalCostTotal,
  xeroAccounts = [],
  providerLabel = "Xero",
  error,
  pending = false,
  onValuesChange,
  onOpenChange,
  onCreate,
}: PurchaseBillDialogProps) {
  const groups = values.groups ?? [
    {
      groupKey: "default",
      label: "Purchase order",
      include: true,
      invoiceNumber: values.invoiceNumber,
      accountingPurchaseAccountCode: values.accountingPurchaseAccountCode,
      amount: "",
      additionalCostIds: [],
    },
  ];
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setExpandedGroupKeys(new Set());
    }
    onOpenChange(nextOpen);
  };
  const updateGroup = (
    index: number,
    patch: Partial<PurchaseBillDialogGroupValues>,
  ) => {
    const nextGroups = groups.map((group, currentIndex) =>
      currentIndex === index ? { ...group, ...patch } : group,
    );
    const first = nextGroups[0];
    onValuesChange({
      ...values,
      groups: nextGroups,
      invoiceNumber: first?.invoiceNumber ?? "",
      accountingPurchaseAccountCode:
        first?.accountingPurchaseAccountCode ?? "",
    });
  };
  const toggleExpanded = (groupKey: string) => {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };
  const setGroupIncluded = (
    index: number,
    groupKey: string,
    included: boolean,
  ) => {
    updateGroup(index, { include: included });
    if (!included) {
      // Excluded cards collapse as well as dim.
      setExpandedGroupKeys((current) => {
        if (!current.has(groupKey)) return current;
        const next = new Set(current);
        next.delete(groupKey);
        return next;
      });
    }
  };
  const isAccountValid = (code: string) =>
    code.trim() !== "" &&
    (xeroAccounts.length === 0 ||
      xeroAccounts.some((account) => account.code === code));
  const selectedGroups = groups.filter((group) => group.include);
  const selectedCount = selectedGroups.length;
  const incompleteCount = selectedGroups.filter(
    (group) =>
      group.invoiceNumber.trim() === "" ||
      !isAccountValid(group.accountingPurchaseAccountCode),
  ).length;

  return (
    <Sheet open={open} onOpenChange={pending ? undefined : handleOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 overflow-hidden bg-[var(--color-surface)] p-0 data-[side=right]:w-[min(100vw,560px)] data-[side=right]:sm:max-w-[560px]"
      >
        <SheetHeader className="gap-(--space-2) border-b border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-8) pb-(--space-6) pt-(--space-8)">
          <SheetTitle className="text-[length:var(--text-xl)] leading-[var(--leading-lg)]">
            Create {providerLabel} bills
          </SheetTitle>
          <SheetDescription>
            Pushes selected supplier bills to {providerLabel}.
          </SheetDescription>
        </SheetHeader>
        <div className="grid flex-1 content-start gap-(--space-5) overflow-y-auto bg-[var(--color-surface)] px-(--space-8) py-(--space-6)">
          <div className="grid gap-(--space-4) sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="purchase-bill-date">Bill date</FieldLabel>
              <DatePicker
                id="purchase-bill-date"
                className="rounded-[var(--radius-md)]"
                value={values.billDate}
                onChange={(value) =>
                  onValuesChange({ ...values, billDate: value || values.billDate })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="purchase-bill-due-date">Due date</FieldLabel>
              <DatePicker
                id="purchase-bill-due-date"
                className="rounded-[var(--radius-md)]"
                value={values.dueDate}
                onChange={(value) =>
                  onValuesChange({ ...values, dueDate: value || values.dueDate })
                }
              />
            </Field>
          </div>
          <datalist id="purchase-bill-xero-accounts">
            {xeroAccounts.map((account) => (
              <option key={account.code} value={account.code}>
                {xeroAccountLabel(account.code, xeroAccounts)}
              </option>
            ))}
          </datalist>
          <div className="grid gap-(--space-4)">
            {groups.map((group, index) => {
              const expanded = expandedGroupKeys.has(group.groupKey);
              const account = xeroAccounts.find(
                (option) => option.code === group.accountingPurchaseAccountCode,
              );
              const accountSummary = group.accountingPurchaseAccountCode
                ? `Account ${account ? `${account.code} — ${account.name}` : group.accountingPurchaseAccountCode}`
                : "Choose account";
              const invoice = group.invoiceNumber.trim();
              const pushed = group.status === "pushed";

              return (
                <div
                  key={group.groupKey}
                  className={cn(
                    "overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]",
                    group.include ? null : "opacity-55",
                  )}
                >
                  <div className="flex items-center gap-(--space-4) p-(--space-5)">
                    <Checkbox
                      aria-label={`Include ${group.label}`}
                      checked={group.include}
                      onCheckedChange={(checked) =>
                        setGroupIncluded(index, group.groupKey, checked === true)
                      }
                    />
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleExpanded(group.groupKey)}
                      className="flex min-w-0 flex-1 items-center gap-(--space-4) text-left outline-none focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)]"
                    >
                      <div className="grid min-w-0 flex-1 gap-(--space-1)">
                        <span className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)]">
                          {group.label}
                        </span>
                        <span className="truncate font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                          {accountSummary}
                          {invoice ? ` · Inv ${invoice}` : ""}
                          {pushed && group.externalNumber
                            ? ` · Billed ${group.externalNumber}`
                            : ""}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-[length:var(--text-sm)] font-semibold tabular-nums text-[var(--color-ink)]">
                        {formatPrice(group.amount) ?? "$0.00"}
                      </span>
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        size={16}
                        className={cn(
                          "shrink-0 text-muted-foreground transition-transform",
                          expanded ? "rotate-180" : null,
                        )}
                      />
                    </button>
                  </div>

                  {expanded ? (
                    <div className="grid gap-(--space-5) border-t border-[var(--color-line-soft)] bg-[var(--color-surface)] p-(--space-5)">
                      <Field>
                        <FieldLabel
                          htmlFor={`purchase-bill-invoice-${group.groupKey}`}
                        >
                          Supplier invoice number
                        </FieldLabel>
                        <Input
                          id={`purchase-bill-invoice-${group.groupKey}`}
                          placeholder="e.g. INV-2043"
                          className="rounded-[var(--radius-md)]"
                          value={group.invoiceNumber}
                          onChange={(event) =>
                            updateGroup(index, {
                              invoiceNumber: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel
                          htmlFor={`purchase-bill-account-${group.groupKey}`}
                        >
                          Bill account
                        </FieldLabel>
                        <Input
                          id={`purchase-bill-account-${group.groupKey}`}
                          list="purchase-bill-xero-accounts"
                          placeholder="e.g. 310 — Cost of goods"
                          className="rounded-[var(--radius-md)]"
                          value={group.accountingPurchaseAccountCode}
                          onChange={(event) =>
                            updateGroup(index, {
                              accountingPurchaseAccountCode: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {hasAdditionalCosts && groups.length === 1 ? (
            <p className="text-[length:var(--text-xs)] text-muted-foreground">
              Additional costs total {formatPrice(additionalCostTotal) ?? "$0.00"}.
            </p>
          ) : null}
          {error ? <FieldError>{error}</FieldError> : null}
        </div>
        <SheetFooter className="mt-auto flex-row items-center justify-between border-t border-[var(--color-line)] bg-[var(--color-surface)] px-(--space-8) py-(--space-5)">
          <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
            {incompleteCount > 0
              ? `${incompleteCount} bill${incompleteCount === 1 ? "" : "s"} need an invoice & account`
              : `${selectedCount} of ${groups.length} selected`}
          </span>
          <div className="flex items-center gap-(--space-3)">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onCreate}
              disabled={
                pending || selectedCount === 0 || incompleteCount > 0
              }
            >
              {pending
                ? "Pushing..."
                : `Push ${selectedCount} to ${providerLabel}`}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
