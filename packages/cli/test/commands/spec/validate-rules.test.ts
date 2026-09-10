/**
 * `specValidateRule` — `PLAN-M8.md` P2's own Checks section.
 *
 * @see specs/09 §9.3
 * @see specs/13 §13.4
 * @see PLAN-M8.md P2
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';
import { renderArtifactPath } from '@forge/schemas/registry';
import { afterEach, describe, expect, it } from 'vitest';

import { readArtifactTemplate } from '../../../src/commands/shared.ts';
import { specValidateRule } from '../../../src/commands/spec/validate-rules.ts';
import type { SpecCommandContext } from '../../../src/commands/spec.ts';
import {
  KB_ROOT,
  SPECS_ROOT,
  cleanupAll,
  createTestProject,
  writeCollectionFileFixture,
  writeKbEntryFixture,
  type TestProject,
} from '../helpers.ts';
import { REPORTS_ROOT } from '../loop/helpers.ts';

afterEach(cleanupAll);

const SESSIONS_ROOT = 'docs/forge/sessions';

function ctx(project: TestProject): SpecCommandContext {
  return {
    paths: project.paths,
    specsRoot: SPECS_ROOT,
    kbRoot: KB_ROOT,
    reportsRoot: REPORTS_ROOT,
    sessionsRoot: SESSIONS_ROOT,
  };
}

interface AcceptanceOverride {
  readonly id: string;
  readonly given?: string;
  readonly when?: string;
  readonly then?: string;
  readonly kind?: string;
}

interface StoryOverrides {
  readonly id?: string;
  readonly status?: string;
  readonly size?: string;
  readonly files_expected?: readonly string[];
  readonly context_refs?: readonly string[];
  readonly acceptance?: readonly AcceptanceOverride[];
  readonly tests?: readonly string[];
  readonly dod_profile?: string;
}

/** A real, schema-valid `Story`, scaffolded from `@forge/templates`' own real `Story.md` template —
 * the identical "real template, `.set()` overrides" pattern `specNew` already establishes, used here
 * (rather than `specNew` itself) because every rule this file tests needs explicit, deterministic
 * ids and field combinations `specNew`'s own id-allocator would not produce. */
async function writeStory(project: TestProject, overrides: StoryOverrides = {}): Promise<string> {
  const id = overrides.id ?? 'STORY-001';
  const templateText = await readArtifactTemplate('Story');
  const pathResult = renderArtifactPath('Story', { id, slug: 'fixture' });
  if (!pathResult.success) throw new Error(`unreachable: ${pathResult.missingVariable}`);
  const doc = ArtifactDocument.parse(templateText, `docs/forge/${pathResult.path}`);
  doc.set(['id'], id);
  doc.set(['title'], 'Fixture story');
  doc.set(['epic'], 'EPIC-001');
  doc.set(['capability'], 'CAP-001');
  doc.set(['status'], overrides.status ?? 'ready');
  doc.set(['size'], overrides.size ?? 'M');
  doc.set(['owner_role'], 'backend');
  doc.set(['files_expected'], overrides.files_expected ?? ['src/fixture/**']);
  doc.set(['context_refs'], overrides.context_refs ?? []);
  doc.set(
    ['acceptance'],
    (overrides.acceptance ?? []).map((criterion) => ({
      id: criterion.id,
      given: criterion.given ?? 'a real precondition',
      when: criterion.when ?? 'a real action',
      then: criterion.then ?? 'a real, observable result',
      kind: criterion.kind ?? 'functional',
    })),
  );
  doc.set(['tests'], overrides.tests ?? []);
  doc.set(['dod_profile'], overrides.dod_profile ?? 'backend-default');
  await writeArtifact(project.paths, doc);
  return id;
}

interface DefectOverrides {
  readonly id?: string;
  readonly severity?: string;
  readonly status?: string;
}

async function writeDefect(project: TestProject, overrides: DefectOverrides = {}): Promise<string> {
  const id = overrides.id ?? 'DEF-001';
  const templateText = await readArtifactTemplate('Defect');
  const pathResult = renderArtifactPath('Defect', { id });
  if (!pathResult.success) throw new Error(`unreachable: ${pathResult.missingVariable}`);
  const relativePath = `${REPORTS_ROOT}/${pathResult.path.replace(/^reports\//, '')}`;
  const doc = ArtifactDocument.parse(templateText, relativePath);
  doc.set(['id'], id);
  doc.set(['status'], overrides.status ?? 'open');
  doc.set(['severity'], overrides.severity ?? 'Sev3');
  await writeArtifact(project.paths, doc);
  return id;
}

interface RcaOverrides {
  readonly id?: string;
  readonly defect: string;
  readonly prevention?: readonly string[];
}

