"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

// Seeds a grid search box from ?q= (e.g. Ash "Show in table" links) and
// follows later soft navigations — which keep the page mounted — without
// clobbering what the user types in between.
export function useGridSearchParam() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [searchValue, setSearchValue] = useState(urlQuery);
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery);
    setSearchValue(urlQuery);
  }
  return [searchValue, setSearchValue] as const;
}
