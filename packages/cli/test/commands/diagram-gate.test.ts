/**
 * `forge diagram validate --gate <G-Design|G-Deliver>` and `forge diagram generate --all --check` (`PLAN-M13.md` P26,
 * Q228; `08` §8.11.6, §8.11.7).
 *
 * Every fixture is a real diagram: a `.mmd` source with its `.mmd.yaml` sidecar under a real KB tree, parsed by the real
 * Mermaid parser; generated diagrams are produced by the real generators, then edited to drift. A passing and a failing
 * fixture for each clause, and the malformed-input cases: an unparseable source, a missing source, a sidecar with no
 * source, a source with no sidecar, a corrupt sidecar.
 *
 * @see specs/08 §8.11.6, §8.11.7
 * @see specs/10 §10.3
 * @see PLAN-M13.md P26
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SpecGraph } from '@forge/core/graph';
import { runGenerator } from '@forge/diagrams/generate';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { afterEach, describe, expect, it } from 'vitest';

import {
  diagramDriftCheck,
  diagramValidateGate,
  type DiagramGate,
  type DiagramGateContext,
} from '../../src/commands/diagram-gate.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

function ctx(
  project: TestProject,
  overrides: {
    level?: string;
    driftPolicy?: 'fail' | 'autofix' | 'warn';
    requireCaptions?: boolean;
    now?: string;
  } = {},
): DiagramGateContext {
  return {
    paths: project.paths,
    kbRoot: KB_ROOT,
    specsRoot: SPECS_ROOT,
    level: overrides.level ?? 'L3',
    diagrams: {
      complexity: DEFAULT_CONFIG.diagrams.complexity,
      requireCaptions: overrides.requireCaptions ?? true,
      driftPolicy: overrides.driftPolicy ?? 'fail',
    },
    clock: { now: () => overrides.now ?? '2026-06-01T00:00:00.000Z' },
  };
}

async function put(project: TestProject, relative: string, text: string): Promise<void> {
  const target = path.join(project.dir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

const FLOW = 'flowchart TB\n  web[Web app] --> api[API service]\n';

interface DiagramOptions {
  readonly id?: string;
  readonly kind?: string;
  readonly source?: string;
  readonly depicts?: readonly string[];
  readonly generated?: boolean;
  readonly generator?: string;
  readonly caption?: string;
  readonly altText?: string;
  readonly reviewBy?: string;
  /** `false`: write only the sidecar. */
  readonly writeSource?: boolean;
}

/** `relative` is the source path under the KB root, e.g. `architecture/views/context.mmd`. */
async function diagram(
  project: TestProject,
  relative: string,
  options: DiagramOptions = {},
): Promise<void> {
  const id = options.id ?? `DIAG-${String(Math.abs(hash(relative)) % 900).padStart(3, '0')}`;
  if (options.writeSource !== false) {
    await put(project, `${KB_ROOT}/${relative}`, options.source ?? FLOW);
  }
  await put(
    project,
    `${KB_ROOT}/${relative}.yaml`,
    `id: ${id}
type: Diagram
schemaVersion: 1
title: A diagram
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
kind: ${options.kind ?? 'flowchart'}
notation: mermaid
source: ${relative}
generated: ${String(options.generated ?? false)}
${options.generator === undefined ? '' : `generator: ${options.generator}\n`}depicts: ${JSON.stringify(options.depicts ?? [])}
explains: []
caption: ${JSON.stringify(options.caption ?? 'The web app calls the API service.')}
alt_text: ${JSON.stringify(options.altText ?? 'A web box with an arrow to an API box.')}
owner: architect
${options.reviewBy === undefined ? '' : `review_by: ${options.reviewBy}\n`}`,
  );
}

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) | 0;
  return value;
}

