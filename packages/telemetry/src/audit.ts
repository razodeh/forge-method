/**
 * `queryAuditEvents` — `20` §20.9's own audit report, built as a pure aggregation/query layer over
 * `readEvents`'s own already-real, already-durable `ForgeEvent` log (`18` §18.4) rather than any new
 * event-producing code (`PLAN-M11.md` P13's own recorded Surface deviation: "no new event-producing
 * code needed for most categories").
 *
 * `20` §20.9 names eight audit-relevant categories. Six of them already have a real, already-registered
 * `EventType` a real producer somewhere in this codebase emits today (confirmed by grepping every real
 * `appendEvent`/`ctx.telemetry.emit` call site in `@forge/engine` before writing this module, not
 * assumed from the catalogue alone):
 *
 * - gate decisions            -> `GateEvaluated` / `GateApproved` / `GateRejected` / `GateWaived`
 * - tool-ceiling escalations  -> `EscalationActive` (not `StepEscalated`, a step-lifecycle status with
 *   no "approver and expiry" shape of its own -- `20` §20.9's own text, "with approver and expiry,
 *   shown in the TUI header while active," is `EscalationActive`'s own literal description, one row up
 *   in `18` §18.4's own Security group from `PolicyViolation`/`SecretRedacted`/`InjectionAttemptBlocked`)
 * - policy violations         -> `PolicyViolation`
 * - blocked injections        -> `InjectionAttemptBlocked`
 * - redacted secrets          -> `SecretRedacted`
 * - artifact writes           -> `ArtifactCreated` / `ArtifactUpdated` (`20` §20.9's own text says
 *   "every artifact write," not every artifact *validation* outcome -- `ArtifactValidated`/
 *   `ArtifactRejected` are deliberately excluded, the same restraint this module takes everywhere else:
 *   report what the catalogue actually distinguishes, not a broader category this piece invents)
 *
 * The remaining two categories genuinely have **no real event type to aggregate today**, confirmed by
 * direct investigation rather than assumed from this plan's own summary:
 *
 * - **destructive-operation confirmations**: `PLAN-M11.md` P11/S7's own `requireDestructiveConfirmation`
 *   (`@forge/engine/security/destructive-confirmation.ts`) is a pure decision function with no
 *   `appendEvent`/`ctx.telemetry.emit` call anywhere in its own module, and its one real call site
 *   (`@forge/cli`'s own `deployEnvironment`, `packages/cli/src/commands/loop/deploy.ts`) does not emit
 *   any event around the decision either -- confirmed empirically, not merely absent from `18` §18.4's
 *   catalogue. This plan's own P13 text anticipates exactly this ("if S7's own confirmation reuses an
 *   existing event type instead, this dependency resolves to 'none new'") and this piece's own build
 *   instructions are explicit: "do not invent an event that doesn't exist."
 * - **MCP calls**: `18` §18.4's catalogue has no dedicated MCP-call event type at all, and no production
 *   code anywhere in this workspace (`@forge/cli`'s own `mcp.ts`, `@forge/adapter-kit`) ever emits one.
 *   The Adapter group's own `SessionEvent` is free-form enough (`payload: unknown`) that a future MCP
 *   producer *could* choose to shape one as `{ server, tool, argumentDigest, outcome }`, but every real
 *   `SessionEvent` emitted anywhere today (`@forge/engine/dispatch/steps.ts`) carries only
 *   `{ sessionId }` -- inventing a payload-shape heuristic to guess which `SessionEvent`s are "really"
 *   MCP calls would misclassify real session-id-registration events with no spec basis for the guess.
 *
 * Both are still real, first-class `AuditCategory` values below (a future piece adding either producer
 * needs no change to this module to start being reported -- only a new case in `CATEGORY_EVENT_TYPES`)
 * -- they simply, honestly, always report zero entries today. See `SPEC-QUESTIONS.md` Q181.
 *
 * @see specs/20 §20.9
 * @see specs/18 §18.4
 * @see PLAN-M11.md P11
 * @see PLAN-M11.md P13
 * @see SPEC-QUESTIONS.md Q181
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

import { errorCode, errorMessage, readEvents, type EventType, type ForgeEvent } from './events.ts';
import { TelemetryError } from './errors.ts';

/** `20` §20.9's own eight named audit-relevant categories, one string-literal union — see this
 * module's own doc comment above for the full mapping and the two categories with no real producer
 * yet. */
