"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Call02Icon,
  Cancel01Icon,
  Delete02Icon,
  Folder01Icon,
  Mail01Icon,
  StarIcon,
  StickyNote02Icon,
  Tick02Icon,
  UserIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { AddressBookFields } from "@/components/address-book-fields";
import { EmptyState } from "@/components/empty-state";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
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
import { FieldError } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import {
  CardPage,
  CardPageBody,
  CardSection,
} from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import {
  CardField,
  CardSelectField,
  CardTextField,
} from "@/components/card-page/card-field";
import {
  CardFormRow,
  ReadOnlyFieldValue,
  underlineControlClass,
} from "@/components/card-page/form-cell";
import { CommitInput } from "@/components/card-page/commit-input";
import { NotesField } from "@/components/card-page/notes-field";
import { ListFrameItem } from "@/components/list-frame";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import {
  cardSaveMutationKey,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import {
  createAddressEntry,
  createCustomer,
  createCustomerContact,
  createCustomerActivity,
  createCustomerProject,
  deleteCustomerActivity,
  patchCustomerActivity,
  deleteCustomer,
  deleteCustomerContact,
  getCustomerCard,
  patchCustomer,
  updateAddressEntry,
  updateCustomerContact,
} from "@/lib/api/clients/customers";
import { makeUniqueAddressLabel } from "@/lib/address-label";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import type { AddressEntry } from "@/lib/dal/addresses";
import {
  addressEntryToAddressOption,
  type AddressEntryOption,
} from "@/lib/address-entry-options";
import {
  addressKey,
  emptyAddressFields,
  formatAddressInline,
  formatDate,
  formatPrice,
  isAddressBlank,
  normalizeAddressFields,
  toDateOnlyString,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";
import {
  customerDefaultValues,
  type InsertCustomer,
  type PatchCustomer,
} from "@/lib/schemas/customers";
import type {
  CustomerActivityRow,
  CustomerActivityType,
  CustomerCategoryOption,
  CustomerContactRole,
  CustomerContactRow,
  CustomerDetailData,
  CustomerLinkedSalesOrderRow,
  CustomerProjectRow,
} from "@/lib/sales/types";
import { SalesOrderStatusBadge } from "./status-badge";
import styles from "@/components/card-page/card-page.module.css";

type CustomerCardProps = {
  initialCustomerId: string | null;
  initialCustomer: CustomerDetailData | null;
  addresses: AddressEntry[];
  categories: CustomerCategoryOption[];
};

type ContactGridRow = CustomerContactRow & { isNew?: boolean };
type OpenOrderGridRow = CustomerLinkedSalesOrderRow;
type CustomerDraftOp =
  | { type: "patch"; patch: PatchCustomer }
  | { type: "upsertContact"; row: ContactGridRow }
  | { type: "deleteContact"; contactId: string }
;
type AddressTarget = "billing" | "shipping";
type CustomerAddressFields = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};
type CustomerAddressOption = AddressEntryOption;
type AddressDialogValues = z.input<typeof createAddressEntrySchema>;
type AddressDialogState = {
  target: AddressTarget;
  option: CustomerAddressOption | null;
};

const addAddressValue = "__add_address__";
const editAddressValue = "__edit_address__";
const sameAsShippingValue = "__same_as_shipping__";
const addressFieldNames = {
  line1: "line1",
  line2: "line2",
  city: "city",
  region: "region",
  postcode: "postcode",
  country: "country",
} as const;
const emptyAddressDialogValues: AddressDialogValues = {
  label: "",
  contactName: null,
  contactPhone: null,
  line1: null,
  line2: null,
  city: null,
  region: null,
  postcode: null,
  country: null,
  deliveryInstructions: null,
  notes: null,
};
const noCustomerCategoryValue = "__no_customer_category__";

const accountStateOptions = [
  { value: "active", label: "Active" },
  { value: "growth", label: "Growth" },
  { value: "at_risk", label: "At risk" },
  { value: "former", label: "Former" },
];

const accountPriorityOptions = [
  { value: "strategic", label: "Strategic" },
  { value: "high", label: "High" },
  { value: "standard", label: "Standard" },
  { value: "low", label: "Low" },
];

const noActivityProjectValue = "__no_activity_project__";
const newProjectSentinel = "__new_project__";

type ActivityStreamFilter =
  | { kind: "project"; id: string; name: string }
  | { kind: "contact"; id: string; name: string }
  | null;


export function CustomerCard({
  initialCustomerId,
  initialCustomer,
  addresses,
  categories,
}: CustomerCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [addressBook, setAddressBook] = useState(addresses);
  const [activityFilter, setActivityFilter] = useState<ActivityStreamFilter>(null);
  const activityAnchorRef = useRef<HTMLDivElement | null>(null);
  const openContactStream = useCallback((contact: { id: string; name: string }) => {
    setActivityFilter({ kind: "contact", id: contact.id, name: contact.name });
    activityAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const [addressDialogState, setAddressDialogState] =
    useState<AddressDialogState | null>(null);
  const engine = useDraftSaveEngine<
    CustomerDetailData,
    CustomerDraftOp,
    CustomerDetailData
  >({
    initialDraft:
      initialCustomer ??
      makeDraftCustomer({
        ...customerDefaultValues,
        accountState: "active",
        accountPriority: "standard",
      }),
    initialServerSnapshot: initialCustomer,
    initialId: initialCustomerId,
    isSaveable: (draft) => Boolean(draft.name.trim()),
    applyOp: (draft, op) => applyCustomerDraftOp(draft, op),
    create: async (draft) => {
      const created = await createCustomer(customerToInsertInput(draft));
      return getCustomerCard(created.id);
    },
    save: async (customerId, draft, ops) => {
      if (ops.length === 0) return null;
      return saveCustomerOps(customerId, draft, ops.map(({ op }) => op));
    },
    getResultId: (result) => result.id,
    applyPersistedIdentity: (draft, result) => ({
      ...draft,
      id: result.id,
      createdAt: result.createdAt,
    }),
    mergeServerOwnedFields: (draft, result) => ({
      ...result,
      ...customerEditableSnapshot(draft),
    }),
    onPersisted: (id) => {
      reflectPersistedCardUrlWithoutNavigation(`/sales/customers/${id}`);
    },
    onResult: (result, draft) => {
      queryClient.setQueryData(["customer-card", result.id], draft);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
  const currentCustomerId = engine.currentId;
  const isDraft = !engine.hasPersistedEntity;

  const customerQuery = useQuery({
    queryKey: ["customer-card", currentCustomerId ?? "__draft__"],
    queryFn: () => getCustomerCard(currentCustomerId as string),
    initialData: initialCustomer ?? undefined,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const serverCustomer = isDraft ? null : customerQuery.data ?? initialCustomer;
  const display = isDraft
    ? engine.draft
    : serverCustomer
      ? {
          ...serverCustomer,
          ...customerEditableSnapshot(engine.draft),
          contacts: engine.draft.contacts,
        }
      : engine.draft;
  const readOnly = Boolean(display.deletedAt);

  const deleteMutation = useDeleteEntity({
    mutationKey: ["customer-action", currentCustomerId ?? "__draft__", "delete"],
    mutationFn: () => deleteCustomer(currentCustomerId as string),
    invalidateQueryKeys: [["customers"]],
    onDeleted: () => router.push("/sales/customers"),
  });
  const deleteConfirm = useConfirmMutation<void>({
    title: "Delete customer?",
    description: (
      <>
        This customer will be soft-deleted. Existing sales orders keep their customer snapshot.
      </>
    ),
    confirmLabel: "Delete",
    pendingLabel: "Deleting...",
    mutation: deleteMutation,
  });

  const addressForm = useForm<AddressDialogValues>({
    resolver: zodResolver(createAddressEntrySchema),
    defaultValues: emptyAddressDialogValues,
  });

  const addressMutation = useMutation({
    mutationKey: cardSaveMutationKey("customer", currentCustomerId ?? "__draft__", "address-book"),
    mutationFn: ({ id, values }: { id: string | null; values: AddressDialogValues }) => {
      const data = createAddressEntrySchema.parse(values);
      return id ? updateAddressEntry(id, data) : createAddressEntry(data);
    },
    onSuccess: (entry) => {
      const option = addressEntryToAddressOption(entry);
      if (!option || !addressDialogState) return;

      setAddressBook((current) => {
        const next = current.filter((address) => address.id !== entry.id);
        return [...next, entry].sort((a, b) => a.label.localeCompare(b.label));
      });
      applyCustomerAddress(addressDialogState.target, option);
      setAddressDialogState(null);
      addressForm.reset(emptyAddressDialogValues);
    },
  });

  const commitCustomerPatch = useCallback(
    (patch: PatchCustomer) => {
      if (readOnly) return;
      engine.applyLocalOp({ type: "patch", patch });
    },
    [engine, readOnly]
  );

  const applyCustomerAddress = useCallback(
    (target: AddressTarget, address: CustomerAddressFields | null) => {
      const normalized = address ? normalizeAddressFields(address) : emptyAddressFields();
      const patch =
        target === "shipping"
          ? shippingAddressPatch(normalized)
          : billingAddressPatch(normalized);
      commitCustomerPatch(patch);
    },
    [commitCustomerPatch]
  );

  const openAddressDialog = useCallback(
    (target: AddressTarget) => {
      addressMutation.reset();
      addressForm.reset(emptyAddressDialogValues);
      setAddressDialogState({ target, option: null });
    },
    [addressForm, addressMutation]
  );

  const openEditAddressDialog = useCallback(
    (target: AddressTarget, option: CustomerAddressOption) => {
      addressMutation.reset();
      addressForm.reset({
        label: option.label,
        contactName: option.contactName,
        contactPhone: option.contactPhone,
        line1: option.line1,
        line2: option.line2,
        city: option.city,
        region: option.region,
        postcode: option.postcode,
        country: option.country,
        notes: option.notes,
        deliveryInstructions: option.deliveryInstructions,
      });
      setAddressDialogState({ target, option });
    },
    [addressForm, addressMutation]
  );

  const handleAddressDialogSubmit = useCallback(
    (values: AddressDialogValues) => {
      if (!addressDialogState) return;
      const label = makeUniqueAddressLabel(
        values,
        addressBook.map((address) => address.label),
      );
      addressMutation.mutate({
        id: addressDialogState.option?.addressEntryId ?? null,
        values: { ...values, label },
      });
    },
    [addressBook, addressDialogState, addressMutation]
  );

  const openOrders = display.salesOrders.filter((order) => order.status === "open");
  const billingAddress = getCustomerBillingAddress(display);
  const shippingAddress = getCustomerShippingAddress(display);
  const billingSameAsShipping = isAddressBlank(billingAddress);
  const addressOptions = useMemo(
    () =>
      addressBook
        .map(addressEntryToAddressOption)
        .filter((option): option is CustomerAddressOption => option != null),
    [addressBook]
  );
  const categoryOptions = useMemo(
    () => [
      { value: noCustomerCategoryValue, label: "Uncategorized" },
      ...categories.map((category) => ({
        value: category.id,
        label: category.name,
      })),
    ],
    [categories]
  );

  const cardSaveState: CardSaveState = readOnly
    ? "readonly"
    : engine.status === "saving" || engine.status === "dirty"
      ? "saving"
      : engine.status === "error"
        ? "failed"
        : isDraft
          ? "not_saved"
          : "saved";
  const cardSaveMessage =
    cardSaveState === "saved"
      ? "Saved"
      : cardSaveState === "failed"
        ? engine.error
        : null;

  return (
    <CardPage>
      <CardPageHeader
        title={display.name.trim() || "New customer"}
        saveState={cardSaveState}
        saveMessage={cardSaveMessage}
        fallbackHref="/sales/customers"
        showPrint={false}
        menuActions={
          isDraft || readOnly
            ? []
            : [
                {
                  label: "Print",
                  onClick: () => window.print(),
                },
                {
                  label: "Delete customer",
                  onClick: () => deleteConfirm.trigger(undefined),
                  destructive: true,
                },
              ]
        }
      />

      <CardPageBody>
        <CardSection title="Customer at a glance">
          <CardFormRow columns="three">
            <CardField
              label="Customer name"
              htmlFor="customer-name"
              required
              invalid={isDraft && !display.name.trim()}
            >
              <CommitInput
                id="customer-name"
                label="Customer name"
                value={display.name}
                disabled={readOnly}
                autoFocus={isDraft}
                required
                className={underlineControlClass(isDraft && !display.name.trim())}
                onCommit={(name) => {
                  if (name) commitCustomerPatch({ name });
                }}
              />
            </CardField>
            <CardField label="Main email" htmlFor="customer-email">
              <CommitInput
                id="customer-email"
                label="Email"
                type="email"
                value={display.email ?? ""}
                disabled={readOnly}
                onCommit={(email) => commitCustomerPatch({ email })}
              />
            </CardField>
            <CardField label="Main phone" htmlFor="customer-phone">
              <CommitInput
                id="customer-phone"
                label="Phone"
                value={display.phone ?? ""}
                disabled={readOnly}
                onCommit={(phone) => commitCustomerPatch({ phone })}
              />
            </CardField>
            <CardSelectField
              label="Category"
              value={display.customerCategoryId ?? noCustomerCategoryValue}
              disabled={readOnly}
              options={categoryOptions}
              onValueChange={(value) =>
                commitCustomerPatch({
                  customerCategoryId:
                    value === noCustomerCategoryValue ? null : value,
                })
              }
            />
            <CardSelectField
              label="State"
              value={display.accountState}
              disabled={readOnly}
              options={accountStateOptions}
              onValueChange={(accountState) =>
                commitCustomerPatch({
                  accountState: accountState as PatchCustomer["accountState"],
                })
              }
            />
            <CardSelectField
              label="Priority"
              value={display.accountPriority}
              disabled={readOnly}
              options={accountPriorityOptions}
              onValueChange={(accountPriority) =>
                commitCustomerPatch({
                  accountPriority:
                    accountPriority as PatchCustomer["accountPriority"],
                })
              }
            />
            <CardField label="Shipping address" htmlFor="customer-shipping-address">
              <CustomerAddressInput
                id="customer-shipping-address"
                target="shipping"
                value={shippingAddress}
                options={addressOptions}
                disabled={readOnly}
                onChange={(address) => applyCustomerAddress("shipping", address)}
                onAddNew={() => openAddressDialog("shipping")}
                onEdit={(option) => openEditAddressDialog("shipping", option)}
              />
            </CardField>
            <CardField label="Billing address" htmlFor="customer-billing-address">
              <CustomerAddressInput
                id="customer-billing-address"
                target="billing"
                value={billingSameAsShipping ? null : billingAddress}
                sameAsShippingLabel={formatAddressInline(shippingAddress)}
                options={addressOptions}
                sameAsShipping
                disabled={readOnly}
                onChange={(address) => applyCustomerAddress("billing", address)}
                onAddNew={() => openAddressDialog("billing")}
                onEdit={(option) => openEditAddressDialog("billing", option)}
              />
            </CardField>
            <CardField label="Customer since">
              <ReadOnlyFieldValue>
                {display.createdAt ? formatDate(toDateOnlyString(display.createdAt)) : "-"}
              </ReadOnlyFieldValue>
            </CardField>
          </CardFormRow>
        </CardSection>

        <ContactsSection
          rows={display.contacts}
          onOpenStream={openContactStream}
          readOnly={readOnly || isDraft}
          onSave={(row) => {
            if (readOnly || isDraft) return;
            engine.applyLocalOp({ type: "upsertContact", row });
          }}
          onDelete={(contactId) => {
            if (readOnly || isDraft) return;
            engine.applyLocalOp({ type: "deleteContact", contactId });
          }}
        />

        <div ref={activityAnchorRef}>
          <ActivitySection
            customerId={currentCustomerId}
            rows={display.activities}
            projects={display.projects}
            contacts={display.contacts}
            filter={activityFilter}
            onFilterChange={setActivityFilter}
            readOnly={readOnly || isDraft}
          />
        </div>

        <OpenOrdersSection
          customerId={currentCustomerId}
          rows={openOrders}
        />

        <CardSection title="Description">
          <NotesField
            hideLabel
            value={display.notes ?? ""}
            disabled={readOnly}
            readOnlyValue={readOnly}
            commitUnchangedValue={isDraft}
            onDraftChange={(notes) => {
              if (isDraft) engine.applyLocalOp({ type: "patch", patch: { notes } }, Number.POSITIVE_INFINITY);
            }}
            onCommit={(notes) => commitCustomerPatch({ notes })}
          />
        </CardSection>
      </CardPageBody>

      {deleteConfirm.dialog}

      <Dialog
        open={addressDialogState != null}
        onOpenChange={(open) => {
          if (!open) setAddressDialogState(null);
        }}
      >
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>
              {addressDialogState?.option ? "Edit address" : "Add address"}
            </DialogTitle>
          </DialogHeader>
          <form
            id="customer-address-form"
            onSubmit={addressForm.handleSubmit(handleAddressDialogSubmit)}
          >
            {addressMutation.error ? (
              <FieldError>
                {(addressMutation.error as Error).message || "Failed to save address."}
              </FieldError>
            ) : null}
            <AddressBookFields
              control={addressForm.control}
              addressNames={addressFieldNames}
              idPrefix="customer-address"
              labelName="label"
              contactNameName="contactName"
              contactPhoneName="contactPhone"
              notesName="notes"
            />
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddressDialogState(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="customer-address-form"
              disabled={addressMutation.isPending}
            >
              {addressMutation.isPending
                ? "Saving..."
                : addressDialogState?.option
                  ? "Save address"
                  : "Add address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardPage>
  );
}

function ContactsSection({
  rows: sourceRows,
  onOpenStream,
  readOnly,
  onSave,
  onDelete,
}: {
  rows: CustomerContactRow[];
  readOnly: boolean;
  onOpenStream: (contact: { id: string; name: string }) => void;
  onSave: (row: ContactGridRow) => void;
  onDelete: (contactId: string) => void;
}) {
  const [rows, setRows] = useSyncedRows<ContactGridRow>(sourceRows);

  const columns = useMemo<LineField<ContactGridRow>[]>(
    () => [
      {
        colId: "primary",
        kind: "display",
        headerName: "Primary",
        width: 92,
        minWidth: 92,
        cellRenderer: (params: ICellRendererParams<ContactGridRow>) => {
          const row = params.data;
          if (!row) return null;
          const active = row.roles.includes("primary");
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={readOnly}
              aria-pressed={active}
              aria-label={active ? "Primary contact" : "Set primary contact"}
              title={active ? "Primary contact" : "Set primary contact"}
              className={styles.primaryContactButton}
              onClick={() => {
                const next = {
                  ...row,
                  roles: active
                    ? row.roles.filter((role) => role !== "primary")
                    : [...new Set([...row.roles, "primary"])] as CustomerContactRole[],
                };
                setRows((current) => replaceRow(current, next));
                if (next.name.trim()) onSave(next);
              }}
            >
              <HugeiconsIcon
                icon={StarIcon}
                className={cn(active && styles.primaryContactIconActive)}
              />
            </Button>
          );
        },
      },
      textColumn("name", "Name", !readOnly),
      {
        colId: "stream",
        kind: "display",
        headerName: "",
        width: 110,
        minWidth: 110,
        cellRenderer: (params: ICellRendererParams<ContactGridRow>) => {
          const row = params.data;
          if (!row || row.isNew || !row.name.trim()) return null;
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`View activity for "${row.name}"`}
              onClick={() => onOpenStream({ id: row.id, name: row.name })}
            >
              Activity
            </Button>
          );
        },
      },
      textColumn("title", "Role", !readOnly),
      textColumn("notes", "Notes", !readOnly, 1.4),
      textColumn("email", "Email", !readOnly),
      textColumn("phone", "Phone", !readOnly),
    ],
    [onOpenStream, onSave, readOnly, setRows]
  );

  const onRowsChange = useCallback(
    (nextRows: ContactGridRow[], change: EditableLineDataGridChange<ContactGridRow>) => {
      setRows(nextRows);
      if (change.type === "row_deleted" && change.row && !change.row.isNew) {
        onDelete(change.row.id);
        return;
      }
      if (
        change.type === "cell_edit_committed" &&
        change.row?.name.trim()
      ) {
        onSave(change.row);
      }
    },
    [onDelete, onSave, setRows]
  );

  return (
    <CardSection title="Contacts" count={`· ${sourceRows.length}`}>
      <MutableLines
        rows={rows}
        fields={columns}
        getRowId={(row) => row.id}
        createRow={newContactRow}
        onRowsChange={onRowsChange}
        addLabel="Add contact"
        readOnly={readOnly}
        emptyMessage="No contacts yet."
      />
    </CardSection>
  );
}

function OpenOrdersSection({
  customerId,
  rows: sourceRows,
}: {
  customerId: string | null;
  rows: OpenOrderGridRow[];
}) {
  const rows = sourceRows
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <CardSection title="Open orders" count={`· ${sourceRows.length}`}>
      <ul className="grid gap-(--space-3)">
        {rows.length > 0 ? (
          rows.map((order) => (
            <li key={order.id}>
              <ListFrameItem
                as={Link}
                href={`/sales/order/${order.id}`}
                interactive
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-(--space-4) p-(--space-4)"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-(--space-3)">
                    <span className="font-mono text-[length:var(--text-sm)] font-medium tabular-nums">
                      {order.orderNumber}
                    </span>
                    <SalesOrderStatusBadge status={order.status} />
                    <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)] tabular-nums">
                      {formatDate(order.shipDate ?? order.orderDate)}
                    </span>
                  </span>
                </span>
                <span className="font-mono text-[length:var(--text-sm)] font-medium tabular-nums">
                  {formatPrice(order.totalAmount) ?? "$0.00"}
                </span>
              </ListFrameItem>
            </li>
          ))
        ) : (
          <EmptyState as="li">No open orders.</EmptyState>
        )}
      </ul>
      {customerId ? (
        <Link
          href={`/sales/orders?customerId=${customerId}`}
          className="mt-(--space-5) inline-flex text-[length:var(--text-sm)] font-medium text-[var(--color-accent-ink)]"
        >
          View all sales orders for this customer →
        </Link>
      ) : (
        <span className="mt-(--space-5) inline-flex text-[length:var(--text-sm)] font-medium text-[var(--color-ink-faint)]">
          View all sales orders for this customer →
        </span>
      )}
    </CardSection>
  );
}

const activityComposerMeta: Record<
  CustomerActivityType,
  { label: string; submitLabel: string; placeholder: string }
> = {
  note: { label: "Note", submitLabel: "Add note", placeholder: "Add a customer note..." },
  call: { label: "Call", submitLabel: "Log call", placeholder: "What was discussed?" },
  email: { label: "Email", submitLabel: "Log email", placeholder: "What was discussed?" },
  meeting: { label: "Meeting", submitLabel: "Log meeting", placeholder: "What was discussed?" },
  task: { label: "Task", submitLabel: "Create task", placeholder: "What needs to happen next?" },
};

const activityTimelineIcons: Record<CustomerActivityType, IconSvgElement> = {
  note: StickyNote02Icon,
  call: Call02Icon,
  email: Mail01Icon,
  meeting: UserMultiple02Icon,
  task: Tick02Icon,
};

function ActivitySection({
  customerId,
  rows: allRows,
  projects,
  contacts,
  filter,
  onFilterChange,
  readOnly,
}: {
  customerId: string | null;
  rows: CustomerActivityRow[];
  projects: CustomerProjectRow[];
  contacts: CustomerContactRow[];
  filter: ActivityStreamFilter;
  onFilterChange: (filter: ActivityStreamFilter) => void;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<CustomerActivityType>("note");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState(noActivityProjectValue);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectStatus, setNewProjectStatus] = useState<"planning" | "active">("planning");
  const [newProjectTargetDate, setNewProjectTargetDate] = useState("");

  const rows = !filter
    ? allRows
    : filter.kind === "project"
      ? allRows.filter((row) => row.customerProjectId === filter.id)
      : allRows.filter((row) =>
          row.attendees.some((attendee) => attendee.contactId === filter.id)
        );
  const mentionMatches =
    mentionQuery === null
      ? []
      : contacts.filter(
          (contact) =>
            contact.name.trim() &&
            contact.name.toLowerCase().startsWith(mentionQuery.toLowerCase())
        );
  const isTask = type === "task";
  const openTasks = rows
    .filter((row) => row.type === "task" && row.status === "open")
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) {
        if (a.dueDate == null) return 1;
        if (b.dueDate == null) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const timeline = rows
    .filter((row) => !(row.type === "task" && row.status === "open"))
    .sort((a, b) => timelineDate(b).getTime() - timelineDate(a).getTime());
  const timelineMonths = groupTimelineByMonth(timeline);
  const today = toDateOnlyString(new Date()) ?? "";

  const invalidate = async () => {
    if (customerId) {
      await queryClient.invalidateQueries({
        queryKey: ["customer-card", customerId],
      });
    }
  };

  const createMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "customer",
      customerId ?? "__draft__",
      "activity-create"
    ),
    mutationFn: () =>
      createCustomerActivity(customerId as string, {
        type,
        occurredAt: undefined,
        title: isTask ? body.trim().replace(/\s+/g, " ") : null,
        body: isTask ? null : body.trim() || null,
        dueDate: isTask && dueDate ? dueDate : null,
        customerProjectId:
          projectId === noActivityProjectValue ? null : projectId,
        attendeeContactIds: contacts
          .filter(
            (contact) =>
              contact.name.trim() && body.includes(`@${contact.name}`)
          )
          .map((contact) => contact.id),
      }),
    onSuccess: async () => {
      setBody("");
      setDueDate("");
      setMentionQuery(null);
      await invalidate();
    },
  });

  const patchMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "customer",
      customerId ?? "__draft__",
      "activity-patch"
    ),
    mutationFn: ({
      activityId,
      status,
    }: {
      activityId: string;
      status: "open" | "done";
    }) => patchCustomerActivity(customerId as string, activityId, { status }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "customer",
      customerId ?? "__draft__",
      "activity-delete"
    ),
    mutationFn: (activityId: string) =>
      deleteCustomerActivity(customerId as string, activityId),
    onSuccess: invalidate,
  });

  const newProjectMutation = useMutation({
    mutationKey: cardSaveMutationKey(
      "customer",
      customerId ?? "__draft__",
      "activity-new-project"
    ),
    mutationFn: () =>
      createCustomerProject(customerId as string, {
        name: newProjectName.trim(),
        status: newProjectStatus,
        startDate: null,
        targetEndDate: newProjectTargetDate || null,
        summary: null,
      }),
    onSuccess: async (project) => {
      setNewProjectOpen(false);
      setNewProjectName("");
      setNewProjectStatus("planning");
      setNewProjectTargetDate("");
      if (project) setProjectId(project.id);
      await invalidate();
    },
  });

  const pending = patchMutation.isPending || deleteMutation.isPending;
  const error =
    createMutation.error ??
    patchMutation.error ??
    deleteMutation.error ??
    newProjectMutation.error;

  return (
    <CardSection title="Activity" count={`· ${rows.length}`}>
      <div className="grid gap-(--space-5)">
        {!readOnly ? (
          <div className="grid gap-0 rounded-(--radius-md) border border-[var(--color-line)]">
            <div className="flex flex-wrap items-center gap-(--space-2) p-(--space-4) pb-0">
              {(Object.keys(activityComposerMeta) as CustomerActivityType[]).map(
                (option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={type === option ? "default" : "outline"}
                    aria-pressed={type === option}
                    onClick={() => setType(option)}
                  >
                    {activityComposerMeta[option].label}
                  </Button>
                )
              )}
            </div>
            <div className="relative">
              <Textarea
                value={body}
                rows={3}
                disabled={createMutation.isPending}
                aria-label={isTask ? "Task title" : "Activity notes"}
                placeholder={activityComposerMeta[type].placeholder}
                className="border-0 shadow-none focus-visible:ring-0 text-[length:var(--text-md)] leading-[var(--leading-md)]"
                onChange={(event) => {
                  const value = event.target.value;
                  setBody(value);
                  const caret = event.target.selectionStart ?? value.length;
                  const match = value.slice(0, caret).match(/@([A-Za-z]*)$/);
                  setMentionQuery(match ? match[1] : null);
                }}
              />
              {mentionMatches.length > 0 ? (
                <div className="absolute top-full left-(--space-4) z-10 mt-(--space-1) grid min-w-56 rounded-(--radius-md) border border-[var(--color-line)] bg-[var(--color-surface)] py-(--space-2) shadow-md">
                  {mentionMatches.slice(0, 6).map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      className="flex items-center gap-(--space-3) px-(--space-4) py-(--space-2) text-left text-[length:var(--text-sm)] hover:bg-[var(--color-surface-2)]"
                      onClick={() => {
                        setBody((current) => {
                          const match = current.match(/@[A-Za-z]*$/);
                          const base = match
                            ? current.slice(0, match.index)
                            : current;
                          return `${base}@${contact.name} `;
                        });
                        setMentionQuery(null);
                      }}
                    >
                      <span className="flex size-(--space-9) items-center justify-center rounded-full border border-[var(--color-line)] text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                        {contactInitials(contact.name)}
                      </span>
                      {contact.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-(--space-3) border-t border-[var(--color-line)] bg-[var(--color-surface-2)] p-(--space-3)">
              <Select
                value={projectId}
                onValueChange={(value) => {
                  if (value === newProjectSentinel) {
                    setNewProjectOpen(true);
                    return;
                  }
                  setProjectId(value);
                }}
              >
                <SelectTrigger aria-label="Project" size="sm">
                  <SelectValue>
                    {projectId === noActivityProjectValue
                      ? "No project"
                      : projects.find((project) => project.id === projectId)
                          ?.name ?? "No project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noActivityProjectValue}>
                    No project
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={newProjectSentinel}>
                    New project…
                  </SelectItem>
                </SelectContent>
              </Select>
              {filter ? (
                <span className="flex items-center gap-(--space-2) rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-(--space-3) py-(--space-1) font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                  <HugeiconsIcon
                    icon={filter.kind === "project" ? Folder01Icon : UserIcon}
                    className="size-(--space-5)"
                  />
                  {filter.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Clear filter"
                    onClick={() => onFilterChange(null)}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} />
                  </Button>
                </span>
              ) : null}
              {isTask ? (
                <div className="w-52">
                  <DatePicker
                    value={dueDate}
                    placeholder="Due date"
                    disabled={createMutation.isPending}
                    onChange={(value) => setDueDate(value ?? "")}
                  />
                </div>
              ) : null}
              <div className="ml-auto flex items-center gap-(--space-4)">
                {error ? <FieldError>{error.message}</FieldError> : null}
                <Button
                  type="button"
                  disabled={!body.trim() || createMutation.isPending}
                  onClick={() => {
                    if (!customerId || readOnly) return;
                    createMutation.mutate();
                  }}
                >
                  {createMutation.isPending
                    ? "Adding..."
                    : activityComposerMeta[type].submitLabel}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {!readOnly || openTasks.length > 0 ? (
          <div className="grid gap-(--space-2)">
            <h3 className={styles.sectionHeading}>
              Upcoming · {openTasks.length}
            </h3>
            {openTasks.length === 0 ? (
              <p className="rounded-(--radius-md) border border-dashed border-[var(--color-line)] px-(--space-4) py-(--space-3) text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                Nothing scheduled — create a task above.
              </p>
            ) : null}
            <ul className="grid gap-(--space-2)">
              {openTasks.map((task) => {
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-(--space-3) py-(--space-2)"
                  >
                    <Checkbox
                      aria-label={`Complete "${task.title}"`}
                      checked={false}
                      disabled={readOnly || pending}
                      onCheckedChange={() =>
                        patchMutation.mutate({
                          activityId: task.id,
                          status: "done",
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)]">
                      {renderWithMentions(task.title ?? "", task.attendees, onFilterChange)}
                    </span>
                    {task.projectName && task.customerProjectId ? (
                      <ActivityProjectChip
                        name={task.projectName}
                        onSelect={() =>
                          onFilterChange({
                            kind: "project",
                            id: task.customerProjectId as string,
                            name: task.projectName as string,
                          })
                        }
                      />
                    ) : null}
                    <span
                      className={cn(
                        "whitespace-nowrap rounded-full border px-(--space-4) py-(--space-1) text-[length:var(--text-xs)]",
                        !task.dueDate &&
                          "border-dashed border-[var(--color-line)] text-[var(--color-ink-faint)]",
                        task.dueDate && task.dueDate < today
                          ? "border-transparent bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                          : task.dueDate === today
                            ? "border-transparent bg-[var(--color-warning-soft)] text-[var(--color-ink)]"
                            : task.dueDate
                              ? "border-[var(--color-line)] text-[var(--color-ink-faint)]"
                              : undefined
                      )}
                    >
                      {task.dueDate
                        ? `Due ${formatDate(task.dueDate)}${
                            task.dueDate < today
                              ? " · Overdue"
                              : task.dueDate === today
                                ? " · Today"
                                : ""
                          }`
                        : "No due date"}
                    </span>
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete "${task.title}"`}
                        disabled={pending}
                        onClick={() => deleteMutation.mutate(task.id)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {timelineMonths.length > 0 ? (
          <div className="grid gap-(--space-5)">
            {timelineMonths.map((month) => (
              <div key={month.label} className="grid gap-(--space-3)">
                <div className="flex items-center gap-(--space-4)">
                  <h3 className={styles.sectionHeading}>{month.label}</h3>
                  <div className="h-px flex-1 bg-[var(--color-line)]" />
                </div>
                <ul className="grid gap-(--space-4)">
                  {month.entries.map((entry) => (
                    <li key={entry.id} className="flex gap-(--space-4)">
                      {entry.type === "task" ? (
                        <Checkbox
                          aria-label={`Reopen "${entry.title}"`}
                          checked
                          disabled={readOnly || pending}
                          className="mt-(--space-1)"
                          onCheckedChange={() =>
                            patchMutation.mutate({
                              activityId: entry.id,
                              status: "open",
                            })
                          }
                        />
                      ) : (
                        <span className="mt-(--space-1) flex size-(--space-9) shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-faint)]">
                          <HugeiconsIcon
                            icon={activityTimelineIcons[entry.type]}
                            className="size-(--space-6)"
                          />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-(--space-3)">
                          <span className="text-[length:var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                            {activityComposerMeta[entry.type].label}
                            {entry.type === "task" ? " · Done" : ""}
                          </span>
                          {entry.createdByName ? (
                            <span className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                              {entry.createdByName}
                            </span>
                          ) : null}
                          <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                            {formatDate(toDateOnlyString(timelineDate(entry)))}
                          </span>
                          {entry.projectName && entry.customerProjectId ? (
                            <ActivityProjectChip
                              name={entry.projectName}
                              onSelect={() =>
                                onFilterChange({
                                  kind: "project",
                                  id: entry.customerProjectId as string,
                                  name: entry.projectName as string,
                                })
                              }
                            />
                          ) : null}
                        </div>
                        {entry.title ? (
                          <p className="mt-(--space-2) text-[length:var(--text-sm)]">
                            {renderWithMentions(entry.title, entry.attendees, onFilterChange)}
                          </p>
                        ) : null}
                        {entry.body ? (
                          <p className="mt-(--space-2) whitespace-pre-wrap text-[length:var(--text-sm)] leading-[var(--leading-md)] text-[var(--color-ink)]">
                            {renderWithMentions(entry.body, entry.attendees, onFilterChange)}
                          </p>
                        ) : null}
                        {entry.attendees.some(
                          (attendee) =>
                            !`${entry.title ?? ""} ${entry.body ?? ""}`.includes(
                              `@${attendee.contactName}`
                            )
                        ) ? (
                          <p className="mt-(--space-2) flex flex-wrap gap-(--space-3) text-[length:var(--text-xs)]">
                            {entry.attendees
                              .filter(
                                (attendee) =>
                                  !`${entry.title ?? ""} ${entry.body ?? ""}`.includes(
                                    `@${attendee.contactName}`
                                  )
                              )
                              .map((attendee) => (
                                <MentionToken
                                  key={attendee.id}
                                  name={attendee.contactName}
                                  contactId={attendee.contactId}
                                  onFilterChange={onFilterChange}
                                />
                              ))}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : openTasks.length === 0 ? (
          <EmptyState density="compact">No activity yet.</EmptyState>
        ) : null}
      </div>

      <Sheet open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <SheetContent
          side="right"
          className="gap-0 overflow-hidden p-0 data-[side=right]:w-[min(420px,94vw)] data-[side=right]:sm:max-w-[min(420px,94vw)]"
        >
          <SheetHeader>
            <SheetTitle>New project</SheetTitle>
            <SheetDescription className="sr-only">
              Create a project to tag activities and orders with.
            </SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-(--space-6) overflow-y-auto p-(--space-8)">
            <CardTextField
              label="Project name"
              value={newProjectName}
              autoFocus
              controlStyle="dialog"
              onChange={(event) => setNewProjectName(event.target.value)}
            />
            <div className="grid gap-(--space-3)">
              <h3 className={styles.sectionHeading}>Status</h3>
              <div className="flex gap-(--space-2)">
                {(["planning", "active"] as const).map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={newProjectStatus === status ? "default" : "outline"}
                    aria-pressed={newProjectStatus === status}
                    onClick={() => setNewProjectStatus(status)}
                  >
                    {status === "planning" ? "Planning" : "Active"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-(--space-3)">
              <h3 className={styles.sectionHeading}>Target date</h3>
              <DatePicker
                value={newProjectTargetDate}
                placeholder="Target date"
                onChange={(value) => setNewProjectTargetDate(value ?? "")}
              />
            </div>
          </div>
          <SheetFooter className="flex-row items-center justify-end gap-(--space-4)">
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewProjectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!newProjectName.trim() || newProjectMutation.isPending}
              onClick={() => newProjectMutation.mutate()}
            >
              {newProjectMutation.isPending ? "Creating..." : "Create project"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </CardSection>
  );
}

function contactInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function MentionToken({
  name,
  contactId,
  onFilterChange,
}: {
  name: string;
  contactId: string | null;
  onFilterChange: (filter: ActivityStreamFilter) => void;
}) {
  if (!contactId) {
    return <span className="text-[var(--color-ink-faint)]">@{name}</span>;
  }
  return (
    <button
      type="button"
      className="font-medium text-[var(--color-ink)] hover:underline"
      onClick={() => onFilterChange({ kind: "contact", id: contactId, name })}
    >
      @{name}
    </button>
  );
}

function renderWithMentions(
  text: string,
  attendees: CustomerActivityRow["attendees"],
  onFilterChange: (filter: ActivityStreamFilter) => void
) {
  const named = attendees.filter((attendee) => attendee.contactName.trim());
  if (named.length === 0 || !text.includes("@")) return text;

  const pattern = new RegExp(
    `@(${named
      .map((attendee) =>
        attendee.contactName.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&")
      )
      .join("|")})`,
    "g"
  );
  const parts = text.split(pattern);
  return parts.map((part, index) => {
    const attendee = named.find((candidate) => candidate.contactName === part);
    if (index % 2 === 1 && attendee) {
      return (
        <MentionToken
          key={`${attendee.id}-${index}`}
          name={attendee.contactName}
          contactId={attendee.contactId}
          onFilterChange={onFilterChange}
        />
      );
    }
    return part;
  });
}

function ActivityProjectChip({
  name,
  onSelect,
}: {
  name: string;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      className="max-w-56 truncate whitespace-nowrap rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-(--space-3) py-(--space-1) text-[length:var(--text-xs)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
      onClick={onSelect}
    >
      {name}
    </button>
  );
}

function groupTimelineByMonth(entries: CustomerActivityRow[]) {
  const months: Array<{ label: string; entries: CustomerActivityRow[] }> = [];
  for (const entry of entries) {
    const label = timelineDate(entry)
      .toLocaleDateString(undefined, { month: "long", year: "numeric" })
      .toUpperCase();
    const current = months[months.length - 1];
    if (current && current.label === label) {
      current.entries.push(entry);
    } else {
      months.push({ label, entries: [entry] });
    }
  }
  return months;
}

function timelineDate(entry: CustomerActivityRow) {
  return new Date(entry.completedAt ?? entry.occurredAt);
}

function CustomerAddressInput({
  id,
  target,
  value,
  sameAsShippingLabel,
  options,
  sameAsShipping,
  disabled,
  onChange,
  onAddNew,
  onEdit,
}: {
  id: string;
  target: AddressTarget;
  value: CustomerAddressFields | null;
  sameAsShippingLabel?: string;
  options: CustomerAddressOption[];
  sameAsShipping?: boolean;
  disabled?: boolean;
  onChange: (address: CustomerAddressFields | null) => void;
  onAddNew: () => void;
  onEdit: (option: CustomerAddressOption) => void;
}) {
  const currentAddressId =
    sameAsShipping && (!value || isAddressBlank(value))
      ? sameAsShippingValue
      : addressKey(value);
  const canEditCurrent =
    currentAddressId !== "" && currentAddressId !== sameAsShippingValue;
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const items = [
    ...(sameAsShipping ? [sameAsShippingValue] : []),
    ...optionIds,
    ...(canEditCurrent ? [editAddressValue] : []),
    addAddressValue,
  ];

  return (
    <Combobox
      items={items}
      value={currentAddressId}
      onValueChange={(nextValue) => {
        if (!nextValue) {
          onChange(null);
          return;
        }
        if (nextValue === sameAsShippingValue) {
          onChange(null);
          return;
        }
        if (nextValue === addAddressValue) {
          onAddNew();
          return;
        }
        if (nextValue === editAddressValue) {
          const option = optionMap.get(currentAddressId);
          if (option) onEdit(option);
          return;
        }
        onChange(optionMap.get(nextValue) ?? null);
      }}
      itemToStringLabel={(itemId) => {
        if (itemId === sameAsShippingValue) {
          return sameAsShippingLabel || "Same as shipping address";
        }
        if (itemId === addAddressValue) return "Add new address";
        if (itemId === editAddressValue) return "Edit selected address";
        return optionMap.get(itemId)?.label ?? "";
      }}
    >
      <ComboboxInput
        id={id}
        placeholder={target === "billing" ? "Billing address" : "Shipping address"}
        disabled={disabled}
        showClear={currentAddressId !== "" && currentAddressId !== sameAsShippingValue}
        className={styles.underlineControl}
      />
      <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-[var(--color-surface)] text-[var(--color-ink)]">
        <ComboboxEmpty>No addresses found</ComboboxEmpty>
        <ComboboxList>
          {(itemId: string) => {
            if (itemId === sameAsShippingValue) {
              return (
                <ComboboxItem key={itemId} value={itemId}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {sameAsShippingLabel || "Same as shipping address"}
                    </span>
                    {sameAsShippingLabel ? (
                      <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                        Same as shipping address
                      </span>
                    ) : null}
                  </span>
                </ComboboxItem>
              );
            }
            if (itemId === addAddressValue) {
              return (
                <ComboboxItem key={itemId} value={itemId}>
                  Add new address
                </ComboboxItem>
              );
            }
            if (itemId === editAddressValue) {
              return (
                <ComboboxItem key={itemId} value={itemId}>
                  Edit selected address
                </ComboboxItem>
              );
            }

            const option = optionMap.get(itemId);
            return (
              <ComboboxItem key={itemId} value={itemId}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option?.label}</span>
                  <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                    {option ? formatAddressInline(option) : ""}
                  </span>
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        {optionIds.length > 0 ? <ComboboxSeparator /> : null}
      </ComboboxContent>
    </Combobox>
  );
}

function textColumn<TData>(
  field: keyof TData & string,
  headerName: string,
  editable: boolean,
  flex = 1
): LineField<TData> {
  return {
    field,
    kind: "text",
    headerName,
    editable,
    flex,
    minWidth: 120,
    valueSetter: (params: ValueSetterParams<TData>) => {
      if (!params.data) return false;
      const next =
        typeof params.newValue === "string"
          ? params.newValue.trim() || null
          : params.newValue;
      const data = params.data as Record<string, unknown>;
      const current = data[field] ?? null;
      if (next === current) return false;
      data[field] = next;
      return true;
    },
  };
}

function contactPayload(row: ContactGridRow) {
  return {
    name: row.name.trim(),
    title: row.title || null,
    email: row.email || null,
    phone: row.phone || null,
    addressEntryId: row.addressEntryId || null,
    roles: row.roles,
    notes: row.notes || null,
  };
}

function newContactRow(): ContactGridRow {
  const now = new Date();
  return {
    id: `new-${crypto.randomUUID()}`,
    isNew: true,
    name: "",
    title: null,
    email: null,
    phone: null,
    addressEntryId: null,
    roles: [],
    notes: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeDraftCustomer(draft: InsertCustomer): CustomerDetailData {
  const now = new Date();
  return {
    id: "__draft__",
    ...draft,
    customerCategoryName: null,
    openOrderCount: 0,
    openOrderValue: "0",
    latestOrderDate: null,
    primaryContactName: null,
    primaryContactEmail: null,
    primaryContactPhone: null,
    nextTaskTitle: null,
    nextTaskDueDate: null,
    xeroContactId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    contacts: [],
    activities: [],
    projects: [],
    salesOrders: [],
  };
}

function normalizeCustomerDraft(draft: InsertCustomer): InsertCustomer {
  return {
    ...draft,
    name: draft.name.trim(),
  };
}

function mergeCustomerPatch(
  customer: CustomerDetailData,
  patch: PatchCustomer
): CustomerDetailData {
  return {
    ...customer,
    ...patch,
    updatedAt: new Date(),
  };
}

function applyCustomerDraftOp(
  customer: CustomerDetailData,
  op: CustomerDraftOp
): CustomerDetailData {
  if (op.type === "patch") return mergeCustomerPatch(customer, op.patch);
  if (op.type === "upsertContact") {
    const contacts = upsertById(customer.contacts, op.row);
    return { ...customer, contacts, updatedAt: new Date() };
  }
  return {
    ...customer,
    contacts: customer.contacts.filter((contact) => contact.id !== op.contactId),
    updatedAt: new Date(),
  };
}

async function saveCustomerOps(
  customerId: string,
  draft: CustomerDetailData,
  ops: CustomerDraftOp[]
) {
  let changed = false;
  const patch = ops.reduce<PatchCustomer>(
    (next, op) => (op.type === "patch" ? { ...next, ...op.patch } : next),
    {},
  );
  if (Object.keys(patch).length > 0) {
    await patchCustomer(customerId, customerEditableSnapshot(draft));
    changed = true;
  }

  for (const op of ops) {
    if (op.type === "upsertContact") {
      if (!op.row.name.trim()) continue;
      if (op.row.isNew) {
        await createCustomerContact(customerId, contactPayload(op.row));
      } else {
        await updateCustomerContact(customerId, op.row.id, contactPayload(op.row));
      }
      changed = true;
    } else if (op.type === "deleteContact") {
      await deleteCustomerContact(customerId, op.contactId);
      changed = true;
    }
  }

  return changed ? getCustomerCard(customerId) : null;
}

function customerToInsertInput(customer: CustomerDetailData): InsertCustomer {
  return normalizeCustomerDraft({
    name: customer.name,
    customerCategoryId: customer.customerCategoryId,
    accountState: customer.accountState,
    accountPriority: customer.accountPriority,
    email: customer.email,
    phone: customer.phone,
    billingLine1: customer.billingLine1,
    billingLine2: customer.billingLine2,
    billingCity: customer.billingCity,
    billingRegion: customer.billingRegion,
    billingPostcode: customer.billingPostcode,
    billingCountry: customer.billingCountry,
    shipLine1: customer.shipLine1,
    shipLine2: customer.shipLine2,
    shipCity: customer.shipCity,
    shipRegion: customer.shipRegion,
    shipPostcode: customer.shipPostcode,
    shipCountry: customer.shipCountry,
    notes: customer.notes,
  });
}

function customerEditableSnapshot(customer: CustomerDetailData): PatchCustomer {
  return {
    name: customer.name,
    customerCategoryId: customer.customerCategoryId,
    accountState: customer.accountState,
    accountPriority: customer.accountPriority,
    email: customer.email,
    phone: customer.phone,
    billingLine1: customer.billingLine1,
    billingLine2: customer.billingLine2,
    billingCity: customer.billingCity,
    billingRegion: customer.billingRegion,
    billingPostcode: customer.billingPostcode,
    billingCountry: customer.billingCountry,
    shipLine1: customer.shipLine1,
    shipLine2: customer.shipLine2,
    shipCity: customer.shipCity,
    shipRegion: customer.shipRegion,
    shipPostcode: customer.shipPostcode,
    shipCountry: customer.shipCountry,
    notes: customer.notes,
  };
}

function useSyncedRows<TRow extends { id: string }>(sourceRows: TRow[]) {
  const [rows, setRows] = useState<TRow[]>(sourceRows);
  const [lastSynced, setLastSynced] = useState(sourceRows);
  if (lastSynced !== sourceRows) {
    setLastSynced(sourceRows);
    setRows(sourceRows);
  }
  return [rows, setRows] as const;
}

function upsertById<TRow extends { id: string }>(rows: TRow[], next: TRow) {
  return rows.some((row) => row.id === next.id)
    ? replaceRow(rows, next)
    : [...rows, next];
}

function replaceRow<TRow extends { id: string }>(rows: TRow[], next: TRow) {
  return rows.map((row) => (row.id === next.id ? next : row));
}

export function addressEntryLabel(address: AddressEntry) {
  return formatAddressInline(address) || address.label;
}

function getCustomerBillingAddress(customer: CustomerDetailData): CustomerAddressFields {
  return normalizeAddressFields({
    line1: customer.billingLine1,
    line2: customer.billingLine2,
    city: customer.billingCity,
    region: customer.billingRegion,
    postcode: customer.billingPostcode,
    country: customer.billingCountry,
  });
}

function getCustomerShippingAddress(customer: CustomerDetailData): CustomerAddressFields {
  return normalizeAddressFields({
    line1: customer.shipLine1,
    line2: customer.shipLine2,
    city: customer.shipCity,
    region: customer.shipRegion,
    postcode: customer.shipPostcode,
    country: customer.shipCountry,
  });
}

function shippingAddressPatch(address: CustomerAddressFields): PatchCustomer {
  return {
    shipLine1: address.line1,
    shipLine2: address.line2,
    shipCity: address.city,
    shipRegion: address.region,
    shipPostcode: address.postcode,
    shipCountry: address.country,
  };
}

function billingAddressPatch(address: CustomerAddressFields): PatchCustomer {
  return {
    billingLine1: address.line1,
    billingLine2: address.line2,
    billingCity: address.city,
    billingRegion: address.region,
    billingPostcode: address.postcode,
    billingCountry: address.country,
  };
}
