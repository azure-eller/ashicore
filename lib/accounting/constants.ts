export const ACCOUNTING_PROVIDER_XERO = "xero";
export const ACCOUNTING_PROVIDER_QUICKBOOKS = "quickbooks";
export const ACCOUNTING_PROVIDERS = [
  ACCOUNTING_PROVIDER_XERO,
  ACCOUNTING_PROVIDER_QUICKBOOKS,
] as const;

export type AccountingProvider = (typeof ACCOUNTING_PROVIDERS)[number];

export const ACCOUNTING_PROVIDER_LABELS: Record<AccountingProvider, string> = {
  [ACCOUNTING_PROVIDER_XERO]: "Xero",
  [ACCOUNTING_PROVIDER_QUICKBOOKS]: "QuickBooks",
};
