import type { SupplierRow } from "@/lib/purchasing/types";
import { apiClientJson, apiJson } from "@/lib/client/api";
import type { InsertSupplier, UpdateSupplier } from "@/lib/schemas/suppliers";

const json = apiClientJson;

type DocSaveOptions = {
  idempotencyKey: string;
  keepalive?: boolean;
};

// Kernel save adapters use apiJson directly: the thrown ApiJsonError carries
// the response body, which the kernel reads for 409 {conflict, current}.
export async function createSupplierDoc(
  payload: InsertSupplier,
  opts: DocSaveOptions,
) {
  return apiJson<SupplierRow>("/api/suppliers", {
    method: "POST",
    body: payload,
    idempotencyKey: opts.idempotencyKey,
    keepalive: opts.keepalive,
    fallbackError: "Failed to create supplier.",
  });
}

export async function updateSupplierDoc(
  supplierId: string,
  payload: Omit<UpdateSupplier, "expectedVersion">,
  opts: DocSaveOptions & { expectedVersion: number | null },
) {
  return apiJson<SupplierRow>(`/api/suppliers/${supplierId}`, {
    method: "PUT",
    body: { ...payload, expectedVersion: opts.expectedVersion ?? undefined },
    idempotencyKey: opts.idempotencyKey,
    keepalive: opts.keepalive,
    fallbackError: "Failed to save supplier.",
  });
}

export async function deleteSupplier(supplierId: string) {
  return json<{ success: boolean }>(
    `/api/suppliers/${supplierId}`,
    { method: "DELETE" },
    "Failed to delete supplier."
  );
}
