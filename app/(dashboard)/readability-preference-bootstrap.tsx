"use client";

import { useEffect, useRef } from "react";
import { useReadability } from "@/app/readability-provider";
import {
  getReadabilityCookie,
  setReadabilityCookie,
} from "@/lib/readability-cookie";
import {
  READABILITY_OPTIONS,
  normalizeReadabilityOption,
  type ReadabilityOption,
} from "@/lib/schemas/account";

type ReadabilityResponse = {
  readability?: ReadabilityOption;
};

export function ReadabilityPreferenceBootstrap() {
  const { setReadability } = useReadability();
  const hasAttemptedBootstrap = useRef(false);

  useEffect(() => {
    if (hasAttemptedBootstrap.current) {
      return;
    }
    hasAttemptedBootstrap.current = true;

    const cookieValue = getReadabilityCookie();
    if (
      cookieValue != null &&
      READABILITY_OPTIONS.includes(cookieValue as ReadabilityOption)
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const response = await fetch("/api/account/preferences", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      const body = (await response.json().catch(() => null)) as ReadabilityResponse | null;

      if (!response.ok || !body?.readability || cancelled) {
        return;
      }

      const readability = normalizeReadabilityOption(body.readability);
      setReadability(readability);
      setReadabilityCookie(readability);
    })();

    return () => {
      cancelled = true;
    };
  }, [setReadability]);

  return null;
}
