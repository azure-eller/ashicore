import Link from "next/link";
import { LockPasswordIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SurfacePanel } from "@/components/surface-panel";
import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100svh-var(--space-24))] w-full max-w-2xl items-center justify-center px-(--space-12) py-(--space-24)">
      <SurfacePanel className="w-full p-(--space-16) text-center">
        <div className="mx-auto mb-(--space-8) grid size-(--space-16) place-items-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]">
          <HugeiconsIcon icon={LockPasswordIcon} size={22} strokeWidth={2} />
        </div>
        <h1 className="font-display text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold tracking-normal text-[var(--color-ink)]">Access not assigned yet</h1>
        <p className="mt-(--space-6) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink-faint)]">
          Your account is active, but your ERP permissions have not been assigned yet.
          Contact your team administrator to get access to inventory, sales, manufacturing,
          or purchasing.
        </p>
        <div className="mt-(--space-12) flex justify-center">
          <Button asChild variant="outline">
            <Link href="/settings/account">Open account settings</Link>
          </Button>
        </div>
      </SurfacePanel>
    </div>
  );
}
