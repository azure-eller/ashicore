import { Heading, Link, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

type TeamInviteProps = {
  inviteUrl: string;
  organizationName: string;
  inviterName: string | null;
  roleLabel: string;
};

export function TeamInvite({
  inviteUrl,
  organizationName,
  inviterName,
  roleLabel,
}: TeamInviteProps) {
  const displayRole =
    roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1);

  return (
    <EmailLayout preview={`Invitation to ${organizationName}`}>
      <Text style={emailStyles.eyebrow}>Team invitation</Text>
      <Heading style={emailStyles.heading}>Join {organizationName}</Heading>
      <Text style={emailStyles.text}>
        You have been invited to collaborate in ashicore.
      </Text>
      <Text style={emailStyles.row}>
        <span style={emailStyles.rowLabel}>Company</span>
        <span style={emailStyles.rowValue}>{organizationName}</span>
      </Text>
      <Text style={emailStyles.row}>
        <span style={emailStyles.rowLabel}>Role</span>
        <span style={emailStyles.rowValue}>{displayRole}</span>
      </Text>
      {inviterName && (
        <Text style={emailStyles.row}>
          <span style={emailStyles.rowLabel}>Invited by</span>
          <span style={emailStyles.rowValue}>{inviterName}</span>
        </Text>
      )}
      <Text style={emailStyles.action}>
        <Link style={emailStyles.button} href={inviteUrl}>
          Accept invitation
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
