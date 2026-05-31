import { formatAddressInline, type AddressLike } from "@/lib/format";

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
