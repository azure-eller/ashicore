import { addressKey, normalizeAddressFields } from "@/lib/format";

export type AddressEntryOptionFields = {
  id: string;
  label: string;
  contactName: string | null;
  contactPhone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
};

export type AddressEntryOption = {
  id: string;
  label: string;
  addressEntryId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
};

export function addressEntryToAddressOption(
  entry: AddressEntryOptionFields,
): AddressEntryOption | null {
  const normalized = normalizeAddressFields({
    line1: entry.line1,
    line2: entry.line2,
    city: entry.city,
    region: entry.region,
    postcode: entry.postcode,
    country: entry.country,
  });
  const id = addressKey(normalized);
  if (!id) return null;

  return {
    ...normalized,
    id,
    label: entry.label,
    addressEntryId: entry.id,
    contactName: entry.contactName,
    contactPhone: entry.contactPhone,
    deliveryInstructions: entry.deliveryInstructions,
    notes: entry.notes,
  };
}
