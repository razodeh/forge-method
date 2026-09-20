/**
 * The six deterministic `forge spec validate --rule <name>` checks `G-Problem`, `G-Product` and `G-Design`
 * name (`10` §10.3's catalogue): `metrics-defined`, `user-identified`, `scope-contradicts-constraints`,
 * `capability-acceptance`, `nfr-numeric`, `blocking-open-questions` (`PLAN-M13.md` P24, Q214).
 *
 * Every fixture is a real document written from the shipped artifact templates. Documents that are
 * schema-invalid on purpose (a whitespace-only acceptance summary, a non-numeric NFR target) are written
 * raw: a rule that only looked at schema-valid documents would pass on exactly the input it exists to catch.
 *
 * @see specs/09 §9.3
 * @see specs/10 §10.3
 * @see PLAN-M13.md P24
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isForgeError } from '@forge/core/errors';
import { afterEach, describe, expect, it } from 'vitest';

import { readArtifactTemplate } from '../../../src/commands/shared.ts';
import {
  specValidateRule,
  type ValidateRuleId,
} from '../../../src/commands/spec/validate-rules.ts';
import type { SpecCommandContext } from '../../../src/commands/spec.ts';
import {
  KB_ROOT,
  SPECS_ROOT,
  cleanupAll,
  createTestProject,
  writeCollectionFileFixture,
  type TestProject,
} from '../helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject): SpecCommandContext {
  return { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT };
}

async function violations(project: TestProject, rule: ValidateRuleId) {
  return (await specValidateRule(ctx(project), rule)).violations;
}

/** Writes `docs/forge/<relative>` from a shipped template, replacing whole top-level `key: ...` front matter
 * lines (and any indented continuation lines under that key) with the given raw YAML. Raw, not
 * `ArtifactDocument.set`, so a deliberately schema-invalid value survives to disk. */
async function writeFromTemplate(
  project: TestProject,
  type: 'Vision' | 'Capability' | 'NFR',
  relative: string,
  fields: Readonly<Record<string, string>>,
): Promise<void> {
  const template = await readArtifactTemplate(type);
  const lines = template.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const key = /^([a-z_]+):/.exec(line)?.[1];
    if (key !== undefined) {
      skipping = false;
      const replacement = fields[key];
      if (replacement !== undefined) {
        out.push(`${key}: ${replacement}`);
        skipping = true;
        continue;
      }
    } else if (skipping && /^\s/.test(line)) {
      continue;
    } else {
      skipping = false;
    }
    out.push(line);
  }
  const target = path.join(project.dir, 'docs/forge', relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, out.join('\n'), 'utf8');
}

function metric(id: string, overrides: Record<string, string> = {}): string {
  const fields = {
    statement: 'Weekly active agencies at day 30',
    baseline: 'unknown',
    target: '">= 60%"',
    instrumentation: 'invoice_sent event',
    ...overrides,
  };
  return [
    `  - id: ${id}`,
    ...Object.entries(fields).map(([key, value]) => `    ${key}: ${value}`),
  ].join('\n');
}

async function writeVision(
  project: TestProject,
  options: { readonly metrics?: readonly string[]; readonly users?: string } = {},
): Promise<void> {
  await writeFromTemplate(project, 'Vision', 'specs/vision.md', {
    success_metrics:
      options.metrics === undefined || options.metrics.length === 0
        ? '[]'
        : `\n${options.metrics.join('\n')}`,
    target_users: options.users ?? '[]',
  });
}

let kbCounter = 0;

