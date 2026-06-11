"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Call02Icon,
  Cancel01Icon,
  Folder01Icon,
  Mail01Icon,
  StarIcon,
  StickyNote02Icon,
  Tag01Icon,
  Tick02Icon,
  UserIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
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
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  CardTextField,
} from "@/components/card-page/card-field";
import {
  CardFormRow,
  ReadOnlyFieldValue,
  underlineControlClass,
} from "@/components/card-page/form-cell";
import { CommitInput } from "@/components/card-page/commit-input";
import { ListFrameItem } from "@/components/list-frame";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import {
  cardSaveMutationKey,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import {
  AddressBookInput,
  useAddressBookDialog,
} from "@/components/card-page/address-book";
import {
  createCustomer,
  createCustomerContact,
  createCustomerActivity,
  createCustomerProject,
  patchCustomerActivity,
  deleteCustomer,
  deleteCustomerContact,
  getCustomerCard,
  patchCustomer,
  updateCustomerContact,
} from "@/lib/api/clients/customers";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import type { AddressEntry } from "@/lib/dal/addresses";
import {
  addressEntryToAddressOption,
  emptyAddressFields,
  formatAddressInline,
  isAddressBlank,
  normalizeAddressFields,
  type AddressEntryOption,
} from "@/lib/addresses";
import {
  formatDate,
  formatPrice,
  toDateOnlyString,
} from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { queryKeys } from "@/lib/client/query-keys";

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

const accountStateDots: Record<string, string> = {
  active: "bg-[var(--color-success)]",
  growth: "bg-[var(--color-accent)]",
  at_risk: "bg-[var(--color-danger)]",
  former: "bg-[var(--color-ink-faint)]",
};

const accountPriorityDots: Record<string, string> = {
  strategic: "bg-[var(--color-warning)]",
  high: "bg-[var(--color-accent)]",
  standard: "bg-[var(--color-ink-faint)]",
  low: "bg-[var(--color-line)]",
};

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
    requestAnimationFrame(() => {
      const anchor = activityAnchorRef.current;
      if (!anchor) return;
      let scroller = anchor.parentElement;
      while (scroller) {
        const overflowY = getComputedStyle(scroller).overflowY;
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          scroller.scrollHeight > scroller.clientHeight
        ) {
          break;
        }
        scroller = scroller.parentElement;
      }
      if (!scroller) return;
      const top =
        anchor.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      scroller.scrollTo({ top, behavior: "smooth" });
    });
  }, []);
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
      queryClient.setQueryData(queryKeys.customers.card(result.id), draft);
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.root });
    },
  });
  const currentCustomerId = engine.currentId;
  const isDraft = !engine.hasPersistedEntity;

  const customerQuery = useQuery({
    queryKey: queryKeys.customers.card(currentCustomerId ?? "__draft__"),
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
    invalidateQueryKeys: [queryKeys.customers.root],
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

  const addressDialog = useAddressBookDialog<AddressTarget>({
    entity: "customer",
    entityId: currentCustomerId,
    idPrefix: "customer",
    addressBook,
    setAddressBook,
    onSaved: (option, target) => applyCustomerAddress(target, option),
  });

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
        eyebrow="Customer"
        title={display.name.trim() || "New customer"}
        meta={
          <div className="flex flex-wrap items-center gap-(--space-2)">
            <HeaderMetaPill
              label="State"
              value={display.accountState}
              options={accountStateOptions}
              dotClassName={accountStateDots[display.accountState]}
              optionDots={accountStateDots}
              disabled={readOnly}
              onSelect={(accountState) =>
                commitCustomerPatch({
                  accountState: accountState as PatchCustomer["accountState"],
                })
              }
            />
            <HeaderMetaPill
              label="Priority"
              value={display.accountPriority}
              options={accountPriorityOptions}
              dotClassName={accountPriorityDots[display.accountPriority]}
              optionDots={accountPriorityDots}
              disabled={readOnly}
              onSelect={(accountPriority) =>
                commitCustomerPatch({
                  accountPriority:
                    accountPriority as PatchCustomer["accountPriority"],
                })
              }
            />
            <HeaderMetaPill
              label="Category"
              value={display.customerCategoryId ?? noCustomerCategoryValue}
              options={categoryOptions}
              icon={Tag01Icon}
              disabled={readOnly}
              onSelect={(value) =>
                commitCustomerPatch({
                  customerCategoryId:
                    value === noCustomerCategoryValue ? null : value,
                })
              }
            />
          </div>
        }
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
        <CardSection title="Customer details">
          <CardFormRow columns="four">
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
            <CardField label="Customer since">
              <ReadOnlyFieldValue>
                {display.createdAt ? formatDate(toDateOnlyString(display.createdAt)) : "-"}
              </ReadOnlyFieldValue>
            </CardField>
          </CardFormRow>
          <CardFormRow columns="halves">
            <CardField label="Shipping address" htmlFor="customer-shipping-address">
              <AddressBookInput
                id="customer-shipping-address"
                value={shippingAddress}
                options={addressOptions}
                placeholder="Shipping address"
                disabled={readOnly}
                onChange={(address) => applyCustomerAddress("shipping", address)}
                onAddNew={() => addressDialog.openNew("shipping")}
                onEdit={(option) => addressDialog.openEdit(option, "shipping")}
              />
            </CardField>
            <CardField label="Billing address" htmlFor="customer-billing-address">
              <AddressBookInput
                id="customer-billing-address"
                value={billingSameAsShipping ? null : billingAddress}
                sameAsShippingLabel={formatAddressInline(shippingAddress)}
                options={addressOptions}
                placeholder="Billing address"
                sameAsShipping
                disabled={readOnly}
                onChange={(address) => applyCustomerAddress("billing", address)}
                onAddNew={() => addressDialog.openNew("billing")}
                onEdit={(option) => addressDialog.openEdit(option, "billing")}
              />
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

        <OpenOrdersSection
          customerId={currentCustomerId}
          rows={openOrders}
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
      </CardPageBody>

      {deleteConfirm.dialog}

      {addressDialog.dialog}
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
      {
        ...textColumn<ContactGridRow>("name", "Name", !readOnly),
        cellRenderer: (params: ICellRendererParams<ContactGridRow>) => {
          const row = params.data;
          if (!row) return null;
          if (row.isNew || !row.name.trim()) return row.name ?? "";
          return (
            <button
              type="button"
              className="font-medium text-[var(--color-ink)] hover:underline"
              aria-label={`View activity for "${row.name}"`}
              onClick={() => onOpenStream({ id: row.id, name: row.name })}
            >
              {row.name}
            </button>
          );
        },
      },
      textColumn("title", "Role", !readOnly),
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
  note: { label: "Note", submitLabel: "Log note", placeholder: "Write a note… (@ to mention a contact)" },
  call: { label: "Call", submitLabel: "Log call", placeholder: "What happened on the call?" },
  email: { label: "Email", submitLabel: "Log email", placeholder: "Summarize the email…" },
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
  const [mention, setMention] = useState<{
    query: string;
    start: number;
    end: number;
  } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [streamSheetOpen, setStreamSheetOpen] = useState(false);
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
    mention === null
      ? []
      : contacts.filter(
          (contact) =>
            contact.name.trim() &&
            contact.name.toLowerCase().startsWith(mention.query.toLowerCase())
        );
  const insertMention = (name: string) => {
    if (!mention) return;
    const caret = mention.start + name.length + 2;
    setBody(
      (current) =>
        `${current.slice(0, mention.start)}@${name} ${current.slice(mention.end)}`
    );
    setMention(null);
    requestAnimationFrame(() => {
      const input = bodyRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };
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
        queryKey: queryKeys.customers.card(customerId),
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
      setMention(null);
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

  const pending = patchMutation.isPending;
  const error =
    createMutation.error ?? patchMutation.error ?? newProjectMutation.error;

  return (
    <CardSection
      title="Activity"
      count={`· ${rows.length}`}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-[var(--color-accent-ink)]"
          onClick={() => setStreamSheetOpen(true)}
        >
          View all →
        </Button>
      }
    >
      <div className="grid gap-(--space-5)">
        {!readOnly ? (
          <div className="grid gap-0 rounded-(--radius-md) border-[1.5px] border-[var(--color-line)] transition-[border-color,box-shadow] duration-(--duration-1) ease-(--ease-out) focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_4px_var(--color-accent-soft)]">
            <div className="flex flex-wrap items-center gap-(--space-2) p-(--space-4) pb-0">
              {(Object.keys(activityComposerMeta) as CustomerActivityType[]).map(
                (option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={type === option}
                    className={cn(
                      "rounded-full",
                      type === option &&
                        "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-soft)]"
                    )}
                    onClick={() => setType(option)}
                  >
                    {activityComposerMeta[option].label}
                  </Button>
                )
              )}
            </div>
            <div className="relative">
              <Textarea
                ref={bodyRef}
                value={body}
                rows={3}
                disabled={createMutation.isPending}
                aria-label={isTask ? "Task title" : "Activity notes"}
                placeholder={activityComposerMeta[type].placeholder}
                className="field-sizing-fixed border-0 bg-transparent shadow-none hover:border-0 focus-visible:border-0 focus-visible:shadow-none text-[length:var(--text-md)] leading-[var(--leading-md)]"
                onChange={(event) => {
                  const value = event.target.value;
                  setBody(value);
                  const caret = event.target.selectionStart ?? value.length;
                  const match = value
                    .slice(0, caret)
                    .match(/@([A-Za-z]+(?: [A-Za-z]+)?)$/);
                  setMention(
                    match
                      ? {
                          query: match[1],
                          start: caret - match[0].length,
                          end: caret,
                        }
                      : null
                  );
                }}
                onBlur={() => setMention(null)}
              />
              {mentionMatches.length > 0 ? (
                <div className="absolute bottom-full left-(--space-4) z-10 mb-(--space-1) grid min-w-56 rounded-(--radius-md) border border-[var(--color-line)] bg-[var(--color-surface)] py-(--space-2) shadow-md">
                  {mentionMatches.slice(0, 6).map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      className="flex items-center gap-(--space-3) px-(--space-4) py-(--space-2) text-left text-[length:var(--text-sm)] hover:bg-[var(--color-surface-2)]"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertMention(contact.name);
                      }}
                    >
                      <span className="flex size-(--space-12) shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] text-[length:var(--text-3xs)] text-[var(--color-ink-faint)]">
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
                <SelectTrigger aria-label="Project" size="sm" className="rounded-full">
                  <HugeiconsIcon
                    icon={Folder01Icon}
                    className="size-(--space-5) shrink-0 text-[var(--color-ink-faint)]"
                  />
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
                  <SelectSeparator />
                  <SelectItem
                    value={newProjectSentinel}
                    className="font-medium text-[var(--color-accent-ink)]"
                  >
                    <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
                    New project
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
                  className="rounded-full"
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

        <ActivityStreamLists
          openTasks={openTasks}
          timelineMonths={timelineMonths}
          readOnly={readOnly}
          pending={pending}
          today={today}
          onToggle={(args) => patchMutation.mutate(args)}
          onFilterChange={onFilterChange}
        />
      </div>

      <Sheet open={streamSheetOpen} onOpenChange={setStreamSheetOpen}>
        <SheetContent
          side="right"
          className="gap-0 overflow-hidden p-0 data-[side=right]:w-[min(560px,94vw)] data-[side=right]:sm:max-w-[min(560px,94vw)]"
        >
          <SheetHeader>
            <SheetTitle>Activity · {rows.length}</SheetTitle>
            <SheetDescription className="sr-only">
              The full activity stream for this customer.
            </SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-(--space-5) overflow-y-auto p-(--space-8)">
            <ActivityStreamLists
              openTasks={openTasks}
              timelineMonths={timelineMonths}
              readOnly={readOnly}
              pending={pending}
              today={today}
              onToggle={(args) => patchMutation.mutate(args)}
              onFilterChange={onFilterChange}
            />
          </div>
        </SheetContent>
      </Sheet>

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
                    variant="outline"
                    aria-pressed={newProjectStatus === status}
                    className={cn(
                      "rounded-full",
                      newProjectStatus === status &&
                        "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-soft)]"
                    )}
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

function ActivityStreamLists({
  openTasks,
  timelineMonths,
  readOnly,
  pending,
  today,
  onToggle,
  onFilterChange,
}: {
  openTasks: CustomerActivityRow[];
  timelineMonths: Array<{ label: string; entries: CustomerActivityRow[] }>;
  readOnly: boolean;
  pending: boolean;
  today: string;
  onToggle: (args: { activityId: string; status: "open" | "done" }) => void;
  onFilterChange: (filter: ActivityStreamFilter) => void;
}) {
  return (
    <>
        {!readOnly || openTasks.length > 0 ? (
          <div className="grid gap-(--space-2)">
            <div className="flex items-center gap-(--space-4)">
              <h3 className={styles.sectionHeading}>
                Upcoming · {openTasks.length}
              </h3>
              <div className="h-px flex-1 bg-[var(--color-line)]" />
            </div>
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
                    <button
                      type="button"
                      aria-label={`Complete "${task.title}"`}
                      disabled={readOnly || pending}
                      className="grid size-(--space-12) shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--color-line)] bg-[var(--color-surface)] text-transparent transition-colors duration-(--duration-1) ease-(--ease-out) outline-none hover:border-[var(--status-success-ink)] hover:bg-[var(--color-success-soft)] hover:text-[var(--status-success-ink)] focus-visible:border-[var(--color-accent)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() =>
                        onToggle({
                          activityId: task.id,
                          status: "done",
                        })
                      }
                    >
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        strokeWidth={2}
                        className="size-(--space-7)"
                      />
                    </button>
                    <span className="min-w-0 truncate text-[length:var(--text-sm)]">
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
                    <span className="flex-1" />
                    <span
                      className={cn(
                        "inline-flex h-(--space-16) items-center whitespace-nowrap rounded-full border px-(--space-6) font-mono text-[length:var(--text-xs)]",
                        !task.dueDate &&
                          "border-dashed border-[var(--color-line)] text-[var(--color-ink-faint)]",
                        task.dueDate && task.dueDate < today
                          ? "border-transparent bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                          : task.dueDate === today
                            ? "border-transparent bg-[var(--color-warning-soft)] text-[var(--color-accent-ink)]"
                            : task.dueDate
                              ? "border-[var(--color-line)] text-[var(--color-ink-faint)]"
                              : undefined
                      )}
                    >
                      {task.dueDate
                        ? `Due ${shortDayLabel(task.dueDate)}${
                            task.dueDate < today
                              ? " · Overdue"
                              : task.dueDate === today
                                ? " · Today"
                                : ""
                          }`
                        : "No due date"}
                    </span>
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
                          className="mt-(--space-1) size-(--space-12) rounded-full data-checked:border-transparent data-checked:bg-[var(--color-success-soft)] data-checked:text-[var(--status-success-ink)]"
                          onCheckedChange={() =>
                            onToggle({
                              activityId: entry.id,
                              status: "open",
                            })
                          }
                        />
                      ) : (
                        <span className="mt-(--space-1) flex size-(--space-16) shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-soft)]">
                          <HugeiconsIcon
                            icon={activityTimelineIcons[entry.type]}
                            className="size-(--space-7)"
                          />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-(--space-3)">
                          <span
                            className={cn(
                              "text-[length:var(--text-xs)] font-medium uppercase tracking-wide",
                              entry.type === "task"
                                ? "text-[var(--status-success-ink)]"
                                : "text-[var(--color-accent-ink)]"
                            )}
                          >
                            {activityComposerMeta[entry.type].label}
                            {entry.type === "task" ? " · Done" : ""}
                          </span>
                          {entry.createdByName ? (
                            <span className="text-[length:var(--text-xs)] font-medium text-[var(--color-ink)]">
                              {entry.createdByName}
                            </span>
                          ) : null}
                          <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                            {relativeDayLabel(timelineDate(entry))}
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
    </>
  );
}

function HeaderMetaPill({
  label,
  value,
  options,
  dotClassName,
  optionDots,
  icon,
  disabled,
  onSelect,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  dotClassName?: string;
  optionDots?: Record<string, string>;
  icon?: IconSvgElement;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          aria-label={`${label}: ${current?.label ?? value}`}
          disabled={disabled}
        >
          <span className="font-mono text-[length:var(--text-3xs)] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
            {label}
          </span>
          {dotClassName ? (
            <span className={cn("size-(--space-4) rounded-full", dotClassName)} />
          ) : null}
          {icon ? (
            <HugeiconsIcon
              icon={icon}
              className="size-(--space-5) text-[var(--color-ink-faint)]"
            />
          ) : null}
          {current?.label ?? value}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={option.value === value}
            onCheckedChange={() => onSelect(option.value)}
          >
            {optionDots?.[option.value] ? (
              <span
                className={cn(
                  "size-(--space-4) rounded-full",
                  optionDots[option.value]
                )}
              />
            ) : null}
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
      className="font-semibold text-[var(--color-accent-ink)] hover:underline"
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
      className="flex max-w-56 items-center gap-(--space-2) rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-(--space-3) py-(--space-1) text-[length:var(--text-xs)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
      onClick={onSelect}
    >
      <HugeiconsIcon icon={Folder01Icon} className="size-(--space-5) shrink-0" />
      <span className="truncate whitespace-nowrap">{name}</span>
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

function relativeDayLabel(date: Date) {
  const day = toDateOnlyString(date);
  const today = toDateOnlyString(new Date());
  const yesterday = toDateOnlyString(new Date(Date.now() - 86_400_000));
  if (day && day === today) return "Today";
  if (day && day === yesterday) return "Yesterday";
  return day ? shortDayLabel(day) : "";
}

function shortDayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const value = new Date(year, month - 1, date);
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(year === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
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
    nextTaskId: null,
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
