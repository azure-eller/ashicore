import "server-only";

import {
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  ACCOUNTING_PROVIDER_XERO,
  type AccountingProvider,
} from "@/lib/accounting/constants";
import type { AccountingConnector } from "./types";
import { quickBooksAccountingConnector } from "./quickbooks/purchase-orders";
import { xeroAccountingConnector } from "./xero/purchase-orders";

const CONNECTORS: Record<AccountingProvider, AccountingConnector> = {
  [ACCOUNTING_PROVIDER_XERO]: xeroAccountingConnector,
  [ACCOUNTING_PROVIDER_QUICKBOOKS]: quickBooksAccountingConnector,
};

export function getAccountingConnector(provider: AccountingProvider) {
  return CONNECTORS[provider];
}

export function isAccountingProvider(value: string): value is AccountingProvider {
  return value === ACCOUNTING_PROVIDER_XERO || value === ACCOUNTING_PROVIDER_QUICKBOOKS;
}

export function getSupportedAccountingConnectors() {
  return Object.values(CONNECTORS);
}
