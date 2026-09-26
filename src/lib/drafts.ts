"use client";

/**
 * Unsaved edits, kept per record instead of guarding every way out of a form.
 * Leaving a form never asks; coming back to it restores what was typed.
 *
 * The JSON-safe part of a draft goes to localStorage, so a reload or a closed
 * tab keeps it. What cannot be serialised (picked images) stays in memory for
 * the life of the page. Storage can be unavailable (private mode, quota, a
 * blocked origin), so every read and write degrades to "no draft".
 */

const DRAFT_VERSION = 1;
/** A draft nobody came back to within a week is dropped on its next read. */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type DraftKind = "new-record-ai" | "new-record-quick" | "retry" | "source-document";

interface StoredDraft {
  v: number;
  savedAt: number;
  basis: string | null;
  data: unknown;
}

export interface Draft<T> {
  data: T;
  /** What the draft was made against, e.g. a document version; null when nothing. */
  basis: string | null;
}

const memory = new Map<string, unknown>();

export function draftKey(ledgerId: string, kind: DraftKind, id: string): string {
  return `draft:${ledgerId}:${kind}:${id}`;
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (value == null || typeof value !== "object") return false;
  const draft = value as Partial<StoredDraft>;
  return (
    draft.v === DRAFT_VERSION &&
    typeof draft.savedAt === "number" &&
    (draft.basis === null || typeof draft.basis === "string") &&
    "data" in draft
  );
}

/** `parse` checks the stored shape; anything it rejects reads as no draft. */
export function readDraft<T>(key: string, parse: (data: unknown) => T | null): Draft<T> | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    clearDraft(key);
    return null;
  }
  if (!isStoredDraft(stored) || Date.now() - stored.savedAt > DRAFT_MAX_AGE_MS) {
    clearDraft(key);
    return null;
  }
  const data = parse(stored.data);
  if (data == null) {
    clearDraft(key);
    return null;
  }
  return { data, basis: stored.basis };
}

export function writeDraft(key: string, data: unknown, basis: string | null = null): void {
  const stored: StoredDraft = { v: DRAFT_VERSION, savedAt: Date.now(), basis, data };
  try {
    window.localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Quota or a blocked origin: the draft lives only as long as the form.
  }
}

/** Keeps what localStorage cannot hold until the page goes away. */
export function keepDraftInMemory(key: string, value: unknown): void {
  memory.set(key, value);
}

export function takeDraftFromMemory<T>(key: string): T | undefined {
  const value = memory.get(key) as T | undefined;
  memory.delete(key);
  return value;
}

export function clearDraft(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clear where storage is unavailable.
  }
}
