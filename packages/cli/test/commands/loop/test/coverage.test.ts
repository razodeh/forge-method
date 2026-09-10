/**
 * `testCoverage` — `PLAN-M8.md` P6's own Checks section.
 *
 * @see specs/13 §13.1 F-TEST-5
 * @see specs/09 §9.5
 * @see PLAN-M8.md P6
 */
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  testCoverage,
  type TestCoverageContext,
} from '../../../../src/commands/loop/test/coverage.ts';
import {
  writeNormalizedReport,
  type TestOutcome,
} from '../../../../src/commands/loop/test/reporter.ts';

const SPECS_ROOT = 'docs/forge/specs';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<{ readonly dir: string; readonly ctx: TestCoverageContext }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-test-coverage-'));
  dirs.push(dir);
  const paths = new ProjectPaths(dir);
  return { dir, ctx: { paths, projectRoot: dir, specsRoot: SPECS_ROOT } };
}

interface StoryFixture {
  readonly id: string;
  readonly status: string;
  readonly acceptance: readonly { readonly id: string }[];
}

/** A minimal, real, schema-valid `Story` — the identical shape `bin.test.ts`'s own
 * `writeOversizedStory` already establishes for the same purpose (a fixture `spec validate --rule`
 * can actually evaluate against), extended with real `acceptance` entries. */
async function writeStory(dir: string, story: StoryFixture): Promise<void> {
  const relPath = `docs/forge/specs/stories/${story.id}-fixture.md`;
  await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
  const acceptanceYaml = story.acceptance
    .map(
      (criterion) =>
        `  - id: ${criterion.id}\n    given: a real precondition\n    when: a real action\n    then: a real outcome\n    kind: functional`,
    )
    .join('\n');
  const content = `---
id: ${story.id}
type: Story
schemaVersion: 1
title: Fixture story
status: ${story.status}
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: po
changelog: []
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
owner_role: backend
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected: []
context_refs: []
acceptance:
${acceptanceYaml}
tests: []
dod_profile: backend-default
---

Fixture body.
`;
  await writeFile(path.join(dir, relPath), content, 'utf8');
}

async function writeCoverageSummary(dir: string, raw: unknown): Promise<void> {
  await mkdir(path.join(dir, 'coverage'), { recursive: true });
  await writeFile(path.join(dir, 'coverage/coverage-summary.json'), JSON.stringify(raw), 'utf8');
}

async function istanbulSummary(dir: string, linePct: number): Promise<unknown> {
  // A real coverage collector records real, symlink-resolved paths (`coverage.ts`'s own
  // `fileCoverageCountsFrom` realpaths `projectRoot` to match) — `realpath(dir)` here mirrors that,
  // since `mkdtemp`'s own `dir` can itself sit behind a symlink (macOS's `/var` -> `/private/var`).
  const absoluteFile = path.join(await realpath(dir), 'src/a.ts');
  return {
    total: {
      lines: { total: 100, covered: linePct, skipped: 0, pct: linePct },
      statements: { total: 100, covered: linePct, skipped: 0, pct: linePct },
      functions: { total: 100, covered: linePct, skipped: 0, pct: linePct },
      branches: { total: 100, covered: linePct, skipped: 0, pct: linePct },
    },
    [absoluteFile]: {
      lines: { total: 100, covered: linePct, skipped: 0, pct: linePct },
      statements: { total: 100, covered: linePct, skipped: 0, pct: linePct },
      functions: { total: 100, covered: linePct, skipped: 0, pct: linePct },
      branches: { total: 100, covered: linePct, skipped: 0, pct: linePct },
    },
  };
}

describe('testCoverage — default rule (flat, whole-project line coverage)', () => {
  it('reports the real total.lines.pct as coverage', async () => {
    const { dir, ctx } = await project();
    await writeCoverageSummary(dir, await istanbulSummary(dir, 87));

    const result = await testCoverage(ctx, {});

    expect(result.coverage).toBe(87);
    expect(result.problems).toBeUndefined();
  });

  it('reports a real "no coverage data" problem, not a thrown exception or a silent 100, when coverage-summary.json is missing', async () => {
    const { ctx } = await project();

    const result = await testCoverage(ctx, {});

    expect(result.coverage).toBe(0);
    expect(result.problems?.some((p) => p.includes('no coverage data'))).toBe(true);
  });

  it('reports a real problem, not a thrown exception, when coverage-summary.json is not valid JSON', async () => {
    const { dir, ctx } = await project();
    await mkdir(path.join(dir, 'coverage'), { recursive: true });
    await writeFile(path.join(dir, 'coverage/coverage-summary.json'), 'not json at all', 'utf8');

    const result = await testCoverage(ctx, {});

    expect(result.coverage).toBe(0);
    expect(result.problems?.length).toBeGreaterThan(0);
  });
});

