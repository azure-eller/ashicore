import { z } from "zod";
import { isValidIsoDate, nullableString } from "./shared";

export const CUSTOMER_CONTACT_ROLE_KEYS = [
  "primary",
  "shipping",
  "invoicing",
  "billing",
  "field",
] as const;

export const CUSTOMER_ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "meeting",
  "task",
] as const;

export const CUSTOMER_TASK_STATUSES = ["open", "done"] as const;

export const CUSTOMER_PROJECT_STATUSES = [
  "planning",
  "active",
  "hold",
  "done",
] as const;

export const customerContactRoleSchema = z.enum(CUSTOMER_CONTACT_ROLE_KEYS);
export const customerActivityTypeSchema = z.enum(CUSTOMER_ACTIVITY_TYPES);
export const customerTaskStatusSchema = z.enum(CUSTOMER_TASK_STATUSES);
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
});

export type CustomerContactInput = z.infer<typeof customerContactSchema>;

const nullableDateTime = nullableString
  .refine((value) => {
    if (value == null) return true;
    const [datePart] = value.split("T");
    return isValidIsoDate(datePart) && !Number.isNaN(new Date(value).getTime());
  }, "Must be a real datetime")
  .transform((value) => (value == null ? undefined : new Date(value)));

const activityDueDate = nullableString.refine(
  (value) => value == null || isValidIsoDate(value),
  "Date must be a real date in YYYY-MM-DD format"
);
const activityProjectId = nullableString.refine(
  (value) => value == null || z.string().uuid().safeParse(value).success,
  "Invalid project"
);

export const customerActivitySchema = z
  .object({
    type: customerActivityTypeSchema,
    occurredAt: nullableDateTime,
    title: nullableString,
    body: nullableString,
    dueDate: activityDueDate,
    customerProjectId: activityProjectId,
    attendeeContactIds: z.array(z.string().uuid()).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.type === "task") {
      if (!value.title?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["title"],
          message: "Title is required",
        });
      }
    } else {
      if (!value.body?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["body"],
          message: "Notes are required",
        });
      }
      if (value.dueDate != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dueDate"],
          message: "Only tasks can have a due date",
        });
      }
    }
  });

export type CustomerActivityInput = z.infer<typeof customerActivitySchema>;

export const customerActivityPatchSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(255).optional(),
    body: nullableString.optional(),
    dueDate: activityDueDate.optional(),
    status: customerTaskStatusSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required"
  );

export type CustomerActivityPatch = z.infer<typeof customerActivityPatchSchema>;

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



