/**
 * `runEvidencePrune` — `forge evidence prune [--apply] [--keep <n>]` end to end, against a real
 * temporary project (real files, real directories, no mocks).
 *
 * @see specs/03-cli-and-installer.md §3.2.5
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 9
 */
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { isForgeError, type Clock } from '@forge/core';
import { pathExists } from '@forge/core/fs';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { runDoctor } from '../../../src/commands/doctor/run-doctor.ts';
import {
  isEnoent,
  parseKeep,
  runEvidencePrune,
  type RunEvidencePruneResult,
} from '../../../src/commands/evidence/prune-command.ts';
import {
  readTombstone,
  tombstoneRelPath,
  writeTombstone,
} from '../../../src/commands/evidence/tombstone.ts';
import {
  gateApprove,
  gateWaive,
  type GateCommandContext,
} from '../../../src/commands/run/gate-commands.ts';
import { cleanupAll, createTestProject, type TestProject } from '../doctor/helpers.ts';

afterEach(cleanupAll);

function fakeClock(now = '2026-10-07T00:00:00.000Z'): Clock {
  return { now: () => now };
}

const REPORTS_ROOT = 'docs/forge/reports';

/** Writes one real, schema-valid `MutationEvidence` record directly onto disk — this module's own
 * `enumerateEvidence` only ever reads front matter back off a file, so a test fixture is written the
 * same way a human-edited or hand-seeded record would be, not necessarily through the real `forge
 * test binding` writer (that writer is exercised separately, in the multi-process test file, for the
 * one claim that specifically needs it: the real `IdAllocator` invariant). */
async function seedMutationEvidence(
  project: TestProject,
  id: string,
  story: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const frontMatter = {
    id,
    type: 'MutationEvidence',
    schemaVersion: 1,
    title: `forge test binding — ${story}`,
    status: 'recorded',
    created: '2026-10-01',
    updated: '2026-10-01',
    revision: 1,
    author: 'engine',
    run: 'run-001',
    changelog: [],
    story,
    mutationKind: 'revert-implementation',
    revertedRange: { fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40) },
    namedTests: ['adds'],
    failedUnderMutation: ['adds'],
    restoreVerified: true,
    toolVersions: { node: '20.0.0' },
    ranAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
  const relPath = `${REPORTS_ROOT}/mutation/${id}.md`;
  await writeRecord(project, relPath, frontMatter);
  return relPath;
}

/** Writes one real, schema-valid `EvidenceBundle` record directly onto disk. */
async function seedEvidenceBundle(
  project: TestProject,
  id: string,
  story: string,
  options: {
    readonly bindingEvidence?: readonly string[];
    readonly parityEvidence?: readonly string[];
    readonly schemaVersion?: number;
  } = {},
): Promise<string> {
  const frontMatter = {
    id,
    type: 'EvidenceBundle',
    schemaVersion: options.parityEvidence === undefined ? 1 : (options.schemaVersion ?? 2),
    title: `Evidence — ${story}`,
    status: 'recorded',
    created: '2026-10-01',
    updated: '2026-10-01',
    revision: 1,
    author: 'engine',
    changelog: [],
    story,
    verify: {
      phase: 'verify',
      passed: true,
      errors: 0,
      checks: [{ check: 'c', status: 'pass', message: 'ok' }],
    },
    coverage: { acCoveragePercent: 100, ratchetRegressions: 0 },
    bindingEvidence: options.bindingEvidence ?? [],
    ...(options.parityEvidence === undefined ? {} : { parityEvidence: options.parityEvidence }),
    reviews: [{ id: 'REVIEW-001', verdict: 'clear' }],
    gates: [],
    exemptions: [],
    cost: { totalUsd: 0, estimated: true },
    assembledAt: '2026-10-01T00:00:00.000Z',
  };
  const relPath = `${REPORTS_ROOT}/evidence/${id}.md`;
  await writeRecord(project, relPath, frontMatter);
  return relPath;
}

/** Writes one real, schema-valid `ParityEvidence` record directly onto disk. */
async function seedParityEvidence(
  project: TestProject,
  id: string,
  story: string | undefined,
): Promise<string> {
  const frontMatter = {
    id,
    type: 'ParityEvidence',
    schemaVersion: 1,
    title: 'Parity check',
    status: 'recorded',
    created: '2026-10-01',
    updated: '2026-10-01',
    revision: 1,
    author: 'engine',
    changelog: [],
    ...(story === undefined ? {} : { story }),
    trusted: null,
    headSha: 'c'.repeat(40),
    dirty: false,
    deltaDigest: 'd'.repeat(64),
    toolVersions: { node: '20.0.0' },
    verdict: 'invalid',
    reason: 'no-declarations',
    declarations: [],
  };
  const relPath = `${REPORTS_ROOT}/parity/${id}.md`;
  await writeRecord(project, relPath, frontMatter);
  return relPath;
}

