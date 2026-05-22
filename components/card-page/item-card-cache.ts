import type { QueryClient } from "@tanstack/react-query";

import type { ItemCardDto } from "@/lib/api/clients/item-cards";

export function setItemCardFamilyQueryData(
  queryClient: QueryClient,
  itemId: string,
  nextCard: ItemCardDto,
) {
  queryClient.setQueryData<ItemCardDto>(["item-card", itemId], (current) => {
    if (!current) return nextCard;
    return {
      ...current,
      family: nextCard.family,
    };
  });
}
