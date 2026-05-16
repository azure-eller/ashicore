import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100svh-var(--space-24))] w-full max-w-2xl items-center justify-center px-(--space-12) py-(--space-24)">
      <div className="w-full border bg-card p-(--space-16) text-center shadow-none">
        <h1 className="text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold tracking-[var(--tracking-tight)]">Access not assigned yet</h1>
        <p className="mt-(--space-6) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-muted-foreground">
          Your account is active, but your ERP permissions have not been assigned yet.
          Contact your team administrator to get access to inventory, sales, manufacturing,
          or purchasing.
        </p>
        <div className="mt-(--space-12) flex justify-center">
          <Button asChild variant="outline">
            <Link href="/settings">Open account settings</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
