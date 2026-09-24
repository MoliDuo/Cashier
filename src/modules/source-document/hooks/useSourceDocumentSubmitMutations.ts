"use client";

import { useRef } from "react";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { createSourceDocumentAction } from "@/modules/source-document/server-actions/create";
import { editRetrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";
import type {
  CreatedRecordResult,
  RetrySourceDocumentResponseDto,
} from "@/modules/source-document/contracts";
import type {
  SourceDocumentInputControllerMessages,
  SourceDocumentSubmitPayload,
} from "./source-document-input-controller.types";
import { uploadSourceDocumentSubmissionImages } from "./source-document-submission-upload";
import { useSubmitProgress } from "./source-document-submit-progress";
import {
  requireSourceDocumentVersion,
  unwrapVersionedCommandResult,
} from "@/modules/source-document/command-results";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateVariables {
  payload: SourceDocumentSubmitPayload;
  clientSubmissionId: string;
  signal: AbortSignal;
}

interface RetryVariables {
  payload: SourceDocumentSubmitPayload;
  signal: AbortSignal;
}

interface CreateSubmissionIdentity {
  payload: SourceDocumentSubmitPayload;
  clientSubmissionId: string;
  uploadedPayload: SourceDocumentSubmitPayload | null;
}

type UseSourceDocumentSubmitMutationsOptions = {
  ledgerId: string;
  bookId?: string;
  messages: SourceDocumentInputControllerMessages;
  onSuccess?: (result: CreatedRecordResult) => void;
} & (
  | { mode: "create"; sourceDocumentId?: never; sourceDocumentVersion?: never }
  | { mode: "retry"; sourceDocumentId: string; sourceDocumentVersion: number }
);

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => resolve());
    } else {
      globalThis.setTimeout(resolve, 0);
    }
  });
}

function arraysEqual<T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
  equals: (leftItem: T, rightItem: T) => boolean
): boolean {
  const leftLength = left?.length ?? 0;
  if (leftLength !== (right?.length ?? 0)) return false;
  for (let index = 0; index < leftLength; index += 1) {
    if (!equals(left![index]!, right![index]!)) return false;
  }
  return true;
}

function sourceDocumentPayloadsEqual(
  left: SourceDocumentSubmitPayload,
  right: SourceDocumentSubmitPayload
): boolean {
  return (
    left.documentDate === right.documentDate &&
    left.timezone === right.timezone &&
    left.text === right.text &&
    arraysEqual(left.storedFileIds, right.storedFileIds, (leftId, rightId) => leftId === rightId) &&
    arraysEqual(
      left.images,
      right.images,
      (leftImage, rightImage) =>
        leftImage.file === rightImage.file && leftImage.mimeType === rightImage.mimeType
    )
  );
}