async function writeRecord(
  project: TestProject,
  relPath: string,
  frontMatter: Readonly<Record<string, unknown>>,
): Promise<void> {
  const absolute = path.join(project.dir, relPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const body = '<fixture>\n';
  await writeFile(absolute, `---\n${YAML.stringify(frontMatter)}---\n\n${body}`, 'utf8');
}

/** Writes one real, minimal, valid `.forge/checks/<id>.gate.yaml` whose one deterministic check
 * always passes (a real shell command, real JSON stdout, a `failOn` that is always false) — real
 * enough for `loadGateRegistry`/`evaluateGate` to accept and evaluate, without needing this project to
 * have any other real tooling installed. */
async function seedGate(
  project: TestProject,
  gateId: string,
  evidence: readonly string[],
): Promise<void> {
  const doc = {
    id: gateId,
    checks: {
      deterministic: [
        {
          id: 'always-pass',
          run: 'node -e "console.log(JSON.stringify({failing:0}))"',
          parser: 'forge-json',
          failOn: 'failing > 0',
        },
      ],
    },
    openQuestionsPolicy: 'block',
    evidence: evidence.map((artifact) => ({ artifact })),
  };
  const absolute = path.join(project.dir, '.forge/checks', `${gateId}.gate.yaml`);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, YAML.stringify(doc), 'utf8');
}

function gateContext(project: TestProject): GateCommandContext {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    checksRoot: '.forge/checks',
    agentsRoot: '.forge/agents',
    runId: 'test-run',
    clock: fakeClock(),
  };
}

async function prune(
  project: TestProject,
  options: { readonly apply?: boolean; readonly keep?: number } = {},
): Promise<RunEvidencePruneResult> {
  return runEvidencePrune({
    paths: project.paths,
    clock: fakeClock(),
    keep: options.keep ?? 5,
    apply: options.apply ?? false,
    marker: undefined,
  });
}

/** Commits every current change — `resolveGateEvidence` (`gate-commands.ts`) only ever resolves a
 * reference against `git ls-tree HEAD`, never the bare working tree (`10` §10.3's own "committed
 * artifacts" bar), so a fixture that needs to be found as real, resolvable evidence must actually be
 * committed, the identical thing a human author of one of these records would do in a real project. */
async function commitAll(project: TestProject, message = 'fixture'): Promise<void> {
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', message], { cwd: project.dir });
}