async function components(project: TestProject, slugs: readonly string[]): Promise<void> {
  const entries = slugs
    .map(
      (slug) => `  - id: component:${slug}
    label: ${slug}
    responsibility: Does the ${slug} work
    owner: backend
    dependsOn: []
    failureModes: []`,
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

async function adr(
  project: TestProject,
  number: number,
  options: {
    category?: string;
    status?: string;
    blast?: readonly string[];
    diagrams?: readonly string[];
    body?: string;
  } = {},
): Promise<void> {
  const id = `ADR-${String(number).padStart(4, '0')}`;
  await put(
    project,
    `${KB_ROOT}/decisions/${id}-choice.md`,
    `---
id: ${id}
type: ADR
schemaVersion: 1
title: A choice
status: ${options.status ?? 'accepted'}
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
category: ${options.category ?? 'architecture'}
deciders: [architect]
date: 2026-01-01
reversibility: easy
blast_radius: ${JSON.stringify(options.blast ?? ['component:api'])}
revisit_trigger: when it hurts
supersedes: []
superseded_by: ${options.status === 'superseded' ? 'ADR-0099' : 'null'}
related: []
diagrams: ${JSON.stringify(options.diagrams ?? [])}
framework: architecture-style
---

${options.body ?? 'Context and decision.\n'}`,
  );
}

const CONTEXT = 'architecture/views/context.mmd';
const CONTAINERS = 'architecture/views/containers.mmd';

async function validate(project: TestProject, gate: DiagramGate, level = 'L3') {
  return diagramValidateGate(ctx(project, { level }), gate);
}

describe('diagram validate --gate G-Design', () => {
  it('passes at L3 with the context and container views present and valid', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001' });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    const outcome = await validate(project, 'G-Design');
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({ gate: 'G-Design', diagrams: 2, required: 2 });
  });

  it('fails at L2 and above when a required view is missing, and names where to draw it', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001' });
    const outcome = await validate(project, 'G-Design', 'L2');
    expect(outcome.violations.map((v) => v.subject)).toEqual([CONTAINERS]);
    expect(outcome.violations[0]?.message).toContain('diagram:required');
    expect(outcome.violations[0]?.remedy).toContain(`${KB_ROOT}/${CONTAINERS}`);
  });

  it.each(['L0', 'L1'])(
    'does not require the views at %s (08 section 8.11.3: L2+)',
    async (level) => {
      const outcome = await validate(await createTestProject(), 'G-Design', level);
      expect(outcome.violations).toEqual([]);
      expect(outcome.fields).toMatchObject({ required: 0 });
    },
  );

  it('still validates every diagram that exists at L1', async () => {
    const project = await createTestProject();
    await diagram(project, 'architecture/views/x.mmd', { source: 'not a diagram at all\n' });
    expect((await validate(project, 'G-Design', 'L1')).violations).toHaveLength(1);
  });

  it('fails a diagram that does not parse (diagram:syntax), naming the id and the file', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001', source: 'flowchart TB\n  a -->\n  ((( \n' });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    const found = (await validate(project, 'G-Design')).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('DIAG-001');
    expect(found[0]?.message).toContain('diagram:syntax');
    expect(found[0]?.remedy).toContain(CONTEXT);
  });

  it('fails an empty source', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001', source: '' });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    expect((await validate(project, 'G-Design')).violations.map((v) => v.subject)).toEqual([
      'DIAG-001',
    ]);
  });

  it('fails a sidecar whose source file does not exist, a source with no sidecar, and a sidecar that fails its schema', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001', writeSource: false });
    await put(project, `${KB_ROOT}/architecture/views/lonely.mmd`, FLOW);
    await put(project, `${KB_ROOT}/architecture/views/broken.mmd.yaml`, 'id: nope\n');
    await put(project, `${KB_ROOT}/architecture/views/broken.mmd`, FLOW);
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    const found = (await validate(project, 'G-Design')).violations;
    const text = found.map((v) => `${v.subject}: ${v.message}`).join('\n');
    expect(text).toContain('DIAG-001: DIAG-001: its source');
    expect(text).toContain('architecture/views/lonely.mmd has no sidecar');
    expect(text).toContain('architecture/views/broken.mmd.yaml could not be read');
    expect(text).not.toContain('broken.mmd has no sidecar');
  });

  it('fails an over-long source instead of parsing it', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, {
      id: 'DIAG-001',
      source: `${FLOW}%% ${'x'.repeat(1_100_000)}\n`,
    });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    expect((await validate(project, 'G-Design')).violations[0]?.message).toContain(
      'character limit',
    );
  });

  it('checks depicts against the components, artifact ids and KB ids (diagram:refs)', async () => {
    const project = await createTestProject();
    await components(project, ['api']);
    await diagram(project, CONTEXT, { id: 'DIAG-001', depicts: ['component:api'] });
    await diagram(project, CONTAINERS, {
      id: 'DIAG-002',
      depicts: ['component:api', 'component:ghost'],
    });
    const found = (await validate(project, 'G-Design')).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('DIAG-002');
    expect(found[0]?.message).toContain('diagram:refs');
  });

  it('a datastore a KB entry names under applies_to is a real thing to depict', async () => {
    const project = await createTestProject();
    await put(
      project,
      `${KB_ROOT}/architecture/db.md`,
      `---
id: KB-ARCH-0001
type: knowledge
section: architecture
title: The database
status: active
confidence: high
owner: architect
sources:
  - kind: decision
    ref: ADR-0001
created: 2026-01-01
updated: 2026-01-01
review_by: 2027-06-01
supersedes: []
superseded_by: null
related: []
diagrams: []
tags: []
applies_to: ['datastore:postgres-primary']
---
`,
    );
    await diagram(project, CONTEXT, { id: 'DIAG-001', depicts: ['datastore:postgres-primary'] });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    expect((await validate(project, 'G-Design')).violations).toEqual([]);
  });

  it('does not check depicts of an ER diagram (entity names are in no registry)', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001' });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    await diagram(project, 'data/views/er-billing.mmd', {
      id: 'DIAG-003',
      kind: 'erDiagram',
      source: 'erDiagram\n  INVOICE ||--o{ LINE_ITEM : has\n',
      depicts: ['Invoice', 'LineItem'],
    });
    expect((await validate(project, 'G-Design')).violations).toEqual([]);
  });

  it('fails a single-word caption and a placeholder label; a warning (orphan node, over-budget) does not fail', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001', caption: 'Context' });
    await diagram(project, CONTAINERS, {
      id: 'DIAG-002',
      source: 'flowchart TB\n  a[foo] --> b[API service]\n  c[Lonely node]\n',
    });
    const outcome = await validate(project, 'G-Design');
    const text = outcome.violations.map((v) => v.message).join('\n');
    expect(text).toContain('diagram:caption');
    expect(text).toContain('diagram:label-quality');
    expect(text).not.toContain('diagram:orphan-nodes');
    expect(outcome.warnings?.map((w) => w.message).join('\n')).toContain('diagram:orphan-nodes');
    expect(outcome.fields['warnings_count']).toBeGreaterThan(0);
  });

  it('requireCaptions: false skips the caption check', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001', caption: 'Context', altText: 'Context' });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    const outcome = await diagramValidateGate(ctx(project, { requireCaptions: false }), 'G-Design');
    expect(outcome.violations).toEqual([]);
  });

  it('a diagram over the hard node limit is an error; between the budget and the limit only a warning', async () => {
    /** `pairs` connected pairs: twice as many nodes. */
    const chain = (pairs: number): string =>
      `flowchart TB\n${Array.from({ length: pairs }, (_v, at) => `  n${String(at)}[Service ${String(at)} api] --> m${String(at)}[Worker ${String(at)} api]`).join('\n')}\n`;
    const warnOnly = await createTestProject();
    await diagram(warnOnly, CONTEXT, { id: 'DIAG-001', source: chain(11) });
    await diagram(warnOnly, CONTAINERS, { id: 'DIAG-002' });
    const warned = await validate(warnOnly, 'G-Design');
    expect(warned.violations).toEqual([]);
    expect((warned.warnings ?? []).some((w) => w.message.includes('diagram:complexity'))).toBe(
      true,
    );
    const hard = await createTestProject();
    await diagram(hard, CONTEXT, { id: 'DIAG-001', source: chain(21) });
    await diagram(hard, CONTAINERS, { id: 'DIAG-002' });
    const found = (await validate(hard, 'G-Design')).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('diagram:complexity');
  });

  it('an ER diagram is required when a DataModel exists, and once present it satisfies every level', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001' });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    await put(
      project,
      `${SPECS_ROOT}/data/DM-001-orders.md`,
      `---
id: DM-001
type: DataModel
schemaVersion: 1
title: Orders
status: draft
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: data-architect
changelog: []
---
`,
    );
    const missing = (await validate(project, 'G-Design')).violations;
    expect(missing.map((v) => v.subject)).toEqual(['data/views']);
    await diagram(project, 'data/views/er-orders.mmd', {
      id: 'DIAG-003',
      kind: 'erDiagram',
      source: 'erDiagram\n  ORDER ||--o{ LINE_ITEM : has\n',
    });
    expect((await validate(project, 'G-Design')).violations).toEqual([]);
    expect((await validate(project, 'G-Design', 'L1')).violations.map((v) => v.subject)).toEqual(
      [],
    );
  });

  describe('ADR diagram coverage (diagram:adr-coverage)', () => {
    async function withViews(): Promise<TestProject> {
      const project = await createTestProject();
      await diagram(project, CONTEXT, { id: 'DIAG-001' });
      await diagram(project, CONTAINERS, { id: 'DIAG-002' });
      return project;
    }

    it('fails a structural ADR (architecture or data) that contains no diagram and lists none', async () => {
      const project = await withViews();
      await adr(project, 1, { category: 'architecture', blast: ['component:api'] });
      await adr(project, 2, { category: 'data', blast: ['component:db'] });
      const found = (await validate(project, 'G-Design')).violations;
      expect(found.map((v) => v.subject)).toEqual(['ADR-0001', 'ADR-0002']);
      expect(found[0]?.remedy).toContain('## Diagram');
    });

    it('a blast radius naming more than one component makes any category structural', async () => {
      const project = await withViews();
      await adr(project, 1, { category: 'delivery', blast: ['component:api', 'component:web'] });
      await adr(project, 2, { category: 'delivery', blast: ['component:api'] });
      expect((await validate(project, 'G-Design')).violations.map((v) => v.subject)).toEqual([
        'ADR-0001',
      ]);
    });

    it('passes with a Mermaid block in the body, or a registered diagram listed', async () => {
      const project = await withViews();
      await adr(project, 1, { body: '## Diagram\n\n```mermaid\nflowchart TB\n  a --> b\n```\n' });
      await adr(project, 2, { diagrams: ['DIAG-001'] });
      const outcome = await validate(project, 'G-Design');
      expect(outcome.violations).toEqual([]);
      expect(outcome.fields).toMatchObject({ structural_adrs: 2 });
    });

    it('an empty or garbage Mermaid fence is not a diagram', async () => {
      const project = await withViews();
      await adr(project, 1, { body: '## Diagram\n\n```mermaid\n```\n' });
      await adr(project, 2, {
        body: '## Diagram\n\n```mermaid\nthis is not a diagram at all\n```\n',
      });
      expect((await validate(project, 'G-Design')).violations.map((v) => v.subject)).toEqual([
        'ADR-0001',
        'ADR-0002',
      ]);
    });

    it('a Mermaid fence written as ```Mermaid or indented in a list item counts', async () => {
      const project = await withViews();
      await adr(project, 1, {
        body: '- item\n\n  ```Mermaid\n  flowchart TB\n    web[Web app] --> api[API service]\n  ```\n',
      });
      expect((await validate(project, 'G-Design')).violations).toEqual([]);
    });

    it('an ADR with thousands of garbage fences is a bounded violation, not a slow pass', async () => {
      const project = await withViews();
      await adr(project, 1, { body: '```mermaid\nnot a diagram\n```\n'.repeat(5000) });
      const started = Date.now();
      const found = (await validate(project, 'G-Design')).violations;
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain('too many Mermaid blocks');
    });

    it('fails a listed diagram that is not registered', async () => {
      const project = await withViews();
      await adr(project, 1, { diagrams: ['DIAG-404'] });
      expect((await validate(project, 'G-Design')).violations[0]?.message).toContain('DIAG-404');
    });

    it('ignores a rejected or superseded ADR, and a non-structural decision', async () => {
      const project = await withViews();
      await adr(project, 1, { status: 'rejected' });
      await adr(project, 2, { status: 'superseded' });
      await adr(project, 3, { category: 'process', blast: ['component:api'] });
      expect((await validate(project, 'G-Design')).violations).toEqual([]);
    });

    it('an ADR that fails its schema is a violation naming the file, not a silent skip', async () => {
      const project = await withViews();
      await put(
        project,
        `${KB_ROOT}/decisions/ADR-0001-broken.md`,
        '---\nid: ADR-0001\ntype: ADR\n---\n',
      );
      const found = (await validate(project, 'G-Design')).violations;
      expect(found.map((v) => v.subject)).toEqual(['decisions/ADR-0001-broken.md']);
      expect(found[0]?.message).toContain('diagram coverage cannot be checked');
      expect((await validate(project, 'G-Deliver', 'L1')).violations).toEqual([]);
    });

    it('is not judged at G-Deliver', async () => {
      const project = await createTestProject();
      await adr(project, 1);
      expect((await validate(project, 'G-Deliver', 'L1')).violations).toEqual([]);
    });
  });

  it('one corrupt spec file is one violation, not one per reader', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001' });
    await diagram(project, CONTAINERS, { id: 'DIAG-002' });
    await put(project, `${SPECS_ROOT}/stories/S.md`, '---\nid: [oops\n---\n');
    const outcome = await validate(project, 'G-Design');
    expect(outcome.violations).toHaveLength(1);
  });

  it('a superseded DataModel does not require an ER diagram', async () => {
    const project = await createTestProject();
    await put(
      project,
      `${SPECS_ROOT}/data/DM-001-orders.md`,
      '---\nid: DM-001\ntype: DataModel\nschemaVersion: 1\ntitle: Orders\nstatus: superseded\ncreated: 2026-01-15\nupdated: 2026-01-15\nrevision: 1\nauthor: data-architect\nchangelog: []\n---\n',
    );
    expect((await validate(project, 'G-Design', 'L1')).violations).toEqual([]);
  });

  it('the ER diagram is required whenever a DataModel exists, at every level', async () => {
    const project = await createTestProject();
    await put(
      project,
      `${SPECS_ROOT}/data/DM-001-orders.md`,
      '---\nid: DM-001\ntype: DataModel\nschemaVersion: 1\ntitle: Orders\nstatus: draft\ncreated: 2026-01-15\nupdated: 2026-01-15\nrevision: 1\nauthor: data-architect\nchangelog: []\n---\n',
    );
    expect((await validate(project, 'G-Design', 'L1')).violations.map((v) => v.subject)).toEqual([
      'data/views',
    ]);
  });

  it('is deterministic and sorted', async () => {
    const project = await createTestProject();
    await diagram(project, 'architecture/views/b.mmd', { id: 'DIAG-020', source: 'nope' });
    await diagram(project, 'architecture/views/a.mmd', { id: 'DIAG-010', source: 'nope' });
    const first = JSON.stringify(await validate(project, 'G-Design'));
    expect(JSON.stringify(await validate(project, 'G-Design'))).toBe(first);
    const subjects = (await validate(project, 'G-Design')).violations.map((v) => v.subject);
    expect([...subjects].sort()).toEqual(subjects);
  });
});

