import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

type PasswordResetProps = {
  url: string;
};

export function PasswordReset({ url }: PasswordResetProps) {
  return (
    <EmailLayout preview="Reset your password">
      <Text style={emailStyles.eyebrow}>Account security</Text>
      <Heading style={emailStyles.heading}>Reset your password</Heading>
      <Text style={emailStyles.text}>
        A password reset was requested for your account.
      </Text>
      <Text style={emailStyles.action}>
        <Link style={emailStyles.button} href={url}>
          Reset password
        </Link>
      </Text>
      <Text style={emailStyles.fallback}>
        If the button does not work, open this link:{" "}
        <Link style={emailStyles.link} href={url}>
          {url}
        </Link>
      </Text>
    </EmailLayout>
  );
}
