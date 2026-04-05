import { Link, Text } from "@react-email/components";
import { EmailLayout } from "@/lib/email/components/layout";

type PasswordResetProps = {
  url: string;
};

export function PasswordReset({ url }: PasswordResetProps) {
  return (
    <EmailLayout preview="Reset your password">
      <Text style={sentence}>
        A password reset was requested for your account.
      </Text>
      <Text style={action}>
        <Link style={link} href={url}>
          Reset password &rarr;
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

const action: React.CSSProperties = {
  margin: 0,
};

const link: React.CSSProperties = {
  color: "#171717",
  fontSize: 13,
  fontWeight: 500,
  textDecoration: "underline",
  textUnderlineOffset: "3px",
};
