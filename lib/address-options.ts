import { allCountries, type CountryData } from "country-region-data";

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
