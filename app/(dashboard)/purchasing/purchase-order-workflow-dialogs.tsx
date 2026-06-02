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
  to: string;
  replyTo: string;
  bcc: string;
  subject: string;
  message: string;
};

export type PurchaseBillDialogValues = {
  invoiceNumber: string;
  billDate: string;
  dueDate: string;
  accountingPurchaseAccountCode: string;
  confirmAdditionalCostsOmitted: boolean;
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
  onSend,
}: PurchaseOrderEmailDialogProps) {
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
            <Field>
              <FieldLabel htmlFor="po-email-to" className="text-destructive">
                Send to
              </FieldLabel>
              <Input
                id="po-email-to"
                className="border-x-0 border-t-0 border-destructive px-0 shadow-none focus-visible:shadow-none"
                value={values.to}
                onChange={(event) =>
                  onValuesChange({ ...values, to: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="po-email-reply-to">Reply to</FieldLabel>
              <Input
                id="po-email-reply-to"
                className="border-x-0 border-t-0 px-0 shadow-none focus-visible:shadow-none"
                value={values.replyTo}
                onChange={(event) =>
                  onValuesChange({ ...values, replyTo: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="po-email-subject">Subject</FieldLabel>
              <Input
                id="po-email-subject"
                className="border-x-0 border-t-0 px-0 shadow-none focus-visible:shadow-none"
                value={values.subject}
                onChange={(event) =>
                  onValuesChange({ ...values, subject: event.target.value })
                }
              />
            </Field>
            <Field>
              <div className="border">
                <FieldLabel
                  htmlFor="po-email-message"
                  className="border-b bg-muted/40 px-3 py-2"
                >
                  Email body
                </FieldLabel>
                <Textarea
                  id="po-email-message"
                  rows={12}
                  className="min-h-72 resize-none border-0 shadow-none focus-visible:shadow-none"
                  value={values.message}
                  onChange={(event) =>
                    onValuesChange({ ...values, message: event.target.value })
                  }
                />
              </div>
            </Field>
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
              values.to.trim() === "" ||
              values.subject.trim() === ""
            }
          >
            {pending ? "Sending..." : "Send"}
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
  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Create {providerLabel} bill</DialogTitle>
          <DialogDescription>
            Creates a supplier bill in {providerLabel} for all purchase order lines.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="purchase-bill-invoice-number">
              Supplier invoice number
            </FieldLabel>
            <Input
              id="purchase-bill-invoice-number"
              value={values.invoiceNumber}
              onChange={(event) =>
                onValuesChange({ ...values, invoiceNumber: event.target.value })
              }
            />
          </Field>
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
          <Field>
            <FieldLabel htmlFor="purchase-bill-account">Default account</FieldLabel>
            <Input
              id="purchase-bill-account"
              list="purchase-bill-xero-accounts"
              value={values.accountingPurchaseAccountCode}
              onChange={(event) =>
                onValuesChange({
                  ...values,
                  accountingPurchaseAccountCode: event.target.value,
                })
              }
            />
            <datalist id="purchase-bill-xero-accounts">
              {xeroAccounts.map((account) => (
                <option key={account.code} value={account.code}>
                  {xeroAccountLabel(account.code, xeroAccounts)}
                </option>
              ))}
            </datalist>
          </Field>
          {hasAdditionalCosts ? (
            <label className="flex items-start gap-3 border bg-muted/30 p-3 text-sm">
              <Checkbox
                checked={values.confirmAdditionalCostsOmitted}
                onCheckedChange={(checked) =>
                  onValuesChange({
                    ...values,
                    confirmAdditionalCostsOmitted: checked === true,
                  })
                }
              />
              <span>
                This PO has {formatPrice(additionalCostTotal) ?? "$0.00"} in
                additional costs. These affect ERP costing but are not sent to
                Xero in v1.
              </span>
            </label>
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
              values.invoiceNumber.trim() === "" ||
              values.accountingPurchaseAccountCode.trim() === "" ||
              (hasAdditionalCosts && !values.confirmAdditionalCostsOmitted)
            }
          >
            {pending ? "Creating..." : "Create bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
