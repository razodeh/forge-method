/**
 * `buildGateReport` — `10` §10.3's own rule 4: "every gate evaluation writes a `GateReport` artifact...
 * with the exact command output." This piece emits the *data* only; writing it to
 * `docs/forge/reports/gates/` as a real artifact document is `@forge/core`'s already-built front-matter
 * writer's job (`GateReport`'s own doc comment in `types.ts` has the fuller reasoning for why this type is
 * deliberately not `@forge/schemas`' identically-named artifact type).
 *
 * A pure function of `(gate, result)` alone — no wall-clock read, no injected `now` — is exactly what makes
 * rule 3's own idempotence ("gates are re-runnable and idempotent") checkable at all: re-evaluating the
 * identical gate against identical check output must produce a byte-identical report, which a report
 * carrying its own generation timestamp could never satisfy. `waiver.ts`'s own `waiverAppliedAt` does not
 * threaten this: it is copied straight through from `result`, itself already fixed by `applyWaiver` at the
 * `now` it was actually called with, not freshly read here.
 *
 * `gateId` and `openQuestionsPolicy` are sourced from `gate` (the definition being reported on), not
 * `result` — properties of the gate itself, declared once regardless of any particular evaluation, unlike
 * `passed`/`checks`/`waiver`/`waiverAppliedAt`, which are properties of *this* evaluation. A verify round
 * found an earlier version split these inconsistently (`gateId` from `gate`, `openQuestionsPolicy` from
 * `result`) with no real reason for the difference — for any output of the real `evaluateGate`→
 * `applyWaiver` pipeline the two sources always agree anyway (`evaluateGate` itself only ever copies both
 * from the same `gate` it was given), so this only matters for a caller passing a mismatched `(gate,
 * result)` pair directly, which this piece treats as caller error to route consistently, not a case to
 * specially detect.
 *
 * `renderGateReportFile` (`PLAN-M14.md` P17) is the writer this doc comment above anticipated: the real,
 * schema-conformant `GateReport` document `10` §10.3 rule 4 calls the audit trail, split into
 * `@forge/schemas`' base front matter (plus `gate`/`outcome`/`evaluatedAt`, `gate-report.ts`) and a
 * Markdown body with one section per deterministic check, the advisory checks listed as not run, and the
 * waiver in force. Like `buildGateReport` it is pure: every value that varies by *when* it runs (`id`,
 * `evaluatedAt`) is a caller-supplied argument, never read here (`21` §21.1) — the same "no wall-clock
 * read" discipline, so a caller that re-renders the identical `(id, gate, report, runId, evaluatedAt)`
 * tuple gets a byte-identical file back.
 *
 * A check's `stdout`/`stderr` are the one genuinely untrusted piece of this document (arbitrary command
 * output, not engine- or project-authored text): both go through `sanitizedCheckText`
 * (`sanitizeResultText`, the identical sanitiser an agent session's own answer goes through,
 * `result-record.ts:88`) before they are ever embedded, capped at `MAX_GATE_REPORT_CHECK_TEXT_BYTES` with
 * a marker rather than left unbounded. `recordChecks` (`approve.ts`) digests this SAME text, not the raw
 * check result, so a reader can sha256 the fenced block in a written report and get back exactly the
 * digest an approval or waiver event recorded — this piece's own "the digests verify against it."
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 * @see PLAN-M14.md P17
 */
import * as YAML from 'yaml';

import { sanitizeResultText } from '../dispatch/result-record.ts';
import { isApproved } from './waiver.ts';
import type { GateDefinition, GateEvaluationResult, GateReport } from './types.ts';

export function buildGateReport(gate: GateDefinition, result: GateEvaluationResult): GateReport {
  return {
    gateId: gate.id,
    passed: result.passed,
    approved: isApproved(result),
    checks: result.checks,
    waiver: result.waiver,
    waiverAppliedAt: result.waiverAppliedAt,
    openQuestionsPolicy: gate.openQuestionsPolicy,
  };
}

/** How much of a check's stdout/stderr the written report keeps, sanitised and capped — generous enough
 * for a real tool's full JSON/log output, bounded enough that a runaway or hostile check cannot grow the
 * report without limit (`10` §10.3 rule 4's own "the exact command output", not an unbounded one). */
export const MAX_GATE_REPORT_CHECK_TEXT_BYTES = 1024 * 1024;

/** A check's stdout/stderr exactly as the written report renders it, and as `recordChecks` (`approve.ts`)
 * digests it: sanitised (terminal escapes, control bytes, invisible/bidi characters stripped; secret
 * shapes redacted) and capped at `MAX_GATE_REPORT_CHECK_TEXT_BYTES` with a truncation marker, through the
 * identical `sanitizeResultText` an agent session's own result text goes through. One shared function so
 * the two call sites can never sanitise or cap differently and silently disagree. */
export function sanitizedCheckText(text: string): string {
  return sanitizeResultText(text, MAX_GATE_REPORT_CHECK_TEXT_BYTES).text;
}

/** `text` as a fenced code block whose own fence is wider than the longest run of backticks already
 * inside it (CommonMark's own escaping rule, the same "widen past the longest run" defence `codeSpan`
 * takes for an inline span, `interaction/review-report.ts`) — untrusted command output containing a
 * stray ` ``` ` must never be able to close the block early and forge a heading or a second front-matter
 * block later in the file. */
