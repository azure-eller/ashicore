"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const handleRetry = () => {
    // Root-level errors often need a fresh server render; reset alone can replay
    // the same failed route cache and leave the user stuck on this card.
    window.location.reload();
  };

  return (
    <div className="flex min-h-svh items-center justify-center px-6 py-10">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-6 text-foreground shadow-sm">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The error was reported. Try the action again, or reload this section.
          </p>
        </div>
        <Button type="button" onClick={handleRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
