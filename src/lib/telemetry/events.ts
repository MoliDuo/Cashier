/**
 * Every business event the app sends, with the props each one carries.
 *
 * Naming: `area.verb`, lower case, one dot (`record.submit`, `detail.edit`).
 * Props are types, codes, counts and durations only: never an amount, a note, a
 * merchant or book name, a search text, a token or an image's contents.
 * `ms` is a duration in milliseconds. The standard `$` events (`$op`,
 * `$dialog`, `$toast`, `$error`, `$screen`, `$vital`) are the SDK's own and are
 * sent through the helpers in `client.ts`.
 *
 * `telemetry-catalog.json` at the repository root describes these events for
 * the dashboard; `tests/unit/lib/telemetry/catalog.test.ts` keeps the two in step.
 */

/** Which form: a new record, or an edit-and-retry of an existing one. */
type RecordMode = "create" | "retry";

type PeriodRangeCode = "week" | "month" | "year" | "all" | "custom";

export type TelemetryEventMap = {
  /** The record form opened. `restored`: it came back with a kept draft. */
  "record.open": { mode: RecordMode; restored: boolean };
  /** The first time text, an image or the date is touched in a form. */
  "record.input": { mode: RecordMode; kind: "text" | "image" | "date"; count?: number };
  /** Submit pressed. `correlationId` also rides on the server's `processing.finished`. */
  "record.submit": {
    mode: RecordMode;
    correlationId: string;
    imageCount: number;
    chars: number;
    dateEdited: boolean;
  };
  /** The submit settled: the record was accepted (`ok`) or refused. */
  "record.result": {
    mode: RecordMode;
    correlationId: string;
    ok: boolean;
    ms: number;
    errorKind?: string;
  };
  /** The form closed without a successful submit. */
  "record.abandon": {
    mode: RecordMode;
    hadInput: boolean;
    submitting: boolean;
    imageCount: number;
    chars: number;
    openMs: number;
  };
  /** A kept draft was restored or thrown away. */
  "record.draft": { mode: RecordMode; action: "restore" | "discard" };

  /** A field of a record or one of its entries was written. `fields` are column names. */
  "detail.edit": { target: "document" | "entry"; fields: string[]; ok: boolean };

  /** The period changed from the bar, its picker or the stats page. */
  "period.switch": { tab: "entries" | "stats"; range: PeriodRangeCode; offset?: number };
  /** The filter dialog applied filters. `fields` names which ones are set, never their values. */
  "filter.apply": { fields: string[]; count: number };

  /** The statistics chart view changed. */
  "stats.view": { view: string };
  /** A statistics bar or slice was opened as a list. */
  "stats.drilldown": { kind: "category" | "date" };

  /** A setting was saved. `fields` names the setting keys, never their values. */
  "settings.change": {
    area: "ledger" | "categories" | "credential";
    action: "save" | "create" | "update" | "delete";
    fields?: string[];
  };

  /** A one-time code was requested. */
  "signin.code": { resend: boolean; ok: boolean; errorKind?: string };
  /** A sign-in attempt finished. */
  "signin.attempt": { method: "otp" | "passkey" | "dev"; ok: boolean; errorKind?: string };

  /** Standard `$error`, sent for the app's error boundary. */
  $error: { kind: "boundary"; source: string; name?: string; digest?: string };
  /** Standard `$toast`. Only the level: a toast's text may name a file or book. */
  $toast: { level: "success" | "error" | "warning" };
};

export type TelemetryEventName = keyof TelemetryEventMap;

/** The server-side events, sent with `sendServerEvent`. */
export type ServerEventMap = {
  /** A processing attempt reached its end. Carries the submitting `record.submit`'s correlation id. */
  "processing.finished": {
    outcome: "completed" | "failed" | "cancelled";
    /** Time from the submission being queued to this outcome. */
    ms: number;
    /** Runs this attempt has been given, this one included. */
    runs: number;
    errorKind?: string;
  };
};

export type ServerEventName = keyof ServerEventMap;