export type AuditCategory =
  | 'gate-decision'
  | 'ceiling-escalation'
  | 'policy-violation'
  | 'blocked-injection'
  | 'redacted-secret'
  | 'destructive-confirmation'
  | 'mcp-call'
  | 'artifact-write';

/** Every real `AuditCategory`, in `20` §20.9's own listed order — exported so a caller (the CLI report
 * layer) can enumerate every category, including the two that report zero entries today, without
 * hand-maintaining a second copy of this list that could drift out of sync with `CATEGORY_EVENT_TYPES`
 * below. */
export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  'gate-decision',
  'ceiling-escalation',
  'policy-violation',
  'blocked-injection',
  'redacted-secret',
  'destructive-confirmation',
  'mcp-call',
  'artifact-write',
];

/** The one real mapping this whole module is built from — see the module doc comment for the
 * confirmed-by-investigation reasoning behind every line, including the two deliberately-empty
 * arrays. */
const CATEGORY_EVENT_TYPES: Readonly<Record<AuditCategory, readonly EventType[]>> = {
  'gate-decision': ['GateEvaluated', 'GateApproved', 'GateRejected', 'GateWaived'],
  'ceiling-escalation': ['EscalationActive'],
  'policy-violation': ['PolicyViolation'],
  'blocked-injection': ['InjectionAttemptBlocked'],
  'redacted-secret': ['SecretRedacted'],
  // No real EventType represents either category yet — see this module's own doc comment.
  'destructive-confirmation': [],
  'mcp-call': [],
  'artifact-write': ['ArtifactCreated', 'ArtifactUpdated'],
};

/** The reverse of `CATEGORY_EVENT_TYPES`, built once at module load rather than re-derived per query —
 * every real `EventType` this module actually classifies maps to exactly one `AuditCategory` (no
 * overlap in `CATEGORY_EVENT_TYPES`'s own arrays above), so a plain `Map` is enough; nothing here needs
 * to handle one event type mapping to more than one category. */
const EVENT_TYPE_TO_CATEGORY: ReadonlyMap<EventType, AuditCategory> = new Map(
  (Object.entries(CATEGORY_EVENT_TYPES) as [AuditCategory, readonly EventType[]][]).flatMap(
    ([category, eventTypes]) =>
      eventTypes.map((eventType): [EventType, AuditCategory] => [eventType, category]),
  ),
);

/** One audited event, tagged with the `AuditCategory` it belongs to — everything a report needs to
 * render a line, carried straight from the real `ForgeEvent` envelope with no re-shaping: `payload` is
 * already redacted (`appendEvent`'s own write-time `redactPayload` call, `20` §20.4) by the time it
 * ever reaches this module, so this module needs no redaction pass of its own. */
export interface AuditEntry {
  readonly category: AuditCategory;
  readonly runId: string;
  readonly seq: number;
  readonly ts: string;
  readonly type: EventType;
  readonly stepId?: string;
  readonly laneId?: string;
  readonly agentId?: string;
  readonly payload: unknown;
}

/** One real run whose event log this query could not fully read — a genuine, disclosable fact for a
 * report whose whole purpose (`20` §20.9: "the evidence trail") is resilience against exactly this
 * shape of gap, not something to swallow silently. A gauntlet critic round's own first finding: without
 * this, one corrupted or unreadable run (a genuine crash-shape `readEvents` already detects and throws
 * for — a torn mid-file write, a `seq` gap, an EACCES) aborted the *entire* aggregation, silently
 * producing zero output for every other, perfectly healthy run — the opposite of what an audit trail is
 * for. `error` is `errorMessage`'s own rendering (never the raw `TelemetryError`/`Error` object itself —
 * this module's own public surface stays plain data, matching every other field here). */
export interface AuditUnreadableRun {
  readonly runId: string;
  readonly error: string;
}

/** `queryAuditEvents`'s own real return: every classified entry this query *could* read, plus every run
 * it genuinely could not — never one silently standing in for the other. */
export interface AuditQueryResult {
  readonly entries: readonly AuditEntry[];
  readonly unreadableRuns: readonly AuditUnreadableRun[];
}

