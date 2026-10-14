/**
 * `assembleAndWriteMutationEvidence` — its own `revert-hunks` extension (`specs/22` M16 P13): given a
 * real `HunkMutationReport` (`M16 P12`'s own `hunk-mutation.ts`), writes a `schemaVersion: 2`,
 * `mutationKind: 'revert-hunks'` `MutationEvidence` record carrying `hunkRun` ALONGSIDE the existing
 * `revertedRange` — never instead of it (`Q299` Decision 2) — through the identical
 * `writeNewFileAtomic`/`getSharedIdAllocator` mechanism the plain `revert-implementation` shape
 * already uses. `binding-evidence.test.ts` (M15 P4) owns the plain shape's own tests; this file owns
 * only what M16 P13 adds, the same "this file owns its own fixture/suite independently" convention
 * `hunks.test.ts`'s own doc comment already states for a sibling piece's test file.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-10
 * @see specs/22 M16 P13
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths, type Clock } from '@forge/core';
import {
  mutationEvidenceSchema,
  mutationEvidence1To2,
  type MigratableDocument,
} from '@forge/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { assembleAndWriteMutationEvidence } from '../../../../src/commands/loop/test/binding-evidence.ts';
import type { BindingCheckCompleted } from '../../../../src/commands/loop/test/binding.ts';
import {
  UNCOVERED_HUNK_REASON,
  type HunkMutationReport,
} from '../../../../src/commands/loop/test/hunk-mutation.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<ProjectPaths> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-binding-evidence-hunks-'));
  dirs.push(dir);
  return new ProjectPaths(dir);
}

function fakeClock(at = '2026-09-30T12:00:00.000Z'): Clock {
  return { now: () => at };
}

const BASE_SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const HEAD_SHA = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5';

function completedResult(overrides: Partial<BindingCheckCompleted> = {}): BindingCheckCompleted {
  return {
    outcome: 'completed',
    namedTests: ['adds', 'subtracts'],
    failedUnderMutation: ['adds', 'subtracts'],
    restoreVerified: true,
    revertedRange: { fromSha: BASE_SHA, toSha: HEAD_SHA },
    ranAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

/** A real, two-entry `HunkMutationReport` — one `killed` by TWO tests at once (the real cardinality
 * `hunk-mutation.ts`'s own `HunkVerdict.killed.killedBy` can carry), one `uncovered` — mirroring the
 * real shapes `hunk-mutation.test.ts`'s own "degrades to granularity file" fixture already produced
 * through the real engine, hand-built here only because this file tests the WRITER, not the engine. */
function hunkMutationReport(overrides: Partial<HunkMutationReport> = {}): HunkMutationReport {
  return {
    granularity: 'hunk',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    // `HunkMutationReport.diffAlgorithm` is the literal `'myers'` (`hunks.ts`'s own `HunkParseResult`,
    // M16 P11, landed), never a longer description -- `mutationEvidenceSchema.hunkRun.diffAlgorithm`
    // is free text for forward-compatibility (M16 P5's own doc comment), but the real value this
    // writer ever actually sees end to end is always exactly this bare string.
    diffAlgorithm: 'myers',
    hunks: [
      {
        id: 'impl.js#1',
        path: 'impl.js',
        ranges: { old: { start: 1, length: 2 }, new: { start: 1, length: 2 } },
        contentHash: '1111111111111111111111111111111111111111111111111111111111111111'.slice(
          0,
          64,
        ),
        verdict: { kind: 'killed', killedBy: ['adds', 'subtracts'] },
      },
      {
        id: 'impl.js#2',
        path: 'impl.js',
        ranges: { old: { start: 5, length: 1 }, new: { start: 5, length: 1 } },
        contentHash: '2222222222222222222222222222222222222222222222222222222222222222'.slice(
          0,
          64,
        ),
        verdict: { kind: 'uncovered', reason: UNCOVERED_HUNK_REASON },
      },
    ],
    ...overrides,
  };
}

async function readWrittenFrontMatter(
  paths: ProjectPaths,
  relativePath: string,
): Promise<Record<string, unknown>> {
  const text = await readFile(paths.resolveWithin(relativePath), 'utf8');
  const frontMatterText = text.split('---\n')[1] ?? '';
  return YAML.parse(frontMatterText) as Record<string, unknown>;
}

