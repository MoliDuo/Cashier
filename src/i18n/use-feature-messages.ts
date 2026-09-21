"use client";

import { useCallback, useMemo } from "react";
import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { FEATURE_MESSAGES, pickMessages } from "./client-feature-messages";
import { FEATURE_MESSAGE_VERSION } from "./feature-message-version";

type FeatureMessageStatus = "loading" | "success" | "error";
type Feature = keyof typeof FEATURE_MESSAGES;

export interface FeatureMessagesState {
  status: FeatureMessageStatus;
  data: Record<string, unknown> | null;
  messages: Record<string, unknown> | null;
  error: Error | null;
  retry: () => void;
}

function normalizeLocale(locale: string): "en" | "zh" {
  return locale === "zh" ? "zh" : "en";
}

function featureMessagesQuery(locale: string, feature: Feature) {
  const normalizedLocale = normalizeLocale(locale);
  return {
    queryKey: ["feature-messages", FEATURE_MESSAGE_VERSION, normalizedLocale, feature] as const,
    queryFn: async (): Promise<Record<string, unknown>> => {
      // The version in the URL and the immutable response header are what keep
      // a good catalog off the network. `cache: "force-cache"` added nothing on
      // top of that and replayed whatever the HTTP cache held regardless of
      // status, so one 404 or gateway error stayed pinned for the life of the
      // entry — the retry button re-read the same failure instead of the server.
      const response = await fetch(
        `/api/i18n/${normalizedLocale}/${feature}?v=${FEATURE_MESSAGE_VERSION}`,
        { credentials: "same-origin" }
      );
      if (!response.ok) {
        throw new Error(`Unable to load feature messages (HTTP ${response.status})`);
      }
      return (await response.json()) as Record<string, unknown>;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } as const;
}

export function preloadFeatureMessages(
  queryClient: QueryClient,
  locale: string,
  feature: Feature
): Promise<Record<string, unknown>> {
  return queryClient.ensureQueryData(featureMessagesQuery(locale, feature));
}

export function useFeatureMessages(
  locale: string,
  feature: Feature,
  availableMessages?: Record<string, unknown>
): FeatureMessagesState {
  const namespaces = FEATURE_MESSAGES[feature];
  const availableFeatureMessages = useMemo(
    () =>
      availableMessages != null && namespaces.every((namespace) => namespace in availableMessages)
        ? pickMessages(availableMessages, namespaces)
        : null,
    [availableMessages, namespaces]
  );
  const query = useQuery({
    ...featureMessagesQuery(locale, feature),
    enabled: availableFeatureMessages == null,
  });
  const refetch = query.refetch;
  const retry = useCallback(() => {
    if (availableFeatureMessages == null) void refetch();
  }, [availableFeatureMessages, refetch]);

  if (availableFeatureMessages != null) {
    return {
      status: "success",
      data: availableFeatureMessages,
      messages: availableFeatureMessages,
      error: null,
      retry,
    };
  }

  return queryState(query, retry);
}

function queryState(
  query: UseQueryResult<Record<string, unknown>, Error>,
  retry: () => void
): FeatureMessagesState {
  const messages = query.data ?? null;
  return {
    status: query.status === "pending" ? "loading" : query.status,
    data: messages,
    messages,
    error: query.error,
    retry,
  };
}
