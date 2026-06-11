import type {
  CustomerActivityRow,
  CustomerContactRow,
  CustomerDetailData,
  CustomerProjectRow,
} from "@/lib/sales/types";
import { apiClientJson } from "@/lib/client/api";
import type {
  CustomerActivityInput,
  CustomerActivityPatch,
  CustomerContactInput,
  CustomerProjectInput,
} from "@/lib/schemas/customer-crm";
import type { InsertCustomer, PatchCustomer } from "@/lib/schemas/customers";

const json = apiClientJson;

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
      body: input,
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
      body: input,
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
      body: input,
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
      body: input,
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

