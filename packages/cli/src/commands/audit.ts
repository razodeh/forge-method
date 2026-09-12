/**
 * `forge audit` — `20` §20.9's own consolidated audit report, a thin CLI layer over
 * `@forge/telemetry`'s own real `queryAuditEvents` (`packages/telemetry/src/audit.ts`). No new
 * event-producing code lives here — this module only queries, formats, and reports, per `PLAN-M11.md`
 * P13's own recorded Surface deviation.
 *
 * `--json` is this command's own first release: `22` §22.1 rule 4 ("`--json` output is a stable
 * contract from M6 onward") makes `AuditReport` below the schema this piece builds once and holds
 * stable from here on — the identical "a versioned TypeScript interface with a `v: 1` field, no
 * separate runtime-validated schema object" precedent `DoctorReport`/`RunStatusReport` (this codebase's
 * only two prior `--json` first-releases) already set, confirmed by reading both before choosing this
 * shape rather than inventing a new convention. `packages/telemetry/test/audit.test.ts` and
 * `packages/cli/test/commands/audit.test.ts` assert the full, exact set of top-level/`counts` keys this
 * schema commits to — the closest thing to schema conformance this codebase's own `--json` precedent
 * ever checks for any report.
 *
 * @see specs/20 §20.9
 * @see specs/22 §22.1
 * @see PLAN-M11.md P13
 */
import { ForgeError } from '@forge/core/errors';
import {
  AUDIT_CATEGORIES,
  queryAuditEvents,
  type AuditCategory,
  type AuditEntry,
  type AuditQueryOptions,
  type AuditUnreadableRun,
} from '@forge/telemetry/audit';
import { TelemetryError } from '@forge/telemetry/errors';

export interface AuditCommandContext {
  readonly projectRoot: string;
}

export interface AuditOptions {
  /** `forge audit --since <date>` — `20` §20.9's own literal flag. Parsing a caller-supplied date
   * string into a `Date` (and rejecting an invalid one) is this module's own job, not
   * `queryAuditEvents`'s — the same "the CLI layer parses, the query layer only takes a real `Date`"
   * split `--since`'s own real backing already documents for what a `Date` even means (see
   * `parseSince` below). */
  readonly since?: string;
  /** Restrict the report to a subset of `AUDIT_CATEGORIES` — `undefined` (the default) reports every
   * real category. */
  readonly categories?: readonly AuditCategory[];
}

export interface AuditReport {
  readonly v: 1;
  /** The real `--since` cutoff this report was generated with, ISO-8601, or `null` when none was
   * given — echoed back so a `--json` consumer never has to guess which invocation produced a given
   * report. */
  readonly since: string | null;
  /** Every real `AuditCategory` (`20` §20.9's own eight, `AUDIT_CATEGORIES`'s own order) mapped to how
   * many real entries this report found for it — present even for a category with zero entries (the
   * two categories with no real producer yet always appear here as `0`, not silently absent), so a
   * `--json` consumer can distinguish "queried and found none" from "not part of this schema." */
  readonly counts: Readonly<Record<AuditCategory, number>>;
  readonly entries: readonly AuditEntry[];
  /** Every real run this report could not fully read — `queryAuditEvents`'s own `unreadableRuns`,
   * carried straight through. Always present, even when empty, for the identical "don't silently omit
   * a field a `--json` consumer might need to branch on" reason `counts` already documents. */
  readonly unreadableRuns: readonly AuditUnreadableRun[];
}

