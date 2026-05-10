import { Suspense } from "react";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { parseInventoryLedgerFilters } from "./filters";
import { LedgerTable } from "./ledger-table";
import {
  getInventoryLedger,
  getInventoryLedgerActorOptions,
  getInventoryLedgerItemOptions,
} from "./queries";
import InventoryLedgerLoading from "./loading";

export default async function InventoryLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleReadAccess("inventory");

  return (
    <Suspense fallback={<InventoryLedgerLoading />}>
      <InventoryLedgerData searchParams={searchParams} />
    </Suspense>
  );
}

async function InventoryLedgerData({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseInventoryLedgerFilters(await searchParams);
  const [initialData, actorOptions, itemOptions] = await Promise.all([
    getInventoryLedger(filters),
    getInventoryLedgerActorOptions(),
    getInventoryLedgerItemOptions(),
  ]);

  return (
    <LedgerTable
      initialData={initialData}
      initialFilters={filters}
      actorOptions={actorOptions}
      itemOptions={itemOptions}
    />
  );
}