/** A real KB entry under `<kbRoot>/<relative>` (`kbEntrySchema`-valid) with the given body. */
async function writeKb(
  project: TestProject,
  relative: string,
  section: 'product' | 'constraints',
  body: string,
): Promise<void> {
  kbCounter += 1;
  const id = `KB-${section === 'product' ? 'PROD' : 'CON'}-${String(kbCounter).padStart(4, '0')}`;
  const content = `---
id: ${id}
type: knowledge
section: ${section}
title: Fixture ${relative}
status: active
confidence: medium
owner: analyst
sources:
  - kind: human
    ref: SESSION-001
created: 2026-01-01
updated: 2026-01-01
review_by: 2026-06-01
supersedes: []
superseded_by: null
related: []
diagrams: []
tags: []
applies_to: []
---

${body}
`;
  const target = path.join(project.dir, KB_ROOT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

// --- metrics-defined ------------------------------------------------------------------------------

describe('metrics-defined', () => {
  it('fails an empty project: there is no measurable success metric anywhere', async () => {
    const found = await violations(await createTestProject(), 'metrics-defined');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/no measurable success metric/);
  });

  it('passes a Vision whose success metric has a statement, baseline, numeric target and instrumentation', async () => {
    const project = await createTestProject();
    await writeVision(project, { metrics: [metric('MET-001')] });
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it('fails a Vision with no success metrics', async () => {
    const project = await createTestProject();
    await writeVision(project, { metrics: [] });
    expect(await violations(project, 'metrics-defined')).toHaveLength(1);
  });

  it('names a Vision metric whose target carries no number', async () => {
    const project = await createTestProject();
    await writeVision(project, {
      metrics: [metric('MET-001'), metric('MET-002', { target: '"grow a lot"' })],
    });
    const found = await violations(project, 'metrics-defined');
    expect(found.map((v) => v.subject)).toEqual(['MET-002']);
    expect(found[0]?.message).toMatch(/target/);
  });

  it('names a Vision metric whose instrumentation is only whitespace (a schema-valid string)', async () => {
    const project = await createTestProject();
    await writeVision(project, { metrics: [metric('MET-001', { instrumentation: '"   "' })] });
    const found = await violations(project, 'metrics-defined');
    expect(
      found.some((v) => v.subject === 'MET-001' && v.message.includes('instrumentation')),
    ).toBe(true);
  });

  it('reads an unquoted numeric baseline or target as a stated value, not a missing one', async () => {
    const project = await createTestProject();
    await writeVision(project, {
      metrics: [metric('MET-001', { baseline: '0', target: '60' })],
    });
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it.each([
    ['a TBD target', { target: 'TBD' }],
    ['a target with only a digit glued to a word (Q3)', { target: '"improve in Q3"' }],
    ['a TBD instrumentation', { instrumentation: 'TBD' }],
    ['a "n/a" baseline', { baseline: '"n/a"' }],
  ])('flags a Vision metric with %s', async (_label, overrides) => {
    const project = await createTestProject();
    await writeVision(project, { metrics: [metric('MET-001', overrides)] });
    expect((await violations(project, 'metrics-defined')).length).toBeGreaterThan(0);
  });

  it('does not count a metric shown inside a fenced code block (an example, not a declaration)', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      '```yaml\nMET-001\n- statement: s\n- baseline: 0\n- target: 60%\n- instrumentation: i\n```',
    );
    expect((await violations(project, 'metrics-defined')).length).toBeGreaterThan(0);
  });

  it('does not let traceability lines create phantom metrics (a bare reference, a list reference, an id-only table)', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `### MET-001 Activation

- **Statement:** Agencies that send an invoice at day 30
- **Baseline:** unknown
- **Target:** >= 60% of signups
- **Instrumentation:** invoice_sent event

## Traceability

MET-001 traces to persona:agency-owner
- MET-001 -> problem.md

| id | traces to |
| --- | --- |
| MET-001 | problem.md |`,
    );
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it('reads a value on a nested bullet and a label with a parenthesised note', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `### MET-001 Activation

- **Statement:**
  - Agencies that send an invoice at day 30
- **Baseline (number or unknown):** unknown
- **Target (numeric):** >= 60% of signups
- **Instrumentation:**
  - the invoice_sent event`,
    );
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it('reads a table whose headers are "Metric", "Target (numeric)" and so on', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `| ID | Metric | Baseline | Target (numeric) | Instrumentation |
| --- | --- | --- | --- | --- |
| MET-001 | Invoices sent per week | 0 | >= 3 | invoice_sent event |`,
    );
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it('does not let an escaped pipe in a cell shift the columns', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `| id | statement | baseline | target | instrumentation |
| --- | --- | --- | --- | --- |
| MET-001 | a \\| b | 0 | >= 3 | invoice_sent event |`,
    );
    expect(await violations(project, 'metrics-defined')).toEqual([]);
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `| id | statement | baseline | target | instrumentation |
| --- | --- | --- | --- | --- |
| MET-001 | a \\| b | 0 | | invoice_sent event |`,
    );
    expect((await violations(project, 'metrics-defined')).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'blockquoted',
      '> ### MET-001\n> - statement: s\n> - baseline: 0\n> - target: 60%\n> - instrumentation: i',
    ],
    [
      'indented as code',
      '    MET-001\n    - statement: s\n    - baseline: 0\n    - target: 60%\n    - instrumentation: i',
    ],
    [
      'inside a four-backtick block that holds a three-backtick example',
      '````\n```\nx\n```\nMET-001\n- statement: s\n- baseline: 0\n- target: 60%\n- instrumentation: i\n````',
    ],
  ])('does not count a metric that is %s', async (_label, body) => {
    const project = await createTestProject();
    await writeKb(project, 'product/metrics.md', 'product', body);
    expect((await violations(project, 'metrics-defined')).length).toBeGreaterThan(0);
  });

  it.each(['improve significantly (see 2026 plan)', 'ship by Q3 2026'])(
    'flags a Vision metric target that does not lead with a number: %s',
    async (target) => {
      const project = await createTestProject();
      await writeVision(project, { metrics: [metric('MET-001', { target: `"${target}"` })] });
      expect((await violations(project, 'metrics-defined')).length).toBeGreaterThan(0);
    },
  );

  it.each(['>= 60% of signups', 'at least 3 invoices per week', '< 2 tickets', '60%', '\u2265 3'])(
    'accepts a Vision metric target that leads with a number: %s',
    async (target) => {
      const project = await createTestProject();
      await writeVision(project, { metrics: [metric('MET-001', { target: `"${target}"` })] });
      expect(await violations(project, 'metrics-defined')).toEqual([]);
    },
  );

  it.each([
    ['an unknown instrumentation', { instrumentation: 'unknown' }],
    ['a pending instrumentation', { instrumentation: 'pending' }],
    ['a "to be determined" baseline', { baseline: '"to be determined"' }],
    ['a "TBD - to be decided" baseline', { baseline: '"TBD - to be decided"' }],
  ])('flags a Vision metric with %s', async (_label, overrides) => {
    const project = await createTestProject();
    await writeVision(project, { metrics: [metric('MET-001', overrides)] });
    expect((await violations(project, 'metrics-defined')).length).toBeGreaterThan(0);
  });

  it.each(['unknown', 'none (new product)', '0', 'unknown, to be measured in the first cohort'])(
    'accepts a Vision metric with the baseline %j',
    async (baseline) => {
      const project = await createTestProject();
      await writeVision(project, { metrics: [metric('MET-001', { baseline: `"${baseline}"` })] });
      expect(await violations(project, 'metrics-defined')).toEqual([]);
    },
  );

  it('accepts a statement that merely starts with a stand-in word (Pending invoices are listed)', async () => {
    const project = await createTestProject();
    await writeVision(project, {
      metrics: [metric('MET-001', { statement: '"Pending invoices cleared within a week"' })],
    });
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it('flags a Vision whose success_metrics is not a list, beside a valid Vision elsewhere', async () => {
    const project = await createTestProject();
    await writeVision(project, { metrics: [metric('MET-001')] });
    await writeFromTemplate(project, 'Vision', 'specs/vision-old.md', {
      id: 'VIS-002',
      success_metrics: '"grow"',
    });
    const found = await violations(project, 'metrics-defined');
    expect(found.map((v) => v.subject)).toEqual(['VIS-002']);
  });

  it('reads a blank field followed by the same field with a value as the value', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `### MET-001

- **Statement:** Agencies that send an invoice at day 30
- **Baseline:** 0
- **Target:**
- **Target:** >= 60%
- **Instrumentation:** invoice_sent event`,
    );
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it('lists at most 200 violations and says how many there were', async () => {
    const project = await createTestProject();
    const many = Array.from({ length: 500 }, (_, n) => `### MET-${String(n + 1).padStart(3, '0')}`);
    await writeKb(project, 'product/metrics.md', 'product', many.join('\n\n'));
    const found = await violations(project, 'metrics-defined');
    expect(found).toHaveLength(201);
    expect(found.at(-1)?.message).toMatch(/501 violations in all/);
  });

  it('passes a KB metrics entry written as a list block per MET id', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `### MET-001 Activation

- **Statement:** Agencies that send an invoice at day 30
- **Baseline:** unknown, to be measured in the first cohort
- **Target:** >= 60% of signups
- **Instrumentation:** the \`invoice_sent\` event per account`,
    );
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it('passes a KB metrics entry written as a table', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `| id | statement | baseline | target | instrumentation |
| --- | --- | --- | --- | --- |
| MET-001 | Invoices sent per agency per week | 0 | >= 3 | invoice_sent event |`,
    );
    expect(await violations(project, 'metrics-defined')).toEqual([]);
  });

  it('fails a table row that has a blank cell', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `| id | statement | baseline | target | instrumentation |
| --- | --- | --- | --- | --- |
| MET-001 | Invoices sent per agency per week | 0 | >= 3 |  |`,
    );
    const found = await violations(project, 'metrics-defined');
    expect(
      found.some((v) => v.subject === 'MET-001' && v.message.includes('instrumentation')),
    ).toBe(true);
  });

  it('flags the incomplete metric even when another metric is complete', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `MET-001
- statement: Agencies that send an invoice at day 30
- baseline: 0
- target: 60%
- instrumentation: invoice_sent event

MET-002
- statement: Support tickets per account
- baseline: 0
- target: < 2`,
    );
    const found = await violations(project, 'metrics-defined');
    expect(found.map((v) => v.subject)).toEqual(['MET-002']);
    expect(found[0]?.message).toMatch(/instrumentation/);
  });

  it('does not count a metric that appears only inside an HTML comment (a template placeholder)', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/metrics.md',
      'product',
      `<!--
MET-001
- statement: example
- baseline: 0
- target: 60%
- instrumentation: example
-->`,
    );
    const found = await violations(project, 'metrics-defined');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/no measurable success metric/);
  });

  it('fails, naming the file, when product/metrics.md cannot be parsed', async () => {
    const project = await createTestProject();
    const target = path.join(project.dir, KB_ROOT, 'product/metrics.md');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '---\nid: not-a-kb-id\ntype: knowledge\n---\nMET-001\n', 'utf8');
    const found = await violations(project, 'metrics-defined');
    expect(found.some((v) => v.subject === 'product/metrics.md')).toBe(true);
  });

  it('rejects a corrupt spec document (malformed front matter) loudly instead of passing', async () => {
    const project = await createTestProject();
    const target = path.join(project.dir, SPECS_ROOT, 'vision.md');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '---\nid: VIS-001\n  bad: [unterminated\n---\nbody\n', 'utf8');
    const failure = await specValidateRule(ctx(project), 'metrics-defined').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isForgeError(failure) && /^CFG-00[0-9]$/.test(failure.code)).toBe(true);
  });

  it('stays linear on hostile bodies (long whitespace runs, many unclosed comment openers, many brackets)', async () => {
    const project = await createTestProject();
    const hostile = [
      `MET-001\n- target:${' '.repeat(200_000)}x${' '.repeat(200_000)}`,
      '<!-- '.repeat(40_000),
      `## In scope\n- ${'[a'.repeat(40_000)}`,
      `# ${'# '.repeat(50_000)}x`,
      `## a${' '.repeat(100_000)}x`,
      `- a${' '.repeat(100_000)}x`,
      `- ${'.;'.repeat(50_000)}`,
    ].join('\n');
    await writeKb(project, 'product/metrics.md', 'product', hostile);
    await writeKb(project, 'product/scope.md', 'product', hostile);
    const started = Date.now();
    await specValidateRule(ctx(project), 'metrics-defined');
    await specValidateRule(ctx(project), 'scope-contradicts-constraints');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stays linear on lines holding U+2028/U+2029 (which "." does not match and whitespace does)', async () => {
    const project = await createTestProject();
    const hostile = [
      `### MET-001\n- target:${' '.repeat(20_000)}a\u2028b`,
      `## ${' '.repeat(100_000)}a\u2029b`,
      `- item${' '.repeat(100_000)}a\u2028b`,
    ].join('\n');
    await writeKb(project, 'product/metrics.md', 'product', hostile);
    await writeKb(project, 'product/scope.md', 'product', hostile);
    await writeKb(project, 'product/users.md', 'product', hostile);
    const started = Date.now();
    await specValidateRule(ctx(project), 'metrics-defined');
    await specValidateRule(ctx(project), 'scope-contradicts-constraints');
    await specValidateRule(ctx(project), 'user-identified');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('is deterministic: the same project gives byte-identical output on every run', async () => {
    const project = await createTestProject();
    await writeVision(project, {
      metrics: [metric('MET-001'), metric('MET-002', { target: '"lots"' })],
    });
    const first = JSON.stringify(await specValidateRule(ctx(project), 'metrics-defined'));
    const second = JSON.stringify(await specValidateRule(ctx(project), 'metrics-defined'));
    expect(second).toBe(first);
  });
});

