/** True when both selections hold the same ids in the same order. */
export function selectionMatches(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
