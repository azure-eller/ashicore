"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useCardEntityActions } from "@/components/card-page/use-card-entity-actions";
import {
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import {
  AddressBookInput,
  useAddressBookDialog,
} from "@/components/card-page/address-book";
import {
  createCustomerDoc,
  deleteCustomer,
  getCustomerCard,
  updateCustomerDoc,
} from "@/lib/api/clients/customers";
import { useCardKernel } from "@/lib/card-kernel/use-card-kernel";
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
  updateCustomerSchema,
  type PatchCustomer,
  type UpdateCustomer,
} from "@/lib/schemas/customers";
import type {
  CustomerCategoryOption,
  CustomerDetailData,
  CustomerLinkedSalesOrderRow,
} from "@/lib/sales/types";
import { SalesOrderStatusBadge } from "./status-badge";
import {
  accountPriorityDots,
  accountPriorityOptions,
  accountStateDots,
  accountStateOptions,
} from "./customer-meta";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/client/query-keys";

import {
  ActivitySection,
  type ActivityStreamFilter,
} from "./customer-activity-stream";
import { ContactsSection } from "./customer-contacts-section";
import {
  billingAddressPatch,
  contactPayload,
  toDocContact,
  getCustomerBillingAddress,
  getCustomerShippingAddress,
  makeDraftCustomer,
  shippingAddressPatch,
  upsertById,
  type AddressTarget,
  type ContactGridRow,
  type CustomerAddressFields,
  type CustomerAddressOption,
} from "./customer-draft";

type CustomerPayload = Omit<UpdateCustomer, "expectedVersion">;

const CONTACT_PAYLOAD_KEYS = [
  "name",
  "title",
  "email",
  "phone",
  "addressEntryId",
  "roles",
] as const;

function serializeCustomer(draft: CustomerDetailData): {
  payload: CustomerPayload;
  pathAliases: Record<string, string>;
} {
  const contacts = draft.contacts.filter((contact) => contact.name.trim());
  const pathAliases: Record<string, string> = {};
  contacts.forEach((contact, index) => {
    for (const key of CONTACT_PAYLOAD_KEYS) {
      pathAliases[`contacts.${index}.${key}`] = `contacts.${contact.id}.${key}`;
    }
  });
  return {
    payload: {
      name: draft.name,
      customerCategoryId: draft.customerCategoryId,
      accountState: draft.accountState,
      accountPriority: draft.accountPriority,
      email: draft.email,
      phone: draft.phone,
      billingLine1: draft.billingLine1,
      billingLine2: draft.billingLine2,
      billingCity: draft.billingCity,
      billingRegion: draft.billingRegion,
      billingPostcode: draft.billingPostcode,
      billingCountry: draft.billingCountry,
      shipLine1: draft.shipLine1,
      shipLine2: draft.shipLine2,
      shipCity: draft.shipCity,
      shipRegion: draft.shipRegion,
      shipPostcode: draft.shipPostcode,
      shipCountry: draft.shipCountry,
      contacts: contacts.map(contactPayload),
    },
    pathAliases,
  };
}

type CustomerCardProps = {
  initialCustomerId: string | null;
  initialCustomer: CustomerDetailData | null;
  addresses: AddressEntry[];
  categories: CustomerCategoryOption[];
  crmLocked: boolean;
};

type OpenOrderGridRow = CustomerLinkedSalesOrderRow;
const noCustomerCategoryValue = "__no_customer_category__";