export interface AuditQueryOptions {
  /** Events with `ts` strictly before this cutoff are excluded. `undefined` (the default) applies no
   * cutoff at all — every real event this project has ever recorded, across every real run. */
  readonly since?: Date;
  /** Restrict the query to a subset of `AUDIT_CATEGORIES` — `undefined` (the default) queries every
   * real category, including the two that report zero entries today. An empty array is a real,
   * deliberate "match nothing" query, not treated the same as `undefined`: a caller that computes an
   * empty subset (e.g. from a CLI flag with no valid category left after validation) gets back an
   * empty result, not silently every category. */
  readonly categories?: readonly AuditCategory[];
}

function toAuditEntry(event: ForgeEvent, category: AuditCategory): AuditEntry {
  return {
    category,
    runId: event.runId,
    seq: event.seq,
    ts: event.ts,
    type: event.type,
    // `exactOptionalPropertyTypes` treats an explicit `stepId: undefined` as distinct from the
    // property being absent entirely — spreading conditionally (rather than always assigning the
    // `ForgeEvent`'s own possibly-`undefined` field directly) is what actually satisfies `AuditEntry`'s
    // own optional-not-nullable field types, the same shape `ForgeEvent` itself already has to take
    // wherever it constructs its own optional fields.
    ...(event.stepId !== undefined && { stepId: event.stepId }),
    ...(event.laneId !== undefined && { laneId: event.laneId }),
    ...(event.agentId !== undefined && { agentId: event.agentId }),
    payload: event.payload,
  };
}

/** Every real run id this project has ever recorded — a plain `.forge/state/runs/` directory listing,
 * read with `node:fs/promises` directly rather than `@forge/core/fs`: `@forge/telemetry` has no `core`
 * edge (`specs/02` §2.2 — `telemetry <- schemas` only, the same boundary `errors.ts`'s own doc comment
 * already documents for the identical reason), the same "reads the filesystem directly, `core` is
 * unreachable" stance `events.ts`'s own `appendEvent`/`readEvents` already take one level down. A
 * missing `runs/` directory (a project that has never run anything yet) is a legitimate, empty state,
 * not an error — mirrors `readEvents`'s own "no event log yet is not corruption" stance. `fs.readdir`'s
 * own order is filesystem-dependent — sorted explicitly (plain code-unit order, below) before any
 * caller ever sees it, the identical "the unordered read is contained here and never returned without
 * the sort immediately below" shape `@forge/vcs`'s own `listWorktreeAdminEntries` already takes for the
 * identical boundary reason (no `@forge/core` edge to reach `listDirEntriesSorted` with). */