// --- user-identified ------------------------------------------------------------------------------

describe('user-identified', () => {
  it('fails an empty project', async () => {
    const found = await violations(await createTestProject(), 'user-identified');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/no user/i);
  });

  it('passes a Vision with a target user', async () => {
    const project = await createTestProject();
    await writeVision(project, { users: '[persona:agency-owner]' });
    expect(await violations(project, 'user-identified')).toEqual([]);
  });

  it('fails a Vision whose only target_users entry is blank', async () => {
    const project = await createTestProject();
    await writeVision(project, { users: '["  "]' });
    expect(await violations(project, 'user-identified')).toHaveLength(1);
  });

  it('passes a KB users entry that names a persona id', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/users.md',
      'product',
      `### persona:agency-owner

Owner of a five-person agency. Job to be done: get paid on time.`,
    );
    expect(await violations(project, 'user-identified')).toEqual([]);
  });

  it('fails a KB users entry with prose but no persona id', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/users.md', 'product', 'Agency owners, mostly.');
    expect(await violations(project, 'user-identified')).toHaveLength(1);
  });

  it('does not accept the template placeholder persona:<slug> or a persona id inside a comment', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/users.md',
      'product',
      'Use ids of the form persona:<slug>.\n<!-- persona:agency-owner -->',
    );
    expect(await violations(project, 'user-identified')).toHaveLength(1);
  });

  it.each([
    '### Freelance designer (persona:freelance-designer)',
    '| Freelance | persona:freelance |',
    '- **id:** persona:agency-owner',
    'Id: persona:agency-owner',
    '    - id: persona:agency-owner',
    'persona:agency-owner - owner of a five-person agency',
  ])('counts a persona defined as %j', async (body) => {
    const project = await createTestProject();
    await writeKb(project, 'product/users.md', 'product', body);
    expect(await violations(project, 'user-identified')).toEqual([]);
  });

  it.each([
    '- persona:tbd2',
    '- persona:todo-later',
    '- persona:unknown-user',
    '#persona:agency-owner',
    '-persona:agency-owner',
    '- persona:Agency-Owner',
  ])('does not count %j', async (body) => {
    const project = await createTestProject();
    await writeKb(project, 'product/users.md', 'product', body);
    expect(await violations(project, 'user-identified')).toHaveLength(1);
  });

  it.each(['everyone', 'x', 'persona:tbd', 'persona:<slug>', 'TBD later', 'Agency owners'])(
    'does not count a Vision target_users entry of %j (it must be a persona id)',
    async (entry) => {
      const project = await createTestProject();
      await writeVision(project, { users: `["${entry}"]` });
      expect(await violations(project, 'user-identified')).toHaveLength(1);
    },
  );

  it('does not count a persona id shown inside a fenced code block', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/users.md', 'product', '```\npersona:agency-owner\n```');
    expect(await violations(project, 'user-identified')).toHaveLength(1);
  });

  it.each([
    'No persona:tbd identified yet.',
    'Use ids of the form persona:slug.',
    '> persona:agency-owner',
    '    persona:agency-owner',
    '- persona:tbd',
  ])('does not count a mention that is not a definition: %s', async (body) => {
    const project = await createTestProject();
    await writeKb(project, 'product/users.md', 'product', body);
    expect(await violations(project, 'user-identified')).toHaveLength(1);
  });

  it.each([
    '- persona:agency-owner: Owner of a five-person agency',
    '**persona:agency-owner** Owner',
    '| persona:agency-owner | Agency owner | Owner |',
    'id: persona:agency-owner',
  ])('counts a persona defined as %s', async (body) => {
    const project = await createTestProject();
    await writeKb(project, 'product/users.md', 'product', body);
    expect(await violations(project, 'user-identified')).toEqual([]);
  });

  it('is not fooled by a word that merely ends in persona:', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/users.md', 'product', 'antipersona:hacker');
    expect(await violations(project, 'user-identified')).toHaveLength(1);
  });
});