async function writeRca(project: TestProject, overrides: RcaOverrides): Promise<string> {
  const id = overrides.id ?? 'RCA-001';
  const templateText = await readArtifactTemplate('RCA');
  const pathResult = renderArtifactPath('RCA', { id, slug: 'fixture' });
  if (!pathResult.success) throw new Error(`unreachable: ${pathResult.missingVariable}`);
  const relativePath = `${SESSIONS_ROOT}/${pathResult.path.replace(/^sessions\//, '')}`;
  const doc = ArtifactDocument.parse(templateText, relativePath);
  doc.set(['id'], id);
  doc.set(['defect'], overrides.defect);
  doc.set(['prevention'], overrides.prevention ?? []);
  await writeArtifact(project.paths, doc);
  return id;
}

/** A real, schema-valid `DataModel` — used to prove `spec:story-refs-resolve` resolves a `DM-###`
 * reference, which no `SpecGraph` node ever covers (`build.ts`'s own `NODE_KIND_BY_ARTIFACT_TYPE`
 * has no `DataModel` entry — a fresh critic round confirmed this directly). */
async function writeDataModel(project: TestProject, id: string): Promise<void> {
  const templateText = await readArtifactTemplate('DataModel');
  const pathResult = renderArtifactPath('DataModel', { id, slug: 'fixture' });
  if (!pathResult.success) throw new Error(`unreachable: ${pathResult.missingVariable}`);
  const doc = ArtifactDocument.parse(templateText, `docs/forge/${pathResult.path}`);
  doc.set(['id'], id);
  await writeArtifact(project.paths, doc);
}

/** A real, schema-valid `SessionRecord` — the identical `spec:story-refs-resolve` gap as
 * `writeDataModel` above, one root cause (`sessionsRoot` docs, not `specsRoot`). */
async function writeSessionRecord(project: TestProject, id: string): Promise<void> {
  const templateText = await readArtifactTemplate('SessionRecord');
  const pathResult = renderArtifactPath('SessionRecord', { id, slug: 'fixture' });
  if (!pathResult.success) throw new Error(`unreachable: ${pathResult.missingVariable}`);
  const relativePath = `${SESSIONS_ROOT}/${pathResult.path.replace(/^sessions\//, '')}`;
  const doc = ArtifactDocument.parse(templateText, relativePath);
  doc.set(['id'], id);
  await writeArtifact(project.paths, doc);
}

async function writeDodProfiles(project: TestProject, yaml: string): Promise<void> {
  await writeArtifactYaml(project, `${KB_ROOT}/engineering/dod-profiles.yaml`, yaml);
}

async function writeArtifactYaml(
  project: TestProject,
  relPath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  await writeFile(path.join(project.dir, relPath), content, 'utf8');
}

const MINIMAL_DOD_PROFILES = `
profiles:
  backend-default:
    ready:
      - story.acceptance.length > 0
    done: []
`;

describe('oversized-stories', () => {
  it('flags a size-L story at status ready or later', async () => {
    const project = await createTestProject();
    await writeStory(project, { id: 'STORY-001', size: 'L', status: 'ready' });

    const result = await specValidateRule(ctx(project), 'oversized-stories');

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.subject).toBe('STORY-001');
  });

  it('does not flag a size-L story at status draft', async () => {
    const project = await createTestProject();
    await writeStory(project, { id: 'STORY-001', size: 'L', status: 'draft' });

    const result = await specValidateRule(ctx(project), 'oversized-stories');

    expect(result.violations).toEqual([]);
  });

  it('does not flag a size-M story at status ready', async () => {
    const project = await createTestProject();
    await writeStory(project, { id: 'STORY-001', size: 'M', status: 'ready' });

    const result = await specValidateRule(ctx(project), 'oversized-stories');

    expect(result.violations).toEqual([]);
  });
});

describe('file-claim-overlap', () => {
  it('flags two ready stories whose files_expected globs overlap', async () => {
    const project = await createTestProject();
    await writeStory(project, {
      id: 'STORY-001',
      status: 'ready',
      files_expected: ['src/billing/**'],
    });
    await writeStory(project, {
      id: 'STORY-002',
      status: 'ready',
      files_expected: ['src/billing/preview/**'],
    });

    const result = await specValidateRule(ctx(project), 'file-claim-overlap');

    expect(result.violations).toHaveLength(1);
  });

  it('does not flag two ready stories with disjoint globs', async () => {
    const project = await createTestProject();
    await writeStory(project, {
      id: 'STORY-001',
      status: 'ready',
      files_expected: ['src/billing/**'],
    });
    await writeStory(project, {
      id: 'STORY-002',
      status: 'ready',
      files_expected: ['src/invoicing/**'],
    });

    const result = await specValidateRule(ctx(project), 'file-claim-overlap');

    expect(result.violations).toEqual([]);
  });

  it('does not flag an overlap against a draft story', async () => {
    const project = await createTestProject();
    await writeStory(project, {
      id: 'STORY-001',
      status: 'draft',
      files_expected: ['src/billing/**'],
    });
    await writeStory(project, {
      id: 'STORY-002',
      status: 'ready',
      files_expected: ['src/billing/preview/**'],
    });

    const result = await specValidateRule(ctx(project), 'file-claim-overlap');

    expect(result.violations).toEqual([]);
  });
});

