"use client";

import { createContext, useContext } from "react";

type ItemCardFocusContextValue = {
  focusedItemId: string | null;
  setFocusedItemId: (itemId: string) => void;
};

const ItemCardFocusContext = createContext<ItemCardFocusContextValue | null>(null);

export const ItemCardFocusProvider = ItemCardFocusContext.Provider;

export function useItemCardFocus() {
  return useContext(ItemCardFocusContext);
}