// --- scope-contradicts-constraints ----------------------------------------------------------------

const SCOPE_BODY = `## In scope

- Invoice creation
- Email delivery of invoices

## Out of scope

- Payroll
`;

describe('scope-contradicts-constraints', () => {
  it('fails a project with no scope: nothing was checked, so it has not passed', async () => {
    const found = await violations(await createTestProject(), 'scope-contradicts-constraints');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/no scope is declared/);
  });

  it('fails a scope.md from which no in-scope item can be read (prose or a table)', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/scope.md', 'product', 'Invoices, mostly. Not payroll.');
    const found = await violations(project, 'scope-contradicts-constraints');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/no in-scope item/);
  });

  it('reads items under nested sub-headings and under label lines as part of their section', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      `# Scope and non-goals

## In scope

### Payments

Billing:

- Payroll processing
- Invoice creation

## Out of scope

- Payroll processing
`,
    );
    const found = await violations(project, 'scope-contradicts-constraints');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/Payroll processing/);
  });

  it('reads a heading named just "Scope" as the in-scope list, beside a "Non-goals" heading', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      '## Scope\n\n- Payroll processing\n\n## Non-goals\n\n- Payroll processing\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toHaveLength(1);
  });

  it('does not read "Not yet in scope" as in scope', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      '## In scope\n\n- Invoices\n\n## Not yet in scope\n\n- Payroll\n',
    );
    await writeKb(project, 'constraints/business.md', 'constraints', '## Forbidden\n\n- Payroll\n');
    expect(await violations(project, 'scope-contradicts-constraints')).toEqual([]);
  });

  it('matches an item annotated with its constraint (frame-problem asks for the annotation)', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      '## In scope\n\n- Payroll processing (constraint: PII, see constraints/regulatory.md)\n\n## Out of scope\n\n- Payroll processing\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toHaveLength(1);
  });

  it('reads a forbidden item nested under a sub-heading of a Forbidden section', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/scope.md', 'product', SCOPE_BODY);
    await writeKb(
      project,
      'constraints/technical.md',
      'constraints',
      '## Forbidden\n\n### Communication\n\n- Email delivery of invoices\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toHaveLength(1);
  });

  it('keeps reading items after an inline <!-- that never closes (a code span, not a comment)', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      'Comments look like `<!--` in HTML.\n\n## In scope\n\n- Payroll\n\n## Out of scope\n\n- Payroll\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toHaveLength(1);
  });

  it('fails when the KB root itself cannot be walked (a tree-level error, not a per-file one)', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, KB_ROOT), { recursive: true, force: true });
    await writeFile(path.join(project.dir, KB_ROOT), 'not a directory', 'utf8');
    for (const rule of [
      'scope-contradicts-constraints',
      'blocking-open-questions',
      'metrics-defined',
      'user-identified',
    ] as const) {
      const found = await violations(project, rule);
      expect(
        found.some((v) => v.subject === KB_ROOT),
        rule,
      ).toBe(true);
    }
  });

  it('passes a scope and constraints that do not contradict', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/scope.md', 'product', SCOPE_BODY);
    await writeKb(
      project,
      'constraints/technical.md',
      'constraints',
      '## Forbidden technology\n\n- Oracle databases\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toEqual([]);
  });

  it('flags an item listed both in scope and out of scope', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      '## In scope\n\n- Payroll processing\n\n## Non-goals\n\n- **Payroll processing.**\n',
    );
    const found = await violations(project, 'scope-contradicts-constraints');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/Payroll processing/i);
  });

  it('flags an in-scope item that a constraint forbids', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/scope.md', 'product', SCOPE_BODY);
    await writeKb(
      project,
      'constraints/regulatory.md',
      'constraints',
      '## Prohibited\n\n- email delivery of invoices\n',
    );
    const found = await violations(project, 'scope-contradicts-constraints');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/constraints\/regulatory\.md/);
  });

  it('does not treat a forbidden item that is out of scope as a contradiction', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/scope.md', 'product', SCOPE_BODY);
    await writeKb(project, 'constraints/business.md', 'constraints', '## Must not\n\n- Payroll\n');
    expect(await violations(project, 'scope-contradicts-constraints')).toEqual([]);
  });

  it.each([
    'Card storage is prohibited.',
    'Card storage is strictly forbidden',
    'Card storage - forbidden by PCI DSS',
    'Forbidden: card storage',
    'Must not: Card storage.',
  ])('reads a constraint written as a prose bullet: %s', async (bullet) => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      '## In scope\n\n- Card storage\n- Invoices\n',
    );
    await writeKb(project, 'constraints/regulatory.md', 'constraints', `## PCI\n\n- ${bullet}\n`);
    const found = await violations(project, 'scope-contradicts-constraints');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/constraints\/regulatory\.md/);
  });

  it.each([
    ['Staff must not exceed budget', 'Budget'],
    ['Admins must not delete accounts', 'Accounts'],
    ['Users cannot export reports', 'Reports'],
    ['We must not collect analytics', 'Analytics'],
  ])(
    'does not turn the object of a prohibited action into a forbidden item (%s / in scope: %s)',
    async (bullet, inScope) => {
      const project = await createTestProject();
      await writeKb(project, 'product/scope.md', 'product', `## In scope\n\n- ${inScope}\n`);
      await writeKb(project, 'constraints/business.md', 'constraints', `## Rules\n\n- ${bullet}\n`);
      expect(await violations(project, 'scope-contradicts-constraints')).toEqual([]);
    },
  );

  it('does not read the bullets under "# Scope" / "## Assumptions" as in scope', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      '# Scope\n\n## In scope\n\n- Invoices\n\n## Assumptions\n\n- Payroll\n\n## Non-goals\n\n- Payroll\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toEqual([]);
  });

  it.each(['## MVP scope', '## Scope (v1)', '# Scope', '**In scope**', 'In scope:'])(
    'reads the list under %j as the in-scope list',
    async (heading) => {
      const project = await createTestProject();
      await writeKb(
        project,
        'product/scope.md',
        'product',
        `${heading}\n\n- Payroll\n\n## Out of scope\n\n- Payroll\n`,
      );
      expect(await violations(project, 'scope-contradicts-constraints')).toHaveLength(1);
    },
  );

  it('reads a decomposed and a composed spelling of the same item as one item (NFC)', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      '## In scope\n\n- Caf\u00e9 menu\n\n## Out of scope\n\n- Cafe\u0301 menu\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toHaveLength(1);
  });

  it('keeps a forbidden list that follows an inline `<!--` code span and precedes a real comment', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/scope.md', 'product', '## In scope\n\n- Card storage\n');
    await writeKb(
      project,
      'constraints/regulatory.md',
      'constraints',
      'Use `<!--` for comments.\n\n## Forbidden\n\n- Card storage\n\n<!-- end of list -->\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toHaveLength(1);
  });

  it('classifies a heading once, not once per item (a 200,000-character heading over 20,000 items)', async () => {
    const project = await createTestProject();
    const items = Array.from({ length: 20_000 }, (_, n) => `- item ${String(n)}`).join('\n');
    await writeKb(
      project,
      'product/scope.md',
      'product',
      `## In scope ${'x'.repeat(200_000)}\n\n${items}\n`,
    );
    await writeKb(
      project,
      'constraints/technical.md',
      'constraints',
      `## Forbidden ${'y'.repeat(200_000)}\n\n${items}\n`,
    );
    const started = Date.now();
    await violations(project, 'scope-contradicts-constraints');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('does not read a "### Allowed" list under a "# Allowed and forbidden" title as forbidden', async () => {
    const project = await createTestProject();
    await writeKb(project, 'product/scope.md', 'product', '## In scope\n\n- Card storage\n');
    await writeKb(
      project,
      'constraints/technical.md',
      'constraints',
      '# Allowed and forbidden\n\n## Allowed\n\n- Card storage\n\n## Forbidden\n\n- Oracle\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toEqual([]);
  });

  it('does not read everything under "Goals and non-goals" as out of scope', async () => {
    const project = await createTestProject();
    await writeKb(
      project,
      'product/scope.md',
      'product',
      '# Goals and non-goals\n\n## In scope\n\n- Invoices\n\n## Non-goals\n\n- Payroll\n',
    );
    expect(await violations(project, 'scope-contradicts-constraints')).toEqual([]);
  });

  it('fails, naming the file, when scope.md cannot be parsed (the check cannot run)', async () => {
    const project = await createTestProject();
    const target = path.join(project.dir, KB_ROOT, 'product/scope.md');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '---\nid: nope\n---\n## In scope\n- x\n', 'utf8');
    const found = await violations(project, 'scope-contradicts-constraints');
    expect(found.some((v) => v.subject === 'product/scope.md')).toBe(true);
  });
});