describe('testCoverage — --rule acceptance-criteria (story:ac-coverage, 09 §9.5)', () => {
  it('reports coverage < 100 and names the missing AC, when one done story AC has no passing bound test', async () => {
    const { dir, ctx } = await project();
    await writeStory(dir, {
      id: 'STORY-001',
      status: 'done',
      acceptance: [{ id: 'AC-001-1' }],
    });
    await writeStory(dir, {
      id: 'STORY-002',
      status: 'done',
      acceptance: [{ id: 'AC-002-1' }],
    });
    const outcomes: readonly TestOutcome[] = [
      { name: 'AC-001-1 does the thing', acId: 'AC-001-1', status: 'pass' },
    ];
    await writeNormalizedReport(ctx.paths, { outcomes });

    const result = await testCoverage(ctx, { rule: 'acceptance-criteria' });

    expect(result.coverage).toBeLessThan(100);
    expect(result.missingAcIds).toEqual(['AC-002-1']);
  });

  it('reports coverage: 100 when every done story AC has a passing bound test', async () => {
    const { dir, ctx } = await project();
    await writeStory(dir, {
      id: 'STORY-001',
      status: 'done',
      acceptance: [{ id: 'AC-001-1' }],
    });
    await writeNormalizedReport(ctx.paths, {
      outcomes: [{ name: 'AC-001-1 does the thing', acId: 'AC-001-1', status: 'pass' }],
    });

    const result = await testCoverage(ctx, { rule: 'acceptance-criteria' });

    expect(result.coverage).toBe(100);
    expect(result.missingAcIds).toBeUndefined();
  });

  it('reports coverage: 100 vacuously when there are no done stories at all', async () => {
    const { dir, ctx } = await project();
    await writeStory(dir, {
      id: 'STORY-001',
      status: 'ready',
      acceptance: [{ id: 'AC-001-1' }],
    });

    const result = await testCoverage(ctx, { rule: 'acceptance-criteria' });

    expect(result.coverage).toBe(100);
  });

  it('does not count an AC whose only bound test failed as covered', async () => {
    const { dir, ctx } = await project();
    await writeStory(dir, {
      id: 'STORY-001',
      status: 'done',
      acceptance: [{ id: 'AC-001-1' }],
    });
    await writeNormalizedReport(ctx.paths, {
      outcomes: [{ name: 'AC-001-1 does the thing', acId: 'AC-001-1', status: 'fail' }],
    });

    const result = await testCoverage(ctx, { rule: 'acceptance-criteria' });

    expect(result.coverage).toBe(0);
    expect(result.missingAcIds).toEqual(['AC-001-1']);
  });

  it('reports a real problem, not a thrown exception, when test-results.json has never been written', async () => {
    const { dir, ctx } = await project();
    await writeStory(dir, {
      id: 'STORY-001',
      status: 'done',
      acceptance: [{ id: 'AC-001-1' }],
    });

    const result = await testCoverage(ctx, { rule: 'acceptance-criteria' });

    expect(result.coverage).toBe(0);
    expect(result.problems?.length).toBeGreaterThan(0);
  });
});

