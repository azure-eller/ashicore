import { DomainError } from "@/lib/errors/domain-error";

export class AllocationError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "AllocationError" });
  }
}
