import {
  DomainError,
} from "@/lib/errors/domain-error";

export class InventoryError extends DomainError {
  constructor(message: string, status = 400) {
    super(message, status, { name: "InventoryError" });
  }
}
