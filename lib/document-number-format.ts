export type DocumentNumberPrefix = "PO" | "SO" | "MO";

const DOCUMENT_NUMBER_SENTINEL = Number.MAX_SAFE_INTEGER;

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function documentNumberPattern(prefix: DocumentNumberPrefix) {
  return `^${escapedRegExp(prefix)}-(?:[0-9]{4}-)?([0-9]{1,18})(?:[^0-9].*)?$`;
}

function parseDocumentNumberSuffix(value: string, prefix: DocumentNumberPrefix) {
  const match = value.match(new RegExp(documentNumberPattern(prefix)));
  if (!match?.[1]) return null;
  const suffix = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(suffix) ? suffix : null;
}

export function compareDocumentNumbers(
  left: string,
  right: string,
  prefix: DocumentNumberPrefix
) {
  const leftSuffix = parseDocumentNumberSuffix(left, prefix);
  const rightSuffix = parseDocumentNumberSuffix(right, prefix);
  const suffixCompare =
    (leftSuffix ?? DOCUMENT_NUMBER_SENTINEL) -
    (rightSuffix ?? DOCUMENT_NUMBER_SENTINEL);

  if (suffixCompare !== 0) return suffixCompare;

  return left.localeCompare(right, undefined, { numeric: true });
}