describe('forge evidence prune — dry run (specs/22 M16 P14)', () => {
  it('writes nothing and names its victims', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 7; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    const result = await prune(project, { keep: 5 });
    expect(result.applied).toBe(false);
    expect(result.removed.map((entry) => entry.id).sort()).toEqual(['MUT-001', 'MUT-002']);
    expect(result.kept.map((entry) => entry.id).sort()).toEqual([
      'MUT-003',
      'MUT-004',
      'MUT-005',
      'MUT-006',
      'MUT-007',
    ]);
    // Nothing on disk changed: every record still exists, and no tombstone was created.
    for (let index = 1; index <= 7; index += 1) {
      expect(
        await pathExists(
          project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-00${String(index)}.md`),
        ),
      ).toBe(true);
    }
    expect(
      await pathExists(project.paths.resolveWithin(tombstoneRelPath(REPORTS_ROOT, 'MUT-001'))),
    ).toBe(false);
  });

  it('defaults --keep to 5, per §3.4\'s "retain last 5" precedent', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    const result = await prune(project, {});
    expect(result.removed.map((entry) => entry.id)).toEqual(['MUT-001']);
  });
});

describe('forge evidence prune — --apply (specs/22 M16 P14)', () => {
  it('keeps exactly the newest n per (type, subject) and removes the rest, each with a tombstone', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 7; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    const result = await prune(project, { apply: true, keep: 5 });
    expect(result.applied).toBe(true);
    expect(result.removed.map((entry) => entry.id).sort()).toEqual(['MUT-001', 'MUT-002']);
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(false);
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-002.md`)),
    ).toBe(false);
    for (let index = 3; index <= 7; index += 1) {
      expect(
        await pathExists(
          project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-00${String(index)}.md`),
        ),
      ).toBe(true);
    }
    const tombstone1 = await readTombstone(project.paths, REPORTS_ROOT, 'MUT-001');
    expect(tombstone1).toMatchObject({
      id: 'MUT-001',
      type: 'MutationEvidence',
      subject: 'STORY-001',
      prunedAt: '2026-10-07T00:00:00.000Z',
    });
    expect(tombstone1?.recordSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never removes the highest id of a type, even across subjects', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 5; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    await seedMutationEvidence(project, 'MUT-006', 'STORY-002');
    const result = await prune(project, { apply: true, keep: 1 });
    expect(result.removed.map((entry) => entry.id).sort()).toEqual([
      'MUT-001',
      'MUT-002',
      'MUT-003',
      'MUT-004',
    ]);
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-006.md`)),
    ).toBe(true);
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-005.md`)),
    ).toBe(true);
  });

  it('--keep is independent per retention type: pruning MutationEvidence never touches EvidenceBundle/ParityEvidence', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 7; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    await seedEvidenceBundle(project, 'EVID-001', 'STORY-001');
    await seedParityEvidence(project, 'PAR-001', undefined);
    const result = await prune(project, { apply: true, keep: 5 });
    expect(result.removed.map((entry) => entry.id).sort()).toEqual(['MUT-001', 'MUT-002']);
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/evidence/EVID-001.md`)),
    ).toBe(true);
    expect(await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/parity/PAR-001.md`))).toBe(
      true,
    );
  });
});

describe('forge evidence prune — reference protection, one test per store (specs/22 M16 P14)', () => {
  it('EvidenceBundle.bindingEvidence protects a MutationEvidence id --keep alone would prune', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    await seedEvidenceBundle(project, 'EVID-001', 'STORY-001', { bindingEvidence: ['MUT-001'] });
    const result = await prune(project, { apply: true, keep: 1 });
    // Without the reference, MUT-001..MUT-005 would all be removed (keep 1 keeps only MUT-006).
    expect(result.removed.map((entry) => entry.id).sort()).toEqual([
      'MUT-002',
      'MUT-003',
      'MUT-004',
      'MUT-005',
    ]);
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(true);
    const kept = result.kept.find((entry) => entry.id === 'MUT-001');
    expect(kept?.reason).toContain('referenced by EVID-001');
  });

  it('EvidenceBundle.parityEvidence protects a ParityEvidence id --keep alone would prune', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedParityEvidence(project, `PAR-00${String(index)}`, undefined);
    }
    await seedEvidenceBundle(project, 'EVID-001', 'STORY-001', { parityEvidence: ['PAR-001'] });
    const result = await prune(project, { apply: true, keep: 1 });
    expect(result.removed.map((entry) => entry.id)).not.toContain('PAR-001');
    expect(await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/parity/PAR-001.md`))).toBe(
      true,
    );
  });

  it("a gate definition's own specific-id evidence citation protects a record --keep alone would prune", async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    await seedGate(project, 'G-Fixture', ['MutationEvidence(MUT-001)']);
    const result = await prune(project, { apply: true, keep: 1 });
    expect(result.removed.map((entry) => entry.id)).not.toContain('MUT-001');
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(true);
  });

  it('a Story document has no field that cites an evidence id, so it never protects one (checked directly, not assumed)', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    const story = {
      id: 'STORY-001',
      type: 'Story',
      schemaVersion: 1,
      title: 'Fixture story',
      status: 'in-progress',
      created: '2026-10-01',
      updated: '2026-10-01',
      revision: 1,
      author: 'engine',
      changelog: [],
      epic: 'EPIC-001',
      capability: 'CAP-001',
      storyType: 'feature',
      size: 'S',
      owner_role: 'engineer',
      depends_on: [],
      blocked_by: [],
      interfaces: [],
      data: [],
      files_expected: [],
      context_refs: [],
      acceptance: [],
      tests: ['MUT-001'],
      dod_profile: 'default',
    };
    await writeRecord(project, 'docs/forge/specs/stories/STORY-001-fixture.md', story);
    const result = await prune(project, { apply: true, keep: 1 });
    // MUT-001 is pruned exactly as it would be with no Story present at all — the Story's own `tests`
    // field (a TEST id, not an evidence id) does not, and structurally cannot, protect it.
    expect(result.removed.map((entry) => entry.id)).toContain('MUT-001');
  });

  it('a gate citation naming an id that was never written protects nothing and is not itself an error', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await seedGate(project, 'G-Fixture', ['MutationEvidence(MUT-999)']);
    const result = await prune(project, { apply: true, keep: 1 });
    expect(result.removed).toEqual([]);
    expect(result.kept.map((entry) => entry.id)).toEqual(['MUT-001']);
  });
});

