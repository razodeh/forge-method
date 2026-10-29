/**
 * `loadExemptions`/`appendExemption`/`applyExemptions`/`describeExemptionProblems` — `specs/22` M15
 * P6, against a real, throwaway project directory.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-8
 * @see PLAN-M15.md P6
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths, type Clock } from '@forge/core';
import { exemptionsFileSchema } from '@forge/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import {
  applyExemptions,
  appendExemption,
  describeExemptionProblems,
  loadExemptions,
  qualifiedTestId,
} from '../../../../src/commands/loop/test/exemptions.ts';
import type { Exemption } from '@forge/schemas';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<{
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-exemptions-'));
  dirs.push(dir);
  return { paths: new ProjectPaths(dir), projectRoot: dir };
}

function fakeClock(now = '2026-09-30T12:00:00.000Z'): Clock {
  return { now: () => now };
}

describe('qualifiedTestId', () => {
  it('joins the story and the test name the identical way discover mode already does', () => {
    expect(qualifiedTestId('STORY-001', 'adds')).toBe('STORY-001: adds');
  });
});

describe('loadExemptions', () => {
  it('reads [] for a project that has never run `forge test exempt`', async () => {
    const { paths } = await freshProject();
    const result = await loadExemptions(paths, 'docs/forge/reports');
    expect(result.exemptions).toEqual([]);
    expect(result.corruptCount).toBe(0);
  });

  it('reads back exactly what appendExemption wrote', async () => {
    const { paths, projectRoot } = await freshProject();
    await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: timing-guard',
        reason: 'a real wall-clock timing guard, never mutation-bindable',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );

    const { exemptions, corruptCount } = await loadExemptions(paths, 'docs/forge/reports');

    expect(corruptCount).toBe(0);
    expect(exemptions).toHaveLength(1);
    expect(exemptions[0]).toMatchObject({
      testId: 'STORY-001: timing-guard',
      reason: 'a real wall-clock timing guard, never mutation-bindable',
      owner: 'alice',
      expiry: '2026-12-01',
    });
    expect(exemptions[0]?.id).toMatch(/^EXEMPT-\d{3}$/);
  });

  it('tolerates a schema-invalid row: the valid sibling survives and the corruption is counted, never silently zeroing the whole read (specs/22 M15 P10, round-2 gauntlet critic)', async () => {
    const { paths } = await freshProject();
    const reportsDir = paths.resolveWithin('docs/forge/reports');
    await mkdir(reportsDir, { recursive: true });
    const seed = {
      type: 'Exemption' as const,
      schemaVersion: 1,
      title: 'Exemption register',
      status: 'active',
      created: '2026-09-30',
      updated: '2026-09-30',
      revision: 1,
      author: 'alice',
      changelog: [],
      exemptions: [
        {
          id: 'EXEMPT-001',
          testId: 'STORY-001: real-test',
          reason: 'a real, valid exemption',
          owner: 'alice',
          expiry: '2026-12-01',
        },
        // Missing `reason`/`expiry` -- schema-invalid.
        { id: 'EXEMPT-002', testId: 'STORY-001: other-test', owner: 'bob' },
      ],
    };
    await writeFile(
      path.join(reportsDir, 'exemptions.md'),
      `---\n${YAML.stringify(seed)}---\n`,
      'utf8',
    );

    const { exemptions, corruptCount } = await loadExemptions(paths, 'docs/forge/reports');

    expect(corruptCount).toBe(1);
    expect(exemptions).toHaveLength(1);
    expect(exemptions[0]?.id).toBe('EXEMPT-001');
  });
});

describe('appendExemption', () => {
  it('allocates sequential ids scoped to the collection file, not the shared project IdAllocator', async () => {
    const { paths, projectRoot } = await freshProject();
    const first = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: a',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );
    const second = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: b',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );

    expect(first).toBe('EXEMPT-001');
    expect(second).toBe('EXEMPT-002');
  });

  /** `withExemptionsLock`'s own lock file, seeded by hand at the exact real path it uses
   * (`.forge/state/exemptions.lock`) so these tests can drive its three reclaim/wait/exhaust branches
   * DETERMINISTICALLY -- never by racing real processes against each other, the only way any of these
   * three branches were exercised before this (round-3 gauntlet critics, both independent reviewers,
   * found all three genuinely untested: a real-process repro proves the mechanism works under SOME
   * timing, never that a specific branch's own logic is correct in isolation, and a probabilistic
   * real-process test can pass on both correct and reverted-to-buggy code alike). */
  function lockFilePath(paths: ProjectPaths): string {
    return paths.resolveState('exemptions.lock');
  }

  it('reclaims a lock naming a real, genuinely dead pid, without waiting out the retry budget', async () => {
    const { paths, projectRoot } = await freshProject();
    const child = spawn('node', ['-e', 'process.exit(0)']);
    const deadPid = child.pid;
    expect(deadPid).toBeDefined();
    await new Promise((resolve) => child.on('exit', resolve));

    await mkdir(path.dirname(lockFilePath(paths)), { recursive: true });
    await writeFile(lockFilePath(paths), String(deadPid), 'utf8');

    const start = Date.now();
    const id = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: a',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );
    // Reclaimed near-instantly (well under the ~5s full retry budget), not merely "eventually" --
    // proves the dead-pid branch fires on its own first check, not as a side effect of some other
    // path's own timeout.
    expect(Date.now() - start).toBeLessThan(1000);
    expect(id).toBe('EXEMPT-001');
  });

  it('does NOT reclaim a lock naming a real, currently-alive pid (this process itself)', async () => {
    const { paths, projectRoot } = await freshProject();
    await mkdir(path.dirname(lockFilePath(paths)), { recursive: true });
    await writeFile(lockFilePath(paths), String(process.pid), 'utf8');

    // This process's own pid is, definitionally, always alive -- so the lock can never legitimately
    // clear itself. The correct, honest behaviour is to exhaust the retry budget and refuse via the
    // typed GATE-515 'lock-exhausted' reason, never a bare Error and never a silent, incorrect
    // reclaim-and-proceed. `20_000`, not this test's own isolated ~5s nominal margin (round 4,
    // correcting round 3): round 3 reverted this to `15_000`, reasoning that restoring
    // `collection-lock.ts`'s own global default to `200`/5s (see `DEFAULT_MAX_LOCK_ATTEMPTS`'s own
    // doc comment) restored the original margin too -- verified only against an isolated rerun and
    // the hand-picked 4-file acceptance command, neither of which is this repo's REAL CI gate. That
    // gate (`.github/workflows/ci.yml`'s `floor` job's full-workspace `pnpm test`, and the `seed`
    // job's own two full-suite runs under `--sequence.shuffle`) runs every test file in one shared
    // fork pool (`vitest.config.ts` deliberately has no per-package config, no `projects` array) --
    // so this test's own nominal ~5s exhaustion runs concurrently, in that SAME pool, with
    // `kb-disclosures.test.ts`'s own 28-worker combined-suite stress test (added M17 round 1,
    // `918bbca`) -- structurally the identical cross-test scheduling-contention shape that already
    // broke that file's own original 5s margin once (round 1's own diagnosis). A wider test timeout
    // costs nothing in production (unlike the attempt-budget constant, correctly left at its
    // restored `200`/5s production default) -- `20s` is a defensively wide test-side margin against
    // real cross-suite contention under that gate, not a claim that this test's own isolated nominal
    // time changed.
    await expect(
      appendExemption(
        paths,
        'docs/forge/reports',
        fakeClock(),
        {
          testId: 'STORY-001: a',
          reason: 'r',
          owner: 'alice',
          expiry: '2026-12-01',
        },
        { projectRoot, runId: undefined },
      ),
    ).rejects.toMatchObject({ code: 'GATE-515' });
  }, 20_000);

  it('does not reclaim a RECENT empty/unwritten lock file -- waits, then exhausts via GATE-515 lock-exhausted, never a silent reclaim-too-early', async () => {
    const { paths, projectRoot } = await freshProject();
    await mkdir(path.dirname(lockFilePath(paths)), { recursive: true });
    // Empty content: the real, ordinary shape of another process's own `writeFileSync(path, pid, {
    // flag: 'wx' })` call that has created the file but has not (yet) had its content observed by
    // this read -- see `withExemptionsLock`'s own doc comment for the full "ambiguous, not
    // unambiguously stale" reasoning this test exists to pin.
    await writeFile(lockFilePath(paths), '', 'utf8');

    // A clock frozen at the file's own real creation instant: age never advances past
    // `STALE_EMPTY_LOCK_MS`, so the age-gate must never reclaim -- the call can only ever resolve by
    // exhausting its retry budget, never by a premature, incorrect reclaim-and-proceed.
    const frozenNow = new Date().toISOString();
    await expect(
      appendExemption(
        paths,
        'docs/forge/reports',
        fakeClock(frozenNow),
        {
          testId: 'STORY-001: a',
          reason: 'r',
          owner: 'alice',
          expiry: '2026-12-01',
        },
        { projectRoot, runId: undefined },
      ),
    ).rejects.toMatchObject({ code: 'GATE-515' });
    // The empty lock file itself must still be there -- a correct "waited, then gave up" outcome
    // never deletes a lock it could not prove was actually its own to clear.
    const remaining = await readFile(lockFilePath(paths), 'utf8');
    expect(remaining).toBe('');
    // `20_000` -- see the identical note on the test just above (real full-workspace CI gate,
    // not just this file's own isolated timing, is what sets this margin).
  }, 20_000);

  it('reclaims an OLD empty/unwritten lock file once it is older than STALE_EMPTY_LOCK_MS', async () => {
    const { paths, projectRoot } = await freshProject();
    await mkdir(path.dirname(lockFilePath(paths)), { recursive: true });
    await writeFile(lockFilePath(paths), '', 'utf8');

    // A clock reading far enough past the file's own real creation instant that the age-gate's own
    // threshold has elapsed -- the inverse of the "recent, must not reclaim" test above, proving the
    // SAME mechanism correctly reclaims once it genuinely is old enough, not merely that it always
    // waits.
    const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const start = Date.now();
    const id = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(farFuture),
      {
        testId: 'STORY-001: a',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );
    expect(Date.now() - start).toBeLessThan(1000);
    expect(id).toBe('EXEMPT-001');
  });

  it('ten concurrent in-process appends never collide on the same id', async () => {
    // In-process only: every call here shares one Node process, so this exercises
    // `withExemptionsLock`'s own serialization but says nothing about the REAL risk -- two separate
    // OS processes racing the same file. This file's own "real cross-process concurrency" describe
    // block below (real, separate `node` processes, released together via a shared gate file) is what
    // actually proves that; this test stays because an in-process regression (e.g. a lock that only
    // serializes some call shapes) is still worth catching cheaply, without the subprocess cost.
    const { paths, projectRoot } = await freshProject();
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        appendExemption(
          paths,
          'docs/forge/reports',
          fakeClock(),
          {
            testId: `STORY-001: test-${String(index)}`,
            reason: 'r',
            owner: 'alice',
            expiry: '2026-12-01',
          },
          { projectRoot, runId: undefined },
        ),
      ),
    );

    expect(new Set(ids).size).toBe(10);
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(10);
  });

  it('refuses once idWidth digits are full (GATE-515 id-exhausted), rather than silently wrapping or colliding', async () => {
    // Seeds 999 entries by writing the fixture directly (not via 999 real `appendExemption` calls,
    // each its own lock-acquire + full read-modify-write -- correct but needlessly slow for a fixture
    // this function's own real work never has to build) -- only the real 1000th call under test goes
    // through `appendExemption` itself.
    const { paths, projectRoot } = await freshProject();
    const reportsDir = paths.resolveWithin('docs/forge/reports');
    await mkdir(reportsDir, { recursive: true });
    const exemptions = Array.from({ length: 999 }, (_unused, index) => ({
      id: `EXEMPT-${String(index + 1).padStart(3, '0')}`,
      testId: `STORY-001: test-${String(index + 1)}`,
      reason: 'r',
      owner: 'alice',
      expiry: '2026-12-01',
    }));
    const seed = {
      type: 'Exemption' as const,
      schemaVersion: 1,
      title: 'Exemption register',
      status: 'active',
      created: '2026-09-30',
      updated: '2026-09-30',
      revision: 1,
      author: 'alice',
      changelog: [],
      exemptions,
    };
    expect(exemptionsFileSchema.safeParse(seed).success).toBe(true);
    await writeFile(
      path.join(reportsDir, 'exemptions.md'),
      `---\n${YAML.stringify(seed)}---\n`,
      'utf8',
    );
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(999);

    await expect(
      appendExemption(
        paths,
        'docs/forge/reports',
        fakeClock(),
        {
          testId: 'STORY-001: test-1000',
          reason: 'r',
          owner: 'alice',
          expiry: '2026-12-01',
        },
        { projectRoot, runId: undefined },
      ),
    ).rejects.toMatchObject({ code: 'GATE-515' });
    // Refused, not a corrupting partial write: the 999 already-recorded entries are untouched.
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(999);
  });

  it('writes a real, schema-valid ExemptionsFile document', async () => {
    const { paths, projectRoot } = await freshProject();
    await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: a',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );

    const text = await readFile(paths.resolveWithin('docs/forge/reports/exemptions.md'), 'utf8');
    const frontMatterText = text.split('---\n')[1] ?? '';
    const YAML = await import('yaml');
    const parsed = exemptionsFileSchema.safeParse(YAML.parse(frontMatterText));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});