async function listRunIds(projectRoot: string): Promise<readonly string[]> {
  const runsDir = path.join(projectRoot, '.forge', 'state', 'runs');
  let entries;
  try {
    // eslint-disable-next-line no-restricted-syntax -- sorted immediately below, see this function's own doc comment
    entries = await fsp.readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw new TelemetryError(
      {
        code: 'TELEMETRY-AUDIT-RUNS-LIST-FAILED',
        message: `Failed to list runs under "${runsDir}" while building an audit report: ${errorMessage(error)}`,
        remedy:
          'Verify the project root is correct and this process has permission to read .forge/state/.',
      },
      { cause: error },
    );
  }
  // `QUALITY-BAR.md` R10: a raw directory listing is unordered — sorted explicitly (plain code-unit
  // order, not `localeCompare`, for the identical "no host-locale-dependent collation" reason this
  // module's own `queryAuditEvents` sort below already documents) rather than trusted as-is.
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** `new Date(ts).getTime()` returns `NaN` for a malformed `ts` — a real possibility for a hand-edited
 * event log (`ts` is only shape-checked as a string by `events.ts`'s own `parseEventLine`, never
 * re-validated as parseable). Every relational comparison against `NaN` is `false`, which would
 * otherwise silently defeat both this module's `--since` exclusion and its own sort's tie-break: a
 * gauntlet critic round's own finding. Mapping a malformed `ts` to `+Infinity` instead makes it sort
 * last (visible at the end of a report, never silently interleaved as if it had a real, ordered
 * position) and never satisfy a `< sinceMs` exclusion (a `--since` cutoff can never have legitimately
 * known where an unparseable timestamp belonged, so it is never hidden by one). */
function tsToComparableMs(ts: string): number {
  const ms = new Date(ts).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** `20` §20.9's own consolidated audit query: every real event across every real run this project has
 * recorded, classified into one of `AUDIT_CATEGORIES` and filtered by `--since`, in stable
 * (`ts`, then `runId`, then `seq`) ascending order. `ts` (not `seq`) is the primary sort key since this
 * spans multiple runs, each with its own independent `seq` numbering — `runId`/`seq` are only a
 * deterministic tie-break for two real events sharing one `ts` (a real, unremarkable shape: `ts` is
 * millisecond-resolution wall-clock time supplied by the caller, and two events from two different
 * concurrent runs — or two same-millisecond events within one run — are a realistic, not pathological,
 * occurrence). Events whose `type` maps to no requested category (every non-audit-relevant `EventType`,
 * plus any audit-relevant one the caller excluded via `options.categories`) are silently skipped, the
 * same "not every event is this report's concern" stance `projectLedger`'s own doc comment already
 * takes for `UsageRecorded`.
 *
 * One run's own `readEvents` failing (a genuine `TelemetryError` — corruption, a `seq` gap, a read
 * failure) does not abort the whole query: it is caught per-run, recorded in the returned
 * `unreadableRuns`, and every other run is still read and reported. `AuditUnreadableRun`'s own doc
 * comment has the full "why a critic round caught this" reasoning — reusing `TelemetryError` naming for
 * the caught shape (rather than a bare `catch {}`) since a non-`TelemetryError` thrown here would be a
 * genuine, unexpected bug this module has no business silently swallowing. Whatever real entries a
 * failing run's own log yielded *before* the failure are still kept — a partial, honest read of a run
 * that failed partway through is more useful to an evidence trail than discarding everything it did
 * manage to read. */
export async function queryAuditEvents(
  projectRoot: string,
  options: AuditQueryOptions = {},
): Promise<AuditQueryResult> {
  const wantedCategories = new Set(options.categories ?? AUDIT_CATEGORIES);
  const sinceMs = options.since?.getTime();

  const runIds = await listRunIds(projectRoot);
  const entries: AuditEntry[] = [];
  const unreadableRuns: AuditUnreadableRun[] = [];
  for (const runId of runIds) {
    try {
      for await (const event of readEvents(projectRoot, runId)) {
        const category = EVENT_TYPE_TO_CATEGORY.get(event.type);
        if (category === undefined || !wantedCategories.has(category)) continue;
        // `event.ts` is only shape-checked as `typeof === 'string'` by `parseEventLine` (`events.ts`'s
        // own doc comment: `payload` is deliberately not checked further; the same leniency extends to
        // `ts` not being re-validated as a *parseable* date there) — a hand-crafted, non-`appendEvent`-
        // written line with `"ts": "not-a-date"` produces `tsMs`/`ts(A)`/`ts(b)` below all `NaN`. A bare
        // `NaN < sinceMs` is always `false` (every relational comparison against `NaN` is), which would
        // silently *never* exclude a malformed-`ts` event from a `--since` filter regardless of how far
        // in the past `--since` names — the opposite of "suspect data should be conspicuous," and a
        // real, adversarial-relevant gap for an audit trail specifically. Treating an unparseable `ts`
        // as `+Infinity` instead makes it sort last (never silently mixed into the middle of an
        // otherwise-chronological report) and never satisfy a "before this cutoff" exclusion — always
        // shown, flagged by its own visibly-malformed `ts` string in the rendered entry, rather than
        // hidden by a cutoff that could never have legitimately known where it belonged.
        const tsMs = tsToComparableMs(event.ts);
        if (sinceMs !== undefined && tsMs < sinceMs) continue;
        entries.push(toAuditEntry(event, category));
      }
    } catch (error) {
      if (!(error instanceof TelemetryError)) throw error;
      unreadableRuns.push({ runId, error: error.message });
    }
  }

  entries.sort((a, b) => {
    const tsDiff = tsToComparableMs(a.ts) - tsToComparableMs(b.ts);
    if (tsDiff !== 0) return tsDiff;
    // Plain code-unit-order comparison, never `localeCompare` (`QUALITY-BAR.md` R10): collation order
    // varies by the host's locale, and this ordering must be identical regardless of where `forge
    // audit` runs.
    if (a.runId < b.runId) return -1;
    if (a.runId > b.runId) return 1;
    return a.seq - b.seq;
  });

  return { entries, unreadableRuns };
}
