/**
 * The band of light a source-document card carries while its document is being
 * processed. It is decoration: the card's accessible state is announced by the
 * header's live region, and this element is hidden from assistive tech and from
 * pointers. It is clipped by the card's own rounded corners and holds no
 * transform of its own beyond the sweep, which is why it must stay inside the
 * card rather than on the wrapper the stream list animates.
 */
export function ProcessingSweep() {
  return (
    <span
      aria-hidden="true"
      data-testid="source-document-processing-sweep"
      className="source-document-processing-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
    />
  );
}
