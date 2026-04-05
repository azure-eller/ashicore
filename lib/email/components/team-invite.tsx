import { Link, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/layout";

type TeamInviteProps = {
  inviteUrl: string;
  organizationName: string;
  inviterName: string | null;
  roleLabel: string;
};

const mono =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

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
      <Text style={sentence}>You have received an invitation.</Text>
      <Text style={row}>
        <span style={label}>Company</span>
        <span style={value}>{organizationName}</span>
      </Text>
      <Text style={row}>
        <span style={label}>Role</span>
        <span style={value}>{displayRole}</span>
      </Text>
      {inviterName && (
        <Text style={row}>
          <span style={label}>Invited by</span>
          <span style={value}>{inviterName}</span>
        </Text>
      )}
      <Text style={action}>
        <Link style={link} href={inviteUrl}>
          Accept invitation &rarr;
        </Link>
      </Text>
    </EmailLayout>
  );
}

const sentence: React.CSSProperties = {
  color: "#171717",
  fontSize: 15,
  lineHeight: "1.5",
  margin: "0 0 20px",
};

const row: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 13,
  lineHeight: "1.7",
  margin: 0,
  color: "#171717",
};

const label: React.CSSProperties = {
  color: "#999",
  display: "inline-block",
  minWidth: 110,
};

const value: React.CSSProperties = {
  color: "#171717",
};

const action: React.CSSProperties = {
  margin: "20px 0 0",
};

const link: React.CSSProperties = {
  color: "#171717",
  fontSize: 13,
  fontWeight: 500,
  textDecoration: "underline",
  textUnderlineOffset: "3px",
};
