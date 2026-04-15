import type { Metadata } from "next";
import Link from "next/link";
import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { getXeroConnection } from "@/lib/dal/xero";
import { XeroSection } from "./xero-section";

export const metadata: Metadata = {
  title: "Integrations",
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireModuleWriteAccess("sales");
  const { error } = await searchParams;
  const connection = await getXeroConnection();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="space-y-1.5">
        <Link
          href="/settings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Settings
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Connect external services to sync data with your ERP.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-6">
        <XeroSection connection={connection} error={error} />
      </div>
    </div>
  );
}
