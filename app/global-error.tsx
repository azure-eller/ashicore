"use client";

import { useEffect } from "react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { captureAppError } from "@/lib/observability/browser-sentry";
import "./globals.css";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    captureAppError(error, {
      source: "global_error_boundary",
      digest: error.digest,
      runtime: "browser",
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-svh items-center justify-center bg-[var(--color-bg)] px-(--space-8) py-(--space-20) text-[var(--color-ink)] antialiased">
          <section className="w-full max-w-md rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-(--space-12) shadow-[var(--shadow-sm)]">
            <div className="mb-(--space-8) grid size-(--space-16) place-items-center rounded-md border border-[var(--color-line)] bg-[var(--color-danger-soft)] text-[var(--status-danger-ink)]">
              <HugeiconsIcon icon={Alert02Icon} size={24} aria-hidden />
            </div>
            <div className="space-y-(--space-4)">
              <p className="font-mono text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
                System error
              </p>
              <h1 className="font-display text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold text-[var(--color-ink)]">
                Something went wrong
              </h1>
              <p className="text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink-soft)]">
                The error was reported. Reload the app to try again.
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-(--space-8) inline-flex h-(--height-input-md) items-center justify-center rounded-full bg-[var(--color-accent)] px-(--space-6) text-[length:var(--text-sm)] font-semibold leading-[var(--leading-sm)] text-[var(--color-accent-text)] shadow-[var(--shadow-sm)] transition-all duration-(--duration-1) ease-(--ease-out) hover:-translate-y-px hover:brightness-[0.97] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)]"
            >
              Reload app
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
