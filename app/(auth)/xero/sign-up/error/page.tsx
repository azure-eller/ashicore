import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldDescription, FieldGroup } from "@/components/ui/field";

const MESSAGES: Record<string, string> = {
  access_denied: "Xero authorization was declined.",
  active_org_required: "Choose an Ashicore organization before linking Xero.",
  callback_failed: "Xero could not finish the signup connection.",
  email_mismatch: "Sign in with the same email address used for Xero signup.",
  expired: "This Xero signup link has expired.",
  org_has_different_tenant:
    "This Ashicore organization is already connected to a different Xero organization.",
  state_mismatch: "The Xero signup security check failed.",
  tenant_connected_elsewhere:
    "This Xero organization is already connected to another Ashicore organization.",
  user_create_failed: "Ashicore could not create the user account.",
};

export default async function XeroSignupErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message =
    MESSAGES[reason ?? ""] ?? "Xero signup could not be completed.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Xero signup needs attention</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <FieldDescription>{message}</FieldDescription>
          <Button asChild>
            <a href="/api/xero/sign-up">Try again</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/settings#integrations">Open settings</a>
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
