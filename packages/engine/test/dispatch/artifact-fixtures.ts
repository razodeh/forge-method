/**
 * Valid (and deliberately invalid) artifact file text for the output-contract tests (`PLAN-M13.md` P7,
 * `outputs.ts`). Each builder returns exactly what an agent would write to disk for that registry type
 * (`18` §18.7): front matter that satisfies the type's own `@forge/schemas` schema, so a test that expects
 * success is proving the real validators accept it, not a stub. Not `*.test.ts`, so it may be shared.
 *
 * @see specs/18 §18.6, §18.7
 */

export const DOCS = 'docs/forge';

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
 * document either builds validates against the identical schema the same way. */
export function adrText(id: string, title = 'A decision'): string {
  return [
    '---',
    `id: ${id}`,
    'type: ADR',
    'schemaVersion: 1',
    `title: ${title}`,
    'status: accepted',
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

export function riskEntry(id: string): string {
  return [
    `  - id: ${id}`,
    '    statement: It could break',
    '    likelihood: low',
    '    impact: high',
    '    mitigation: Test it',
    '    owner: em',
  ].join('\n');
}

/** A `kb/risks.md` register (`collection: true`) holding the given entry ids. */
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
    ...ids.map(riskEntry),
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

export const openQuestionEntry = (id: string): string =>
  [`  - id: ${id}`, '    question: Which database', '    status: open'].join('\n');

export const assumptionEntry = (id: string): string =>
  [
    `  - id: ${id}`,
    '    text: Users have accounts',
    '    confidence: low',
    '    validate_by: 2026-06-01',
  ].join('\n');

export const environmentEntry = (id: string): string =>
  [
    `  - id: ${id}`,
    '    purpose: staging',
    '    url: https://staging.example.com',
    '    deploy_trigger: merge',
    '    data_policy: synthetic',
    '    secrets_source: vault',
    '    owner: sre',
    '    access: team',
  ].join('\n');

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
