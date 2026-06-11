import type { QueryClient } from "@tanstack/react-query";

import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import { queryKeys } from "@/lib/client/query-keys";

export function setItemCardFamilyQueryData(
  queryClient: QueryClient,
  itemId: string,
  nextCard: ItemCardDto,
) {
  queryClient.setQueryData<ItemCardDto>(queryKeys.itemCards.detail(itemId), (current) => {
    if (!current) return nextCard;
    return {
      ...current,
      family: nextCard.family,
    };
  });
}
