import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { LedgerRefreshResult } from "@/modules/source-document/contract-refresh";
import { applyStreamRefreshToCache } from "@/modules/source-document/hooks/stream-refresh-cache";

function makeResult(overrides: Partial<LedgerRefreshResult> = {}): LedgerRefreshResult {
  return {
    version: "1",
    changed: false,
    hasTransitionalWork: false,
    invalidations: { categories: false, settings: false, stats: false },
    ...overrides,
  };
}

describe("applyStreamRefreshToCache", () => {
  it("does not invalidate anything for an unchanged signal", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    applyStreamRefreshToCache(client, makeResult());

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates only changed stream projections", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    client.setQueryData(["ledger", "source-documents", "refresh"], makeResult());

    await applyStreamRefreshToCache(client, makeResult({ changed: true }));

    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["ledger", "source-documents", "stream"], refetchType: "active" },
      {
        queryKey: ["ledger", "source-documents", "stream-total"],
        refetchType: "active",
      },
      { queryKey: ["ledger", "entries"], refetchType: "active" },
      { queryKey: ["ledger", "source-document"], refetchType: "active" },
    ]);
    expect(client.getQueryState(["ledger", "source-documents", "refresh"])?.isInvalidated).toBe(
      false
    );
  });

  it("invalidates category-bearing projections for category changes", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await applyStreamRefreshToCache(
      client,
      makeResult({ invalidations: { categories: true, settings: false, stats: false } })
    );

    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["ledger", "categories"], exact: true, refetchType: "active" },
      { queryKey: ["ledger", "source-documents", "stream"], refetchType: "active" },
      { queryKey: ["ledger", "entries"], refetchType: "active" },
      { queryKey: ["ledger", "source-document"], refetchType: "active" },
      { queryKey: ["ledger", "summary"], refetchType: "active" },
      { queryKey: ["ledger", "enhanced-stats"], refetchType: "active" },
    ]);
  });

  it("invalidates settings and stats families precisely", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await applyStreamRefreshToCache(
      client,
      makeResult({
        invalidations: { categories: false, settings: true, stats: true },
      })
    );

    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["ledger"], exact: true, refetchType: "active" },
      { queryKey: ["ledger", "settings"], exact: true, refetchType: "active" },
      { queryKey: ["ledger", "summary"], refetchType: "active" },
      { queryKey: ["ledger", "enhanced-stats"], refetchType: "active" },
      {
        queryKey: ["ledger", "source-documents", "stream-total"],
        refetchType: "active",
      },
    ]);
  });
});
