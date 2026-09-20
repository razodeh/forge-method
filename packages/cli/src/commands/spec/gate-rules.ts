/**
 * The six deterministic `forge spec validate --rule <name>` checks that `G-Problem`, `G-Product` and
 * `G-Design` name (`10` §10.3's catalogue) and that no code implemented until `PLAN-M13.md` P24:
 * `metrics-defined`, `user-identified`, `scope-contradicts-constraints` (G-Problem),
 * `capability-acceptance`, `blocking-open-questions` (G-Product) and `nfr-numeric` (G-Product, G-Design).
 *
 * **What each one may read.** Project documents only: `Vision`, `Capability` and `NFR` under the specs
 * root, and the KB's `product/{metrics,users,scope}.md`, `constraints/*.md` and `open-questions.md`. No
 * clock, no network, no model. Output is sorted (by document id, then by the order a document lists its
 * own items) so a re-run over the same tree is byte-identical.
 *
 * **Raw front matter, not the schema.** A rule that only inspected documents that pass their schema would
 * pass on exactly the input it exists to catch (a Capability whose `acceptance_summary` is one space
 * satisfies `z.string().min(1)`; a non-numeric NFR target fails the schema, so a schema-first read would
 * never see it). Each rule reads `frontMatter` directly, the way `oversized-stories` already does. A KB file
 * that fails its own schema is reported as a violation naming the file, never skipped: a check that cannot
 * read its input has not passed. A corrupt spec document (unterminated front matter, invalid YAML) still
 * throws `CFG-006`/`CFG-007` from `listSpecArtifacts`, as it does for every other rule, so the gate's
 * unparseable-output rule fails it.
 *
 * **Presence rules and per-item rules.** `metrics-defined` and `user-identified` are presence rules: their
 * gate condition is "no measurable success metric" / "no identified user", so an empty project fails them.
 * `capability-acceptance` and `nfr-numeric` are per-item rules, but a product definition with no
 * Capability, or a design with no NFR, is not evaluable either, so an empty set is one violation rather
 * than a vacuous pass. `scope-contradicts-constraints` needs a scope to read: none, or one from which no
 * in-scope item can be read, is a violation, because nothing was checked. Only `blocking-open-questions`
 * passes an empty project (no open question blocks nothing). A file the rule needs that cannot be read (a
 * KB file failing its schema, or the KB root itself) is a violation, never a skip.
 *
 * **What is deliberately not decided here.** Whether a metric is *meaningful*, a persona *specific*, an
 * acceptance summary *testable*, a number *justified* or a contradiction *implicit* is the advisory critic's
 * (`critique-problem-framing`, `critique-product-definition`); these rules prove presence and explicit
 * inconsistency only. The reading of each gate condition, and where the specs are silent, is recorded in
 * `SPEC-QUESTIONS.md` Q214.
 *
 * @see specs/09 §9.3
 * @see specs/10 §10.3
 * @see PLAN-M13.md P24
 */
import type { ArtifactDocument } from '@forge/core/artifacts';
import { parseKbTree, type KbTree } from '@forge/kb/schema';
import { NFR_TARGET_PATTERN } from '@forge/schemas';

import { listSpecArtifacts } from '../shared.ts';
import type { SpecCommandContext } from '../spec.ts';
import type { RuleValidationResult, RuleViolation, ValidateRuleId } from './validate-rules.ts';

type GateRuleId = Extract<
  ValidateRuleId,
  | 'metrics-defined'
  | 'user-identified'
  | 'scope-contradicts-constraints'
  | 'capability-acceptance'
  | 'nfr-numeric'
  | 'blocking-open-questions'
>;

/** More than this many violations are counted, not listed: a hostile or generated document can hold tens of
 * thousands of incomplete items, and `errors` (the number the gate reads) needs only to be positive. */
const MAX_LISTED_VIOLATIONS = 200;

function result(rule: GateRuleId, violations: readonly RuleViolation[]): RuleValidationResult {
  if (violations.length <= MAX_LISTED_VIOLATIONS) return { rule, violations };
  return {
    rule,
    violations: [
      ...violations.slice(0, MAX_LISTED_VIOLATIONS),
      {
        subject: rule,
        message: `${String(violations.length)} violations in all; only the first ${String(MAX_LISTED_VIOLATIONS)} are listed.`,
      },
    ],
  };
}

// --- shared reading helpers ------------------------------------------------------------------------

type RawFrontMatter = Readonly<Record<string, unknown>>;

/** `ArtifactDocument.parse` already proved the front matter is a YAML mapping (`shared.ts`,
 * `validate-rules.ts` `rawStorySizeStatus`), so this is a cast, not a runtime check. */
function frontMatterOf(doc: ArtifactDocument): RawFrontMatter {
  return doc.frontMatter as RawFrontMatter;
}

/** The documents of one artifact type, read raw, in a stable order: by id when it is a string (a document
 * with no usable id sorts by path, after the identified ones). */
