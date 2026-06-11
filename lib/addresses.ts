import { allCountries, type CountryData } from "country-region-data";

/** Canonical six-field structured address. Compose, don't copy. */
export type StructuredAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};

export type AddressLike = Partial<StructuredAddress>;

/** Saved address-book entry fields shared by DAL rows and picker options. */
export type AddressEntryFields = StructuredAddress & {
  id: string;
  label: string;
  contactName: string | null;
  contactPhone: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Country / region options
// ---------------------------------------------------------------------------

export const DEFAULT_COUNTRY = "United States";

export type RegionOption = {
  value: string;
  label: string;
};

export type AddressOption = {
  value: string;
  label: string;
};

const countryByName = new Map(
  allCountries.map((country) => [country[0].toLowerCase(), country])
);

function countrySortKey(country: CountryData) {
  if (country[0] === DEFAULT_COUNTRY) return `0-${country[0]}`;
  if (country[0] === "Canada") return `1-${country[0]}`;
  if (country[0] === "Mexico") return `2-${country[0]}`;
  return `3-${country[0]}`;
}

export const COUNTRY_OPTIONS: AddressOption[] = [...allCountries]
  .sort((left, right) => countrySortKey(left).localeCompare(countrySortKey(right)))
  .map((country) => ({
    value: country[0],
    label: country[0],
  }));

export function normalizeCountry(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return countryByName.get(trimmed.toLowerCase())?.[0] ?? trimmed;
}

export function getRegionOptions(country: string | null | undefined): RegionOption[] {
  const normalizedCountry = normalizeCountry(country) ?? DEFAULT_COUNTRY;
  const countryData = countryByName.get(normalizedCountry.toLowerCase());
  if (!countryData) return [];

  return countryData[2].map(([name, code]) => ({
    value: code || name,
    label: name,
  }));
}

export function normalizeRegion(
  country: string | null | undefined,
  value: string | null | undefined
) {
  const trimmed = value?.trim().replace(/\.$/, "");
  if (!trimmed) return null;

  const lowerValue = trimmed.toLowerCase();
  const option = getRegionOptions(country).find(
    (region) =>
      region.value.toLowerCase() === lowerValue ||
      region.label.toLowerCase() === lowerValue
  );

  return option?.value ?? trimmed;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const STREET_SUFFIX_PATTERN =
  /\b(aly|alley|ave|avenue|blvd|boulevard|cir|circle|ct|court|dr|drive|hwy|highway|ln|lane|pkwy|parkway|pl|place|rd|road|st|street|ter|terrace|trl|trail|way)\b\.?/gi;

function splitStreetAndCity(value: string): { street: string; city: string } | null {
  const commaParts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (commaParts.length >= 2) {
    return {
      street: commaParts.slice(0, -1).join(", "),
      city: commaParts[commaParts.length - 1],
    };
  }

  const matches = [...value.matchAll(STREET_SUFFIX_PATTERN)];
  const suffix = matches.at(-1);
  if (suffix?.index == null) return null;

  const streetEnd = suffix.index + suffix[0].length;
  const street = value.slice(0, streetEnd).trim();
  const city = value.slice(streetEnd).trim();
  if (!street || !city || /\battn\b/i.test(city)) return null;

  return { street, city };
}

function splitOneLineUsAddress(value: string): AddressLike | null {
  const normalized = value.replace(/\s+/g, " ").replace(/\b([A-Z]{2})\./g, "$1").trim();
  const match = normalized.match(
    /^(.+?)\s*,?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/
  );
  if (!match) return null;
  const [, streetAndCity, region, postcode] = match;

  const split = splitStreetAndCity(streetAndCity);
  if (!split) return null;

  return {
    line1: split.street,
    city: split.city,
    region,
    postcode,
    country: DEFAULT_COUNTRY,
  };
}

export function normalizeAddressFields(address: AddressLike): StructuredAddress {
  const normalizedCountry = normalizeCountry(address.country);
  const normalized: StructuredAddress = {
    line1: address.line1?.trim() || null,
    line2: address.line2?.trim() || null,
    city: address.city?.trim() || null,
    region: normalizeRegion(normalizedCountry, address.region),
    postcode: address.postcode?.trim() || null,
    country: normalizedCountry,
  };

  if (
    normalized.line1 &&
    !normalized.line2 &&
    !normalized.city &&
    !normalized.region &&
    !normalized.postcode
  ) {
    const splitAddress = splitOneLineUsAddress(normalized.line1);
    if (!splitAddress) {
      return normalized;
    }

    return {
      ...normalized,
      ...splitAddress,
      country: normalized.country ?? splitAddress.country ?? DEFAULT_COUNTRY,
    };
  }

  return normalized;
}

export function emptyAddressFields(): StructuredAddress {
  return {
    line1: null,
    line2: null,
    city: null,
    region: null,
    postcode: null,
    country: null,
  };
}

export function isAddressBlank(address: AddressLike | null | undefined) {
  if (!address) return true;
  const normalized = normalizeAddressFields(address);
  return [
    normalized.line1,
    normalized.line2,
    normalized.city,
    normalized.region,
    normalized.postcode,
    normalized.country,
  ].every((part) => !part);
}

export function addressKey(address: AddressLike | null | undefined) {
  const normalized = address ? normalizeAddressFields(address) : emptyAddressFields();
  return [
    normalized.line1,
    normalized.line2,
    normalized.city,
    normalized.region,
    normalized.postcode,
    normalized.country,
  ]
    .map((part) => part ?? "")
    .join("\u001f")
    .replace(/^\u001f+|\u001f+$/g, "");
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a structured address into lines suitable for <pre>/whitespace-pre-wrap display.
 */
export function formatAddressLines(address: AddressLike): string[] {
  address = normalizeAddressFields(address);
  const lines: string[] = [];

  if (address.line1?.trim()) lines.push(address.line1.trim());
  if (address.line2?.trim()) lines.push(address.line2.trim());

  const cityLine = [address.city, address.region, address.postcode]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  if (cityLine) lines.push(cityLine);

  if (address.country?.trim()) lines.push(address.country.trim());

  return lines;
}

export function formatAddress(address: AddressLike): string {
  return formatAddressLines(address).join("\n");
}

export function formatAddressInline(address: AddressLike): string {
  return formatAddressLines(address).join(", ");
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export type AddressLabelFields = AddressLike & {
  label?: string | null;
};

export function makeUniqueAddressLabel(
  values: AddressLabelFields,
  existingLabels: Iterable<string>,
) {
  const explicitLabel = values.label?.trim();
  const baseLabel = explicitLabel || formatAddressInline(values) || "Address";
  if (explicitLabel) return baseLabel;

  const labels = new Set(existingLabels);
  let label = baseLabel;
  let suffix = 2;
  while (labels.has(label)) {
    label = `${baseLabel} (${suffix})`;
    suffix += 1;
  }
  return label;
}

// ---------------------------------------------------------------------------
// Picker options
// ---------------------------------------------------------------------------

export type AddressEntryOption = AddressEntryFields & {
  addressEntryId: string | null;
};

export function addressEntryToAddressOption(
  entry: AddressEntryFields,
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
