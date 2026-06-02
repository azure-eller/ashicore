import "server-only";

import {
  quickBooksQueryEndpoint,
  quickBooksRequest,
} from "@/lib/accounting/providers/quickbooks/client";

export type QuickBooksAccountOption = {
  code: string;
  name: string;
  type: string | null;
  class: string | null;
};

type QuickBooksAccountQueryResponse = {
  QueryResponse?: {
    Account?: Array<{
      Id?: string;
      Name?: string;
      AccountType?: string;
      Classification?: string;
      Active?: boolean;
    }>;
  };
};

export async function listQuickBooksAccounts(
  orgId: string
): Promise<QuickBooksAccountOption[]> {
  const data = await quickBooksRequest<QuickBooksAccountQueryResponse>(
    orgId,
    quickBooksQueryEndpoint(
      "select * from Account where Active = true order by Name"
    )
  );

  return (data.QueryResponse?.Account ?? [])
    .filter((account) => account.Id && account.Name)
    .map((account) => ({
      code: account.Id ?? "",
      name: account.Name ?? account.Id ?? "",
      type: account.AccountType ?? null,
      class: account.Classification ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
