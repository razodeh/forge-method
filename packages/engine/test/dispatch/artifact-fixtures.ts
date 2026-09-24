/**
 * Valid (and deliberately invalid) artifact file text for the output-contract tests (`PLAN-M13.md` P7,
 * `outputs.ts`). Each builder returns exactly what an agent would write to disk for that registry type
 * (`18` §18.7): front matter that satisfies the type's own `@forge/schemas` schema, so a test that expects
 * success is proving the real validators accept it, not a stub. Not `*.test.ts`, so it may be shared.
 *
 * `PLAN-M14.md` P11: the output check now requires at least one `sources` item on every produced KB
 * document and every new/changed register entry (`08` §8.6), so every KB-located builder below
 * (`adrText`, `riskEntry`, `assumptionEntry`, `openQuestionEntry`, `environmentEntry`) takes an
 * optional `sources` override defaulting to `DEFAULT_SOURCE` -- every EXISTING call site keeps getting
 * a schema-valid, non-empty `sources` for free, and a test that specifically wants the P11 failure
 * passes `[]` to omit the field entirely.
 *
 * @see specs/18 §18.6, §18.7
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */

export const DOCS = 'docs/forge';

/** One `sources` item, matching `artifactSourceSchema`'s shape (`kind`/`ref`). */
export interface SourceFixture {
  readonly kind: 'decision' | 'human' | 'code';
  readonly ref: string;
}

/** The default a KB-located fixture builder uses unless a test overrides it -- one real-shaped source,
 * schema-valid and non-empty, so every pre-existing "this should pass" call site keeps passing without
 * having to be touched by P11. */
export const DEFAULT_SOURCE: readonly SourceFixture[] = [{ kind: 'decision', ref: 'ADR-0001' }];

/** `sources:` rendered as YAML lines at `indent`, or `[]` when `sources` is empty (the field is then
 * omitted entirely, not emitted as `sources: []` -- both are equally "no source" to the output check,
 * and omission is what a real agent that never wrote the field would produce). */
function entrySourcesLines(sources: readonly SourceFixture[], indent: string): string[] {
  if (sources.length === 0) return [];
  const lines: string[] = [`${indent}sources:`];
  for (const source of sources) {
    lines.push(`${indent}  - kind: ${source.kind}`, `${indent}    ref: '${source.ref}'`);
  }
  return lines;
}

export function epicText(
  id = 'EPIC-001',
  overrides: Readonly<Record<string, string>> = {},
): string {
  const fields: Record<string, string> = {
    capability: 'CAP-001',
    stage: 'stage-1',
    goal: 'Ship the thing',
    ...overrides,
  };
  return [
    '---',
    `id: ${id}`,
    'type: Epic',
    'schemaVersion: 1',
    `title: Epic ${id}`,
    'status: draft',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: po',
    'changelog: []',
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    'scope_in: []',
    'scope_out: []',
    'stories: []',
    'interfaces: []',
    'data: []',
    'exit_criteria: []',
    '---',
    '',
    'One paragraph.',
    '',
  ].join('\n');
}

/** An Epic missing its required `goal` field: schema-invalid. */
export function epicMissingGoalText(id = 'EPIC-001'): string {
  return epicText(id).replace(/^goal: .*\n/m, '');
}

/** A minimal but schema-valid ADR document (`08` §8.4), at `id` -- the same shape/fields
 * `packages/engine/test/dispatch/agent.test.ts`'s own `validAdrDocument` (`PLAN-M14.md` P8) uses, so a
 * document either builds validates against the identical schema the same way. `sources` defaults to
 * `DEFAULT_SOURCE` (`PLAN-M14.md` P11); pass `[]` to build a document the output check's sources rule
 * rejects. `status` defaults to `'accepted'` -- every existing call site keeps getting exactly what it
 * got before P31 added this parameter; pass `'proposed'` (or any other `adrSchema` status) to build the
 * document P31's own tainted-step rule (`dispatch/outputs.ts`'s `taintedAdrStatusProblem`) cares about. */
