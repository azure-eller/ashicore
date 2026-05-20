import { z } from "zod";
import { isValidIsoDate, nullableString } from "./shared";

export const CUSTOMER_CONTACT_ROLE_KEYS = [
  "primary",
  "shipping",
  "invoicing",
  "billing",
  "field",
] as const;

export const CUSTOMER_CORRESPONDENCE_TYPES = [
  "note",
  "call",
  "email",
  "meeting",
] as const;

export const CUSTOMER_PROJECT_STATUSES = [
  "planning",
  "active",
  "hold",
  "done",
] as const;

export const customerContactRoleSchema = z.enum(CUSTOMER_CONTACT_ROLE_KEYS);
export const customerCorrespondenceTypeSchema = z.enum(
  CUSTOMER_CORRESPONDENCE_TYPES
);
export const customerProjectStatusSchema = z.enum(CUSTOMER_PROJECT_STATUSES);

export const customerContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  title: nullableString,
  email: nullableString.refine(
    (value) => value == null || z.string().email().safeParse(value).success,
    "Email must be valid"
  ),
  phone: nullableString,
  addressEntryId: nullableString.refine(
    (value) => value == null || z.string().uuid().safeParse(value).success,
    "Invalid address"
  ),
  roles: z.array(customerContactRoleSchema).default([]),
  notes: nullableString,
});

export type CustomerContactInput = z.infer<typeof customerContactSchema>;

const nullableDateTime = nullableString
  .refine((value) => {
    if (value == null) return true;
    const [datePart] = value.split("T");
    return isValidIsoDate(datePart) && !Number.isNaN(new Date(value).getTime());
  }, "Must be a real datetime")
  .transform((value) => (value == null ? undefined : new Date(value)));

export const customerCorrespondenceSchema = z.object({
  type: customerCorrespondenceTypeSchema,
  occurredAt: nullableDateTime,
  title: nullableString,
  body: z.string().trim().min(1, "Notes are required"),
  attendeeContactIds: z.array(z.string().uuid()).default([]),
});

export type CustomerCorrespondenceInput = z.infer<
  typeof customerCorrespondenceSchema
>;

const projectDate = nullableString.refine(
  (value) => value == null || isValidIsoDate(value),
  "Date must be a real date in YYYY-MM-DD format"
);

export const customerProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(255),
  status: customerProjectStatusSchema.default("planning"),
  startDate: projectDate,
  targetEndDate: projectDate,
  summary: nullableString,
});

export type CustomerProjectInput = z.infer<typeof customerProjectSchema>;

export const customerProjectFileRenameSchema = z.object({
  filename: z.string().trim().min(1, "Filename is required").max(255),
});

export type CustomerProjectFileRenameInput = z.infer<
  typeof customerProjectFileRenameSchema
>;
