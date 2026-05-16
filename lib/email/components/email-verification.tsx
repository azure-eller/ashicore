import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

type EmailVerificationProps = {
  url: string;
};

export function EmailVerification({ url }: EmailVerificationProps) {
  return (
    <EmailLayout preview="Verify your email">
      <Text style={emailStyles.eyebrow}>Account security</Text>
      <Heading style={emailStyles.heading}>Confirm your email address</Heading>
      <Text style={emailStyles.text}>
        Confirm this address to activate your ashicore account.
      </Text>
      <Text style={emailStyles.action}>
        <Link style={emailStyles.button} href={url}>
          Verify email
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
