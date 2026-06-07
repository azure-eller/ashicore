import Link from "next/link";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--color-bg)] px-(--space-8) py-(--space-20) text-[var(--color-ink)]">
      <section className="w-full max-w-md rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-(--space-12) shadow-[var(--shadow-sm)]">
        <div className="mb-(--space-8) grid size-(--space-16) place-items-center rounded-md border border-[var(--color-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]">
          <HugeiconsIcon icon={Search01Icon} size={24} aria-hidden />
        </div>
        <div className="space-y-(--space-4)">
          <p className="font-mono text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
            404
          </p>
          <h1 className="font-display text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold text-[var(--color-ink)]">
            Page not found
          </h1>
          <p className="text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink-soft)]">
            This page is not available in this workspace.
          </p>
        </div>
        <div className="mt-(--space-8) flex flex-wrap gap-(--space-4)">
          <Button asChild>
            <Link href="/sales/orders">Open sales orders</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
