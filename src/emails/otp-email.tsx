import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
  Section,
} from "@react-email/components";
import * as React from "react";

interface OTPEmailCopy {
  preview: string;
  heading: string;
  intro: string;
  codeLabel: string;
  expiry: string;
  warning: string;
  footer: string;
}

interface OTPEmailProps {
  otp: string;
  host: string;
  expiresInMinutes: number;
  copy: OTPEmailCopy;
}

export default function OTPEmail({ otp, copy }: OTPEmailProps) {
  return (
    <Html lang="zh">
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{copy.heading}</Heading>
          <Section style={section}>
            <Text style={text}>{copy.intro}</Text>
            <Section style={codeSection}>
              <Text style={codeLabel}>{copy.codeLabel}</Text>
              <Text style={codeText}>{otp}</Text>
            </Section>
            <Text style={expiryText}>{copy.expiry}</Text>
          </Section>
          <Text style={warningText}>{copy.warning}</Text>
          <Text style={footer}>{copy.footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#ffffff",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};

const container = {
  margin: "0 auto",
  padding: "20px 0 48px",
  maxWidth: "560px",
};

const h1 = {
  fontSize: "24px",
  fontWeight: "600",
  lineHeight: "1.25",
  color: "#111827",
  marginBottom: "24px",
};

const section = {
  padding: "24px",
  border: "1px solid #e5e7eb",
  borderRadius: "12px",
  textAlign: "center" as const,
};

const text = {
  fontSize: "16px",
  lineHeight: "1.5",
  color: "#374151",
  marginBottom: "24px",
};

const codeSection = {
  margin: "24px 0",
  padding: "16px",
  backgroundColor: "#f9fafb",
  borderRadius: "8px",
};

const codeLabel = {
  fontSize: "14px",
  color: "#6b7280",
  marginBottom: "8px",
  textAlign: "center" as const,
};

const codeText = {
  fontSize: "48px",
  fontWeight: "700",
  fontFamily: "monospace",
  letterSpacing: "0.25em",
  color: "#111827",
  textAlign: "center" as const,
  margin: "0",
  userSelect: "all" as const,
};

const expiryText = {
  fontSize: "14px",
  color: "#6b7280",
  marginTop: "16px",
  marginBottom: "0",
  textAlign: "center" as const,
};

const warningText = {
  fontSize: "14px",
  color: "#dc2626",
  marginTop: "24px",
  padding: "12px",
  backgroundColor: "#fef2f2",
  borderRadius: "6px",
  textAlign: "center" as const,
};

const footer = {
  fontSize: "14px",
  color: "#6b7280",
  marginTop: "24px",
  textAlign: "center" as const,
};
