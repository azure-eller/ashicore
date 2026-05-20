import type {
  CustomerContactRow,
  CustomerDetailData,
  CustomerProjectRow,
} from "@/app/(dashboard)/sales/types";
import type { AddressEntry } from "@/lib/dal/addresses";
import type { CreateAddressEntry, UpdateAddressEntry } from "@/lib/schemas/addresses";
import type { CustomerContactInput, CustomerProjectInput } from "@/lib/schemas/customer-crm";
import type { InsertCustomer, PatchCustomer } from "@/lib/schemas/customers";

export class CustomerApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "CustomerApiError";
  }
}

async function parseError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  let fieldErrors: Record<string, string[]> | undefined;
  try {
    const body = (await response.json()) as {
      error?: string;
      errors?: Record<string, string[]>;
    };
    message = body.error ?? message;
    fieldErrors = body.errors;
  } catch {
    message = `${response.status} ${response.statusText}`;
  }
  throw new CustomerApiError(message, response.status, fieldErrors);
}

async function json<T>(path: string, init?: RequestInit, fallback = "Request failed") {
  const response = await fetch(path, init);
  if (!response.ok) return parseError(response, fallback);
  return (await response.json()) as T;
}

const jsonHeaders = { "Content-Type": "application/json" };

export async function getCustomerCard(customerId: string) {
  return json<CustomerDetailData>(
    `/api/customers/${customerId}`,
    undefined,
    "Failed to load customer."
  );
}

export async function createCustomer(input: InsertCustomer) {
  return json<{ id: string }>(
    "/api/customers",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
    "Failed to create customer."
  );
}

export async function patchCustomer(customerId: string, input: PatchCustomer) {
  return json<{ id: string }>(
    `/api/customers/${customerId}`,
    {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
    "Failed to save customer."
  );
}

export async function deleteCustomer(customerId: string) {
  return json<{ success: boolean }>(
    `/api/customers/${customerId}`,
    { method: "DELETE" },
    "Failed to delete customer."
  );
}

export async function createCustomerContact(
  customerId: string,
  input: CustomerContactInput
) {
  return json<CustomerContactRow>(
    `/api/customers/${customerId}/contacts`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
    "Failed to create contact."
  );
}

export async function updateCustomerContact(
  customerId: string,
  contactId: string,
  input: CustomerContactInput
) {
  return json<CustomerContactRow>(
    `/api/customers/${customerId}/contacts/${contactId}`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
    "Failed to save contact."
  );
}

export async function deleteCustomerContact(customerId: string, contactId: string) {
  return json<{ success: boolean }>(
    `/api/customers/${customerId}/contacts/${contactId}`,
    { method: "DELETE" },
    "Failed to remove contact."
  );
}

export async function createCustomerProject(
  customerId: string,
  input: CustomerProjectInput
) {
  return json<CustomerProjectRow>(
    `/api/customers/${customerId}/projects`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
    "Failed to create project."
  );
}

export async function updateCustomerProject(
  customerId: string,
  projectId: string,
  input: CustomerProjectInput
) {
  return json<CustomerProjectRow>(
    `/api/customers/${customerId}/projects/${projectId}`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
    "Failed to save project."
  );
}

export async function deleteCustomerProject(customerId: string, projectId: string) {
  return json<{ success: boolean }>(
    `/api/customers/${customerId}/projects/${projectId}`,
    { method: "DELETE" },
    "Failed to delete project."
  );
}

export async function createAddressEntry(input: CreateAddressEntry) {
  return json<AddressEntry>(
    "/api/addresses",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
    "Failed to create address."
  );
}

export async function updateAddressEntry(id: string, input: UpdateAddressEntry) {
  return json<AddressEntry>(
    `/api/addresses/${id}`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
    "Failed to update address."
  );
}