describe('diagram validate --gate G-Deliver', () => {
  const PIPELINE = 'delivery/views/pipeline.mmd';
  const DEPLOY = 'delivery/views/deployment-staging.mmd';

  it('passes with the pipeline and a deployment topology diagram', async () => {
    const project = await createTestProject();
    await diagram(project, PIPELINE, { id: 'DIAG-001' });
    await diagram(project, DEPLOY, { id: 'DIAG-002' });
    const outcome = await validate(project, 'G-Deliver');
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({ gate: 'G-Deliver', diagrams: 2, required: 2 });
  });

  it('fails when either is missing at L2+, and not at L1', async () => {
    const project = await createTestProject();
    await diagram(project, PIPELINE, { id: 'DIAG-001' });
    expect((await validate(project, 'G-Deliver')).violations.map((v) => v.subject)).toEqual([
      'delivery/views',
    ]);
    const bare = await createTestProject();
    expect((await validate(bare, 'G-Deliver')).violations).toHaveLength(2);
    expect((await validate(bare, 'G-Deliver', 'L1')).violations).toEqual([]);
  });

  it("only looks at the delivery views: a broken architecture diagram is G-Design's", async () => {
    const project = await createTestProject();
    await diagram(project, PIPELINE, { id: 'DIAG-001' });
    await diagram(project, DEPLOY, { id: 'DIAG-002' });
    await diagram(project, CONTEXT, { id: 'DIAG-003', source: 'nope' });
    expect((await validate(project, 'G-Deliver')).violations).toEqual([]);
  });

  it('a stale diagram (review_by in the past) is an error here and only a warning at G-Design', async () => {
    const project = await createTestProject();
    await diagram(project, PIPELINE, { id: 'DIAG-001', reviewBy: '2026-01-01' });
    await diagram(project, DEPLOY, { id: 'DIAG-002', reviewBy: '2099-01-01' });
    const found = (await validate(project, 'G-Deliver')).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('diagram:staleness');
    await diagram(project, CONTEXT, { id: 'DIAG-003', reviewBy: '2026-01-01' });
    await diagram(project, CONTAINERS, { id: 'DIAG-004' });
    const design = await validate(project, 'G-Design');
    expect(design.violations.filter((v) => v.message.includes('staleness'))).toEqual([]);
    expect((design.warnings ?? []).some((w) => w.message.includes('staleness'))).toBe(true);
  });

  it('judges staleness against the injected clock, not the machine', async () => {
    const project = await createTestProject();
    await diagram(project, PIPELINE, { id: 'DIAG-001', reviewBy: '2026-06-15' });
    await diagram(project, DEPLOY, { id: 'DIAG-002' });
    expect(
      (await diagramValidateGate(ctx(project, { now: '2026-06-01T00:00:00.000Z' }), 'G-Deliver'))
        .violations,
    ).toEqual([]);
    expect(
      (await diagramValidateGate(ctx(project, { now: '2026-07-01T00:00:00.000Z' }), 'G-Deliver'))
        .violations,
    ).toHaveLength(1);
  });

  it('fails a deployment diagram with a syntax error', async () => {
    const project = await createTestProject();
    await diagram(project, PIPELINE, { id: 'DIAG-001' });
    await diagram(project, DEPLOY, { id: 'DIAG-002', source: 'flowchart TB\n  a -->\n' });
    expect((await validate(project, 'G-Deliver')).violations.map((v) => v.subject)).toEqual([
      'DIAG-002',
    ]);
  });
});

