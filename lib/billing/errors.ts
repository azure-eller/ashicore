export class BillingConfigError extends Error {
  status = 503;
  // Keep operator diagnostics in `message`; API routes return this safe text.
  // Defaulting to `message` preserves existing errors that are already safe.
  publicMessage: string;

  constructor(
    message = "Stripe billing is not configured.",
    options?: { publicMessage?: string }
  ) {
    super(message);
    this.name = "BillingConfigError";
    this.publicMessage = options?.publicMessage ?? message;
  }
}
