export type FieldErrorRecord = Record<string, string[]>;

type ValidationIssue = {
  path: PropertyKey[];
  message: string;
};

export function isFieldErrorRecord(value: unknown): value is FieldErrorRecord {
  if (typeof value !== "object" || value == null) {
    return false;
  }

  return Object.values(value).every(
    (messages) =>
      Array.isArray(messages) &&
      messages.every((message) => typeof message === "string"),
  );
}

export function fieldErrorsFromIssues(issues: ValidationIssue[]): FieldErrorRecord {
  const errors: FieldErrorRecord = {};
  for (const issue of issues) {
    const field =
      issue.path.length > 0 ? issue.path.map((part) => String(part)).join(".") : "form";
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

export function firstFieldErrorMessage(
  errors: FieldErrorRecord,
  fallback = "Invalid request.",
) {
  return Object.values(errors).flat()[0] ?? fallback;
}

export function formatFieldErrorMessage(errors: FieldErrorRecord) {
  return Object.entries(errors)
    .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
    .join("; ");
}
