"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CardPage,
  CardPageBody,
  CardSection,
} from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import {
  CardField,
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
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import {
  AddressBookInput,
  useAddressBookDialog,
} from "@/components/card-page/address-book";
import {
  createCustomer,
  deleteCustomer,
  getCustomerCard,
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
} from "@/lib/addresses";
import {
  formatDate,
  formatPrice,
  toDateOnlyString,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  customerDefaultValues,
  type PatchCustomer,
} from "@/lib/schemas/customers";
import type {
  CustomerCategoryOption,
  CustomerDetailData,
  CustomerLinkedSalesOrderRow,
} from "@/lib/sales/types";
import { SalesOrderStatusBadge } from "./status-badge";
import { queryKeys } from "@/lib/client/query-keys";

import {
  ActivitySection,
  type ActivityStreamFilter,
} from "./customer-activity-stream";
import { ContactsSection } from "./customer-contacts-section";
import {
  applyCustomerDraftOp,
  billingAddressPatch,
  customerEditableSnapshot,
  customerToInsertInput,
  getCustomerBillingAddress,
  getCustomerShippingAddress,
  makeDraftCustomer,
  saveCustomerOps,
  shippingAddressPatch,
  type AddressTarget,
  type CustomerAddressFields,
  type CustomerAddressOption,
  type CustomerDraftOp,
} from "./customer-draft";

type CustomerCardProps = {
  initialCustomerId: string | null;
  initialCustomer: CustomerDetailData | null;
  addresses: AddressEntry[];
  categories: CustomerCategoryOption[];
};

type OpenOrderGridRow = CustomerLinkedSalesOrderRow;
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