// --- capability-acceptance ------------------------------------------------------------------------

describe('capability-acceptance', () => {
  it('fails an empty project: a product definition with no capability cannot be evaluated', async () => {
    const found = await violations(await createTestProject(), 'capability-acceptance');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/no Capability/);
  });

  it('passes capabilities that each carry an acceptance summary', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-001.md', {
      acceptance_summary: "'An owner can email an invoice and see it marked sent.'",
    });
    expect(await violations(project, 'capability-acceptance')).toEqual([]);
  });

  it('flags a whitespace-only acceptance summary (the schema only requires one character)', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-001.md', {
      acceptance_summary: '"   "',
    });
    const found = await violations(project, 'capability-acceptance');
    expect(found.map((v) => v.subject)).toEqual(['CAP-001']);
  });

  it('flags a Capability with no acceptance_summary field at all', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-002.md', {
      id: 'CAP-002',
    });
    const target = path.join(project.dir, 'docs/forge/specs/capabilities/CAP-002.md');
    await writeFile(
      target,
      (await readFile(target, 'utf8')).replace(/^acceptance_summary:.*\n/m, ''),
      'utf8',
    );
    const found = await violations(project, 'capability-acceptance');
    expect(found.map((v) => v.subject)).toEqual(['CAP-002']);
  });

  it('flags an unfilled template placeholder as a missing acceptance summary', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-001.md', {});
    const found = await violations(project, 'capability-acceptance');
    expect(found.map((v) => v.subject)).toEqual(['CAP-001']);
  });

  it('flags a document with a CAP- id and a mistyped type instead of ignoring it', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-001.md', {
      acceptance_summary: "'An owner can email an invoice.'",
    });
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-002.md', {
      id: 'CAP-002',
      type: 'Capabilty',
      acceptance_summary: '""',
    });
    const found = await violations(project, 'capability-acceptance');
    expect(found.map((v) => v.subject)).toEqual(['CAP-002']);
    expect(found[0]?.message).toMatch(/type: Capability/);
  });

  it('names a document that has a CAP- id and no type at all', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-001.md', {
      acceptance_summary: "'An owner can email an invoice.'",
    });
    const target = path.join(project.dir, 'docs/forge/specs/capabilities/CAP-003.md');
    await writeFile(target, '---\nid: CAP-003\n---\nbody\n', 'utf8');
    expect((await violations(project, 'capability-acceptance')).map((v) => v.subject)).toEqual([
      'CAP-003',
    ]);
  });

  it('reports one violation per offending capability, ordered by id', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-002.md', {
      id: 'CAP-002',
      acceptance_summary: '""',
    });
    await writeFromTemplate(project, 'Capability', 'specs/capabilities/CAP-001.md', {
      acceptance_summary: '""',
    });
    const found = await violations(project, 'capability-acceptance');
    expect(found.map((v) => v.subject)).toEqual(['CAP-001', 'CAP-002']);
  });
});