describe('diagram generate --all --check', () => {
  const C4 = 'architecture/views/containers.mmd';

  async function generatedContainers(project: TestProject): Promise<string> {
    const source = runGenerator('components-to-c4', {
      components: [
        { id: 'component:api', label: 'api', dependsOn: [] },
        { id: 'component:web', label: 'web', dependsOn: ['component:api'] },
      ],
    }).source;
    await diagram(project, C4, {
      id: 'DIAG-002',
      source: `${source}\n`,
      generated: true,
      generator: 'components-to-c4',
    });
    return source;
  }

  async function inventory(project: TestProject): Promise<void> {
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
  - id: component:api
    label: api
    responsibility: Serves
    owner: backend
    dependsOn: []
    failureModes: []
  - id: component:web
    label: web
    responsibility: Shows
    owner: frontend
    dependsOn: [component:api]
    failureModes: []
---
`,
    );
  }

  it('passes an empty project: nothing generated can have drifted', async () => {
    const outcome = await diagramDriftCheck(ctx(await createTestProject()));
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({ checked: 0, drifted: 0 });
  });

  it('passes a hand-drawn diagram (generated: false is never regenerated)', async () => {
    const project = await createTestProject();
    await diagram(project, CONTEXT, { id: 'DIAG-001' });
    expect(await diagramDriftCheck(ctx(project))).toMatchObject({
      fields: { checked: 0, drifted: 0 },
    });
  });

  it('passes a generated container view that matches the component inventory', async () => {
    const project = await createTestProject();
    await inventory(project);
    await generatedContainers(project);
    const outcome = await diagramDriftCheck(ctx(project));
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({ checked: 1, in_sync: 1, mismatched: 0, drifted: 0 });
  });

  it("accepts the spec's `forge:` generator spelling and CRLF line endings", async () => {
    const project = await createTestProject();
    await inventory(project);
    const source = runGenerator('components-to-c4', {
      components: [
        { id: 'component:api', label: 'api', dependsOn: [] },
        { id: 'component:web', label: 'web', dependsOn: ['component:api'] },
      ],
    }).source;
    await diagram(project, C4, {
      id: 'DIAG-002',
      source: `${source.replace(/\n/g, '\r\n')}\r\n`,
      generated: true,
      generator: 'forge:components-to-c4',
    });
    expect((await diagramDriftCheck(ctx(project))).fields).toMatchObject({
      in_sync: 1,
      drifted: 0,
    });
  });

  it('fails a diagram edited by hand after it was generated (drift), naming it', async () => {
    const project = await createTestProject();
    await inventory(project);
    const source = await generatedContainers(project);
    await put(project, `${KB_ROOT}/${C4}`, `${source}\n  extra[Hand added] --> component_api\n`);
    const outcome = await diagramDriftCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ mismatched: 1, drifted: 1 });
    expect(outcome.violations[0]?.subject).toBe('DIAG-002');
    expect(outcome.violations[0]?.message).toContain('has drifted');
  });

  it('fails when the component inventory moved on and the diagram did not', async () => {
    const project = await createTestProject();
    await inventory(project);
    await generatedContainers(project);
    const file = path.join(project.dir, `${KB_ROOT}/architecture/components.md`);
    await writeFile(file, (await readFile(file, 'utf8')).replace('label: web', 'label: website'));
    expect((await diagramDriftCheck(ctx(project))).fields).toMatchObject({
      mismatched: 1,
      drifted: 1,
    });
  });

  it('a generated diagram with no component inventory is unverifiable and counts as drifted', async () => {
    const project = await createTestProject();
    await generatedContainers(project);
    const outcome = await diagramDriftCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ unverifiable: 1, drifted: 1 });
    expect(outcome.violations[0]?.message).toContain('has no components');
  });

  it('a generator with no project-state reader is unverifiable, never a pass', async () => {
    const project = await createTestProject();
    await diagram(project, 'data/views/er-orders.mmd', {
      id: 'DIAG-005',
      kind: 'erDiagram',
      source: 'erDiagram\n  ORDER ||--o{ LINE_ITEM : has\n',
      generated: true,
      generator: 'datamodel-to-er',
    });
    await diagram(project, 'delivery/views/pipeline.mmd', {
      id: 'DIAG-006',
      generated: true,
      generator: 'pipeline-to-flow',
    });
    await diagram(project, 'architecture/views/weird.mmd', {
      id: 'DIAG-007',
      generated: true,
      generator: 'not-a-generator',
    });
    const outcome = await diagramDriftCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ checked: 3, unverifiable: 3, drifted: 3 });
    const text = outcome.violations.map((v) => v.message).join('\n');
    expect(text).toContain('only components-to-c4 and specgraph-to-graph');
    expect(text).toContain('not-a-generator');
    expect(outcome.violations[0]?.remedy).toContain('generated: false');
  });

  it('regenerates a spec graph diagram from the real spec documents', async () => {
    const project = await createTestProject();
    const empty = runGenerator('specgraph-to-graph', { graph: SpecGraph.build([]) }).source;
    await diagram(project, 'specs/views/traceability.mmd', {
      id: 'DIAG-009',
      source: `${empty}\n`,
      generated: true,
      generator: 'specgraph-to-graph',
    });
    expect((await diagramDriftCheck(ctx(project))).fields).toMatchObject({
      in_sync: 1,
      drifted: 0,
    });
    await put(
      project,
      `${SPECS_ROOT}/visions/VIS-001.md`,
      `---
id: VIS-001
type: Vision
schemaVersion: 1
title: A vision
status: draft
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: pm
changelog: []
---
`,
    );
    expect((await diagramDriftCheck(ctx(project))).fields).toMatchObject({
      mismatched: 1,
      drifted: 1,
    });
  });

  it('a spec graph diagram over corrupt spec documents is unverifiable, not a crash', async () => {
    const project = await createTestProject();
    await diagram(project, 'specs/views/traceability.mmd', {
      id: 'DIAG-009',
      generated: true,
      generator: 'specgraph-to-graph',
    });
    await put(project, `${SPECS_ROOT}/visions/VIS-001.md`, '---\nid: [oops\n---\n');
    const outcome = await diagramDriftCheck(ctx(project));
    expect(outcome.fields).toMatchObject({ unverifiable: 1, drifted: 1 });
  });

  it('driftPolicy warn turns drift into a warning: drifted is 0 and the exit is clean', async () => {
    const project = await createTestProject();
    await generatedContainers(project);
    const outcome = await diagramDriftCheck(ctx(project, { driftPolicy: 'warn' }));
    expect(outcome.violations).toEqual([]);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.fields).toMatchObject({ unverifiable: 1, drifted: 0, drift_policy: 'warn' });
  });

  it('driftPolicy autofix is checked like fail: a gate check never writes', async () => {
    const project = await createTestProject();
    await inventory(project);
    const source = await generatedContainers(project);
    await put(project, `${KB_ROOT}/${C4}`, `${source}\n  extra[Hand added] --> component_api\n`);
    const before = await readFile(path.join(project.dir, `${KB_ROOT}/${C4}`), 'utf8');
    const outcome = await diagramDriftCheck(ctx(project, { driftPolicy: 'autofix' }));
    expect(outcome.fields).toMatchObject({ drifted: 1 });
    const after = await readFile(path.join(project.dir, `${KB_ROOT}/${C4}`), 'utf8');
    expect(after).toBe(before);
  });

  it('an unreadable sidecar or source counts as drifted even under warn (it cannot be shown in sync)', async () => {
    const project = await createTestProject();
    await put(project, `${KB_ROOT}/architecture/views/broken.mmd.yaml`, 'id: nope\n');
    await diagram(project, C4, {
      id: 'DIAG-002',
      generated: true,
      generator: 'components-to-c4',
      writeSource: false,
    });
    const outcome = await diagramDriftCheck(ctx(project, { driftPolicy: 'warn' }));
    expect(outcome.fields['drifted']).toBe(outcome.violations.length);
    expect(outcome.violations.length).toBe(2);
  });

  it('is deterministic and sorted', async () => {
    const project = await createTestProject();
    await diagram(project, 'a/views/x.mmd', {
      id: 'DIAG-020',
      generated: true,
      generator: 'deps-to-graph',
    });
    await diagram(project, 'a/views/y.mmd', {
      id: 'DIAG-010',
      generated: true,
      generator: 'deps-to-graph',
    });
    const first = JSON.stringify(await diagramDriftCheck(ctx(project)));
    expect(JSON.stringify(await diagramDriftCheck(ctx(project)))).toBe(first);
    expect((await diagramDriftCheck(ctx(project))).violations.map((v) => v.subject)).toEqual([
      'DIAG-010',
      'DIAG-020',
    ]);
  });
});
