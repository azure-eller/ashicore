import { EmailMfaForm } from "@/components/email-mfa-form";

export function MfaSetupForm({ next = "/org-setup" }: { next?: string }) {
  return (
    <div className="mx-auto w-full max-w-[420px]">
      <EmailMfaForm mode="setup" next={next} />
    </div>
  );
}