/** A bare `new Date(raw)` accepts far more than `--since` should, in two distinct ways a gauntlet
 * critic round both caught:
 *
 * 1. `new Date('garbage')` produces an `Invalid Date` object (not a thrown error —
 *    `Number.isNaN(date.getTime())` is the only real way to detect it), and `new Date('')` produces the
 *    identical `Invalid Date` a caller who forgot to actually supply `--since` a value would trigger —
 *    both would otherwise silently apply *no* cutoff at all, rather than fail loudly on a real,
 *    likely-typo'd flag value.
 * 2. `new Date(raw)` for a non-ISO-8601 form (`'01/15/2026'`, `'March 2026'`, …) is *implementation-
 *    defined* per ECMA-262, and even for the one ISO-8601 form ECMA-262 does define completely without
 *    a timezone (a bare `'2026-01-15T00:00:00'`, no `Z`/offset), the spec mandates parsing it as the
 *    *host machine's own local time* — `QUALITY-BAR.md` R10's own determinism requirement ("no
 *    `Date.now()`... reliance on... running the piece's tests twice under `TZ` set to a non-UTC zone
 *    gives identical results") applies exactly as much to parsing a *caller-supplied* date as to reading
 *    the clock directly: two machines with different `TZ` (or different `--since` invocations of the
 *    identical flag value on the same machine at different times of year, under DST) would silently
 *    compute two different cutoffs for the identical `--since 2026-01-15T00:00:00`. Restricting
 *    `SINCE_PATTERN` to only the two ECMA-262 forms that are *not* timezone-ambiguous (a bare date,
 *    always UTC per spec; or a full date-time with an explicit `Z`/offset) closes this rather than
 *    merely warning about it in a doc comment.
 *
 * A gauntlet critic round's own second-round finding: the first version of this function threw a bare
 * `class AuditInvalidSinceError extends Error`, not a registered `ForgeError` — `QUALITY-BAR.md` R2
 * ("every error is a typed `ForgeError`") applies to this module exactly as it does to every other real
 * `@forge/cli` command's own flag validation (`init/parse-init-flags.ts`, `entry/parse-global-flags.ts`,
 * `commands/config.ts` all throw the identical registered `USR-002` for "a flag was given a value
 * outside its declared/accepted set" -- confirmed by reading `USR-002`'s own registry entry,
 * `packages/core/src/errors/codes.ts`, before reusing it here rather than inventing a second code for
 * the same shape of failure). */
const SINCE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

function parseSince(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;
  if (!SINCE_PATTERN.test(raw)) {
    throw new ForgeError('USR-002', { flag: '--since', value: raw });
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ForgeError('USR-002', { flag: '--since', value: raw });
  }
  return parsed;
}

function toQueryOptions(options: AuditOptions): AuditQueryOptions {
  const since = parseSince(options.since);
  // `exactOptionalPropertyTypes`: only assign `since`/`categories` when actually present, the same
  // "don't assign an explicit `undefined`" shape `@forge/telemetry/audit`'s own `toAuditEntry` already
  // takes for the identical reason.
  return {
    ...(since !== undefined && { since }),
    ...(options.categories !== undefined && { categories: options.categories }),
  };
}

function countByCategory(entries: readonly AuditEntry[]): Readonly<Record<AuditCategory, number>> {
  const counts = Object.fromEntries(AUDIT_CATEGORIES.map((category) => [category, 0])) as Record<
    AuditCategory,
    number
  >;
  for (const entry of entries) {
    counts[entry.category] += 1;
  }
  return counts;
}

/** The real `forge audit` report — every real, audit-relevant event this project has recorded, across
 * every real run, since the given cutoff (if any).
 *
 * `queryAuditEvents` already isolates a per-run failure into `unreadableRuns` (`@forge/telemetry/
 * audit`'s own doc comment); what it does *not*, and cannot, handle is a failure in listing `.forge/
 * state/runs` itself (`TELEMETRY-AUDIT-RUNS-LIST-FAILED` — a genuine EACCES/EIO on the runs directory
 * itself, not one run's own log) or any other raw `TelemetryError` escaping it. A gauntlet critic
 * round's own second-round finding: this was previously left unwrapped, escaping this function as a
 * bare `TelemetryError` a CLI caller has no registered code/remedy for. `@forge/telemetry`'s own
 * `errors.ts` doc comment states the convention directly ("`@forge/engine`... is where a caught
 * `TelemetryError` is wrapped into a real `ForgeError`") — `@forge/cli` is the identical kind of
 * caller one layer over, the same wrap `@forge/engine/dispatch/execute.ts`'s own `RUN-038` already
 * performs for a step-scoped `TelemetryError`, applied here via the step-less `RUN-076` a report
 * spanning every run (not one step) actually needs. */
