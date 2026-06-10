import { EmailMfaForm } from "@/components/email-mfa-form";

export function TwoFactorForm({ next = "/" }: { next?: string }) {
  return <EmailMfaForm next={next} />;
}
