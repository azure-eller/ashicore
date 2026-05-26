import { EmailMfaForm } from "@/components/email-mfa-form";

export function MfaSetupForm({ next = "/org-setup" }: { next?: string }) {
  return <EmailMfaForm mode="setup" next={next} />;
}
