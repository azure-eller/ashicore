import "server-only";

import {
  quickBooksQueryEndpoint,
  quickBooksRequest,
  quickBooksSqlString,
} from "./client";

type QuickBooksItem = {
  Id?: string;
  Name?: string;
  Sku?: string;
};

type ItemQueryResponse = {
  QueryResponse?: { Item?: QuickBooksItem[] };
};

type CreateItemResponse = {
  Item?: QuickBooksItem;
};

export async function ensureQuickBooksSalesServiceItem(
  orgId: string,
  accountId: string,
  item: { name: string; sku: string | null }
) {
  const itemName = item.sku?.trim() || item.name;
  const lookup = item.sku?.trim()
    ? `Sku = ${quickBooksSqlString(item.sku.trim())}`
    : `Name = ${quickBooksSqlString(itemName)}`;
  const found = await quickBooksRequest<ItemQueryResponse>(
    orgId,
    quickBooksQueryEndpoint(
      `select * from Item where ${lookup}`
    )
  );
  const existing = found.QueryResponse?.Item?.[0];
  if (existing?.Id) {
    return { id: existing.Id, name: existing.Name ?? itemName };
  }

  const created = await quickBooksRequest<CreateItemResponse>(orgId, "/item", {
    method: "POST",
    body: JSON.stringify({
      Name: itemName,
      Sku: item.sku?.trim() || undefined,
      Description: item.name,
      Type: "Service",
      IncomeAccountRef: { value: accountId },
      TrackQtyOnHand: false,
    }),
  });

  if (!created.Item?.Id) {
    throw new Error("QuickBooks did not return a service item id.");
  }
  return {
    id: created.Item.Id,
    name: created.Item.Name ?? itemName,
  };
}