describe('assembleAndWriteMutationEvidence — revert-hunks (specs/22 M16 P13)', () => {
  it('writes schemaVersion 2, mutationKind revert-hunks, and a hunkRun that validates against the real schema', async () => {
    const paths = await freshProject();
    const written = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
      hunkMutation: hunkMutationReport(),
    });

    const frontMatter = await readWrittenFrontMatter(paths, written.path);
    expect(frontMatter['schemaVersion']).toBe(2);
    expect(frontMatter['mutationKind']).toBe('revert-hunks');
    // `revertedRange` is KEPT alongside `hunkRun`, not replaced by it (Q299 Decision 2).
    expect(frontMatter['revertedRange']).toEqual({ fromSha: BASE_SHA, toSha: HEAD_SHA });

    const result = mutationEvidenceSchema.safeParse(frontMatter);
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('a killed hunk carries every real killedBy test name, never truncated to one (the cardinality this piece widened the schema for)', async () => {
    const paths = await freshProject();
    const written = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
      hunkMutation: hunkMutationReport(),
    });

    const frontMatter = await readWrittenFrontMatter(paths, written.path);
    const hunkRun = frontMatter['hunkRun'] as {
      readonly hunks: readonly Record<string, unknown>[];
    };
    const killed = hunkRun.hunks.find((hunk) => hunk['verdict'] === 'killed');
    expect(killed?.['killedBy']).toEqual(['adds', 'subtracts']);
    const uncovered = hunkRun.hunks.find((hunk) => hunk['verdict'] === 'uncovered');
    expect(uncovered?.['killedBy']).toBeUndefined();
  });

  it('the written hunkRun matches the input report hunk for hunk: id, path, ranges, contentHash and verdict, byte-exact round trip', async () => {
    const paths = await freshProject();
    const report = hunkMutationReport();
    const written = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
      hunkMutation: report,
    });

    const frontMatter = await readWrittenFrontMatter(paths, written.path);
    const hunkRun = frontMatter['hunkRun'] as Record<string, unknown>;
    expect(hunkRun['baseSha']).toBe(report.baseSha);
    expect(hunkRun['diffAlgorithm']).toBe(report.diffAlgorithm);
    expect(hunkRun['granularity']).toBe(report.granularity);
    const hunks = hunkRun['hunks'] as readonly Record<string, unknown>[];
    expect(hunks).toHaveLength(report.hunks.length);
    for (const [index, hunk] of report.hunks.entries()) {
      const writtenHunk = hunks[index];
      expect(writtenHunk?.['id']).toBe(hunk.id);
      expect(writtenHunk?.['path']).toBe(hunk.path);
      expect(writtenHunk?.['ranges']).toEqual(hunk.ranges);
      expect(writtenHunk?.['contentHash']).toBe(hunk.contentHash);
      expect(writtenHunk?.['verdict']).toBe(hunk.verdict.kind);
    }
  });

  it('omitting hunkMutation still writes the plain v1 revert-implementation shape, unchanged (regression guard)', async () => {
    const paths = await freshProject();
    const written = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
    });

    const frontMatter = await readWrittenFrontMatter(paths, written.path);
    expect(frontMatter['schemaVersion']).toBe(1);
    expect(frontMatter['mutationKind']).toBe('revert-implementation');
    expect(frontMatter['hunkRun']).toBeUndefined();
    const result = mutationEvidenceSchema.safeParse(frontMatter);
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('is append-only: a second write at the identical story+timestamp refuses (RUN-114), never silently rewriting the first hunk-level record', async () => {
    const paths = await freshProject();
    const input = {
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
      hunkMutation: hunkMutationReport(),
    };
    const first = await assembleAndWriteMutationEvidence(input);
    const beforeSecondAttempt = await readFile(paths.resolveWithin(first.path), 'utf8');

    await expect(assembleAndWriteMutationEvidence(input)).rejects.toMatchObject({
      code: 'RUN-114',
    });

    const afterSecondAttempt = await readFile(paths.resolveWithin(first.path), 'utf8');
    expect(afterSecondAttempt).toBe(beforeSecondAttempt);
  });

  it('the 1-to-2 migration refuses this exact, real hunk-level record outright, through down -- revert-hunks has no version-1 form', async () => {
    const paths = await freshProject();
    const written = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
      hunkMutation: hunkMutationReport(),
    });

    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const frontMatter = await readWrittenFrontMatter(paths, written.path);
    const body = text.split('---\n').slice(2).join('---\n');
    const doc: MigratableDocument = { type: 'MutationEvidence', body, frontmatter: frontMatter };

    if (mutationEvidence1To2.down === undefined) {
      throw new Error('mutationEvidence1To2 has no down');
    }
    expect(() => mutationEvidence1To2.down?.(doc)).toThrow(
      new RegExp(`${written.id}.*revert-hunks`, 's'),
    );
  });

  it('the identical migration still strips a plain, non-hunk record down to schemaVersion 1 (the SAME migration, the other mutationKind -- regression guard)', async () => {
    const paths = await freshProject();
    const written = await assembleAndWriteMutationEvidence({
      paths,
      reportsRoot: 'docs/forge/reports',
      storyId: 'STORY-014',
      runId: 'run-1',
      toolVersions: { vitest: '4.1.11' },
      result: completedResult(),
      clock: fakeClock(),
    });

    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const frontMatter = await readWrittenFrontMatter(paths, written.path);
    // The plain writer always sets schemaVersion 1 directly; bump it the way `mutationEvidence1To2.up`
    // does, so this test exercises `down` on a genuine schemaVersion-2, revert-implementation record.
    const atV2 = { ...frontMatter, schemaVersion: 2 };
    const body = text.split('---\n').slice(2).join('---\n');
    const doc: MigratableDocument = { type: 'MutationEvidence', body, frontmatter: atV2 };

    if (mutationEvidence1To2.down === undefined) {
      throw new Error('mutationEvidence1To2 has no down');
    }
    const after = mutationEvidence1To2.down(doc);
    expect(after.frontmatter['schemaVersion']).toBe(1);
    expect(after.frontmatter['hunkRun']).toBeUndefined();
  });
});
