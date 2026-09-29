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
  /** How long the code lasts and what to do with an email you did not ask for. */
  note: string;
}

interface OTPEmailProps {
  otp: string;
  copy: OTPEmailCopy;
}

/** A heading, the code, and one line; the subject and preview already carry the code. */
export default function OTPEmail({ otp, copy }: OTPEmailProps) {
  return (
    <Html lang="zh">
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{copy.heading}</Heading>
          <Section style={codeSection}>
            <Text style={codeText}>{otp}</Text>
          </Section>
          <Text style={noteText}>{copy.note}</Text>
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

const codeSection = {
  margin: "0",
  padding: "16px",
  backgroundColor: "#f9fafb",
  borderRadius: "8px",
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

const noteText = {
  fontSize: "14px",
  color: "#6b7280",
  marginTop: "16px",
  textAlign: "center" as const,
};
