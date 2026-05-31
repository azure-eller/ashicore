import type { SupplierRow } from "@/app/(dashboard)/purchasing/types";
import { ApiClientError, createApiJsonRequester } from "@/lib/client/api";
import type { InsertSupplier, PatchSupplier, UpdateSupplier } from "@/lib/schemas/suppliers";

export class SupplierApiError extends ApiClientError {
  constructor(
    message: string,
    status: number,
    fieldErrors?: Record<string, string[]>
  ) {
    super("SupplierApiError", message, status, fieldErrors);
  }
}

const json = createApiJsonRequester(
  ({ message, status, fieldErrors }) => new SupplierApiError(message, status, fieldErrors),
);

const jsonHeaders = { "Content-Type": "application/json" };

export async function getSupplierCard(supplierId: string) {
  return json<SupplierRow>(
    `/api/suppliers/${supplierId}`,
    undefined,
    "Failed to load supplier."
  );
}

export async function createSupplier(input: InsertSupplier) {
  return json<{ id: string; name: string }>(
    "/api/suppliers",
    {
      method: "POST",
      headers: jsonHeaders,
      body: input,
    },
    "Failed to create supplier."
  );
}

export async function updateSupplier(supplierId: string, input: UpdateSupplier) {
  return json<{ id: string }>(
    `/api/suppliers/${supplierId}`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: input,
    },
    "Failed to save supplier."
  );
}

export async function patchSupplier(
  supplierId: string,
  current: SupplierRow,
  input: PatchSupplier
) {
  return updateSupplier(supplierId, supplierToUpdateInput(current, input));
}

export async function deleteSupplier(supplierId: string) {
  return json<{ success: boolean }>(
    `/api/suppliers/${supplierId}`,
    { method: "DELETE" },
    "Failed to delete supplier."
  );
}

function supplierToUpdateInput(
  supplier: SupplierRow,
  patch: PatchSupplier
): UpdateSupplier {
  return {
    name: supplier.name,
    code: supplier.code,
    contactName: supplier.contactName,
    email: supplier.email,
    phone: supplier.phone,
    billingLine1: supplier.billingLine1,
    billingLine2: supplier.billingLine2,
    billingCity: supplier.billingCity,
    billingRegion: supplier.billingRegion,
    billingPostcode: supplier.billingPostcode,
    billingCountry: supplier.billingCountry,
    paymentTerms: supplier.paymentTerms,
    notes: supplier.notes,
    ...patch,
  };
}