// `specs/22` M15 P11 metric 4a: "exemptions opened" -- real telemetry, real `appendEvent`, against the
// real event log (never the `ctx.telemetry` facade: this is CLI-layer code, with no `ExecuteStepContext`
// of its own, the identical reason `gate-commands.ts`'s own `emitGateEvent` calls `appendEvent` directly).
describe('appendExemption telemetry (specs/22 M15 P11)', () => {
  it('emits a CheckRun {kind: "exemption-declared"} event when a real FORGE_RUN_ID is in progress', async () => {
    const { paths, projectRoot } = await freshProject();
    const id = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      { testId: 'STORY-001: a', reason: 'r', owner: 'alice', expiry: '2026-12-01' },
      { projectRoot, runId: 'run-exempt' },
    );

    const { readEvents } = await import('@forge/telemetry/events');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-exempt')) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'CheckRun',
      runId: 'run-exempt',
      payload: {
        kind: 'exemption-declared',
        exemptionId: id,
        testId: 'STORY-001: a',
        owner: 'alice',
        expiry: '2026-12-01',
      },
    });
  });

  it('emits nothing at all for a standalone invocation with no real FORGE_RUN_ID -- there is no event log to write into', async () => {
    const { paths, projectRoot } = await freshProject();
    await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      { testId: 'STORY-001: a', reason: 'r', owner: 'alice', expiry: '2026-12-01' },
      { projectRoot, runId: undefined },
    );

    const { pathExists } = await import('@forge/core/fs');
    // No run directory was ever created for this project at all -- not merely an empty one.
    expect(await pathExists(paths.resolveState('runs'))).toBe(false);
  });

  // Mutation evidence: a refused declaration (GATE-515 id-exhausted here) must not leave a phantom
  // "exemption-declared" event for an exemption that was never actually durable.
  it('emits nothing when the declaration itself is refused (GATE-515 id-exhausted)', async () => {
    const { paths, projectRoot } = await freshProject();
    const reportsDir = paths.resolveWithin('docs/forge/reports');
    await mkdir(reportsDir, { recursive: true });
    const exemptions999 = Array.from({ length: 999 }, (_unused, index) => ({
      id: `EXEMPT-${String(index + 1).padStart(3, '0')}`,
      testId: `STORY-001: test-${String(index + 1)}`,
      reason: 'r',
      owner: 'alice',
      expiry: '2026-12-01',
    }));
    const seed = {
      type: 'Exemption' as const,
      schemaVersion: 1,
      title: 'Exemption register',
      status: 'active',
      created: '2026-09-30',
      updated: '2026-09-30',
      revision: 1,
      author: 'alice',
      changelog: [],
      exemptions: exemptions999,
    };
    await writeFile(
      path.join(reportsDir, 'exemptions.md'),
      `---\n${YAML.stringify(seed)}---\n`,
      'utf8',
    );

    await expect(
      appendExemption(
        paths,
        'docs/forge/reports',
        fakeClock(),
        { testId: 'STORY-001: test-1000', reason: 'r', owner: 'alice', expiry: '2026-12-01' },
        { projectRoot, runId: 'run-refused' },
      ),
    ).rejects.toMatchObject({ code: 'GATE-515' });

    const { readEvents } = await import('@forge/telemetry/events');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-refused')) events.push(event);
    expect(events).toEqual([]);
  });
});