function snapshotPayload(payload: SourceDocumentSubmitPayload): SourceDocumentSubmitPayload {
  return {
    documentDate: payload.documentDate,
    ...(payload.timezone === undefined ? {} : { timezone: payload.timezone }),
    text: payload.text,
    storedFileIds: [...payload.storedFileIds],
    ...(payload.images === undefined
      ? {}
      : { images: payload.images.map((image) => ({ ...image })) }),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSourceDocumentSubmitMutations({
  ledgerId,
  mode,
  sourceDocumentId,
  sourceDocumentVersion,
  messages,
  onSuccess,
  bookId,
}: UseSourceDocumentSubmitMutationsOptions) {
  const {
    progress,
    setProgress,
    uploadControllerRef,
    setMonotonicProgress,
    handleSubmitError,
    finishUpload,
    canCancel,
    cancel,
  } = useSubmitProgress(messages);
  const createSubmissionIdentityRef = useRef<CreateSubmissionIdentity | null>(null);
  // -----------------------------------------------------------------------
  // Create mutation
  // -----------------------------------------------------------------------

  const createMutation = useLedgerMutation<
    Awaited<ReturnType<typeof createSourceDocumentAction>>,
    CreateVariables
  >(ledgerId, {
    invalidates: ["documents", "stats"],
    mutationFn: async (variables: CreateVariables) => {
      const currentIdentity = createSubmissionIdentityRef.current;
      let uploadedPayload =
        currentIdentity?.clientSubmissionId === variables.clientSubmissionId
          ? currentIdentity.uploadedPayload
          : null;
      if (uploadedPayload == null) {
        uploadedPayload = await uploadSourceDocumentSubmissionImages(
          ledgerId,
          variables.payload,
          { signal: variables.signal },
          setMonotonicProgress
        );
        if (
          createSubmissionIdentityRef.current?.clientSubmissionId === variables.clientSubmissionId
        ) {
          createSubmissionIdentityRef.current.uploadedPayload = uploadedPayload;
        }
      }
      setMonotonicProgress({ phase: "submitting", percent: 90 });
      const result = await createSourceDocumentAction(
        ledgerId,
        {
          ...(bookId == null ? {} : { bookId }),
          ...(uploadedPayload.text == null ? {} : { text: uploadedPayload.text }),
          storedFileIds: uploadedPayload.storedFileIds,
          ...(uploadedPayload.documentDate == null
            ? {}
            : { documentDate: uploadedPayload.documentDate }),
          ...(uploadedPayload.timezone == null ? {} : { timezone: uploadedPayload.timezone }),
        },
        variables.clientSubmissionId
      );
      return result;
    },
    successMessage: null,
    errorMessage: null,
    onSuccess: async (data, variables) => {
      try {
        if (
          createSubmissionIdentityRef.current?.clientSubmissionId === variables.clientSubmissionId
        ) {
          createSubmissionIdentityRef.current = null;
        }
        setMonotonicProgress({ phase: "complete", percent: 100 });
        await waitForPaint();
        onSuccess?.({
          sourceDocumentId: data.sourceDocumentId,
          documentDate: variables.payload.documentDate,
        });
      } finally {
        finishUpload(variables.signal);
      }
    },
    onError: (error, variables) => {
      handleSubmitError(error, messages.createError);
      finishUpload(variables.signal);
    },
  });

  // -----------------------------------------------------------------------
  // Retry mutation
  // -----------------------------------------------------------------------

  const retryMutation = useLedgerMutation<RetrySourceDocumentResponseDto, RetryVariables>(
    ledgerId,
    {
      invalidates: ["documents", "stats"],
      mutationFn: async (variables: RetryVariables) => {
        if (sourceDocumentId == null) throw new Error("No source document ID for retry");
        // Fail before uploading anything: a missing version must not upload
        // files or call the action, and the form content stays intact for retry.
        const expectedVersion = requireSourceDocumentVersion(
          sourceDocumentVersion,
          sourceDocumentId
        );
        const { payload } = variables;
        const uploadedPayload = await uploadSourceDocumentSubmissionImages(
          ledgerId,
          payload,
          { signal: variables.signal },
          setMonotonicProgress
        );
        setMonotonicProgress({ phase: "submitting", percent: 90 });
        const result = await editRetrySourceDocumentAction(
          ledgerId,
          sourceDocumentId,
          uploadedPayload,
          expectedVersion
        );
        return unwrapVersionedCommandResult(result);
      },
      successMessage: messages.retrySuccess,
      errorMessage: null,
      onSuccess: async (data, variables) => {
        try {
          setMonotonicProgress({ phase: "complete", percent: 100 });
          await waitForPaint();
          onSuccess?.({
            sourceDocumentId: sourceDocumentId!,
            documentDate: variables.payload.documentDate,
          });
        } finally {
          finishUpload(variables.signal);
        }
      },
      onError: (error, variables) => {
        handleSubmitError(error, messages.retryError);
        finishUpload(variables.signal);
      },
    }
  );

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  const activeMutation = mode === "retry" ? retryMutation : createMutation;

  const submit = (payload: SourceDocumentSubmitPayload) => {
    if (mode === "retry" && sourceDocumentId == null) return false;
    if (activeMutation.isPending || progress != null) return false;
    uploadControllerRef.current?.abort();
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setProgress({ phase: "preparing", percent: 0 });
    if (mode === "create") {
      const currentIdentity = createSubmissionIdentityRef.current;
      if (
        currentIdentity == null ||
        !sourceDocumentPayloadsEqual(currentIdentity.payload, payload)
      ) {
        createSubmissionIdentityRef.current = {
          payload: snapshotPayload(payload),
          clientSubmissionId: crypto.randomUUID(),
          uploadedPayload: null,
        };
      }
    }
    const startMutation = () => {
      if (controller.signal.aborted) {
        if (uploadControllerRef.current === controller) {
          uploadControllerRef.current = null;
          setProgress(null);
        }
        return;
      }
      if (mode === "retry") {
        if (sourceDocumentId == null) return;
        retryMutation.mutate({ payload, signal: controller.signal });
        return;
      }

      createMutation.mutate({
        payload,
        clientSubmissionId: createSubmissionIdentityRef.current!.clientSubmissionId,
        signal: controller.signal,
      });
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(startMutation);
    } else {
      globalThis.setTimeout(startMutation, 0);
    }
    return true;
  };

  return {
    isPending: activeMutation.isPending || progress != null,
    progress,
    submit,
    canCancel,
    cancel,
  };
}
