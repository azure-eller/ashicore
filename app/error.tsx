"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SurfacePanel } from "@/components/surface-panel";
import { Button } from "@/components/ui/button";
import { captureAppError } from "@/lib/observability/browser-sentry";

export default function AppError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    captureAppError(error, {
      route: pathname,
      source: "client_error_boundary",
      digest: error.digest,
      runtime: "browser",
    });
  }, [error, pathname]);

  const handleRetry = () => {
    // Root-level errors often need a fresh server render; reset alone can replay
    // the same failed route cache and leave the user stuck on this card.
    window.location.reload();
  };

  return (
    <div className="flex min-h-svh items-center justify-center px-(--space-12) py-(--space-20)">
      <SurfacePanel
        tone="background"
        className="w-full max-w-md space-y-(--space-8) p-(--space-12) shadow-none"
      >
        <div className="space-y-(--space-4)">
          <h1 className="text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold tracking-[var(--tracking-tight)]">Something went wrong</h1>
          <p className="text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-muted-foreground">
            The error was reported. Try the action again, or reload this section.
          </p>
        </div>
        <Button type="button" onClick={handleRetry}>
          Try again
        </Button>
      </SurfacePanel>
    </div>
  );
}