function exemption(overrides: Partial<Exemption> = {}): Exemption {
  return {
    id: 'EXEMPT-001',
    testId: 'STORY-001: timing-guard',
    reason: 'r',
    owner: 'alice',
    expiry: '2026-12-01',
    ...overrides,
  };
}

describe('applyExemptions', () => {
  it('suppresses exactly one matching, valid exemption and no other', () => {
    const result = applyExemptions(
      'STORY-001',
      ['timing-guard', 'adds'],
      [exemption()],
      '2026-09-30',
    );
    expect(result.nonBinding).toEqual(['adds']);
    expect(result.staleExemptions).toEqual([]);
    expect(result.expiredExemptions).toEqual([]);
  });

  it('a stale exemption (its own testId matches nothing in rawNonBinding) suppresses nothing, and is named', () => {
    const result = applyExemptions('STORY-001', ['adds'], [exemption()], '2026-09-30');
    expect(result.nonBinding).toEqual(['adds']);
    expect(result.staleExemptions).toEqual([exemption()]);
    expect(result.expiredExemptions).toEqual([]);
  });

  it('an expired exemption suppresses nothing, even though its testId matches, and is named', () => {
    const result = applyExemptions(
      'STORY-001',
      ['timing-guard'],
      [exemption({ expiry: '2026-01-01' })],
      '2026-09-30',
    );
    expect(result.nonBinding).toEqual(['timing-guard']);
    expect(result.expiredExemptions).toEqual([exemption({ expiry: '2026-01-01' })]);
    expect(result.staleExemptions).toEqual([]);
  });

  it('an exemption expiring on exactly today is already expired, not still valid for one more day', () => {
    const result = applyExemptions(
      'STORY-001',
      ['timing-guard'],
      [exemption({ expiry: '2026-09-30' })],
      '2026-09-30',
    );
    expect(result.nonBinding).toEqual(['timing-guard']);
    expect(result.expiredExemptions).toHaveLength(1);
  });

  it("never matches a different story's own exemption, even for the identical bare test name", () => {
    const result = applyExemptions(
      'STORY-002',
      ['timing-guard'],
      [exemption({ testId: 'STORY-001: timing-guard' })],
      '2026-09-30',
    );
    expect(result.nonBinding).toEqual(['timing-guard']);
    expect(result.staleExemptions).toEqual([]);
    expect(result.expiredExemptions).toEqual([]);
  });
});

describe('describeExemptionProblems', () => {
  it('names a stale exemption by its own testId and id', () => {
    const problems = describeExemptionProblems({
      nonBinding: [],
      staleExemptions: [exemption()],
      expiredExemptions: [],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('STORY-001: timing-guard');
    expect(problems[0]).toContain('EXEMPT-001');
    expect(problems[0]).toContain('stale');
  });

  it('names an expired exemption by its own testId, id, owner and expiry', () => {
    const problems = describeExemptionProblems({
      nonBinding: [],
      staleExemptions: [],
      expiredExemptions: [exemption({ expiry: '2026-01-01' })],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('STORY-001: timing-guard');
    expect(problems[0]).toContain('alice');
    expect(problems[0]).toContain('2026-01-01');
  });

  it('is empty when nothing is stale or expired', () => {
    expect(
      describeExemptionProblems({ nonBinding: [], staleExemptions: [], expiredExemptions: [] }),
    ).toEqual([]);
  });
});