function docsOfType(
  docs: readonly ArtifactDocument[],
  type: string,
): readonly { readonly doc: ArtifactDocument; readonly id: string; readonly fm: RawFrontMatter }[] {
  return docs
    .map((doc) => {
      const fm = frontMatterOf(doc);
      return { doc, fm, id: preview(typeof fm['id'] === 'string' ? fm['id'] : doc.path, 80) };
    })
    .filter(({ fm }) => fm['type'] === type)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** An unfilled shipped-template placeholder such as `<the observable condition ...>`. The templates ship
 * every prose field as a `'<...>'` string so a real document cannot forget a field, and so a schema-valid
 * document can still carry one; it is not a definition. */
function isPlaceholder(value: string): boolean {
  return /^<[^>]*>$/s.test(value.trim());
}

/** A scalar front-matter value as text. YAML reads an unquoted `baseline: 0` or `target: 60` as a number, and a
 * number is a stated value: the rules judge presence and numeric-ness here, and leave "the schema wants a
 * string" to `forge spec validate` (`G-Design`'s `spec:validate` check), so a schema-invalid but present number
 * is not misreported as missing. */
function textOf(value: unknown): unknown {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
}

/** A prose field that is present, non-blank, not an unfilled placeholder and not a stand-in for an answer:
 * a to-be-decided marker (`TBD`, `to be determined`, alone or followed by a dash, colon or comma and more text), `n/a`, `pending`,
 * `later`, `-`, `?`, and `unknown` or `none`, which are answers only where `allow` says so (a metric's baseline
 * may be `unknown` or `none`, its instrumentation may not). A sentence that merely starts with such a word
 * (`Pending invoices are listed`) is real text. */
function hasRealText(
  value: unknown,
  allow: 'anything' | 'unknown-and-none' = 'anything',
): value is string {
  if (typeof value !== 'string' || isBlank(value) || isPlaceholder(value)) return false;
  const text = value.trim();
  if (STAND_IN_LEAD.test(text) || STAND_IN_WHOLE.test(text)) return false;
  return allow === 'unknown-and-none' || !UNKNOWN_WHOLE.test(text);
}

const STAND_IN_LEAD =
  /^(?:tbd|tba|todo|to\s+be\s+(?:determined|decided|defined|confirmed|written)|n\/?a)\s*(?:$|[-:,;.(\u2013\u2014])/i;
const STAND_IN_WHOLE = /^(?:pending|later|\?+|-+|\.{3}|\u2026)[\s.!?]*$/i;
const UNKNOWN_WHOLE = /^(?:unknown|none)[\s.!?]*$/i;

/** A number as its own token: `>= 60%`, `at day 30`, `< 300ms` have one; `improve in Q3` (a digit glued to a
 * letter) and `grow a lot` do not. */
const NUMBER_TOKEN = /(?:^|[^A-Za-z0-9])\d/;

/** A metric target leads with its number: the number is one of its first three words (`>= 60% of signups`,
 * `at least 3 invoices`, `< 2 tickets`). A number further in (`improve significantly (see 2026 plan)`, `ship by Q3
 * 2026`) is a date or a reference, not a target an instrument can be compared against (`define-success-metrics`:
 * "target (numeric, with the comparison and unit)"). */
function leadsWithNumber(target: string): boolean {
  return target
    .trim()
    .split(/\s+/, 3)
    .some((word) => NUMBER_TOKEN.test(word));
}

/** HTML comments render as nothing, so a template's commented-out example is not content. Written with
 * `indexOf`, not a lazy regex: a body holding many `<!--` and no `-->` would make `/<!--[\s\S]*?-->/g` quadratic.
 * An opener with no closer, and one inside an inline code span (an odd number of backticks before it on its line:
 * ``Use `<!--` for comments``), is left as literal text: swallowing up to a distant `-->` would hide real content,
 * such as a whole Forbidden list. The backtick parity is carried forward, so the scan stays linear. */
function stripComments(body: string): string {
  let out = '';
  let from = 0;
  let scanned = 0;
  const line = { inCodeSpan: false };
  const advanceTo = (position: number): void => {
    const chunk = body.slice(scanned, position);
    const newline = chunk.lastIndexOf('\n');
    if (newline !== -1) line.inCodeSpan = false;
    for (const char of newline === -1 ? chunk : chunk.slice(newline + 1)) {
      if (char === '`') line.inCodeSpan = !line.inCodeSpan;
    }
    scanned = position;
  };
  for (;;) {
    const open = body.indexOf('<!--', from);
    if (open === -1) return out + body.slice(from);
    advanceTo(open);
    if (line.inCodeSpan) {
      out += body.slice(from, open + 4);
      from = open + 4;
      continue;
    }
    const close = body.indexOf('-->', open + 4);
    if (close === -1) return out + body.slice(from);
    out += body.slice(from, open);
    from = close + 3;
    scanned = from; // the comment's own text carries no code spans
  }
}

/** Lines of `body`, split at every terminator (`.` matches none of `\n`, `\r`, U+2028, U+2029, and `\s` matches
 * the last two, so a line holding one made a `\s*` + `(.*)$` pair backtrack cubically), each with trailing
 * whitespace removed by the native (linear) `trimEnd`. */
function linesOf(body: string): readonly string[] {
  return body.split(/\r\n|[\r\n\u2028\u2029]/).map((line) => line.trimEnd());
}

/** A fenced code block (``` or ~~~) is an example, not a declaration: a template's sample metric or persona
 * inside a fence must not satisfy a presence rule. CommonMark closing: the same character, at least as many of
 * it as the opener, and nothing else on the line (a shorter fence or one with an info string is content of the
 * block). An unterminated fence runs to the end. */
function stripFences(body: string): string {
  const kept: string[] = [];
  let open: { readonly char: string; readonly length: number } | undefined;
  for (const line of linesOf(body)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open === undefined) {
      if (marker === null) kept.push(line);
      else open = { char: (marker[1] ?? '').charAt(0), length: (marker[1] ?? '').length };
    } else if (
      marker !== null &&
      (marker[1] ?? '').startsWith(open.char) &&
      (marker[1] ?? '').length >= open.length &&
      (marker[2] ?? '').trim() === ''
    ) {
      open = undefined;
    }
  }
  return kept.join('\n');
}

function kbEntryBody(tree: KbTree, relativePath: string): string | undefined {
  for (const entry of tree.entries) {
    if (entry.kind === 'kb-entry' && entry.path === relativePath)
      return stripComments(stripFences(entry.value.body));
  }
  return undefined;
}

/** A violation for every KB file the rule needs that failed its own schema, and for a tree-level failure
 * (`parseKbTree` reports a `kbRoot` that is a plain file, or a directory it cannot walk, as one error whose path
 * is `kbRoot` itself, with no entries): either way the check cannot run, and a check that cannot read its input
 * has not passed. */
function unreadableKbFiles(
  ctx: SpecCommandContext,
  tree: KbTree,
  isRelevant: (relativePath: string) => boolean,
  what: string,
): readonly RuleViolation[] {
  return tree.errors
    .filter((error) => error.path === ctx.kbRoot || isRelevant(error.path))
    .map((error) => ({
      subject: error.path,
      message: `${error.path} could not be read (${preview(error.message)}); ${what} cannot be checked until it is valid.`,
    }));
}

/** Text echoed into a message: one line, bounded (a document can hold megabytes). */
function preview(text: string, limit = 160): string {
  const line = oneLine(text);
  return line.length > limit ? `${line.slice(0, limit)}...` : line;
}

/** A front-matter value echoed into a message: JSON when it can be, bounded, and never a throw (a YAML anchor can
 * make a value cyclic). */
function previewValue(value: unknown): string {
  try {
    // `JSON.stringify(undefined)` is `undefined` at runtime although typed `string`.
    const stringify = JSON.stringify as (input: unknown) => string | undefined;
    return preview(stringify(value) ?? 'undefined', 80);
  } catch {
    return '[a value that cannot be printed]';
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// --- metrics-defined -------------------------------------------------------------------------------

interface MetricFields {
  readonly id: string;
  readonly origin: string;
  readonly statement: unknown;
  readonly baseline: unknown;
  readonly target: unknown;
  readonly instrumentation: unknown;
}

/** What is wrong with one metric, as field names; empty when it is a measurable metric. `target` must carry
 * a number: a target with no number is not something an instrument can compare against (`10` §10.3: "No
 * measurable success metric"). `baseline` may be the word `unknown` (`define-success-metrics`): it must be
 * stated, not numeric. */
function metricProblems(metric: MetricFields): readonly string[] {
  const problems: string[] = [];
  if (!hasRealText(metric.statement)) problems.push('statement');
  if (!hasRealText(metric.baseline, 'unknown-and-none')) problems.push('baseline');
  if (!hasRealText(metric.target)) problems.push('target');
  else if (!leadsWithNumber(metric.target)) problems.push('target (it must lead with a number)');
  if (!hasRealText(metric.instrumentation)) problems.push('instrumentation');
  return problems;
}

function visionMetrics(docs: readonly ArtifactDocument[]): readonly MetricFields[] {
  const metrics: MetricFields[] = [];
  for (const { id, fm } of docsOfType(docs, 'Vision')) {
    const list = fm['success_metrics'];
    if (!Array.isArray(list)) continue;
    list.forEach((item: unknown, index) => {
      const entry = (typeof item === 'object' && item !== null ? item : {}) as RawFrontMatter;
      metrics.push({
        id: preview(
          typeof entry['id'] === 'string' ? entry['id'] : `${id} success_metrics[${String(index)}]`,
          80,
        ),
        origin: `${id} success_metrics`,
        statement: textOf(entry['statement']),
        baseline: textOf(entry['baseline']),
        target: textOf(entry['target']),
        instrumentation: textOf(entry['instrumentation']),
      });
    });
  }
  return metrics;
}

const METRIC_FIELD_NAMES = ['statement', 'baseline', 'target', 'instrumentation'] as const;
type MetricFieldName = (typeof METRIC_FIELD_NAMES)[number];

/** A line that opens a metric block: an optional heading/list marker and emphasis, then a `MET-###` id at the start
 * of the line (`define-success-metrics` numbers them `MET-###`). At most three spaces of indentation and no `>`: a
 * four-space-indented line is code and a blockquote is a quotation, neither is a declaration. */
const METRIC_START = /^ {0,3}(?:(#{1,6})\s+|[-*+]\s+|\d+[.)]\s+)?[*_`[]*(MET-\d{3,12})\b/;
/** `field: value` in any of `- **Target:** v`, `- target: v`, `Target: v`, `**Target (numeric):** v`. One
 * quantified run on each side of the colon and a tail that always matches, so it cannot backtrack. */
const METRIC_FIELD = new RegExp(
  `^\\s*(?:[-*+]\\s+|\\d+[.)]\\s+)?[*_\`]*(${METRIC_FIELD_NAMES.join('|')})[*_\`]*(?:\\s*\\([^)]{0,80}\\))?[*_\`]*\\s*:[*_\`\\s]*(.*)$`,
  'i',
);
const HEADING = /^ {0,3}(#{1,6})\s+\S/;

type MetricFieldValues = Partial<Record<MetricFieldName, string>>;

interface MetricBlock {
  readonly id: string;
  readonly fields: MetricFieldValues;
}

/** `MET-###` blocks: the id opens a block (heading, list item or bare line) and `field: value` lines below it fill
 * it, until the next metric or a heading that closes it. A value may sit on the next line (a nested bullet). A
 * block that is not a heading and has no field is a *reference* (`MET-001 traces to persona:x`, `- MET-001 ->
 * problem.md`), not a definition, and is ignored, so the brief's traceability lines cannot create phantom metrics.
 * Markdown tables with an `id` column are read by `metricTableRows`. */
function metricBlocks(body: string): readonly MetricBlock[] {
  const blocks: { id: string; level: number; fields: MetricFieldValues }[] = [];
  let current: (typeof blocks)[number] | undefined;
  let pending: MetricFieldName | undefined;
  for (const line of linesOf(body)) {
    const start = METRIC_START.exec(line);
    if (start !== null) {
      current = { id: start[2] ?? '', level: (start[1] ?? '').length, fields: {} };
      blocks.push(current);
      pending = undefined;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      pending = undefined;
      if (
        current !== undefined &&
        (current.level === 0 || (heading[1] ?? '').length <= current.level)
      ) {
        current = undefined;
      }
    }
    if (current === undefined) continue;
    const field = METRIC_FIELD.exec(line);
    const name = field?.[1]?.toLowerCase() as MetricFieldName | undefined;
    if (name !== undefined) {
      const value = field?.[2] ?? '';
      if ((current.fields[name] ?? '') === '') current.fields[name] = value;
      pending = value.trim() === '' ? name : undefined;
    } else if (pending !== undefined && line.trim() !== '') {
      if ((current.fields[pending] ?? '') === '') {
        current.fields[pending] = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
      }
      pending = undefined;
    }
  }
  return blocks.filter((block) => block.level > 0 || Object.keys(block.fields).length > 0);
}

/** Cells of a table row; a `\|` is text, not a separator. */
function tableCells(line: string): readonly string[] {
  const inner = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  return inner
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').replace(/[*_`]/g, '').trim());
}

/** Which header cell is which field: `Statement`/`Metric`, `Baseline`, `Target`, `Instrumentation` (by prefix, so
 * `Target (numeric)` counts). `undefined` unless the table has an `id` column and at least one field column. */
function metricTableColumns(
  header: readonly string[],
): { readonly id: number; readonly fields: Partial<Record<MetricFieldName, number>> } | undefined {
  const lowered = header.map((cell) => cell.toLowerCase());
  const id = lowered.indexOf('id');
  const fields: Partial<Record<MetricFieldName, number>> = {};
  lowered.forEach((cell, at) => {
    const name =
      METRIC_FIELD_NAMES.find((candidate) => cell.startsWith(candidate)) ??
      (cell.startsWith('metric') ? 'statement' : undefined);
    if (name !== undefined) fields[name] ??= at;
  });
  return id === -1 || Object.keys(fields).length === 0 ? undefined : { id, fields };
}

/** A `| id | statement | baseline | target | instrumentation |` table: each row whose id cell is a `MET-###`. A table
 * with no field columns (`| id | traces to |`) is a reference table and is ignored. */
function metricTableRows(body: string): readonly MetricBlock[] {
  const rows: MetricBlock[] = [];
  let columns: ReturnType<typeof metricTableColumns>;
  let inTable = false;
  for (const line of linesOf(body)) {
    if (!line.startsWith('|') && !/^ {1,3}\|/.test(line)) {
      columns = undefined;
      inTable = false;
      continue;
    }
    const cells = tableCells(line);
    if (!inTable) {
      inTable = true;
      columns = metricTableColumns(cells);
      continue;
    }
    if (columns === undefined) continue;
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === '')) continue;
    const match = /^(MET-\d{3,12})\b/.exec(cells[columns.id] ?? '');
    if (match === null) continue;
    const fields: MetricFieldValues = {};
    for (const name of METRIC_FIELD_NAMES) {
      const at = columns.fields[name];
      if (at !== undefined) fields[name] = cells[at] ?? '';
    }
    rows.push({ id: match[1] ?? '', fields });
  }
  return rows;
}

function kbMetrics(body: string, origin: string): readonly MetricFields[] {
  return [...metricBlocks(body), ...metricTableRows(body)].map((block) => ({
    id: block.id,
    origin,
    statement: block.fields.statement,
    baseline: block.fields.baseline,
    target: block.fields.target,
    instrumentation: block.fields.instrumentation,
  }));
}

const METRICS_PATH = 'product/metrics.md';

export async function validateMetricsDefined(
  ctx: SpecCommandContext,
): Promise<RuleValidationResult> {
  const [docs, tree] = await Promise.all([
    listSpecArtifacts(ctx.paths, ctx.specsRoot),
    parseKbTree(ctx.paths, ctx.kbRoot),
  ]);
  const body = kbEntryBody(tree, METRICS_PATH);
  const metrics = [
    ...visionMetrics(docs),
    ...(body === undefined ? [] : kbMetrics(body, METRICS_PATH)),
  ];
  const violations: RuleViolation[] = [
    ...unreadableKbFiles(ctx, tree, (p) => p === METRICS_PATH, 'the success metrics'),
    ...docsOfType(docs, 'Vision')
      .filter(
        ({ fm }) => fm['success_metrics'] !== undefined && !Array.isArray(fm['success_metrics']),
      )
      .map(({ id }) => ({
        subject: id,
        message: `${id} success_metrics is not a list of metrics, so none of its metrics can be read: make it a YAML list.`,
      })),
  ];
  let measurable = 0;
  for (const metric of metrics) {
    const problems = metricProblems(metric);
    if (problems.length === 0) {
      measurable += 1;
      continue;
    }
    violations.push({
      subject: metric.id,
      message:
        `success metric ${metric.id} (${metric.origin}) is not measurable; fix: ${problems.join(', ')}. ` +
        'A metric needs a statement, a baseline (a number, or "unknown" plus how it will ' +
        'be established), a target that leads with a number (`>= 60% of signups`) and an instrumentation source.',
    });
  }
  if (measurable === 0) {
    violations.push({
      subject: 'success_metrics',
      message:
        'no measurable success metric: define at least one MET-### in the KB entry product/metrics.md ' +
        "(or in the Vision's success_metrics) with a statement, baseline, numeric target and instrumentation.",
    });
  }
  return result('metrics-defined', violations);
}

// --- user-identified ---------------------------------------------------------------------------------

/** `frame-problem` gives each user group "a stable id of the form `persona:<slug>`" in `product/users.md`,
 * and `write-vision` copies them into `Vision.target_users`. Counted only where an id is *defined*: at the start
 * of a heading, list item, table row or `id:` line, never inside a sentence (`No persona:tbd yet`, `ids look like
 * persona:slug`), a blockquote or code. A placeholder slug does not identify anyone. */
const PERSONA_TOKEN = /(?<![\w:-])persona:([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g;
const PLACEHOLDER_SLUGS: ReadonlySet<string> = new Set([
  'tbd',
  'todo',
  'unknown',
  'slug',
  'name',
  'example',
  'placeholder',
  'x',
  'xxx',
]);

/** A slug that names someone: not a placeholder such as `tbd`, `tbd2`, `unknown-user`. */
function isRealSlug(slug: string): boolean {
  const first = (slug.split('-')[0] ?? '').replace(/\d+$/, '');
  return first !== '' && !PLACEHOLDER_SLUGS.has(first);
}

/** Whether `line` is a place where a persona is *defined*: a heading, a list item (at any indent: a nested item is
 * still an item), a table row, an `id:` line, or a line that opens with the id. A sentence of prose, a blockquote
 * and an indented code line are mentions, not definitions. Every pattern is a single anchored run, so a long line
 * cannot backtrack. */
function isDefinitionLine(line: string): boolean {
  return (
    /^ {0,3}#{1,6}(?: |$)/.test(line) ||
    /^ *(?:[-*+]|\d+[.)])(?: |$)/.test(line) ||
    /^ {0,3}\|/.test(line) ||
    /^ {0,3}[*_`]*id[*_`]*\s*:/i.test(line) ||
    /^ {0,3}[*_`]*persona:/.test(line)
  );
}

function definesPersona(body: string): boolean {
  return linesOf(body).some(
    (line) =>
      isDefinitionLine(line) &&
      [...line.matchAll(PERSONA_TOKEN)].some((match) => isRealSlug(match[1] ?? '')),
  );
}

/** A `Vision.target_users` entry is the persona id itself (`write-vision`: "named as its `persona:<slug>` id"). */
function isPersonaId(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^persona:([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(value.trim());
  return match !== null && isRealSlug(match[1] ?? '');
}

const USERS_PATH = 'product/users.md';

export async function validateUserIdentified(
  ctx: SpecCommandContext,
): Promise<RuleValidationResult> {
  const [docs, tree] = await Promise.all([
    listSpecArtifacts(ctx.paths, ctx.specsRoot),
    parseKbTree(ctx.paths, ctx.kbRoot),
  ]);
  const violations: RuleViolation[] = [
    ...unreadableKbFiles(ctx, tree, (p) => p === USERS_PATH, 'the identified users'),
  ];
  const fromVision = docsOfType(docs, 'Vision').some(
    ({ fm }) =>
      Array.isArray(fm['target_users']) &&
      fm['target_users'].some((user: unknown) => isPersonaId(user)),
  );
  const body = kbEntryBody(tree, USERS_PATH);
  const fromKb = body !== undefined && definesPersona(body);
  if (!fromVision && !fromKb) {
    violations.push({
      subject: 'target_users',
      message:
        'no user is identified: name at least one user group by persona id (persona:<slug>, lower case) as a ' +
        "heading, list item or table row in the KB entry product/users.md, or list one in the Vision's target_users.",
    });
  }
  return result('user-identified', violations);
}

// --- scope-contradicts-constraints -------------------------------------------------------------------

const SCOPE_PATH = 'product/scope.md';
const OUT_OF_SCOPE =
  /\bnot\s+(?:yet\s+)?in\s+scope\b|\bout[\s-]+of[\s-]+scope\b|\bnon[\s-]?goals?\b|\bexcluded?\b|\bexclusions?\b|\bdeferred\b/i;
const IN_SCOPE_WORD = /\bscope\b/i;
const FORBIDDEN =
  /\bforbidden\b|\bprohibited\b|\bdisallowed\b|\bbanned\b|\bmust\s+not\b|\bmay\s+not\b|\bnot\s+allowed\b|\bexcluded?\b/i;
const ALLOWED = /\b(?:allowed|permitted|mandated|required|must\s+use|approved)\b/i;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(\S.*)$/;
const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BOLD_HEADING = /^\s*(?:\*\*|__)([^*_]+?)(?:\*\*|__)\s*:?$/;
const COLON_HEADING = /^\s*([A-Za-z][A-Za-z\s/-]*):$/;
/** A bold or `Word:` label groups items inside the current ATX section; it sits one level below every `#`. */
const LABEL_LEVEL = 7;
/** Only the start of a heading is classified: a document can hold a heading of any length. */
const HEADING_CLASSIFY_LIMIT = 200;

type ScopeKind = 'in' | 'out' | undefined;

/** What one heading says about the items under it, computed once when the heading is read (not once per item). */
interface Heading {
  readonly level: number;
  /** In scope, out of scope, or nothing. "Scope" alone, `MVP scope` and `In scope` are the in-scope list; "Scope and
   * non-goals" and "Goals and non-goals" name more than one list, so they say nothing (their sub-headings decide). */
  readonly scope: ScopeKind;
  /** `true` for a Forbidden-like heading, `false` for an Allowed-like one, `undefined` for neither or both. */
  readonly forbids: boolean | undefined;
}

function classifyHeading(level: number, text: string): Heading {
  const head = text.slice(0, HEADING_CLASSIFY_LIMIT);
  const out = OUT_OF_SCOPE.test(head);
  let scope: ScopeKind;
  if (out) scope = /\b(?:and|or)\b|[&/,]/i.test(head) ? undefined : 'out';
  else scope = IN_SCOPE_WORD.test(head) ? 'in' : undefined;
  const forbidden = FORBIDDEN.test(head);
  const allowed = ALLOWED.test(head);
  return { level, scope, forbids: forbidden === allowed ? undefined : forbidden };
}

interface Item {
  /** The headings above the item, outermost first. */
  readonly headings: readonly Heading[];
  readonly text: string;
}

/** Every list item in `body` with the headings above it, so an item under `## In scope` / `### Payments` is still
 * in scope and a `Billing:` label inside a section does not end the section. */
function listItems(body: string): readonly Item[] {
  const items: Item[] = [];
  const stack: Heading[] = [];
  for (const line of linesOf(body)) {
    const atx = ATX_HEADING.exec(line);
    const named =
      atx === null ? (BOLD_HEADING.exec(line)?.[1] ?? COLON_HEADING.exec(line)?.[1]) : undefined;
    if (atx !== null || named !== undefined) {
      const level = atx === null ? LABEL_LEVEL : (atx[1] ?? '').length;
      while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
      stack.push(classifyHeading(level, atx === null ? (named ?? '') : (atx[2] ?? '')));
      continue;
    }
    const item = LIST_ITEM.exec(line)?.[1];
    if (item !== undefined) items.push({ headings: [...stack], text: item });
  }
  return items;
}

/** `text` without trailing whitespace or any of `chars`, by index (linear; a regex `[...]+$` is not). */
function trimTrailing(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && (chars.includes(text.charAt(end - 1)) || /\s/.test(text.charAt(end - 1)))) {
    end -= 1;
  }
  return text.slice(0, end);
}

/** The comparable form of a list item: NFC-normalised, markup, links, case, a trailing parenthetical or dash-suffixed
 * note, trailing punctuation and spacing removed, so `**Payroll processing.**`, `payroll processing` and `Payroll
 * processing (constraint: PII)` are the same declared item (`frame-problem` tells agents to annotate each scope item
 * with the constraint that limits it). Equality is deliberately the only relation used: it has no false positives
 * from shared words. */
function normaliseItem(text: string): string {
  let out = text
    .normalize('NFC')
    .replace(/\[([^\]]{0,200})\]\([^)]{0,500}\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const dash = out.search(/\s[\u2013\u2014-]\s/);
  if (dash !== -1) out = out.slice(0, dash);
  out = trimTrailing(out, '.;:,!');
  while (out.endsWith(')')) {
    const open = out.lastIndexOf('(');
    if (open <= 0) break;
    out = trimTrailing(out.slice(0, open), '.;:,!');
  }
  return out;
}

/** The items whose headings satisfy `wanted`, keyed by normalised text. */
function itemsWhere(
  body: string,
  wanted: (headings: readonly Heading[]) => boolean,
): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const { headings, text } of listItems(body)) {
    if (!wanted(headings)) continue;
    const key = normaliseItem(text);
    if (key !== '' && !found.has(key)) found.set(key, text);
  }
  return found;
}

/** The deepest heading that classifies decides. A level-1 heading is the document's title, not a section, so it
 * classifies only when nothing deeper exists (`# Scope` over `## Assumptions` says nothing about Assumptions). */
function scopeKindOf(headings: readonly Heading[]): ScopeKind {
  for (const heading of [...headings].reverse()) {
    if (heading.level === 1 && headings.length > 1) continue;
    if (heading.scope !== undefined) return heading.scope;
  }
  return undefined;
}

/** Forbidden when the deepest heading that says anything about permission says forbidden: a `## Allowed` under
 * `# Allowed and forbidden` is not. */
function isForbidden(headings: readonly Heading[]): boolean {
  for (const heading of [...headings].reverse()) {
    if (heading.forbids !== undefined) return heading.forbids;
  }
  return false;
}

/** A constraint bullet that states its own prohibition: `Card storage is prohibited`, `Card storage - forbidden by
 * PCI`, `Forbidden: card storage`, `Must not: card storage`. The forbidden item is the subject or the text after the
 * label, and equality with an in-scope item is the only relation used. Prose that names an action (`Staff must not
 * exceed budget`) is deliberately not decomposed: dropping its verb made an in-scope `Budget` a false contradiction. */
const PROSE_PROHIBITED_SUBJECT =
  /^(.{1,200}?)(?:\s[-\u2013\u2014:]\s|\s(?:is|are)\s)\s*(?:strictly\s+)?(?:forbidden|prohibited|not\s+allowed|disallowed|banned|out\s+of\s+bounds)\b/i;
const PROSE_LABELLED =
  /^(?:forbidden|prohibited|disallowed|banned|must\s+not|not\s+allowed)\s*:\s*(.{1,200})$/i;

function prosePhrases(text: string): readonly string[] {
  const labelled = PROSE_LABELLED.exec(text)?.[1];
  if (labelled !== undefined) return [labelled];
  const subject = PROSE_PROHIBITED_SUBJECT.exec(text)?.[1];
  return subject === undefined ? [] : [subject.replace(/^(?:the|any)\s+/i, '')];
}

/** `G-Problem`'s "scope contradicts constraints". A semantic contradiction is not decidable from prose; the
 * critique brief says this check proves "declared scope does not contradict declared constraints", so it reads
 * declared ones only (an item both in and out of scope, or in scope while a constraint file forbids it), by
 * normalised equality. It needs a scope to read: no `product/scope.md`, or one from which no in-scope item can be
 * read, is a violation (nothing was checked), as is an unreadable scope or constraint file. */
export async function validateScopeContradictsConstraints(
  ctx: SpecCommandContext,
): Promise<RuleValidationResult> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const isConstraint = (p: string): boolean => p.startsWith('constraints/');
  const violations: RuleViolation[] = [
    ...unreadableKbFiles(
      ctx,
      tree,
      (p) => p === SCOPE_PATH || isConstraint(p),
      'scope against constraints',
    ),
  ];
  const scopeBody = kbEntryBody(tree, SCOPE_PATH);
  if (scopeBody === undefined) {
    if (!violations.some((v) => v.subject === SCOPE_PATH)) {
      violations.push({
        subject: SCOPE_PATH,
        message: `no scope is declared: write ${SCOPE_PATH} (frame-problem produces it) with the in-scope items as bullets under a heading named "In scope", so they can be checked against the constraints.`,
      });
    }
    return result('scope-contradicts-constraints', violations);
  }

  const inScope = itemsWhere(scopeBody, (headings) => scopeKindOf(headings) === 'in');
  const outOfScope = itemsWhere(scopeBody, (headings) => scopeKindOf(headings) === 'out');
  if (inScope.size === 0) {
    violations.push({
      subject: SCOPE_PATH,
      message: `no in-scope item could be read from ${SCOPE_PATH}: list them as bullets under a heading named "In scope" (nested sub-headings are fine), so they can be checked against the constraints.`,
    });
  }
  for (const [key, text] of inScope) {
    if (outOfScope.has(key)) {
      violations.push({
        subject: SCOPE_PATH,
        message: `"${preview(text)}" is listed both in scope and out of scope (non-goals) in ${SCOPE_PATH}.`,
      });
    }
  }

  const constraintPaths = tree.entries
    .filter((entry) => entry.kind === 'kb-entry' && isConstraint(entry.path))
    .map((entry) => entry.path)
    .sort();
  for (const path of constraintPaths) {
    const body = kbEntryBody(tree, path) ?? '';
    const forbidden = new Map(itemsWhere(body, isForbidden));
    for (const item of listItems(body)) {
      for (const phrase of prosePhrases(item.text)) {
        const key = normaliseItem(phrase);
        if (key !== '' && !forbidden.has(key)) forbidden.set(key, item.text);
      }
    }
    for (const [key, text] of inScope) {
      if (forbidden.has(key)) {
        violations.push({
          subject: SCOPE_PATH,
          message: `"${preview(text)}" is in scope in ${SCOPE_PATH} but ${path} lists it as forbidden.`,
        });
      }
    }
  }
  return result('scope-contradicts-constraints', violations);
}

// --- capability-acceptance ---------------------------------------------------------------------------

/** A document whose id carries an artifact type's prefix but whose `type` is something else (`type: Capabilty`).
 * `G-Product` does not run the generic `spec validate`, so a typo'd type would otherwise hide a document from
 * the rule that judges it. */
function mistypedDocs(
  docs: readonly ArtifactDocument[],
  idPrefix: string,
  type: string,
): readonly RuleViolation[] {
  return docs
    .map((doc) => ({ doc, fm: frontMatterOf(doc) }))
    .filter(
      ({ fm }) =>
        typeof fm['id'] === 'string' && fm['id'].startsWith(`${idPrefix}-`) && fm['type'] !== type,
    )
    .map(({ doc, fm }) => ({
      subject: preview(String(fm['id']), 80),
      message: `${preview(String(fm['id']), 80)} (${preview(doc.path, 120)}) has an ${idPrefix}- id but type ${previewValue(fm['type'])}, so it is not read as a ${type}: set type: ${type}.`,
    }))
    .sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
}

export async function validateCapabilityAcceptance(
  ctx: SpecCommandContext,
): Promise<RuleValidationResult> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const capabilities = docsOfType(docs, 'Capability');
  const violations: RuleViolation[] = [...mistypedDocs(docs, 'CAP', 'Capability')];
  if (capabilities.length === 0) {
    violations.push({
      subject: 'Capability',
      message:
        'no Capability document exists under the specs root: a product definition needs at least one, each with an acceptance summary.',
    });
  }
  for (const { id, fm } of capabilities) {
    if (hasRealText(fm['acceptance_summary'])) continue;
    violations.push({
      subject: id,
      message: `${id} has no acceptance_summary: state the observable condition that means it is done (an empty or placeholder value does not count).`,
    });
  }
  return result('capability-acceptance', violations);
}

// --- nfr-numeric -------------------------------------------------------------------------------------

function rawVerificationRef(fm: RawFrontMatter): unknown {
  const verification = fm['verification'];
  return typeof verification === 'object' && verification !== null
    ? (verification as RawFrontMatter)['ref']
    : undefined;
}

export async function validateNfrNumeric(ctx: SpecCommandContext): Promise<RuleValidationResult> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const nfrs = docsOfType(docs, 'NFR');
  const violations: RuleViolation[] = [...mistypedDocs(docs, 'NFR', 'NFR')];
  if (nfrs.length === 0) {
    violations.push({
      subject: 'NFR',
      message:
        'no NFR document exists under the specs root: the quality targets the design must meet are not written down.',
    });
  }
  for (const { id, fm } of nfrs) {
    const target = textOf(fm['target']);
    if (typeof target !== 'string' || !NFR_TARGET_PATTERN.test(target)) {
      violations.push({
        subject: id,
        message:
          `${id} target ${previewValue(fm['target'] ?? null)} is not numeric: it must start with ` +
          'a number, optionally after a comparison operator (for example "< 300ms" or ">= 99.5%"). Put the percentile ' +
          'and load in metric and conditions.',
      });
    } else if (
      !hasRealText(fm['statement']) ||
      !hasRealText(fm['metric']) ||
      !hasRealText(rawVerificationRef(fm))
    ) {
      // An NFR scaffolded from the shipped template carries the numeric default target `< 300ms`; without this an
      // untouched template would satisfy the rule. `09` §9.3: an NFR is "numeric and verifiable".
      violations.push({
        subject: id,
        message: `${id} has a numeric target but no real statement, metric or verification.ref (empty, or an unfilled template placeholder): say what is measured and how it will be checked.`,
      });
    }
  }
  return result('nfr-numeric', violations);
}

// --- blocking-open-questions -------------------------------------------------------------------------

const OPEN_QUESTIONS_PATH = 'open-questions.md';

/** Every shipped gate has `openQuestionsPolicy: block`, and `OpenQuestion` has only `open | resolved` (no
 * per-story or per-gate `blocks` link; Q23), so, as `definition-of-ready`'s `spec:no-blocking-open-questions`
 * already reads it, an open question is a blocking one. */
export async function validateBlockingOpenQuestions(
  ctx: SpecCommandContext,
): Promise<RuleValidationResult> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const violations: RuleViolation[] = [
    ...unreadableKbFiles(ctx, tree, (p) => p === OPEN_QUESTIONS_PATH, 'the open questions'),
  ];
  for (const entry of tree.entries) {
    if (entry.kind !== 'open-questions-file') continue;
    for (const question of entry.value.open_questions) {
      if (question.status !== 'open') continue;
      violations.push({
        subject: question.id,
        message: `${question.id} is open: ${preview(question.question)} Resolve it (status: resolved) or record the answer before approving.`,
      });
    }
  }
  return result('blocking-open-questions', violations);
}