describe('unbound-acceptance-criteria', () => {
  it('flags a ready story acceptance criterion with no bound test', async () => {
    const project = await createTestProject();
    await writeStory(project, {
      id: 'STORY-001',
      status: 'ready',
      acceptance: [{ id: 'AC-001-1' }],
      tests: [],
    });

    const result = await specValidateRule(ctx(project), 'unbound-acceptance-criteria');

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.subject).toBe('AC-001-1');
  });

  it('does not flag an acceptance criterion named in tests', async () => {
    const project = await createTestProject();
    await writeStory(project, {
      id: 'STORY-001',
      status: 'ready',
      acceptance: [{ id: 'AC-001-1' }],
      tests: ['AC-001-1 returns the expected result'],
    });

    const result = await specValidateRule(ctx(project), 'unbound-acceptance-criteria');

    expect(result.violations).toEqual([]);
  });
});

describe('open-sev1-sev2-defects', () => {
  it('flags an open Sev1 defect', async () => {
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev1', status: 'open' });

    const result = await specValidateRule(ctx(project), 'open-sev1-sev2-defects');

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.subject).toBe('DEF-001');
  });

  it('does not flag a closed Sev1 defect', async () => {
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev1', status: 'closed' });

    const result = await specValidateRule(ctx(project), 'open-sev1-sev2-defects');

    expect(result.violations).toEqual([]);
  });

  it('does not flag a Sev1 defect at any other real status besides the literal "open"', async () => {
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev1', status: 'resolved' });

    const result = await specValidateRule(ctx(project), 'open-sev1-sev2-defects');

    expect(result.violations).toEqual([]);
  });

  it('does not flag an open Sev3 defect', async () => {
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev3', status: 'open' });

    const result = await specValidateRule(ctx(project), 'open-sev1-sev2-defects');

    expect(result.violations).toEqual([]);
  });
});

describe('unresolved-rca', () => {
  it('flags a closed Sev1 defect with no linked RCA at all', async () => {
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev1', status: 'closed' });

    const result = await specValidateRule(ctx(project), 'unresolved-rca');

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.subject).toBe('DEF-001');
  });

  it('flags a closed Sev1 defect whose RCA has zero prevention actions', async () => {
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev1', status: 'closed' });
    await writeRca(project, { id: 'RCA-001', defect: 'DEF-001', prevention: [] });

    const result = await specValidateRule(ctx(project), 'unresolved-rca');

    expect(result.violations).toHaveLength(1);
  });

  it('does not flag a closed Sev1 defect with a real RCA carrying a real prevention action', async () => {
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev1', status: 'closed' });
    await writeRca(project, {
      id: 'RCA-001',
      defect: 'DEF-001',
      prevention: ['Property test: total always equals round(sum(raw_lines)).'],
    });

    const result = await specValidateRule(ctx(project), 'unresolved-rca');

    expect(result.violations).toEqual([]);
  });

  it('treats any status other than the literal "open" as closed, not just the literal "closed"', async () => {
    // Nothing in this codebase ever writes `status: 'closed'` onto a real Defect today (confirmed by
    // a fresh critic round) — anchoring "closed" on anything-but-"open" is what keeps this check from
    // being permanently vacuous against real project data regardless of which spelling a future
    // closing mechanism actually uses.
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev1', status: 'resolved' });

    const result = await specValidateRule(ctx(project), 'unresolved-rca');

    expect(result.violations).toHaveLength(1);
  });

  it('does not report a violation when a defect has multiple RCAs and only one carries a real prevention action', async () => {
    // `.find()`'s first-match-only semantics (this file's own first draft) reported a false positive
    // here whenever the empty-prevention RCA happened to sort before the real one — reproduced
    // directly by a fresh critic round.
    const project = await createTestProject();
    await writeDefect(project, { id: 'DEF-001', severity: 'Sev1', status: 'closed' });
    await writeRca(project, { id: 'RCA-001', defect: 'DEF-001', prevention: [] });
    await writeRca(project, {
      id: 'RCA-002',
      defect: 'DEF-001',
      prevention: ['A real prevention action.'],
    });

    const result = await specValidateRule(ctx(project), 'unresolved-rca');

    expect(result.violations).toEqual([]);
  });
});

