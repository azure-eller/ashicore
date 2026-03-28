"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function useSmartBack(fallbackPath: string) {
  const router = useRouter();

  return useCallback(() => {
    if (document.referrer.startsWith(window.location.origin)) {
      router.back();
      return;
    }
    router.push(fallbackPath);
  }, [router, fallbackPath]);
}
