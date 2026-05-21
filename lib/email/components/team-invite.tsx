import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

type TeamInviteProps = {
  inviteUrl: string;
  organizationName: string;
};

export function TeamInvite({
  inviteUrl,
  organizationName,
}: TeamInviteProps) {
  return (
    <EmailLayout preview={`Invitation to ${organizationName}`}>
      <Text style={emailStyles.eyebrow}>Team invitation</Text>
      <Heading style={emailStyles.heading}>Join {organizationName}</Heading>
      <Text style={emailStyles.text}>
        You have been invited to join {organizationName} on Ashicore. Please set
        up your account.
      </Text>
      <Text style={emailStyles.action}>
        <Link style={emailStyles.button} href={inviteUrl}>
          Set up account
        </Link>
      </Text>
      <Text style={emailStyles.fallback}>
        If the button does not work, open this link:{" "}
        <Link style={emailStyles.link} href={inviteUrl}>
          {inviteUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