export function CustomerCard({
  initialCustomerId,
  initialCustomer,
  addresses,
  categories,
  crmLocked,
}: CustomerCardProps) {
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
  const [newCustomerId] = useState(() => crypto.randomUUID());
  const customerId = initialCustomerId ?? newCustomerId;

  const kernel = useCardKernel<CustomerDetailData, CustomerPayload>({
    entityType: "customer",
    id: customerId,
    initialServerDoc: initialCustomer,
    makeNewDoc: makeDraftCustomer,
    collections: { contacts: { idKey: "id" } },
    schema: updateCustomerSchema,
    serialize: serializeCustomer,
    create: (payload, opts) =>
      createCustomerDoc({ ...payload, id: customerId }, opts),
    update: (id, payload, opts) => updateCustomerDoc(id, payload, opts),
    onServerDoc: (doc) => {
      queryClient.setQueryData(queryKeys.customers.card(doc.id), doc);
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.root });
    },
    onCreated: (doc) => {
      reflectPersistedCardUrlWithoutNavigation(`/sales/customers/${doc.id}`);
    },
  });
  const isDraft = !kernel.isPersisted;
  const currentCustomerId = isDraft ? null : customerId;

  // Activity/project mutations invalidate this query; adopting its data keeps
  // the kernel doc's server-owned satellites (activities, projects) fresh.
  const customerQuery = useQuery({
    queryKey: queryKeys.customers.card(customerId),
    queryFn: () => getCustomerCard(customerId),
    initialData: initialCustomer ?? undefined,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const refreshedCustomer = customerQuery.data;
  const adoptServerDoc = kernel.adoptServerDoc;
  useEffect(() => {
    if (refreshedCustomer) adoptServerDoc(refreshedCustomer);
  }, [adoptServerDoc, refreshedCustomer]);

  const display = kernel.draft;
  const readOnly = Boolean(display.deletedAt);

  const actions = useCardEntityActions({
    entity: "customer-action",
    getId: () => (kernel.isPersisted ? customerId : null),
    flush: kernel.flush,
    invalidateQueryKeys: [queryKeys.customers.root],
    delete: {
      label: "Delete customer",
      run: (id) => deleteCustomer(id),
      navigateTo: "/sales/customers",
      confirm: {
        title: "Delete customer?",
        description: (
          <>
            This customer will be soft-deleted. Existing sales orders keep their customer snapshot.
          </>
        ),
      },
    },
  });

  const commitCustomerPatch = useCallback(
    (patch: PatchCustomer) => {
      if (readOnly) return;
      kernel.update((draft) => ({ ...draft, ...patch }));
    },
    [kernel, readOnly]
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

  const cardSaveState: CardSaveState = readOnly ? "readonly" : kernel.saveState;
  const cardSaveMessage = readOnly ? null : kernel.saveMessage;

  return (
    <CardPage>
      <CardPageHeader
        eyebrow="Customer"
        title={display.name.trim() || "New customer"}
        statusControl={
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
                ...(actions.deleteAction ? [actions.deleteAction] : []),
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
          <CardFormRow columns="four">
            <CardField label="Category" htmlFor="customer-category">
              <Select
                value={display.customerCategoryId ?? noCustomerCategoryValue}
                disabled={readOnly}
                onValueChange={(value) =>
                  commitCustomerPatch({
                    customerCategoryId:
                      value === noCustomerCategoryValue ? null : value,
                  })
                }
              >
                <SelectTrigger id="customer-category" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

        {crmLocked ? null : (
          <ContactsSection
            rows={display.contacts}
            onOpenStream={openContactStream}
            readOnly={readOnly || isDraft}
            onSave={(row) => {
              if (readOnly || isDraft) return;
              const contact = toDocContact(row as ContactGridRow);
              kernel.update((draft) => ({
                ...draft,
                contacts: upsertById(draft.contacts, contact),
              }));
            }}
            onDelete={(contactId) => {
              if (readOnly || isDraft) return;
              kernel.update((draft) => ({
                ...draft,
                contacts: draft.contacts.filter(
                  (contact) => contact.id !== contactId,
                ),
              }));
            }}
          />
        )}

        <OpenOrdersSection
          customerId={currentCustomerId}
          rows={openOrders}
        />

        {crmLocked ? null : (
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
        )}
      </CardPageBody>

      {actions.dialogs}

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
  disabled,
  onSelect,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  dotClassName?: string;
  optionDots?: Record<string, string>;
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
          className="h-(--height-header-control) rounded-full"
          aria-label={`${label}: ${current?.label ?? value}`}
          disabled={disabled}
        >
          <span className="font-mono text-[length:var(--text-3xs)] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
            {label}
          </span>
          {dotClassName ? (
            <span className={cn("size-(--space-4) rounded-full", dotClassName)} />
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