export async function auditReport(
  ctx: AuditCommandContext,
  options: AuditOptions = {},
): Promise<AuditReport> {
  const queryOptions = toQueryOptions(options);
  let entries: readonly AuditEntry[];
  let unreadableRuns: readonly AuditUnreadableRun[];
  try {
    ({ entries, unreadableRuns } = await queryAuditEvents(ctx.projectRoot, queryOptions));
  } catch (cause) {
    if (!(cause instanceof TelemetryError)) throw cause;
    throw new ForgeError(
      'RUN-076',
      { telemetryCode: cause.code, telemetryMessage: cause.message },
      { cause },
    );
  }
  return {
    v: 1,
    since: queryOptions.since?.toISOString() ?? null,
    counts: countByCategory(entries),
    entries,
    unreadableRuns,
  };
}

const CATEGORY_LABELS: Readonly<Record<AuditCategory, string>> = {
  'gate-decision': 'Gate decisions',
  'ceiling-escalation': 'Tool-ceiling escalations',
  'policy-violation': 'Policy violations',
  'blocked-injection': 'Blocked injections',
  'redacted-secret': 'Redacted secrets',
  'destructive-confirmation': 'Destructive-operation confirmations',
  'mcp-call': 'MCP calls',
  'artifact-write': 'Artifact writes',
};

/** A human-readable line is a *report*, not the audit trail's own source of truth — the full,
 * untruncated `payload` is always available in `--json` mode (a stable contract, `AuditEntry.payload`
 * carried through with no loss). Truncating only this rendering, never the returned `AuditReport`
 * itself, is what a gauntlet critic round's own "a pathologically large payload could dump megabytes
 * into the human-readable report" finding actually calls for — the fix belongs in the one place that
 * only ever produces throwaway display text, not in the data. `JSON.stringify` already escapes any
 * literal newline/control character inside a string value (`'\n'` becomes the two characters `\`+`n`,
 * never a real line break), so the one real risk here is length, not line-breaking. */
const MAX_PAYLOAD_DISPLAY_LENGTH = 500;

function formatPayload(payload: unknown): string {
  const rendered = JSON.stringify(payload);
  if (rendered.length <= MAX_PAYLOAD_DISPLAY_LENGTH) return rendered;
  return `${rendered.slice(0, MAX_PAYLOAD_DISPLAY_LENGTH)}… (truncated for display; see --json for the full payload)`;
}

function formatEntry(entry: AuditEntry): string {
  const scope = [
    entry.runId,
    entry.stepId !== undefined ? `step:${entry.stepId}` : undefined,
    entry.laneId !== undefined ? `lane:${entry.laneId}` : undefined,
    entry.agentId !== undefined ? `agent:${entry.agentId}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
  return `    [${entry.ts}] ${entry.type} (${scope}) ${formatPayload(entry.payload)}`;
}

function formatUnreadableRun(run: AuditUnreadableRun): string {
  return `    ${run.runId}: ${run.error}`;
}

/** The real, human-readable `forge audit` report — `20` §20.9's own default output mode. Grouped by
 * category (`AUDIT_CATEGORIES`'s own fixed order, always all eight, even a category with zero real
 * entries — the same "report the honest zero, don't hide the category" stance `AuditReport.counts`
 * itself already takes) rather than one flat chronological list: `20` §20.9's own worked question
 * ("why is this line here?") is a question about *what kind* of privileged action happened, which a
 * category-grouped report answers directly and a flat list makes a reader re-derive by eye. */
export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(
    report.since === null
      ? 'forge audit — every recorded event, all time'
      : `forge audit — every recorded event since ${report.since}`,
  );
  lines.push('');

  for (const category of AUDIT_CATEGORIES) {
    const entriesForCategory = report.entries.filter((entry) => entry.category === category);
    lines.push(`${CATEGORY_LABELS[category]} (${String(report.counts[category])})`);
    if (entriesForCategory.length === 0) {
      lines.push('    (none recorded)');
    } else {
      for (const entry of entriesForCategory) {
        lines.push(formatEntry(entry));
      }
    }
    lines.push('');
  }

  if (report.unreadableRuns.length > 0) {
    lines.push(
      `Unreadable runs (${String(report.unreadableRuns.length)}) — excluded from every count above, not silently treated as zero events:`,
    );
    for (const run of report.unreadableRuns) {
      lines.push(formatUnreadableRun(run));
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