export function adrText(
  id: string,
  title = 'A decision',
  sources: readonly SourceFixture[] = DEFAULT_SOURCE,
  status = 'accepted',
): string {
  return [
    '---',
    `id: ${id}`,
    'type: ADR',
    'schemaVersion: 1',
    `title: ${title}`,
    `status: ${status}`,
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: architect',
    'changelog: []',
    'category: architecture',
    'deciders: [architect]',
    'date: 2026-01-15',
    'reversibility: medium',
    'blast_radius: []',
    "revisit_trigger: 'n/a'",
    'supersedes: []',
    'superseded_by: null',
    'related: []',
    'diagrams: []',
    "framework: 'n/a'",
    ...entrySourcesLines(sources, ''),
    '---',
    '',
    '## Context',
    '',
    'x',
    '',
    '## Options considered',
    '',
    'x',
    '',
    '## Decision',
    '',
    'x',
    '',
    '## Diagram',
    '',
    'x',
    '',
    '## Consequences',
    '',
    'x',
    '',
    '## Reversal plan',
    '',
    'x',
    '',
  ].join('\n');
}

/** A minimal but schema-valid Runbook document (`14` §14), at `id`. `sources` defaults to
 * `DEFAULT_SOURCE` (`PLAN-M14.md` P11); pass `[]` to build a document the output check's sources rule
 * rejects. */
export function runbookText(
  id: string,
  title = 'API returns 503 under load',
  sources: readonly SourceFixture[] = DEFAULT_SOURCE,
): string {
  return [
    '---',
    `id: ${id}`,
    'type: Runbook',
    'schemaVersion: 1',
    `title: ${title}`,
    'status: active',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: ops',
    'changelog: []',
    "symptoms: 'p95 latency exceeds 5s'",
    "immediate_mitigation: 'scale the deployment'",
    'diagnosis_steps: [check dashboards]',
    "escalation: 'page the on-call SRE'",
    'post_incident_actions: [file an RCA]',
    ...entrySourcesLines(sources, ''),
    '---',
    '',
    'What an on-call responder needs before running this under pressure.',
    '',
  ].join('\n');
}

export function sessionRecordText(sessionType: string, id = 'SESSION-001'): string {
  return [
    '---',
    `id: ${id}`,
    'type: SessionRecord',
    'schemaVersion: 1',
    'title: Retro',
    'status: complete',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: em',
    'changelog: []',
    `sessionType: ${sessionType}`,
    'technique: []',
    'question: What did we learn',
    'constraints_applied: []',
    'participants: []',
    "started: '2026-01-15T10:00:00Z'",
    "ended: '2026-01-15T11:00:00Z'",
    'cost_usd: 0',
    '---',
    '',
    ...[
      'Frame',
      'Diverge',
      'Converge',
      'Decisions',
      'Non-decisions',
      'Actions',
      'KB write-back',
    ].flatMap((heading) => [`## ${heading}`, '', 'text', '']),
  ].join('\n');
}

/** `sources` defaults to `DEFAULT_SOURCE` (`PLAN-M14.md` P11); pass `[]` for an entry the output
 * check's sources rule rejects. */
export function riskEntry(id: string, sources: readonly SourceFixture[] = DEFAULT_SOURCE): string {
  return [
    `  - id: ${id}`,
    '    statement: It could break',
    '    likelihood: low',
    '    impact: high',
    '    mitigation: Test it',
    '    owner: em',
    ...entrySourcesLines(sources, '    '),
  ].join('\n');
}

/** A `kb/risks.md` register (`collection: true`) holding the given entry ids, each with `DEFAULT_SOURCE`
 * -- not `ids.map(riskEntry)`: `Array.prototype.map` also passes the element's index as `riskEntry`'s
 * own second (`sources`) parameter, silently defeating its default. */
export function risksFileText(...ids: readonly string[]): string {
  return [
    '---',
    'type: Risk',
    'schemaVersion: 1',
    'title: Risk register',
    'status: active',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: em',
    'changelog: []',
    'risks:',
    ...ids.map((id) => riskEntry(id)),
    '---',
    '',
  ].join('\n');
}

