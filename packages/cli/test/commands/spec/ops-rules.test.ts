/**
 * `forge spec validate --rule slo-observability-coverage` and `--rule runbook-coverage` (`G-Operate`,
 * `PLAN-M13.md` P26, Q228).
 *
 * Every fixture is a real document: SLOs are NFR files in the shape the `define-slos` brief asks for, runbooks are KB
 * files in the shape `write-runbooks` asks for, and the component inventory is a real `architecture/components.md`.
 * A passing fixture and a failing one for every clause of each rule.
 *
 * @see specs/10 §10.3
 * @see specs/14 §14.5, §14.7
 * @see PLAN-M13.md P26
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SpecCommandContext } from '../../../src/commands/spec.ts';
import {
  specValidateRule,
  VALIDATE_RULE_IDS,
  type ValidateRuleId,
} from '../../../src/commands/spec/validate-rules.ts';
import {
  KB_ROOT,
  SPECS_ROOT,
  cleanupAll,
  createTestProject,
  type TestProject,
} from '../helpers.ts';

afterEach(cleanupAll);

const ctx = (project: TestProject): SpecCommandContext => ({
  paths: project.paths,
  specsRoot: SPECS_ROOT,
  kbRoot: KB_ROOT,
});

async function put(project: TestProject, relative: string, text: string): Promise<void> {
  const target = path.join(project.dir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

async function run(project: TestProject, rule: ValidateRuleId) {
  return (await specValidateRule(ctx(project), rule)).violations;
}

interface SloOptions {
  readonly kind?: string;
  readonly ref?: string | null;
  readonly status?: string;
  readonly body?: string;
}

const BURN =
  'Alerts fire on error-budget burn rate: a fast window pages, a slow window opens a ticket.';

async function slo(project: TestProject, id: string, options: SloOptions = {}): Promise<void> {
  const ref = options.ref === undefined ? 'ALERT-api-availability' : options.ref;
  const body =
    options.body ??
    `## Why\n\n${BURN}\n\nPlanned alert ALERT-api-availability: ratio of 5xx over 30 days.\n`;
  await put(
    project,
    `${SPECS_ROOT}/nfrs/${id}.md`,
    `---
id: ${id}
type: NFR
schemaVersion: 1
title: API availability
status: ${options.status ?? 'active'}
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: sre
changelog: []
category: availability
statement: The API answers successfully
metric: successful request ratio
target: '>= 99.9%'
verification:
  kind: ${options.kind ?? 'monitor'}${ref === null ? '' : `\n  ref: ${ref}`}
applies_to: [component:api]
---

${body}`,
  );
}

async function components(
  project: TestProject,
  modes: Record<string, readonly string[]>,
): Promise<void> {
  const entries = Object.entries(modes)
    .map(
      ([slug, failureModes]) => `  - id: component:${slug}
    label: ${slug}
    responsibility: Does the ${slug} work
    owner: backend
    dependsOn: []
    failureModes: ${JSON.stringify(failureModes)}`,
    )
    .join('\n');
  await put(
    project,
    `${KB_ROOT}/architecture/components.md`,
    `---
type: Component
schemaVersion: 1
title: Components
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
components:
${entries}
---
`,
  );
}

interface RunbookOptions {
  readonly status?: string;
  readonly symptoms?: string;
  readonly steps?: readonly string[];
  readonly escalation?: string;
}

async function runbook(
  project: TestProject,
  number: number,
  title: string,
  options: RunbookOptions = {},
): Promise<void> {
  const id = `RUN-${String(number).padStart(3, '0')}`;
  await put(
    project,
    `${KB_ROOT}/ops/runbooks/${id}-book.md`,
    `---
id: ${id}
type: Runbook
schemaVersion: 1
title: ${JSON.stringify(title)}
status: ${options.status ?? 'active'}
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: sre
changelog: []
symptoms: ${JSON.stringify(options.symptoms ?? 'Pages from ALERT-api-availability; 5xx rate above the budget.')}
immediate_mitigation: Fail over to the replica with the promote script.
diagnosis_steps: ${JSON.stringify(options.steps ?? ['Run kubectl logs deploy/api and look for connection refused'])}
escalation: ${JSON.stringify(options.escalation ?? 'Page the platform lead, then the vendor.')}
post_incident_actions: ['Record an RCA']
---

Body.
`,
  );
}

describe('slo-observability-coverage', () => {
  const RULE: ValidateRuleId = 'slo-observability-coverage';

  it('is a rule the CLI accepts', () => {
    expect(VALIDATE_RULE_IDS).toContain(RULE);
  });

  it('passes an SLO whose alert id is defined in its body and whose body states a burn-rate policy', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001');
    expect(await run(project, RULE)).toEqual([]);
  });

  it('fails a project with no SLO at all: an empty set shows no alert', async () => {
    const found = await run(await createTestProject(), RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('No SLO is declared');
    expect(found[0]?.remedy).toMatch(/^Run the define-slos step/);
  });

  it('an NFR verified by a test or benchmark is not an SLO: a project of only those still fails', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001', { kind: 'test' });
    expect((await run(project, RULE))[0]?.message).toContain('No SLO is declared');
  });

  it('a retired SLO does not count', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001', { status: 'superseded' });
    expect((await run(project, RULE))[0]?.message).toContain('No SLO is declared');
  });

  it.each([
    ['no ref at all', null],
    ['a blank ref', "''"],
    ['a ref that is not a monitor id', 'grafana/api'],
    ['a ref with a shell metacharacter', "'ALERT-x; rm -rf /'"],
  ])('fails %s', async (_label, ref) => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001', { ref });
    const found = await run(project, RULE);
    expect(found.map((v) => v.message).join(' ')).toContain('does not name a dashboard or alert');
    expect(found[0]?.remedy).toMatch(/^Set verification\.ref/);
  });

  it('fails a monitor id that is defined nowhere (not in the SLO body, an ops entry or the plan)', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001', { body: `${BURN}\n` });
    const found = await run(project, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('ALERT-api-availability is not defined anywhere');
  });

  it('a longer id containing the reference is not a definition of it (whole-token match)', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001', {
      body: `${BURN}\nPlanned alert ALERT-api-availability-fast only.\n`,
    });
    expect((await run(project, RULE))[0]?.message).toContain('is not defined anywhere');
  });

  it('accepts a definition in the observability plan (handoffs.md) or in an ops/ KB entry', async () => {
    const withPlan = await createTestProject();
    await slo(withPlan, 'NFR-0001', { body: `${BURN}\n` });
    await put(
      withPlan,
      'docs/forge/reports/handoffs.md',
      '---\ntype: HandoffRecord\n---\n- subtype: observability-plan; ALERT-api-availability: burn-rate ratio\n',
    );
    expect(await run(withPlan, RULE)).toEqual([]);

    const withEntry = await createTestProject();
    await slo(withEntry, 'NFR-0001', { body: `${BURN}\n` });
    await put(
      withEntry,
      `${KB_ROOT}/ops/observability.md`,
      `---
id: KB-OPS-0001
type: knowledge
section: ops
title: Observability plan
status: active
confidence: high
owner: sre
sources:
  - kind: decision
    ref: ADR-0001
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

Planned: ALERT-api-availability (5xx ratio).
`,
    );
    expect(await run(withEntry, RULE)).toEqual([]);
  });

  it('fails an SLO whose body never states a burn-rate policy', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001', {
      body: 'Planned alert ALERT-api-availability: raw 5xx > 1%.\n',
    });
    const found = await run(project, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('burn-rate');
  });

  it('reports every failing SLO, sorted, and is byte-identical across runs', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0002', { ref: null });
    await slo(project, 'NFR-0001', { body: 'nothing\n' });
    const first = JSON.stringify(await run(project, RULE));
    expect(JSON.stringify(await run(project, RULE))).toBe(first);
    const subjects = (await run(project, RULE)).map((v) => v.subject);
    expect([...subjects].sort()).toEqual(subjects);
    expect(subjects.filter((s) => s === 'NFR-0001')).toHaveLength(2);
  });

  it('a corrupt spec document is a violation naming the file, never a skip or a pass', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001');
    await put(project, `${SPECS_ROOT}/nfrs/NFR-0009.md`, '---\nid: [oops\n---\n');
    const found = await run(project, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe(`${SPECS_ROOT}/nfrs/NFR-0009.md`);
  });

  it("a KB file that cannot be read under ops/ is a violation; an unrelated broken ADR is not this rule's", async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001');
    await put(project, `${KB_ROOT}/decisions/ADR-0001-broken.md`, '---\nnot: an adr\n---\n');
    expect(await run(project, RULE)).toEqual([]);
    await put(project, `${KB_ROOT}/ops/runbooks/RUN-001-broken.md`, '---\nnot: a runbook\n---\n');
    const found = await run(project, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('ops/runbooks/RUN-001-broken.md');
  });

  it('every violation names what to do', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001', { ref: null, body: 'x' });
    for (const violation of await run(project, RULE)) {
      expect(violation.remedy?.length).toBeGreaterThan(20);
    }
  });
});

describe('runbook-coverage', () => {
  const RULE: ValidateRuleId = 'runbook-coverage';

  it('is a rule the CLI accepts', () => {
    expect(VALIDATE_RULE_IDS).toContain(RULE);
  });

  it('passes when every component failure mode has a usable runbook and every SLO alert is named by one', async () => {
    const project = await createTestProject();
    await components(project, {
      api: ['Database primary unavailable'],
      worker: ['Queue backlog grows'],
    });
    await slo(project, 'NFR-0001');
    await runbook(project, 1, 'Database primary unavailable');
    await runbook(project, 2, 'Queue backlog grows', {
      symptoms: 'Depth of the jobs table rising; nothing pages yet.',
    });
    expect(await run(project, RULE)).toEqual([]);
  });

  it('fails a project with nothing identified: no component failure mode and no SLO alert', async () => {
    const found = await run(await createTestProject(), RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('No failure mode is identified');
  });

  it('fails a failure mode no runbook is titled with, naming component and mode', async () => {
    const project = await createTestProject();
    await components(project, { api: ['Database primary unavailable', 'Certificate expires'] });
    await runbook(project, 1, 'Database primary unavailable');
    const found = await run(project, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('component:api: Certificate expires');
    expect(found[0]?.remedy).toMatch(/^Write the runbook/);
  });

  it('matches titles ignoring case and punctuation, and either text may contain the other', async () => {
    const project = await createTestProject();
    await components(project, {
      api: ['database primary unavailable!', 'Cache'],
      worker: ['Queue backlog'],
    });
    await runbook(project, 1, 'Database Primary Unavailable');
    await runbook(project, 2, 'Queue backlog grows past the alert threshold');
    // 'Cache' is shorter than the containment minimum and has no equal title: not covered by the long title above
    const found = await run(project, RULE);
    expect(found.map((v) => v.subject)).toEqual(['component:api: Cache']);
  });

  it('a one-word or partial-word title covers nothing (whole-word containment of two or more words only)', async () => {
    const project = await createTestProject();
    await components(project, { api: ['Database connection pool exhausted'] });
    await runbook(project, 1, 'Database');
    await runbook(project, 2, 'Connect');
    expect(await run(project, RULE)).toHaveLength(1);
    await runbook(project, 3, 'Connection pool exhausted');
    expect(await run(project, RULE)).toEqual([]);
  });

  it.each(['TODO', 'tbd', 'n/a', 'none'])(
    'a stand-in %s for the escalation does not count',
    async (word) => {
      const project = await createTestProject();
      await components(project, { api: ['Database primary unavailable'] });
      await runbook(project, 1, 'Database primary unavailable', { escalation: word });
      expect((await run(project, RULE))[0]?.message).toContain('looks like it but does not count');
    },
  );

  it('an unrelated runbook covers nothing', async () => {
    const project = await createTestProject();
    await components(project, { api: ['Database primary unavailable'] });
    await runbook(project, 1, 'Certificate expires');
    expect(await run(project, RULE)).toHaveLength(1);
  });

  it.each<[string, RunbookOptions]>([
    ['a retired status', { status: 'deprecated' }],
    ['no diagnosis steps', { steps: [] }],
    ['a blank diagnosis step', { steps: ['  '] }],
    ['a template placeholder step', { steps: ['<the exact command to run>'] }],
    ['an unfilled escalation', { escalation: '<who to page, and when>' }],
  ])('a runbook with %s does not count, and the message says why', async (_label, options) => {
    const project = await createTestProject();
    await components(project, { api: ['Database primary unavailable'] });
    await runbook(project, 1, 'Database primary unavailable', options);
    const found = await run(project, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('RUN-001 looks like it but does not count');
  });

  it('a runbook that fails its schema is a violation naming the file (it cannot be counted)', async () => {
    const project = await createTestProject();
    await components(project, { api: ['Database primary unavailable'] });
    await put(
      project,
      `${KB_ROOT}/ops/runbooks/RUN-001-bad.md`,
      '---\nid: RUN-001\ntype: Runbook\n---\n',
    );
    const found = await run(project, RULE);
    expect(found.map((v) => v.subject)).toContain('ops/runbooks/RUN-001-bad.md');
  });

  it('fails an SLO alert that no usable runbook names', async () => {
    const project = await createTestProject();
    await components(project, { api: ['Database primary unavailable'] });
    await slo(project, 'NFR-0001');
    await runbook(project, 1, 'Database primary unavailable', { symptoms: 'Connections refused.' });
    const found = await run(project, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('NFR-0001: ALERT-api-availability');
    expect(found[0]?.message).toContain('links no runbook');
  });

  it('a dashboard SLO monitor needs no runbook; only an alert links one', async () => {
    const project = await createTestProject();
    await components(project, { api: ['Database primary unavailable'] });
    await slo(project, 'NFR-0001', {
      ref: 'DASH-api-availability',
      body: `${BURN}\nPlanned DASH-api-availability.\n`,
    });
    await runbook(project, 1, 'Database primary unavailable');
    expect(await run(project, RULE)).toEqual([]);
  });

  it('an SLO alert alone (no component failure modes) is an identified mode: it needs a runbook', async () => {
    const project = await createTestProject();
    await slo(project, 'NFR-0001');
    expect((await run(project, RULE))[0]?.subject).toBe('NFR-0001: ALERT-api-availability');
    await runbook(project, 1, 'API availability breach');
    expect(await run(project, RULE)).toEqual([]);
  });

  it('a corrupt component inventory is a violation, never a pass on "no failure modes"', async () => {
    const project = await createTestProject();
    await put(
      project,
      `${KB_ROOT}/architecture/components.md`,
      '---\ntype: Component\ncomponents: nope\n---\n',
    );
    const found = await run(project, RULE);
    expect(found.map((v) => v.subject)).toContain('architecture/components.md');
  });

  it('is deterministic and sorted', async () => {
    const project = await createTestProject();
    await components(project, { b: ['Second failure'], a: ['First failure'] });
    const first = JSON.stringify(await run(project, RULE));
    expect(JSON.stringify(await run(project, RULE))).toBe(first);
    expect((await run(project, RULE)).map((v) => v.subject)).toEqual([
      'component:a: First failure',
      'component:b: Second failure',
    ]);
  });
});
