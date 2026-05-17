import { Heading, Text } from "@react-email/components";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

type MfaCodeProps = {
  code: string;
};

export function MfaCode({ code }: MfaCodeProps) {
  return (
    <EmailLayout preview="Your ashicore verification code">
      <Text style={emailStyles.eyebrow}>Account security</Text>
      <Heading style={emailStyles.heading}>Your verification code</Heading>
      <Text style={emailStyles.text}>
        Enter this code to continue signing in to ashicore.
      </Text>
      <Text style={codeStyle}>{code}</Text>
      <Text style={emailStyles.text}>
        This code expires shortly. If you did not request it, ignore this email.
      </Text>
    </EmailLayout>
  );
}

const codeStyle: React.CSSProperties = {
  color: "#13161b",
  fontSize: 32,
  fontWeight: 700,
  letterSpacing: "0.18em",
  lineHeight: "40px",
  margin: "22px 0",
  textAlign: "center",
};
