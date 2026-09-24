"use client";

import { useTranslations } from "next-intl";
import type { ProcessingFailureCode } from "@/modules/source-document/lifecycle";

export function useDiagnosticMessages() {
  const t = useTranslations("DiagnosticCode");

  const label = (code: ProcessingFailureCode) => {
    switch (code) {
      case "ai_provider_unavailable":
        return t("ai_provider_unavailable");
      case "ai_schema_invalid":
        return t("ai_schema_invalid");
      case "exchange_rate_failure":
        return t("exchange_rate_failure");
      case "storage_failure":
        return t("storage_failure");
      case "processing_unavailable":
        return t("processing_unavailable");
      case "database_unavailable":
        return t("database_unavailable");
      case "request_bound_retry_exhausted":
        return t("request_bound_retry_exhausted");
      case "processing_timeout":
        return t("processing_timeout");
    }
  };

  const description = (code: ProcessingFailureCode) => {
    switch (code) {
      case "ai_provider_unavailable":
        return t("ai_provider_unavailable_desc");
      case "ai_schema_invalid":
        return t("ai_schema_invalid_desc");
      case "exchange_rate_failure":
        return t("exchange_rate_failure_desc");
      case "storage_failure":
        return t("storage_failure_desc");
      case "processing_unavailable":
        return t("processing_unavailable_desc");
      case "database_unavailable":
        return t("database_unavailable_desc");
      case "request_bound_retry_exhausted":
        return t("request_bound_retry_exhausted_desc");
      case "processing_timeout":
        return t("processing_timeout_desc");
    }
  };

  return {
    label,
    description,
    /** Title for a document the AI could not turn into any expense. */
    unparsableLabel: t("unparsable_document"),
    /** Fallback for a failed document that carries no reason of its own. */
    unparsableDescription: t("unparsable_document_desc"),
  };
}
