import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

type EmailLayoutProps = {
  preview: string;
  children: React.ReactNode;
};

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function EmailLayout({ preview, children }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brandRow}>
            <Text style={brandMark}>a</Text>
            <Text style={brandName}>ashicore</Text>
          </Section>
          <Section style={panel}>{children}</Section>
          <Text style={footer}>
            This message was sent by ashicore.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const emailStyles = {
  action: {
    margin: "28px 0 0",
  } satisfies React.CSSProperties,
  button: {
    backgroundColor: "#1c3d6b",
    color: "#ffffff",
    display: "inline-block",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: "20px",
    padding: "12px 18px",
    textDecoration: "none",
  } satisfies React.CSSProperties,
  eyebrow: {
    color: "#6a707a",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    lineHeight: "16px",
    margin: "0 0 10px",
    textTransform: "uppercase",
  } satisfies React.CSSProperties,
  fallback: {
    borderTop: "1px solid #dcdcd6",
    color: "#6a707a",
    fontSize: 12,
    lineHeight: "18px",
    margin: "28px 0 0",
    padding: "18px 0 0",
    wordBreak: "break-all",
  } satisfies React.CSSProperties,
  heading: {
    color: "#13161b",
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    lineHeight: "30px",
    margin: "0 0 16px",
  } satisfies React.CSSProperties,
  link: {
    color: "#1c3d6b",
    textDecoration: "underline",
  } satisfies React.CSSProperties,
  row: {
    borderTop: "1px solid #e8e8e3",
    margin: 0,
    padding: "12px 0",
  } satisfies React.CSSProperties,
  rowLabel: {
    color: "#6a707a",
    display: "inline-block",
    fontSize: 13,
    lineHeight: "20px",
    minWidth: 120,
  } satisfies React.CSSProperties,
  rowValue: {
    color: "#13161b",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: "20px",
  } satisfies React.CSSProperties,
  text: {
    color: "#3a3f48",
    fontSize: 15,
    lineHeight: "23px",
    margin: "0 0 16px",
  } satisfies React.CSSProperties,
};

const body: React.CSSProperties = {
  backgroundColor: "#f3f3f1",
  fontFamily,
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  margin: "0 auto",
  maxWidth: 560,
  padding: "40px 24px",
};

const brandRow: React.CSSProperties = {
  margin: "0 0 16px",
};

const brandMark: React.CSSProperties = {
  backgroundColor: "#1c3d6b",
  color: "#ffffff",
  display: "inline-block",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: "24px",
  margin: "0 10px 0 0",
  textAlign: "center",
  width: 24,
};

const brandName: React.CSSProperties = {
  color: "#13161b",
  display: "inline-block",
  fontSize: 17,
  fontWeight: 700,
  lineHeight: "24px",
  margin: 0,
};

const panel: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #dcdcd6",
  padding: "32px 30px",
};

const footer: React.CSSProperties = {
  color: "#6a707a",
  fontSize: 12,
  lineHeight: "18px",
  margin: "16px 0 0",
};
