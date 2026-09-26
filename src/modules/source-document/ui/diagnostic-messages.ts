import type { ProcessingFailureCode } from "@/modules/source-document/lifecycle";
import { diagnosticCodeCopy } from "@/copy/source-document";

export function diagnosticLabel(code: ProcessingFailureCode): string {
  switch (code) {
    case "ai_provider_unavailable":
      return diagnosticCodeCopy.aiProviderUnavailable;
    case "ai_schema_invalid":
      return diagnosticCodeCopy.aiSchemaInvalid;
    case "exchange_rate_failure":
      return diagnosticCodeCopy.exchangeRateFailure;
    case "storage_failure":
      return diagnosticCodeCopy.storageFailure;
    case "processing_unavailable":
      return diagnosticCodeCopy.processingUnavailable;
    case "request_bound_retry_exhausted":
      return diagnosticCodeCopy.requestBoundRetryExhausted;
    case "processing_timeout":
      return diagnosticCodeCopy.processingTimeout;
  }
}

export function diagnosticDescription(code: ProcessingFailureCode): string {
  switch (code) {
    case "ai_provider_unavailable":
      return diagnosticCodeCopy.aiProviderUnavailableDesc;
    case "ai_schema_invalid":
      return diagnosticCodeCopy.aiSchemaInvalidDesc;
    case "exchange_rate_failure":
      return diagnosticCodeCopy.exchangeRateFailureDesc;
    case "storage_failure":
      return diagnosticCodeCopy.storageFailureDesc;
    case "processing_unavailable":
      return diagnosticCodeCopy.processingUnavailableDesc;
    case "request_bound_retry_exhausted":
      return diagnosticCodeCopy.requestBoundRetryExhaustedDesc;
    case "processing_timeout":
      return diagnosticCodeCopy.processingTimeoutDesc;
  }
}