function fencedBlock(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** `report`'s own verdict, `10` §10.3 rule 1: every deterministic check passed (`passed`), a recorded
 * waiver covers what failed (`waived` — `report.waiver` is set only once a waiver has actually been
 * applied, `waiver.ts`'s own `applyWaiver`), or neither (`failed`). */
export function gateReportOutcome(report: GateReport): 'passed' | 'failed' | 'waived' {
  if (report.passed) return 'passed';
  return report.waiver === undefined ? 'failed' : 'waived';
}

export interface GateReportFileInput {
  /** This document's own registry id (`GATE-###`, `18` §18.7) — distinct from `gate.id` (the gate
   * definition being reported on, e.g. `G-Design`). */
  readonly id: string;
  readonly gate: GateDefinition;
  readonly report: GateReport;
  readonly runId: string;
  /** The real instant this evaluation ran, as the caller's own clock produced it (`21` §21.1) — never
   * read here. Used verbatim for the front matter's `evaluatedAt` and sliced to a date for
   * `created`/`updated`. */
  readonly evaluatedAt: string;
}

/** `gate check`/`approve`/`waive`'s own gatekeeper byline — no person or agent authored this document; the
 * engine rendered it from a real evaluation, the same convention the stub template
 * (`templates/artifacts/GateReport.md`) already ships with. */
const REPORT_AUTHOR = 'gatekeeper';

/** The base front matter (`18` §18.6) plus `gate`/`outcome`/`evaluatedAt` (`gate-report.ts`). */
function gateReportFrontMatter(input: GateReportFileInput): Record<string, unknown> {
  const { id, gate, report, runId, evaluatedAt } = input;
  const outcome = gateReportOutcome(report);
  const date = evaluatedAt.slice(0, 10);
  return {
    id,
    type: 'GateReport',
    schemaVersion: 1,
    title: `${gate.id} gate evaluation (run ${runId})`,
    status: outcome,
    created: date,
    updated: date,
    revision: 1,
    author: REPORT_AUTHOR,
    run: runId,
    changelog: [],
    gate: gate.id,
    outcome,
    evaluatedAt,
  };
}

/** One `## <checkId>` section per deterministic check: `run`, `exitCode`, `passed`, `failOn` (from the
 * gate's own declared check — `DeterministicCheckResult` itself carries no `failOn`), `reason` when the
 * evaluator gave one, then the sanitised, capped `stdout`/`stderr` fenced (`10` §10.3 rule 4: "the exact
 * command output"). */
function renderCheckSections(gate: GateDefinition, report: GateReport): string[] {
  const lines: string[] = [];
  for (const check of report.checks) {
    const declared = gate.checks.deterministic.find((candidate) => candidate.id === check.checkId);
    lines.push(`## ${check.checkId}`, '');
    lines.push(`- run: ${check.run}`);
    lines.push(`- exitCode: ${String(check.exitCode)}`);
    lines.push(`- passed: ${String(check.passed)}`);
    if (declared !== undefined) lines.push(`- failOn: ${declared.failOn}`);
    if (check.reason !== undefined) lines.push(`- reason: ${check.reason}`);
    lines.push('', 'stdout:', '', fencedBlock(sanitizedCheckText(check.stdout)), '');
    if (check.stderr !== undefined) {
      lines.push('stderr:', '', fencedBlock(sanitizedCheckText(check.stderr)), '');
    }
  }
  return lines;
}

/** One `## <id> (advisory)` section per advisory check — rule 2: advisory checks never fail a gate and
 * this piece's own Surface does not dispatch one, so every advisory check is listed as not run, never
 * silently omitted (a reader must not mistake an empty list for "the advisory review found nothing"). */
function renderAdvisorySections(gate: GateDefinition): string[] {
  const lines: string[] = [];
  for (const advisory of gate.checks.advisory) {
    lines.push(`## ${advisory.id} (advisory)`, '');
    lines.push(`- agent: ${advisory.agent}`);
    lines.push('- run: not run');
    lines.push('');
  }
  return lines;
}

function renderWaiverSection(report: GateReport): string[] {
  if (report.waiver === undefined) return [];
  return [
    '## Waiver',
    '',
    `- owner: ${report.waiver.owner}`,
    `- expiresAt: ${report.waiver.expiresAt}`,
    `- reason: ${report.waiver.reason}`,
    '',
  ];
}

/** The whole file: `---`, the YAML front matter, `---`, a blank line, the body — the identical shape
 * `renderReviewReportFile` (`interaction/review-report.ts`) already writes for `ReviewReport`. Pure: no
 * clock, no I/O, no randomness — the same `(id, gate, report, runId, evaluatedAt)` tuple always renders
 * byte-identically. */
export function renderGateReportFile(input: GateReportFileInput): string {
  const frontMatter = gateReportFrontMatter(input);
  const body = [
    ...renderCheckSections(input.gate, input.report),
    ...renderAdvisorySections(input.gate),
    ...renderWaiverSection(input.report),
  ].join('\n');
  return `---\n${YAML.stringify(frontMatter)}---\n\n${body}`;
}