// --- nfr-numeric ----------------------------------------------------------------------------------

async function writeNfr(project: TestProject, id: string, target: string): Promise<void> {
  await writeFromTemplate(project, 'NFR', `specs/nfr/${id}.md`, {
    id,
    target,
    statement: "'Invoice list renders quickly under normal load.'",
    metric: "'p95 render latency'",
    verification: '\n  kind: benchmark\n  ref: invoice-list-p95',
  });
}

describe('nfr-numeric', () => {
  it('fails an empty project: there is no NFR to be numeric', async () => {
    const found = await violations(await createTestProject(), 'nfr-numeric');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/no NFR/);
  });

  it.each(["'< 300ms'", "'>= 99.5%'", "'0 open violations'", "'= 12'", "'250'"])(
    'passes numeric target %s',
    async (target) => {
      const project = await createTestProject();
      await writeNfr(project, 'NFR-0001', target);
      expect(await violations(project, 'nfr-numeric')).toEqual([]);
    },
  );

  it.each(["'fast'", "'p95 under 300ms'", "'reduce onboarding to 1 click'", "''", "'   '"])(
    'flags non-numeric target %s',
    async (target) => {
      const project = await createTestProject();
      await writeNfr(project, 'NFR-0001', target);
      const found = await violations(project, 'nfr-numeric');
      expect(found.map((v) => v.subject)).toEqual(['NFR-0001']);
    },
  );

  it("reads a bare YAML number as a numeric target (the schema wanting a string is spec validate's finding)", async () => {
    const project = await createTestProject();
    await writeNfr(project, 'NFR-0001', '300');
    expect(await violations(project, 'nfr-numeric')).toEqual([]);
  });

  it.each(['[300]', '{ value: 300 }', 'true', 'null'])(
    'flags a target that is not a scalar number or string (%s)',
    async (target) => {
      const project = await createTestProject();
      await writeNfr(project, 'NFR-0001', target);
      expect((await violations(project, 'nfr-numeric')).map((v) => v.subject)).toEqual([
        'NFR-0001',
      ]);
    },
  );

  it('flags an untouched template NFR: its default target is numeric but nothing is stated', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'NFR', 'specs/nfr/NFR-0001.md', { id: 'NFR-0001' });
    const found = await violations(project, 'nfr-numeric');
    expect(found.map((v) => v.subject)).toEqual(['NFR-0001']);
    expect(found[0]?.message).toMatch(/statement, metric or verification\.ref/);
  });

  it('flags an NFR whose verification.ref is still the template placeholder', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'NFR', 'specs/nfr/NFR-0001.md', {
      id: 'NFR-0001',
      statement: "'Renders quickly.'",
      metric: "'p95 latency'",
    });
    const found = await violations(project, 'nfr-numeric');
    expect(found.map((v) => v.subject)).toEqual(['NFR-0001']);
    expect(found[0]?.message).toMatch(/verification\.ref/);
  });

  it('flags a mistyped NFR (type: nfr) by its NFR- id', async () => {
    const project = await createTestProject();
    await writeNfr(project, 'NFR-0001', "'< 300ms'");
    await writeFromTemplate(project, 'NFR', 'specs/nfr/NFR-0002.md', {
      id: 'NFR-0002',
      type: 'nfr',
      target: "'fast'",
    });
    expect((await violations(project, 'nfr-numeric')).map((v) => v.subject)).toEqual(['NFR-0002']);
  });

  it('reports a cyclic YAML value and a huge target as one bounded message, not a crash', async () => {
    const project = await createTestProject();
    await writeNfr(project, 'NFR-0001', '&a [*a]');
    await writeNfr(project, 'NFR-0002', `'${'x'.repeat(300_000)}'`);
    const found = await violations(project, 'nfr-numeric');
    expect(found.map((v) => v.subject)).toEqual(['NFR-0001', 'NFR-0002']);
    expect(found.every((v) => v.message.length < 600)).toBe(true);
  });

  it('evaluates an NFR that is schema-invalid for another reason too', async () => {
    const project = await createTestProject();
    await writeFromTemplate(project, 'NFR', 'specs/nfr/NFR-0003.md', {
      id: 'NFR-0003',
      target: "'quick'",
      category: 'not-a-category',
      statement: "'Renders quickly.'",
      metric: "'p95 latency'",
    });
    expect((await violations(project, 'nfr-numeric')).map((v) => v.subject)).toEqual(['NFR-0003']);
  });

  it('names only the offending NFRs when several exist', async () => {
    const project = await createTestProject();
    await writeNfr(project, 'NFR-0001', "'< 300ms'");
    await writeNfr(project, 'NFR-0002', "'fast'");
    await writeNfr(project, 'NFR-0003', "'>= 99%'");
    expect((await violations(project, 'nfr-numeric')).map((v) => v.subject)).toEqual(['NFR-0002']);
  });
});

