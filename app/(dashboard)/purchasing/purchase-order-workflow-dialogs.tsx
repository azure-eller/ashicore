"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
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
  deletePending?: boolean;
  fileError?: string | null;
  onValuesChange: (values: PurchaseOrderEmailDialogValues) => void;
  onOpenChange: (open: boolean) => void;
  onAddDocuments?: () => void;
  onDeleteDocument?: (fileId: string) => void;
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

export function PurchaseOrderEmailDialog({
  open,
  orderId,
  orderNumber,
  attachments = [],
  values,
  error,
  pending = false,
  uploadPending = false,
  deletePending = false,
  fileError,
  onValuesChange,
  onOpenChange,
  onAddDocuments = () => {},
  onDeleteDocument = () => {},
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
    },
  ];
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
  const selectedCount = groups.filter((group) => group.include).length;

  return (
    <Sheet open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-[min(100vw,48rem)] data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="px-8 pb-4 pt-8">
          <SheetTitle>Send documents for {orderNumber ?? "purchase order"}</SheetTitle>
          <SheetDescription className="sr-only">
            Send the purchase order PDF and attachments to the supplier.
          </SheetDescription>
        </SheetHeader>
        {orderId ? (
          <div className="grid flex-1 content-start gap-7 overflow-y-auto px-8 pb-8">
            {groups.map((group, index) => (
              <div key={group.groupKey} className="grid gap-4 border p-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-3 text-sm font-medium">
                    <Checkbox
                      checked={group.include}
                      onCheckedChange={(checked) =>
                        updateGroup(index, { include: checked === true })
                      }
                    />
                    {group.label}
                  </label>
                  {group.status === "sent" ? (
                    <span className="text-xs text-muted-foreground">
                      Sent{group.sentAt ? ` ${new Date(group.sentAt).toLocaleString()}` : ""}
                    </span>
                  ) : null}
                </div>
                <Field>
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel
                      htmlFor={`po-email-to-${group.groupKey}`}
                      className="text-destructive"
                    >
                      Send to
                    </FieldLabel>
                    {onSaveRecipientEmail && group.supplierId ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
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
                    className="border-x-0 border-t-0 border-destructive px-0 shadow-none focus-visible:shadow-none"
                    value={group.to}
                    onChange={(event) => updateGroup(index, { to: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`po-email-reply-to-${group.groupKey}`}>
                    Reply to
                  </FieldLabel>
                  <Input
                    id={`po-email-reply-to-${group.groupKey}`}
                    className="border-x-0 border-t-0 px-0 shadow-none focus-visible:shadow-none"
                    value={group.replyTo}
                    onChange={(event) =>
                      updateGroup(index, { replyTo: event.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`po-email-subject-${group.groupKey}`}>
                    Subject
                  </FieldLabel>
                  <Input
                    id={`po-email-subject-${group.groupKey}`}
                    className="border-x-0 border-t-0 px-0 shadow-none focus-visible:shadow-none"
                    value={group.subject}
                    onChange={(event) =>
                      updateGroup(index, { subject: event.target.value })
                    }
                  />
                </Field>
                <Field>
                  <div className="border">
                    <FieldLabel
                      htmlFor={`po-email-message-${group.groupKey}`}
                      className="border-b bg-muted/40 px-3 py-2"
                    >
                      Email body
                    </FieldLabel>
                    <Textarea
                      id={`po-email-message-${group.groupKey}`}
                      rows={8}
                      className="min-h-52 resize-none border-0 shadow-none focus-visible:shadow-none"
                      value={group.message}
                      onChange={(event) =>
                        updateGroup(index, { message: event.target.value })
                      }
                    />
                  </div>
                </Field>
              </div>
            ))}
            <div className="grid gap-2">
              <p className="text-sm font-medium">Documents</p>
              <div className="divide-y border">
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{orderNumber ?? "Purchase order"}.pdf</span>
                  <span className="text-xs text-muted-foreground">Generated PDF</span>
                </div>
                {attachments.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{file.filename}</span>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
                      aria-label={`Remove ${file.filename}`}
                      onClick={() => onDeleteDocument(file.id)}
                      disabled={deletePending || pending}
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    className="w-fit"
                    disabled={uploadPending || pending}
                  >
                    <HugeiconsIcon icon={Add01Icon} size={16} />
                    Add documents
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-72">
                  <DropdownMenuItem disabled>
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
                    Purchase order
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <HugeiconsIcon icon={File01Icon} size={16} />
                    Purchase order, received in parts
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <HugeiconsIcon icon={File01Icon} size={16} />
                    Request for quote
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <HugeiconsIcon icon={File01Icon} size={16} />
                    Put-away list
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onAddDocuments}>
                    <HugeiconsIcon icon={Upload01Icon} size={16} />
                    Custom attachment
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {fileError ? <FieldError>{fileError}</FieldError> : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </div>
        ) : null}
        <SheetFooter className="mt-auto flex-row justify-end border-t px-8 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={onSend}
            disabled={
              pending ||
              selectedCount === 0 ||
              groups.some(
                (group) =>
                  group.include &&
                  (group.to.trim() === "" || group.subject.trim() === ""),
              )
            }
          >
            {pending ? "Sending..." : `Send selected (${selectedCount})`}
          </Button>
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
  const selectedGroups = groups.filter((group) => group.include);

  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Create {providerLabel} bill</DialogTitle>
          <DialogDescription>
            Creates selected supplier bills in {providerLabel}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="purchase-bill-date">Bill date</FieldLabel>
              <DatePicker
                id="purchase-bill-date"
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
          {groups.map((group, index) => (
            <div key={group.groupKey} className="grid gap-4 border p-4">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-3 text-sm font-medium">
                  <Checkbox
                    checked={group.include}
                    onCheckedChange={(checked) =>
                      updateGroup(index, { include: checked === true })
                    }
                  />
                  {group.label}
                </label>
                <span className="text-xs text-muted-foreground">
                  {group.status === "pushed"
                    ? `Billed${group.externalNumber ? ` ${group.externalNumber}` : ""}`
                    : formatPrice(group.amount) ?? "$0.00"}
                </span>
              </div>
              <Field>
                <FieldLabel htmlFor={`purchase-bill-invoice-${group.groupKey}`}>
                  Supplier invoice number
                </FieldLabel>
                <Input
                  id={`purchase-bill-invoice-${group.groupKey}`}
                  value={group.invoiceNumber}
                  onChange={(event) =>
                    updateGroup(index, { invoiceNumber: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`purchase-bill-account-${group.groupKey}`}>
                  Bill account
                </FieldLabel>
                <Input
                  id={`purchase-bill-account-${group.groupKey}`}
                  list="purchase-bill-xero-accounts"
                  value={group.accountingPurchaseAccountCode}
                  onChange={(event) =>
                    updateGroup(index, {
                      accountingPurchaseAccountCode: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
          ))}
          {hasAdditionalCosts && groups.length === 1 ? (
            <p className="text-xs text-muted-foreground">
              Additional costs total {formatPrice(additionalCostTotal) ?? "$0.00"}.
            </p>
          ) : null}
          {error ? <FieldError>{error}</FieldError> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onCreate}
            disabled={
              pending ||
              selectedGroups.length === 0 ||
              selectedGroups.some(
                (group) =>
                  group.invoiceNumber.trim() === "" ||
                  group.accountingPurchaseAccountCode.trim() === "",
              )
            }
          >
            {pending ? "Creating..." : `Create selected (${selectedGroups.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
