"use client";

import { createContext, useContext } from "react";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import type { ItemCardDraftController } from "./use-item-card-draft-controller";

type ItemCardFocusContextValue = {
  focusedItemId: string | null;
  setFocusedItemId: (itemId: string | null) => void;
};

const ItemCardFocusContext = createContext<ItemCardFocusContextValue | null>(null);

export const ItemCardFocusProvider = ItemCardFocusContext.Provider;

export function useItemCardFocus() {
  return useContext(ItemCardFocusContext);
}

export type ItemCardContextValue = ItemCardFocusContextValue & {
  card: ItemCardDto;
  controller: ItemCardDraftController;
};

const ItemCardContext = createContext<ItemCardContextValue | null>(null);

export const ItemCardProvider = ItemCardContext.Provider;

export function useItemCardContext() {
  const context = useContext(ItemCardContext);
  if (!context) {
    throw new Error("useItemCardContext must be used inside ItemCardProvider");
  }
  return context;
}

export function useOptionalItemCardContext() {
  return useContext(ItemCardContext);
}