describe('definition-of-ready', () => {
  it('reports a real "cannot verify" violation when no DoD profiles file exists at all', async () => {
    const project = await createTestProject();
    await writeStory(project, { id: 'STORY-001', status: 'ready' });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.message).toContain('cannot verify');
  });

  it('flags a ready story with zero acceptance criteria against the real profile expression', async () => {
    const project = await createTestProject();
    await writeDodProfiles(project, MINIMAL_DOD_PROFILES);
    await writeStory(project, { id: 'STORY-001', status: 'ready', acceptance: [] });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations.some((violation) => violation.subject === 'STORY-001')).toBe(true);
  });

  it('does not flag a ready story with real acceptance criteria against the same expression', async () => {
    const project = await createTestProject();
    await writeDodProfiles(project, MINIMAL_DOD_PROFILES);
    await writeStory(project, {
      id: 'STORY-001',
      status: 'ready',
      acceptance: [{ id: 'AC-001-1' }],
    });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations).toEqual([]);
  });

  it('does not check a draft story at all', async () => {
    const project = await createTestProject();
    await writeStory(project, { id: 'STORY-001', status: 'draft', acceptance: [] });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations).toEqual([]);
  });

  it('resolves spec:story-refs-resolve against a real known KB entry id', async () => {
    const project = await createTestProject();
    await writeDodProfiles(
      project,
      `
profiles:
  backend-default:
    ready:
      - check: spec:story-refs-resolve
    done: []
`,
    );
    await writeKbEntryFixture(project, 'KB-ARCH-0001');
    await writeStory(project, {
      id: 'STORY-001',
      status: 'ready',
      context_refs: ['KB-ARCH-0001'],
    });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations).toEqual([]);
  });

  it('flags a context_ref that resolves to nothing real', async () => {
    const project = await createTestProject();
    await writeDodProfiles(
      project,
      `
profiles:
  backend-default:
    ready:
      - check: spec:story-refs-resolve
    done: []
`,
    );
    await writeStory(project, {
      id: 'STORY-001',
      status: 'ready',
      context_refs: ['KB-ARCH-9999'],
    });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations).toHaveLength(1);
  });

  it('resolves spec:story-refs-resolve against a real DataModel id (no SpecGraph node covers it)', async () => {
    const project = await createTestProject();
    await writeDodProfiles(
      project,
      `
profiles:
  backend-default:
    ready:
      - check: spec:story-refs-resolve
    done: []
`,
    );
    await writeDataModel(project, 'DM-001');
    await writeStory(project, { id: 'STORY-001', status: 'ready', context_refs: ['DM-001'] });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations).toEqual([]);
  });

  it('resolves spec:story-refs-resolve against a real SessionRecord id (a sessionsRoot document)', async () => {
    const project = await createTestProject();
    await writeDodProfiles(
      project,
      `
profiles:
  backend-default:
    ready:
      - check: spec:story-refs-resolve
    done: []
`,
    );
    await writeSessionRecord(project, 'SESSION-001');
    await writeStory(project, {
      id: 'STORY-001',
      status: 'ready',
      context_refs: ['SESSION-001'],
    });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations).toEqual([]);
  });

  it('flags every ready story when an open, blocking question exists project-wide', async () => {
    const project = await createTestProject();
    await writeDodProfiles(
      project,
      `
profiles:
  backend-default:
    ready:
      - check: spec:no-blocking-open-questions
    done: []
`,
    );
    await writeCollectionFileFixture(
      project,
      'open-questions.md',
      'OpenQuestion',
      'open_questions',
    );
    // `writeCollectionFileFixture` writes an empty `open_questions: []` — overwritten here with one
    // real, open question, since this rule's own real scope (documented in `validate-rules.ts`) is
    // "any open question anywhere," not per-story, and needs at least one to exercise the true branch.
    const relPath = `${KB_ROOT}/open-questions.md`;
    const raw = await readFile(path.join(project.dir, relPath), 'utf8');
    await writeFile(
      path.join(project.dir, relPath),
      raw.replace(
        'open_questions: []',
        "open_questions:\n  - id: OQ-001\n    question: 'Is this resolved?'\n    status: open",
      ),
      'utf8',
    );
    await writeStory(project, { id: 'STORY-001', status: 'ready' });

    const result = await specValidateRule(ctx(project), 'definition-of-ready');

    expect(result.violations).toHaveLength(1);
  });
});
