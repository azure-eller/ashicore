import "server-only";

import { Address, Contact, Phone, type Contacts } from "xero-node";
import { eq } from "drizzle-orm";
import { customers, suppliers } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { XeroError, extractXeroMessage, redactXeroError } from "./errors";
import { buildXeroIdempotencyKey } from "./idempotency";

type AddressInput = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};

export type XeroContactInput = {
  /** Local id used to persist the returned Xero contact id back. */
  id: string;
  /** Whether this id refers to a customer or supplier row. */
  source: "customer" | "supplier";
  name: string;
  email: string | null;
  phone: string | null;
  xeroContactId: string | null;
  /** Pay-to / bill-from style address — maps to Xero POBOX type. */
  billing: AddressInput | null;
  /** Ship-to / deliver-from style address — maps to Xero STREET type. */
  shipping: AddressInput | null;
};

function buildAddress(
  type: Address.AddressTypeEnum,
  input: AddressInput | null
): Address | null {
  if (!input) return null;
  const populated = [
    input.line1,
    input.line2,
    input.city,
    input.region,
    input.postcode,
    input.country,
  ].some((value) => value != null && value !== "");
  if (!populated) return null;

  return {
    addressType: type,
    addressLine1: input.line1 ?? undefined,
    addressLine2: input.line2 ?? undefined,
    city: input.city ?? undefined,
    region: input.region ?? undefined,
    postalCode: input.postcode ?? undefined,
    country: input.country ?? undefined,
  };
}

/**
 * Create or update a Xero contact for a local customer or supplier and
 * persist the returned `contactID` back to the local row. Idempotent on
 * retry within Xero's 6-minute window via a stable idempotency key.
 */
export async function upsertXeroContact(
  orgId: string,
  contact: XeroContactInput,
  tenantId: string,
  accountingApi: import("xero-node").AccountingApi
): Promise<string> {
  const addresses: Address[] = [];
  const billingAddress = buildAddress(Address.AddressTypeEnum.POBOX, contact.billing);
  if (billingAddress) addresses.push(billingAddress);
  const shippingAddress = buildAddress(
    Address.AddressTypeEnum.STREET,
    contact.shipping
  );
  if (shippingAddress) addresses.push(shippingAddress);

  const contactPayload: Contact = {
    name: contact.name,
    emailAddress: contact.email ?? undefined,
    addresses,
    phones: contact.phone
      ? [{ phoneNumber: contact.phone, phoneType: Phone.PhoneTypeEnum.DEFAULT }]
      : undefined,
  };
  if (contact.xeroContactId) {
    contactPayload.contactID = contact.xeroContactId;
  }

  const contacts: Contacts = { contacts: [contactPayload] };
  const idempotencyKey = buildXeroIdempotencyKey(
    orgId,
    contact.source,
    contact.id,
    contact.xeroContactId ? "update" : "create"
  );

  try {
    const response = contact.xeroContactId
      ? await accountingApi.updateOrCreateContacts(
          tenantId,
          contacts,
          undefined,
          idempotencyKey
        )
      : await accountingApi.createContacts(
          tenantId,
          contacts,
          undefined,
          idempotencyKey
        );

    const returned = response.body.contacts?.[0];
    if (!returned?.contactID) {
      throw new XeroError("Xero did not return a contact ID.", 502);
    }

    if (returned.contactID !== contact.xeroContactId) {
      await persistXeroContactId(orgId, contact, returned.contactID);
    }

    return returned.contactID;
  } catch (error) {
    if (error instanceof XeroError) throw error;
    console.error("Xero contact upsert failed:", redactXeroError(error));
    throw new XeroError(
      `Could not sync ${contact.source} to Xero: ${extractXeroMessage(error)}`,
      502
    );
  }
}

async function persistXeroContactId(
  orgId: string,
  contact: XeroContactInput,
  contactId: string
) {
  await withOrgContext(orgId, async (tx) => {
    if (contact.source === "customer") {
      await tx
        .update(customers)
        .set({ xeroContactId: contactId, updatedAt: new Date() })
        .where(eq(customers.id, contact.id));
    } else {
      await tx
        .update(suppliers)
        .set({ xeroContactId: contactId, updatedAt: new Date() })
        .where(eq(suppliers.id, contact.id));
    }
  });
}