describe('forge evidence prune — tombstone atomicity and fault injection (specs/22 M16 P14)', () => {
  it('an ordinary --apply leaves a real, readable tombstone for a pruned id, and the record itself is gone', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    const target = project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`);
    const result = await prune(project, { apply: true, keep: 1 });
    expect(result.removed.map((entry) => entry.id)).toContain('MUT-001');
    const tombstone = await readTombstone(project.paths, REPORTS_ROOT, 'MUT-001');
    expect(tombstone?.id).toBe('MUT-001');
    expect(await pathExists(target)).toBe(false);
  });

  it('fault injection: a REAL removal failure proves the tombstone was written before removal was ever attempted, never the reverse', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await seedMutationEvidence(project, 'MUT-002', 'STORY-001');
    const mutationDir = project.paths.resolveWithin(`${REPORTS_ROOT}/mutation`);
    // A real OS-level fault: removing MUT-001.md needs write permission on its own parent directory
    // (POSIX `unlink`), which this strips — `removeRecord`'s own `fs.rm(..., { force: true })` still
    // propagates a permission error (`force` only ever swallows ENOENT); this is a genuine, unforced
    // failure inside the SAME two-step sequence `runEvidencePrune` always runs, not a mock of either
    // step. If the real code ever removed a record before writing its tombstone, this exact injection
    // would show a MISSING tombstone for MUT-001 once the call throws; the committed code's own real
    // order means the tombstone is already, genuinely on disk by the time the failure happens.
    await mkdir(mutationDir, { recursive: true });
    const originalMode = (await stat(mutationDir)).mode & 0o777;
    await chmod(mutationDir, 0o555);
    try {
      await expect(prune(project, { apply: true, keep: 1 })).rejects.toThrow();
    } finally {
      await chmod(mutationDir, originalMode);
    }
    const tombstone = await readTombstone(project.paths, REPORTS_ROOT, 'MUT-001');
    expect(tombstone?.id).toBe('MUT-001');
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(true);
  });

  it('fault injection — tombstone written, record removal never reached (the real crash window): the record wins, not the tombstone', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    // Simulates the real crash window directly: write the tombstone (step one) and deliberately never
    // remove the record (step two) — step two, in the real code, is a plain `fs.rm`, which this test
    // does not need to call at all to prove the INVARIANT the fault point protects: "while both exist,
    // the record wins."
    await writeTombstone(
      project.paths,
      REPORTS_ROOT,
      {
        id: 'MUT-001',
        type: 'MutationEvidence',
        subject: 'STORY-001',
        numericId: 1,
        relPath: `${REPORTS_ROOT}/mutation/MUT-001.md`,
        sha256: 'e'.repeat(64),
        references: [],
      },
      fakeClock(),
    );
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(true);
    expect(
      await pathExists(project.paths.resolveWithin(tombstoneRelPath(REPORTS_ROOT, 'MUT-001'))),
    ).toBe(true);
    // A real, independent enumeration still finds MUT-001 as a normal, live record (the record wins):
    // a dry-run prune over it behaves exactly as if no tombstone existed at all.
    const result = await prune(project, { keep: 1 });
    expect(result.kept.map((entry) => entry.id)).toEqual(['MUT-001']);
  });

  it('a torn (truncated) tombstone reads as absent, not as a parse error', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    const tombstonePath = project.paths.resolveWithin(tombstoneRelPath(REPORTS_ROOT, 'MUT-001'));
    await mkdir(path.dirname(tombstonePath), { recursive: true });
    await writeFile(tombstonePath, '{"id": "MUT-001", "type": "Mutat', 'utf8');
    const tombstone = await readTombstone(project.paths, REPORTS_ROOT, 'MUT-001');
    expect(tombstone).toBeUndefined();
  });

  it('a repeated/concurrent tombstone write for the same id is idempotent, not an error (RUN-114 swallowed)', async () => {
    const project = await createTestProject();
    const record = {
      id: 'MUT-001',
      type: 'MutationEvidence' as const,
      subject: 'STORY-001',
      numericId: 1,
      relPath: `${REPORTS_ROOT}/mutation/MUT-001.md`,
      sha256: 'f'.repeat(64),
      references: [],
    };
    await writeTombstone(project.paths, REPORTS_ROOT, record, fakeClock());
    await expect(
      writeTombstone(project.paths, REPORTS_ROOT, record, fakeClock('2026-10-08T00:00:00.000Z')),
    ).resolves.toBeUndefined();
    // The FIRST write's own timestamp survives — a second writer never overwrites an existing tombstone.
    const tombstone = await readTombstone(project.paths, REPORTS_ROOT, 'MUT-001');
    expect(tombstone?.prunedAt).toBe('2026-10-07T00:00:00.000Z');
  });
});

describe('forge evidence prune — refusals (specs/22 M16 P14)', () => {
  it.each([
    ['0', '0'],
    ['-1', '-1'],
    ['1.5', '1.5'],
    ['abc', 'abc'],
  ])('--keep %s is a typed refusal (RUN-143)', (_label, raw) => {
    expect(() => parseKeep(raw)).toThrow(expect.objectContaining({ code: 'RUN-143' }));
  });

  it('--keep with no value at all defaults to 5 rather than refusing', () => {
    expect(parseKeep(undefined)).toBe(5);
  });

  it('--apply refuses under FORGE_RUN_ID (RUN-144); a dry run under the same marker does not', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await expect(
      runEvidencePrune({
        paths: project.paths,
        clock: fakeClock(),
        keep: 5,
        apply: true,
        marker: { runId: 'run-014' },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'RUN-144' }));
    await expect(
      runEvidencePrune({
        paths: project.paths,
        clock: fakeClock(),
        keep: 5,
        apply: false,
        marker: { runId: 'run-014' },
      }),
    ).resolves.toMatchObject({ applied: false });
  });

  it('an unreadable/unparseable store refuses the whole prune and removes nothing (RUN-145)', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    // A document that unambiguously claims to BE a MutationEvidence record (its own `type` field says
    // so) but fails that type's own schema (missing every other required field) — not merely
    // malformed YAML, which `enumerateEvidence` already treats as "not an artifact document" and
    // skips; this is the one case that must fail closed.
    await writeFile(
      project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-broken.md`),
      '---\nid: MUT-999\ntype: MutationEvidence\n---\n\nbroken\n',
      'utf8',
    );
    let caught: unknown;
    try {
      await prune(project, { apply: true, keep: 1 });
    } catch (error) {
      caught = error;
    }
    expect(isForgeError(caught) && caught.code).toBe('RUN-145');
    // Removes nothing: every real record, including the ones --keep would have pruned, still exists.
    for (let index = 1; index <= 5; index += 1) {
      expect(
        await pathExists(
          project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-00${String(index)}.md`),
        ),
      ).toBe(true);
    }
  });

  it('an unrelated, unparseable Markdown file elsewhere in the project does not disable retention (best-effort, not fail-closed, for a non-store file)', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await mkdir(project.paths.resolveWithin('docs/forge/specs'), { recursive: true });
    await writeFile(
      project.paths.resolveWithin('docs/forge/specs/README.md'),
      '# Not an artifact\n',
      'utf8',
    );
    const result = await prune(project, { keep: 1 });
    expect(result.kept.map((entry) => entry.id)).toEqual(['MUT-001']);
  });

  it('a real file, listed by the directory scan but genuinely unreadable (permission denied) by the time it is opened, is silently skipped — not fatal, the identical best-effort stance a plain parse failure already gets', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await seedMutationEvidence(project, 'MUT-002', 'STORY-001');
    const unreadable = project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-002.md`);
    const originalMode = (await stat(unreadable)).mode & 0o777;
    await chmod(unreadable, 0o000);
    try {
      const result = await prune(project, { keep: 5 });
      const allIds = [...result.kept, ...result.removed].map((entry) => entry.id);
      expect(allIds).toContain('MUT-001');
      expect(allIds).not.toContain('MUT-002');
    } finally {
      await chmod(unreadable, originalMode);
    }
  });
});