describe('testCoverage — --rule ratchet (coverage:ratchet)', () => {
  it('reports regressions: 0 and persists a first-ever baseline, with no prior baseline file', async () => {
    const { dir, ctx } = await project();
    await writeCoverageSummary(dir, await istanbulSummary(dir, 80));

    const result = await testCoverage(ctx, { rule: 'ratchet' });

    expect(result.regressions).toBe(0);
    const written = await readFile(
      path.join(dir, 'docs/forge/reports/coverage-baseline.json'),
      'utf8',
    );
    expect(JSON.parse(written)).toBeTruthy();
  });

  it('reports a real regression when this run drops more than 0.5pp below the stored baseline', async () => {
    const { dir, ctx } = await project();
    await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
    // A real coverage collector records real, symlink-resolved paths (`coverage.ts`'s own
    // `fileCoverageCountsFrom` realpaths `projectRoot` to match) — `realpath(dir)` here mirrors that,
    // since `mkdtemp`'s own `dir` can itself sit behind a symlink (macOS's `/var` -> `/private/var`).
    const absoluteFile = path.join(await realpath(dir), 'src/a.ts');
    const baseline = {
      src: { lines: 90, statements: 90, functions: 90, branches: 90 },
    };
    await writeFile(
      path.join(dir, 'docs/forge/reports/coverage-baseline.json'),
      JSON.stringify(baseline),
      'utf8',
    );
    await mkdir(path.join(dir, 'coverage'), { recursive: true });
    await writeFile(
      path.join(dir, 'coverage/coverage-summary.json'),
      JSON.stringify({
        total: { lines: { total: 100, covered: 70, skipped: 0, pct: 70 } },
        [absoluteFile]: {
          lines: { total: 100, covered: 70, skipped: 0, pct: 70 },
          statements: { total: 100, covered: 70, skipped: 0, pct: 70 },
          functions: { total: 100, covered: 70, skipped: 0, pct: 70 },
          branches: { total: 100, covered: 70, skipped: 0, pct: 70 },
        },
      }),
      'utf8',
    );

    const result = await testCoverage(ctx, { rule: 'ratchet' });

    expect(result.regressions).toBeGreaterThan(0);
  });

  it('reports a real problem, forcing regressions >= 1, when coverage-summary.json is missing', async () => {
    const { ctx } = await project();

    const result = await testCoverage(ctx, { rule: 'ratchet' });

    expect(result.regressions).toBeGreaterThanOrEqual(1);
    expect(result.problems?.length).toBeGreaterThan(0);
  });

  describe('adversarial fixtures a fresh critic round found', () => {
    it('never persists over a present-but-unusable baseline — a real regression cannot be laundered on the next run', async () => {
      const { dir, ctx } = await project();
      // Run 1: establishes a real, valid baseline at 90%.
      await writeCoverageSummary(dir, await istanbulSummary(dir, 90));
      const first = await testCoverage(ctx, { rule: 'ratchet' });
      expect(first.regressions).toBe(0);

      // The baseline file is now corrupted by something other than this code (a hand edit, a
      // truncated write) — the exact "present but unusable" case `readBaseline` degrades to `{}` for.
      const baselinePath = path.join(dir, 'docs/forge/reports/coverage-baseline.json');
      await writeFile(baselinePath, 'not json at all', 'utf8');

      // Run 2, with a real regression (40%, well below the recorded 90%): must report the failure —
      // and, critically, must NOT overwrite the corrupted baseline with this run's own (regressed)
      // numbers, which would let run 3 read them back as a brand-new, "clean" 40% baseline.
      await writeCoverageSummary(dir, await istanbulSummary(dir, 40));
      const second = await testCoverage(ctx, { rule: 'ratchet' });
      expect(second.regressions).toBeGreaterThanOrEqual(1);
      expect(second.problems?.length).toBeGreaterThan(0);

      const stillCorrupted = await readFile(baselinePath, 'utf8');
      expect(stillCorrupted).toBe('not json at all');
    });

    it('reports a real problem, forcing regressions >= 1, when coverage-summary.json names no real per-file entries', async () => {
      const { dir, ctx } = await project();
      await writeCoverageSummary(dir, {
        total: { lines: { total: 0, covered: 0, skipped: 0, pct: 0 } },
      });

      const result = await testCoverage(ctx, { rule: 'ratchet' });

      expect(result.regressions).toBeGreaterThanOrEqual(1);
      expect(result.problems?.some((p) => p.includes('no real per-file'))).toBe(true);
    });

    it('excludes a file path that escapes the project root, as a real problem, rather than silently merging it into one ".." bucket', async () => {
      const { dir, ctx } = await project();
      // A non-realpathed key (built from `dir` directly, not `realpath(dir)`) — the exact shape a
      // collector that never resolves symlinks produces when the project root itself sits behind
      // one (`mkdtemp`'s own real temp directories do, on macOS).
      const foreignKey = path.join(dir, 'src/a.ts');
      await writeCoverageSummary(dir, {
        total: { lines: { total: 100, covered: 80, skipped: 0, pct: 80 } },
        [foreignKey]: {
          lines: { total: 100, covered: 80, skipped: 0, pct: 80 },
          statements: { total: 100, covered: 80, skipped: 0, pct: 80 },
          functions: { total: 100, covered: 80, skipped: 0, pct: 80 },
          branches: { total: 100, covered: 80, skipped: 0, pct: 80 },
        },
      });

      const result = await testCoverage(ctx, { rule: 'ratchet' });

      // Real files (non-realpathed keys) exist, but every one is excluded — never silently merged
      // into a ".."-keyed bucket, which is the specific behaviour this test guards against; with
      // nothing real left to compare, this degrades to the "no real per-file entries" problem too.
      expect(result.problems?.some((p) => p.includes('outside the project root'))).toBe(true);
    });

    it('reports a real problem, not a thrown exception, when coverage-summary.json parses to null', async () => {
      const { dir, ctx } = await project();
      await writeCoverageSummary(dir, null);

      const defaultResult = await testCoverage(ctx, {});
      expect(defaultResult.coverage).toBe(0);
      expect(defaultResult.problems?.length).toBeGreaterThan(0);

      const ratchetResult = await testCoverage(ctx, { rule: 'ratchet' });
      expect(ratchetResult.regressions).toBeGreaterThanOrEqual(1);
      expect(ratchetResult.problems?.length).toBeGreaterThan(0);
    });

    it('reports a real problem, not a thrown exception, when coverage-summary.json parses to a JSON array', async () => {
      const { dir, ctx } = await project();
      await writeCoverageSummary(dir, [1, 2, 3]);

      const result = await testCoverage(ctx, {});

      expect(result.coverage).toBe(0);
      expect(result.problems?.length).toBeGreaterThan(0);
    });

    it('tolerates a null per-file entry (excluded, not a thrown exception)', async () => {
      const { dir, ctx } = await project();
      const absoluteFile = path.join(await realpath(dir), 'src/broken.ts');
      await writeCoverageSummary(dir, {
        total: { lines: { total: 100, covered: 80, skipped: 0, pct: 80 } },
        [absoluteFile]: null,
      });

      const result = await testCoverage(ctx, { rule: 'ratchet' });

      // Excluded, not thrown — and with no *other* real file entry, this degrades to the
      // "no real per-file entries" problem too, exercised on its own above.
      expect(result.problems?.length).toBeGreaterThan(0);
    });

    it('reports a real problem, not a thrown exception, when a spec doc under specsRoot is malformed', async () => {
      const { dir, ctx } = await project();
      await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
      await writeFile(
        path.join(dir, 'docs/forge/specs/stories/STORY-001-broken.md'),
        '---\nid: STORY-001\nunterminated front matter',
        'utf8',
      );

      const result = await testCoverage(ctx, { rule: 'acceptance-criteria' });

      expect(result.coverage).toBe(0);
      expect(result.problems?.length).toBeGreaterThan(0);
    });

    it('reports a real problem, forcing regressions >= 1, when the baseline cannot be written back', async () => {
      const { dir, ctx } = await project();
      await writeCoverageSummary(dir, await istanbulSummary(dir, 80));
      await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
      await mkdir(path.join(dir, 'docs/forge/reports/coverage-baseline.json'), { recursive: true });

      const result = await testCoverage(ctx, { rule: 'ratchet' });

      expect(result.regressions).toBeGreaterThanOrEqual(1);
      expect(result.problems?.length).toBeGreaterThan(0);
    });

    it('treats a JSON-array baseline file as unusable, not as a silently-accepted empty baseline', async () => {
      const { dir, ctx } = await project();
      await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
      await writeFile(path.join(dir, 'docs/forge/reports/coverage-baseline.json'), '[]', 'utf8');
      await writeCoverageSummary(dir, await istanbulSummary(dir, 80));

      const result = await testCoverage(ctx, { rule: 'ratchet' });

      expect(result.regressions).toBeGreaterThanOrEqual(1);
      expect(result.problems?.some((p) => p.includes('coverage-baseline.json'))).toBe(true);
    });
  });
});