export function handoffEntry(id: string, step: string): string {
  return [
    `  - id: ${id}`,
    '    from: test-architect',
    '    to: sdet',
    `    step: ${step}`,
    "    timestamp: '2026-01-15T10:00:00Z'",
    '    delivered: [plan]',
    '    open_questions: []',
    '    assumptions: []',
    '    constraints_for_receiver: []',
    '    acceptance_for_receiver: []',
  ].join('\n');
}

/** A `reports/handoffs.md` register: no wrapper schema exists for it (`SPEC-QUESTIONS.md` Q23). */
export function handoffsFileText(...entries: readonly { id: string; step: string }[]): string {
  return [
    '---',
    'type: HandoffRecord',
    'handoffs:',
    ...entries.map((entry) => handoffEntry(entry.id, entry.step)),
    '---',
    '',
  ].join('\n');
}

const REGISTER_BASE = [
  'schemaVersion: 1',
  'title: A register',
  'status: active',
  'created: 2026-01-15',
  'updated: 2026-01-15',
  'revision: 1',
  'author: em',
  'changelog: []',
];

/** A register file whose entries sit under `key`, each given as pre-indented YAML entry lines. */
export function registerFileText(type: string, key: string, entries: readonly string[]): string {
  return ['---', `type: ${type}`, ...REGISTER_BASE, `${key}:`, ...entries, '---', ''].join('\n');
}

/** `sources` defaults to `DEFAULT_SOURCE` (`PLAN-M14.md` P11); pass `[]` for an entry the output
 * check's sources rule rejects. Not a bare arrow assigned from another function (each still takes
 * `sources` as its own second parameter, so `[...ids].map(openQuestionEntry)` would leak the array
 * index into it the identical way `riskEntry`'s own doc comment warns against). */
export function openQuestionEntry(
  id: string,
  sources: readonly SourceFixture[] = DEFAULT_SOURCE,
): string {
  return [
    `  - id: ${id}`,
    '    question: Which database',
    '    status: open',
    ...entrySourcesLines(sources, '    '),
  ].join('\n');
}

export function assumptionEntry(
  id: string,
  sources: readonly SourceFixture[] = DEFAULT_SOURCE,
): string {
  return [
    `  - id: ${id}`,
    '    text: Users have accounts',
    '    confidence: low',
    '    validate_by: 2026-06-01',
    ...entrySourcesLines(sources, '    '),
  ].join('\n');
}

export function environmentEntry(
  id: string,
  sources: readonly SourceFixture[] = DEFAULT_SOURCE,
): string {
  return [
    `  - id: ${id}`,
    '    purpose: staging',
    '    url: https://staging.example.com',
    '    deploy_trigger: merge',
    '    data_policy: synthetic',
    '    secrets_source: vault',
    '    owner: sre',
    '    access: team',
    ...entrySourcesLines(sources, '    '),
  ].join('\n');
}

export const waiverEntry = (id: string, extra = ''): string =>
  [
    `  - id: ${id}`,
    '    reason: accepted risk',
    '    owner: em',
    '    expiry: 2026-12-31',
    ...(extra === '' ? [] : [extra]),
  ].join('\n');

/** A `reports/waivers.md` register: no wrapper schema exists for it (`SPEC-QUESTIONS.md` Q23). */
export function waiversFileText(...entries: readonly string[]): string {
  return ['---', 'type: Waiver', 'waivers:', ...entries, '---', ''].join('\n');
}

export function diagramSidecarText(): string {
  return [
    'id: DIAG-001',
    'type: Diagram',
    'schemaVersion: 1',
    'title: Context',
    'status: draft',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: architect',
    'changelog: []',
    'kind: flowchart',
    'notation: mermaid',
    'source: ctx.mmd',
    'generated: false',
    'depicts: []',
    'explains: []',
    'caption: A caption',
    'alt_text: An alt text',
    'owner: architect',
  ].join('\n');
}