describe('forge evidence prune — tombstone write failures that are not RUN-114 propagate (specs/22 M16 P14)', () => {
  it('writeTombstone re-throws a genuine write failure rather than swallowing it the way it swallows RUN-114', async () => {
    const project = await createTestProject();
    const reportsDir = project.paths.resolveWithin(REPORTS_ROOT);
    await mkdir(reportsDir, { recursive: true });
    const originalMode = (await stat(reportsDir)).mode & 0o777;
    // No write permission on the reports root itself: `writeTombstone`'s own `writeNewFileAtomic`
    // cannot even `mkdir` its own `pruned/` subdirectory, so this is a genuine `RUN-034`, never
    // `RUN-114` (which only ever means "the exact tombstone already exists") — the one path this
    // function's own `catch` must NOT swallow.
    await chmod(reportsDir, 0o555);
    try {
      await expect(
        writeTombstone(
          project.paths,
          REPORTS_ROOT,
          {
            id: 'MUT-001',
            type: 'MutationEvidence',
            subject: 'STORY-001',
            numericId: 1,
            relPath: `${REPORTS_ROOT}/mutation/MUT-001.md`,
            sha256: 'a'.repeat(64),
            references: [],
          },
          fakeClock(),
        ),
      ).rejects.not.toMatchObject({ code: 'RUN-114' });
    } finally {
      await chmod(reportsDir, originalMode);
    }
  });
});

