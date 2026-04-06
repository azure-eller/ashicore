import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-2xl items-center justify-center px-6 py-12">
      <div className="w-full rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Access not assigned yet</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your account is active, but your ERP permissions have not been assigned yet.
          Contact your team administrator to get access to inventory, sales, manufacturing,
          or purchasing.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild variant="outline">
            <Link href="/settings/account">Open account settings</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
