import type {
  CustomerActivityRow,
  CustomerDetailData,
  CustomerProjectRow,
} from "@/lib/sales/types";
import { apiClientJson, apiJson } from "@/lib/client/api";
import type {
  CustomerActivityInput,
  CustomerActivityPatch,
  CustomerProjectInput,
} from "@/lib/schemas/customer-crm";
import type { InsertCustomer, UpdateCustomer } from "@/lib/schemas/customers";

const json = apiClientJson;

const jsonHeaders = { "Content-Type": "application/json" };

type DocSaveOptions = {
  idempotencyKey: string;
  keepalive?: boolean;
};

export async function getCustomerCard(customerId: string) {
  return json<CustomerDetailData>(
    `/api/customers/${customerId}`,
    undefined,
    "Failed to load customer."
  );
}

// Kernel save adapters use apiJson directly: the thrown ApiJsonError carries
// the response body, which the kernel reads for 409 {conflict, current}.
export async function createCustomerDoc(
  payload: InsertCustomer,
  opts: DocSaveOptions,
) {
  return apiJson<CustomerDetailData>("/api/customers", {
    method: "POST",
    body: payload,
    idempotencyKey: opts.idempotencyKey,
    keepalive: opts.keepalive,
    fallbackError: "Failed to create customer.",
  });
}

export async function updateCustomerDoc(
  customerId: string,
  payload: Omit<UpdateCustomer, "expectedVersion">,
  opts: DocSaveOptions & { expectedVersion: number | null },
) {
  return apiJson<CustomerDetailData>(`/api/customers/${customerId}`, {
    method: "PUT",
    body: { ...payload, expectedVersion: opts.expectedVersion ?? undefined },
    idempotencyKey: opts.idempotencyKey,
    keepalive: opts.keepalive,
    fallbackError: "Failed to save customer.",
  });
}

export async function deleteCustomer(customerId: string) {
  return json<{ success: boolean }>(
    `/api/customers/${customerId}`,
    { method: "DELETE" },
    "Failed to delete customer."
  );
}

export async function createCustomerActivity(
  customerId: string,
  input: CustomerActivityInput
) {
  return json<CustomerActivityRow>(
    `/api/customers/${customerId}/activities`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: input,
    },
    "Failed to add activity."
  );
}

export async function patchCustomerActivity(
  customerId: string,
  activityId: string,
  input: CustomerActivityPatch
) {
  return json<CustomerActivityRow>(
    `/api/customers/${customerId}/activities/${activityId}`,
    {
      method: "PATCH",
      headers: jsonHeaders,
      body: input,
    },
    "Failed to update activity."
  );
}

export async function deleteCustomerActivity(
  customerId: string,
  activityId: string
) {
  return json<{ success: boolean }>(
    `/api/customers/${customerId}/activities/${activityId}`,
    { method: "DELETE" },
    "Failed to remove activity."
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
      body: input,
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
      body: input,
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