describe('forge evidence prune — the fixed point and the second enumeration pass (specs/22 M16 P14)', () => {
  it('a record referenced only by a record this same prune removes is not protected', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    // EVID-001 is old (keep 1 removes it) and references MUT-001 (also old) — nothing else keeps
    // either alive.
    await seedEvidenceBundle(project, 'EVID-001', 'STORY-001', { bindingEvidence: ['MUT-001'] });
    await seedEvidenceBundle(project, 'EVID-002', 'STORY-001', { bindingEvidence: [] });
    const result = await prune(project, { apply: true, keep: 1 });
    expect(result.removed.map((entry) => entry.id)).toContain('EVID-001');
    expect(result.removed.map((entry) => entry.id)).toContain('MUT-001');
  });

  it('a record referenced for the first time between the two enumeration passes keeps its tombstone and survives this run', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await seedMutationEvidence(project, 'MUT-002', 'STORY-001');
    // keep 1: MUT-001 starts as a genuine, unprotected candidate (nothing references it yet) —
    // `afterTombstonesForTest` (a test-only hook `runEvidencePrune` itself declares, fired after
    // every candidate's tombstone is written and before the second enumeration pass) writes a BRAND
    // NEW `EvidenceBundle` citing MUT-001 at exactly that point, through the real `runEvidencePrune`
    // call itself — not a reimplementation of its own two-pass logic. The genuinely racy, real
    // two-process version of this same claim (no hook of any kind — a genuinely separate OS process
    // polling for the real tombstone file's own appearance) is proven separately in
    // `prune-multiprocess.test.ts`'s own "a late gate citation from a genuinely separate OS process, no
    // test hook" describe block.
    const result = await runEvidencePrune({
      paths: project.paths,
      clock: fakeClock(),
      keep: 1,
      apply: true,
      marker: undefined,
      afterTombstonesForTest: () =>
        seedEvidenceBundle(project, 'EVID-001', 'STORY-001', { bindingEvidence: ['MUT-001'] }).then(
          () => undefined,
        ),
    });
    expect(result.removed.map((entry) => entry.id)).not.toContain('MUT-001');
    expect(result.pending.map((entry) => entry.id)).toContain('MUT-001');
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(true);
    // The tombstone DOES exist (written before the hook ran) — a genuine pending removal, distinct
    // from "never a candidate at all".
    const tombstone = await readTombstone(project.paths, REPORTS_ROOT, 'MUT-001');
    expect(tombstone?.id).toBe('MUT-001');
  });

  it('a dead-classified EvidenceBundle spared by a late gate citation also spares what IT references — the second pass needs its own fixed point', async () => {
    const project = await createTestProject();
    // MUT-001 is a genuine candidate (nothing protects it on its own); MUT-002 is the newest/highest
    // MUT id, protected outright.
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await seedMutationEvidence(project, 'MUT-002', 'STORY-001');
    // EVID-001 is ALSO a genuine candidate (EVID-002 outranks it as both newest and highest-id for
    // EvidenceBundle) — its own bindingEvidence cites MUT-001, but that citation does not count toward
    // `computeProtection`'s first pass because EVID-001 itself is not protected there either.
    await seedEvidenceBundle(project, 'EVID-001', 'STORY-001', { bindingEvidence: ['MUT-001'] });
    await seedEvidenceBundle(project, 'EVID-002', 'STORY-001', { bindingEvidence: [] });
    // Between the two enumeration passes, a brand-new gate definition arrives citing EVID-001 by
    // specific id — the one real, on-disk mechanism that can cite an EvidenceBundle at all (no other
    // record's own `bindingEvidence`/`parityEvidence` field can name another EvidenceBundle's id).
    const result = await runEvidencePrune({
      paths: project.paths,
      clock: fakeClock(),
      keep: 1,
      apply: true,
      marker: undefined,
      afterTombstonesForTest: () => seedGate(project, 'G-Late', ['EvidenceBundle(EVID-001)']),
    });
    // EVID-001 survives — a late, direct gate citation names it. This much already worked before this
    // fix (`computeStillReferenced`'s own gate-citation branch never depended on `deadBundleIds`).
    expect(result.removed.map((entry) => entry.id)).not.toContain('EVID-001');
    expect(result.pending.map((entry) => entry.id)).toContain('EVID-001');
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/evidence/EVID-001.md`)),
    ).toBe(true);
    // The real, load-bearing assertion (the bug this fix closes): MUT-001 must ALSO survive — EVID-001
    // is not actually gone, so its own citation of MUT-001 must count, exactly as it would have if
    // EVID-001 had been classified a survivor from the very first enumeration pass.
    expect(result.removed.map((entry) => entry.id)).not.toContain('MUT-001');
    expect(result.pending.map((entry) => entry.id)).toContain('MUT-001');
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(true);
  });
});

describe('forge doctor stays clean after a prune (specs/22 M16 P14)', () => {
  it('a project with a pruned MutationEvidence record still passes forge doctor cleanly', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 7; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    await prune(project, { apply: true, keep: 5 });
    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });
    expect(report.ok).toBe(true);
  });
});

describe('citing a pruned id in a gate approval reads "pruned", never "dangling" (specs/22 M16 P14)', () => {
  it('a gate citing a never-written id refuses RUN-112 ("missing")', async () => {
    const project = await createTestProject();
    await seedGate(project, 'G-Fixture', ['MutationEvidence(MUT-999)']);
    await expect(gateApprove(gateContext(project), 'G-Fixture')).rejects.toThrow(
      expect.objectContaining({ code: 'RUN-112' }),
    );
  });

  it('a gate citing an id this command has pruned refuses RUN-146 ("pruned"), naming the tombstone — not RUN-112', async () => {
    const project = await createTestProject();
    for (let index = 1; index <= 6; index += 1) {
      await seedMutationEvidence(project, `MUT-00${String(index)}`, 'STORY-001');
    }
    // `resolveGateEvidence` (`gate-commands.ts`) only ever resolves against `git ls-tree HEAD` (`10`
    // §10.3's "committed artifacts" bar) — commit the records first, the identical thing a human
    // author of one would do in a real project, so this test exercises the real resolution path
    // rather than one that would read "missing" regardless of whether anything was ever pruned.
    await commitAll(project);
    await prune(project, { apply: true, keep: 1 });
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(false);
    await seedGate(project, 'G-Fixture', ['MutationEvidence(MUT-001)']);
    let caught: unknown;
    try {
      await gateApprove(gateContext(project), 'G-Fixture');
    } catch (error) {
      caught = error;
    }
    expect(isForgeError(caught) && caught.code).toBe('RUN-146');
    expect(isForgeError(caught) && (caught.details as { path?: unknown }).path).toBe(
      tombstoneRelPath(REPORTS_ROOT, 'MUT-001'),
    );
  });

  it('the identical "pruned" answer holds for forge gate waive too', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await seedMutationEvidence(project, 'MUT-002', 'STORY-001');
    await commitAll(project);
    // keep 1: MUT-001 is pruned; MUT-002 (the highest id) survives.
    await prune(project, { apply: true, keep: 1 });
    expect(
      await pathExists(project.paths.resolveWithin(`${REPORTS_ROOT}/mutation/MUT-001.md`)),
    ).toBe(false);
    await seedGate(project, 'G-Fixture', ['MutationEvidence(MUT-001)']);
    await expect(
      gateWaive(gateContext(project), 'G-Fixture', {
        reason: 'r',
        owner: 'alice',
        expiresAt: '2026-12-01',
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'RUN-146' }));
  });
});

describe('forge evidence prune — a sub-id (the base id regex\'s own optional "-N" suffix) is silently excluded from retention, for every retention-managed type (specs/22 M16 P14)', () => {
  // `18` §18.6's base id regex (`checkIdMatchesRegisteredType`) accepts an OPTIONAL `-\d+` suffix for
  // every registered type — nothing in this project's own `IdAllocator` ever allocates one for
  // `MutationEvidence`/`EvidenceBundle`/`ParityEvidence`, but a schema-valid document naming one is
  // real and reachable (a hand-edited or hand-authored file). This piece's own `numericIdOf` cannot
  // parse a "newest" ordering out of such an id (`"001-2"` is not `/^\d+$/`), so it is silently
  // excluded from this scan entirely — neither counted as kept nor as a removal candidate, and
  // therefore never prunable by this command at all. Disclosed precisely in this piece's own report,
  // not merely implied by a passing test.
  it('a MutationEvidence sub-id is excluded from both kept and removed', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await seedMutationEvidence(project, 'MUT-001-2', 'STORY-001');
    const result = await prune(project, { keep: 1 });
    const allIds = [...result.kept, ...result.removed].map((entry) => entry.id);
    expect(allIds).toContain('MUT-001');
    expect(allIds).not.toContain('MUT-001-2');
  });

  it('an EvidenceBundle sub-id is excluded from both kept and removed', async () => {
    const project = await createTestProject();
    await seedEvidenceBundle(project, 'EVID-001', 'STORY-001');
    await seedEvidenceBundle(project, 'EVID-001-2', 'STORY-001');
    const result = await prune(project, { keep: 1 });
    const allIds = [...result.kept, ...result.removed].map((entry) => entry.id);
    expect(allIds).toContain('EVID-001');
    expect(allIds).not.toContain('EVID-001-2');
  });

  it('a ParityEvidence sub-id is excluded from both kept and removed', async () => {
    const project = await createTestProject();
    await seedParityEvidence(project, 'PAR-001', undefined);
    await seedParityEvidence(project, 'PAR-001-2', undefined);
    const result = await prune(project, { keep: 1 });
    const allIds = [...result.kept, ...result.removed].map((entry) => entry.id);
    expect(allIds).toContain('PAR-001');
    expect(allIds).not.toContain('PAR-001-2');
  });
});

describe("forge evidence prune — remaining small edges this piece's own coverage pass required (specs/22 M16 P14)", () => {
  it('parseKeep returns the parsed value for every real, valid --keep', () => {
    expect(parseKeep('1')).toBe(1);
    expect(parseKeep('12')).toBe(12);
  });

  it('isEnoent recognises a real Node ENOENT and rejects every other shape', () => {
    expect(isEnoent({ code: 'ENOENT' })).toBe(true);
    expect(isEnoent(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true);
    expect(isEnoent({ code: 'EACCES' })).toBe(false);
    expect(isEnoent({})).toBe(false);
    expect(isEnoent(null)).toBe(false);
    expect(isEnoent('ENOENT')).toBe(false);
    expect(isEnoent(undefined)).toBe(false);
  });

  it('a gate definition with no "evidence:" key at all (not even an empty list) is scanned without throwing, and cites nothing', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    const doc = {
      id: 'G-NoEvidence',
      checks: {
        deterministic: [
          { id: 'always-pass', run: 'true', parser: 'forge-json', failOn: 'failing > 0' },
        ],
      },
      openQuestionsPolicy: 'block',
      // Deliberately no `evidence:` key — `GateDefinition.evidence` is `undefined`, not `[]`, exactly
      // the real shape a hand-authored gate with no evidence block parses to (`document.ts`).
    };
    const absolute = project.paths.resolveWithin('.forge/checks/G-NoEvidence.gate.yaml');
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, YAML.stringify(doc), 'utf8');
    const result = await prune(project, { keep: 1 });
    expect(result.kept.map((entry) => entry.id)).toEqual(['MUT-001']);
  });

  it('a record that becomes "pending" via a brand-new GATE citation (not an EvidenceBundle) between the two enumeration passes is reported with the citing gate\'s own name', async () => {
    const project = await createTestProject();
    await seedMutationEvidence(project, 'MUT-001', 'STORY-001');
    await seedMutationEvidence(project, 'MUT-002', 'STORY-001');
    const result = await runEvidencePrune({
      paths: project.paths,
      clock: fakeClock(),
      keep: 1,
      apply: true,
      marker: undefined,
      afterTombstonesForTest: () => seedGate(project, 'G-Late', ['MutationEvidence(MUT-001)']),
    });
    expect(result.removed.map((entry) => entry.id)).not.toContain('MUT-001');
    const pendingEntry = result.pending.find((entry) => entry.id === 'MUT-001');
    expect(pendingEntry?.reason).toContain('gate G-Late');
  });
});
