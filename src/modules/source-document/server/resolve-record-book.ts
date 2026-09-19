import type { BookPort } from "@/application/contracts";
import { ValidationError } from "@/lib/errors";

/**
 * Which book a manually entered record lands in. The web forms always send the
 * book the picker showed; without one (an older client, or an API call that
 * leaves it out) the first live book in switcher order is used. A ledger with
 * no live book cannot accept a manual record, so that is a validation failure
 * rather than a silent default.
 */
export async function resolveRecordBook(
  ledgerId: string,
  requestedBookId: string | null | undefined,
  books: Pick<BookPort, "get" | "list">
): Promise<{ id: string; timeZone: string | null }> {
  if (requestedBookId != null) {
    const requested = await books.get(ledgerId, requestedBookId);
    if (requested == null) throw new ValidationError("Unknown book");
    return { id: requested.id, timeZone: requested.timeZone };
  }
  const live = await books.list(ledgerId);
  const fallback = live[0] ?? null;
  if (fallback == null) throw new ValidationError("A book is required");
  return { id: fallback.id, timeZone: fallback.timeZone };
}
