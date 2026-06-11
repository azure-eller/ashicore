import { apiClientJson } from "@/lib/client/api";
import type { AddressEntry } from "@/lib/dal/addresses";
import type { CreateAddressEntry, UpdateAddressEntry } from "@/lib/schemas/addresses";

const jsonHeaders = { "Content-Type": "application/json" };

export async function createAddressEntry(input: CreateAddressEntry) {
  return apiClientJson<AddressEntry>(
    "/api/addresses",
    {
      method: "POST",
      headers: jsonHeaders,
      body: input,
    },
    "Failed to create address."
  );
}

export async function updateAddressEntry(id: string, input: UpdateAddressEntry) {
  return apiClientJson<AddressEntry>(
    `/api/addresses/${id}`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: input,
    },
    "Failed to update address."
  );
}