// --- blocking-open-questions ----------------------------------------------------------------------

async function writeOpenQuestions(project: TestProject, entries: string): Promise<void> {
  await writeCollectionFileFixture(project, 'open-questions.md', 'OpenQuestion', 'open_questions');
  const target = path.join(project.dir, KB_ROOT, 'open-questions.md');
  const raw = await readFile(target, 'utf8');
  await writeFile(target, raw.replace('open_questions: []', `open_questions:\n${entries}`), 'utf8');
}

describe('blocking-open-questions', () => {
  it('passes a project with no open-questions register', async () => {
    expect(await violations(await createTestProject(), 'blocking-open-questions')).toEqual([]);
  });

  it('passes a register whose questions are all resolved', async () => {
    const project = await createTestProject();
    await writeOpenQuestions(
      project,
      "  - id: OQ-001\n    question: 'Is it done?'\n    status: resolved",
    );
    expect(await violations(project, 'blocking-open-questions')).toEqual([]);
  });

  it('flags every open question by id', async () => {
    const project = await createTestProject();
    await writeOpenQuestions(
      project,
      [
        "  - id: OQ-001\n    question: 'Which region?'\n    status: open",
        "  - id: OQ-002\n    question: 'Done?'\n    status: resolved",
        "  - id: OQ-003\n    question: 'Which currency?'\n    status: open",
      ].join('\n'),
    );
    const found = await violations(project, 'blocking-open-questions');
    expect(found.map((v) => v.subject)).toEqual(['OQ-001', 'OQ-003']);
    expect(found[0]?.message).toMatch(/Which region\?/);
  });

  it('fails, naming the file, when the register cannot be parsed (an "Open" status is not "open")', async () => {
    const project = await createTestProject();
    await writeOpenQuestions(project, "  - id: OQ-001\n    question: 'x'\n    status: Open");
    const found = await violations(project, 'blocking-open-questions');
    expect(found.some((v) => v.subject === 'open-questions.md')).toBe(true);
  });
});
