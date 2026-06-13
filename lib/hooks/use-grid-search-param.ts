"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

// Seeds a grid search box from ?q= (e.g. Ash "Show in table" links) and
// follows later soft navigations — which keep the page mounted — without
// clobbering what the user types in between. The third element is the raw
// `?q=` value, for pages that react to link-driven searches (e.g. picking
// the workflow tab that contains the matches).
export function useGridSearchParam() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [searchValue, setSearchValue] = useState(urlQuery);
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery);
    setSearchValue(urlQuery);
  }
  return [searchValue, setSearchValue, urlQuery] as const;
}

type WorkflowTab = "open" | "done";

// A `?q=` link means "show me these rows": when the link's matches live
// entirely on the other workflow tab, switch to it once data is ready.
// Manual typing never flips tabs — only `urlQuery` transitions do.
export function useWorkflowTabForUrlQuery({
  urlQuery,
  searchValue,
  ready,
  openMatches,
  doneMatches,
  tab,
  onTabChange,
}: {
  urlQuery: string;
  searchValue: string;
  ready: boolean;
  openMatches: number;
  doneMatches: number;
  tab: WorkflowTab;
  onTabChange: (tab: WorkflowTab) => void;
}) {
  const [pickedUrlQuery, setPickedUrlQuery] = useState("");
  if (urlQuery !== pickedUrlQuery && ready && searchValue === urlQuery) {
    setPickedUrlQuery(urlQuery);
    if (urlQuery !== "") {
      if (tab === "open" && openMatches === 0 && doneMatches > 0) {
        onTabChange("done");
      } else if (tab === "done" && doneMatches === 0 && openMatches > 0) {
        onTabChange("open");
      }
    }
  }
}
