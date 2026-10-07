/**
 * `runParityCheck` — `forge parity check`'s own orchestration (`specs/22` M16 P7, `13` F-TEST-9,
 * `process/SPEC-QUESTIONS.md` Q294 Decisions 3-5). Ties together P2's selection, P3's observation
 * (`side: 'candidate'`), P4's comparison and counting, P5's `ParityEvidence` schema and this piece's
 * own new trust anchor — every primitive reused, never reimplemented, except the orchestration
 * itself and the brand-new trust-anchor comparison. Real temporary git repositories and real
 * subprocess fixtures throughout; no mock of the engine's own observation, comparison or capture
 * primitives (`QUALITY-BAR.md` R6).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P7
 * @see process/SPEC-QUESTIONS.md Q294
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { documentProblems } from '@forge/engine/dispatch';
import { definitionForType } from '@forge/schemas';
import { evaluateGate, type CheckRunner, type GateDefinition } from '@forge/engine/gates';
import { pathExists, ProjectPaths } from '@forge/core/fs';
import { readEvents } from '@forge/telemetry/events';
import { SYSTEM_CLOCK } from '@forge/core';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runParityCapture,
  type RunParityCaptureOptions,
} from '../../../src/commands/parity/capture-command.ts';
import {
  parityCheckExitCode,
  runParityCheck,
  type RunParityCheckOptions,
} from '../../../src/commands/parity/check-command.ts';
import { emitParityCheckTelemetry } from '../../../src/commands/parity/check-telemetry.ts';

const PARITY_EVIDENCE_TYPE = definitionForType('ParityEvidence');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** `.forge/state/` is gitignored in every real FORGE project (Q294 Decision 7: "the `.forge/state/`
 * of the tree a capture runs in (gitignored, `18` §18.2)"); this fixture matches that so the
 * "working tree touched" tests below see the same thing a real project's own `git status` would
 * (never the shared id allocator's own `.forge/state/ids.json` cache, which every evidence-writing
 * verb in this codebase, not only this one, touches as a matter of course). */
const STABLE_BODY = `process.stdout.write('ok');\n`;

/** The initial commit already carries a stable `behavior.cjs` (see this module's own
 * `FIXED_RUN`/{@link writeBehavior} doc comment): every declaration's own `reference.ref` defaults
 * to `HEAD` AT THE TIME `writeDeclaration` is called, so `behavior.cjs` must already be committed
 * before any declaration is written, or the reference-side scratch worktree observes a tree with no
 * such file at all (a real defect this piece's own report discloses it hit and fixed: an earlier
 * version of this fixture wrote `behavior.cjs` AFTER `freshProject`'s own initial commit but BEFORE
 * `writeDeclaration`, within the same test, which still raced the same way whenever a test forgot to
 * commit it first). Baking a stable default into `freshProject` itself removes the ordering hazard
 * for every test, which only ever needs to REWRITE `behavior.cjs` afterwards (uncommitted) to vary
 * what the CANDIDATE does. */
async function freshProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p7-check-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
  await writeFile(path.join(dir, '.gitkeep'), '', 'utf8');
  await writeFile(path.join(dir, 'behavior.cjs'), STABLE_BODY, 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

async function commitAll(dir: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

async function headSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

/**
 * The declaration's own `run` never changes between a test's `writeDeclaration` calls (it is part of
 * the declaration digest `selectCapture`'s key covers, `Q294` Decision 6): every scenario below that
 * needs the CANDIDATE to behave differently than the captured reference does so by rewriting
 * `behavior.cjs`'s own content with {@link writeBehavior}, the identical "the declaration's `run`
 * stays fixed; an external file's content is what the test varies" pattern
 * `capture-command.test.ts`'s own `MARKER_RUN`/`marker.txt` already establishes — a first version of
 * this file instead varied the declaration's own `run` directly between a capture and a check, which
 * changes the digest and makes `selectCapture` read `missing` rather than exercising the comparison
 * at all (caught by this piece's own tests going red for the wrong reason; see this piece's report).
 */
const FIXED_RUN = `node behavior.cjs`;

async function writeBehavior(dir: string, body: string): Promise<void> {
  await writeFile(path.join(dir, 'behavior.cjs'), body, 'utf8');
}

const CHANGED_BODY = `process.stdout.write('changed');\n`;
const UNSTABLE_BODY = `process.stdout.write(String(Math.random()));\n`;
const UNCLEAN_BODY = `require('fs').writeFileSync('stray.txt', 'x');\nprocess.stdout.write('ok');\n`;
const TIMEOUT_BODY = `setTimeout(() => {}, 100000);\n`;
const MARKER_BODY = `require('fs').writeFileSync('ran.marker', '1');\nprocess.stdout.write('rewritten');\n`;

async function writeDeclaration(
  dir: string,
  name: string,
  options: {
    readonly ref?: string;
    readonly expires?: string;
    readonly stabilityRuns?: number;
    readonly timeoutMs?: number;
    readonly reviewBlock?: string;
  } = {},
): Promise<void> {
  const ref = options.ref ?? (await headSha(dir));
  const expires = options.expires ?? '2999-01-01';
  const stabilityRuns = options.stabilityRuns ?? 2;
  const review =
    options.reviewBlock ??
    'review:\n  by: tester\n  basis: read the diff by hand\n  at: 2026-01-01\n';
  const caseBody =
    options.timeoutMs === undefined ? '{}' : `timeoutMs: ${String(options.timeoutMs)}`;
  const yaml = `name: ${name}
reference:
  ref: ${ref}
${review}expires: ${expires}
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: ${String(stabilityRuns)}
    cases:
      - ${caseBody}
`;
  await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
  await writeFile(path.join(dir, '.forge/parity', `${name}.parity.yaml`), yaml, 'utf8');
}

function captureOptions(dir: string, overrides: Partial<RunParityCaptureOptions> = {}) {
  return {
    projectRoot: dir,
    parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
    ...overrides,
  } satisfies RunParityCaptureOptions;
}

function checkOptions(dir: string, overrides: Partial<RunParityCheckOptions> = {}) {
  return {
    projectRoot: dir,
    parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
    reportsRoot: 'docs/forge/reports',
    ...overrides,
  } satisfies RunParityCheckOptions;
}

async function evidenceFiles(dir: string): Promise<readonly string[]> {
  try {
    return (await readdir(path.join(dir, 'docs/forge/reports/parity'))).sort();
  } catch {
    return [];
  }
}

describe('runParityCheck: a candidate that matches its capture exits clean (specs/22 M16 P7)', () => {
  it('reads match, failing 0, passing 1, and exits 0', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));

    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('match');
    expect(result.failing).toBe(0);
    expect(result.passing).toBe(1);
    expect(result.declarations).toEqual([
      { name: 'sample', verdict: 'match', passing: 1, failing: 0 },
    ]);
    expect(parityCheckExitCode(result)).toBe(0);
  });
});

describe('runParityCheck: a changed candidate exits failing, naming the surface, case and stream, never the text (specs/22 M16 P7)', () => {
  it('reads mismatch and exits 1, with no field anywhere carrying the differing output', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    // The DECLARATION (and so its digest) is untouched; only the candidate's own behaviour changes.
    await writeBehavior(dir, CHANGED_BODY);

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));

    expect(result.verdict).toBe('mismatch');
    expect(result.failing).toBe(1);
    expect(result.passing).toBe(0);
    expect(parityCheckExitCode(result)).toBe(1);
    const declaration = result.declarations[0];
    expect(declaration?.verdict).toBe('mismatch');
    expect(declaration?.reason).toMatch(/process/);
    expect(declaration?.reason).toMatch(/stdout/);
    // Neither side's observed text reaches the result anywhere: the TYPE itself has no field that
    // could hold it (`compare.ts`'s own `CaseComparisonResult` carries only a structural `location`,
    // never content, the identical "enforced at the type level" guarantee this module's own
    // `RunParityCheckDeclarationResult` inherits by construction, never by caller discipline).
    // "changed" (the candidate's own new text) is checked directly; the reference's original "ok" is
    // not re-checked the same way, since the literal substring "ok" also matches the envelope's own
    // structural `"ok":true` field and would be a false positive.
    expect(JSON.stringify(result)).not.toContain('changed');
  });
});

describe('runParityCheck: refusals (specs/22 M16 P7)', () => {
  it('refuses a --name that matches no declaration', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');

    await expect(
      runParityCheck(checkOptions(dir, { name: 'does-not-exist', noRecord: true })),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^RUN-\d{3}$/) as unknown as string });
  });

  it('refuses a --trusted that is not a full commit sha or an accepted refs/ name', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');

    await expect(
      runParityCheck(checkOptions(dir, { trusted: 'main', noRecord: true })),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^RUN-\d{3}$/) as unknown as string });
  });

  it('refuses a --trusted that is well-formed but does not resolve', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');

    await expect(
      runParityCheck(checkOptions(dir, { trusted: 'refs/heads/no-such-branch', noRecord: true })),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^RUN-\d{3}$/) as unknown as string });
  });
});

describe('runParityCheck: zero declarations is one failing with reason no-declarations, never a pass (specs/22 M16 P7)', () => {
  it('reads {verdict: invalid, reason: no-declarations, passing: 0, failing: 1} and exits 1', async () => {
    const dir = await freshProject();
    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result).toMatchObject({
      ok: true,
      verdict: 'invalid',
      reason: 'no-declarations',
      passing: 0,
      failing: 1,
      declarations: [],
    });
    expect(parityCheckExitCode(result)).toBe(1);
  });
});

describe('runParityCheck: the seven non-match, non-stop verdicts F-TEST-9 names are each independently reachable (specs/22 M16 P7)', () => {
  it('missing: a declaration with no capture at all, naming the platform it looked for', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    // Never captured.
    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('missing');
    expect(result.declarations[0]?.verdict).toBe('missing');
    expect(result.declarations[0]?.reason).toMatch(
      new RegExp(`${process.platform}-${process.arch}`),
    );
    expect(parityCheckExitCode(result)).toBe(1);
  });

  it('ambiguous: two differing captures share one selection key', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    const first = await runParityCapture(captureOptions(dir));
    const firstFile = first.captures[0]?.file ?? '';
    const firstPath = path.join(dir, '.forge/parity/captures', firstFile);
    const firstBytes = await readFile(firstPath, 'utf8');
    // A second, hand-crafted capture under the identical key, differing only in its own stored
    // observation -- the real way `ambiguous` arises (two humans, or a merge, leave two captures).
    interface MinimalCapture {
      readonly cases: { readonly observation: { stdout?: string } }[];
    }
    const mutated = JSON.parse(firstBytes) as MinimalCapture;
    const mutatedCase = mutated.cases[0];
    if (mutatedCase !== undefined) mutatedCase.observation.stdout = 'different';
    const mutatedBytes = JSON.stringify(mutated);
    const crypto = await import('node:crypto');
    const mutatedName = `${crypto.createHash('sha256').update(mutatedBytes).digest('hex')}.json`;
    await writeFile(path.join(dir, '.forge/parity/captures', mutatedName), mutatedBytes, 'utf8');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('ambiguous');
    expect(result.declarations[0]?.verdict).toBe('ambiguous');
    expect(parityCheckExitCode(result)).toBe(1);
  });

  it('unstable: the candidate disagrees with itself across its own stability runs', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    await writeBehavior(dir, UNSTABLE_BODY);

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('unstable');
    expect(result.declarations[0]?.verdict).toBe('unstable');
    expect(parityCheckExitCode(result)).toBe(1);
  });

  it('expired: the declaration\'s own "expires" date has already been reached', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample', { expires: '2020-01-01' });
    await commitAll(dir, 'declare');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('expired');
    expect(result.declarations[0]?.verdict).toBe('expired');
    expect(parityCheckExitCode(result)).toBe(1);
  });

  it('invalid: a structurally broken declaration (no "review" block)', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample', { reviewBlock: '' });
    await commitAll(dir, 'declare');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('invalid');
    expect(result.declarations[0]?.verdict).toBe('invalid');
    expect(parityCheckExitCode(result)).toBe(1);
  });

  it('unclean: observing the candidate leaves an extra file on disk', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    await writeBehavior(dir, UNCLEAN_BODY);

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('unclean');
    expect(result.declarations[0]?.verdict).toBe('unclean');
    expect(parityCheckExitCode(result)).toBe(1);
    await rm(path.join(dir, 'stray.txt'), { force: true });
  });

  it('error: a case that exceeds its own timeoutMs', async () => {
    const dir = await freshProject();
    // `timeoutMs` IS part of the digest, so it is set from the very first write -- captured against
    // a FAST script well inside the limit, then the candidate's own script (never the declaration)
    // is rewritten to one that hangs past the identical, unchanged 200ms limit.
    await writeDeclaration(dir, 'sample', { timeoutMs: 200 });
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    await writeBehavior(dir, TIMEOUT_BODY);

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('error');
    expect(result.declarations[0]?.verdict).toBe('error');
    expect(parityCheckExitCode(result)).toBe(1);
  }, 15000);
});

describe('runParityCheck: the trust anchor, checked before any declaration runs (specs/22 M16 P7)', () => {
  it('a rewritten .forge/parity/ reads oracle-changed for every declaration, naming the differing path, and observes nothing', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    // The capture file itself is committed too, so "main" starts genuinely clean under the anchor's
    // own comparison (an uncommitted, just-written capture would already read as its own "added"
    // difference, confounding this test's real point).
    await commitAll(dir, 'capture');

    // Simulate an agent rewriting the oracle: edit the DECLARATION file, uncommitted, after the
    // trusted commit -- exactly the scenario the anchor exists to catch. The candidate's own script
    // is ALSO rewritten, to a version that would prove it ran if the short-circuit failed to work.
    await writeDeclaration(dir, 'sample', {
      reviewBlock: 'review:\n  by: an-agent\n  basis: self-authored\n  at: 2026-01-01\n',
    });
    await writeBehavior(dir, MARKER_BODY);

    const result = await runParityCheck(
      checkOptions(dir, { trusted: 'refs/heads/main', noRecord: true }),
    );
    expect(result.verdict).toBe('invalid');
    expect(result.reason).toMatch(/^oracle-changed:/);
    expect(result.reason).toMatch(/sample\.parity\.yaml/);
    expect(result.declarations[0]?.verdict).toBe('invalid');
    expect(result.declarations[0]?.reason).toMatch(/^oracle-changed:/);
    await expect(readFile(path.join(dir, 'ran.marker'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    }); // the rewritten (oracle-changed) command never ran
  });

  it('with --trusted omitted, no comparison is made and an otherwise-matching candidate still passes', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('match');
  });
});

describe('runParityCheck: the ParityEvidence record (specs/22 M16 P7)', () => {
  it('writes exactly one schema-valid record per invocation, and its id is in the envelope', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    const result = await runParityCheck(checkOptions(dir));

    expect(result.evidenceId).toMatch(/^PAR-\d{3}$/);
    const files = await evidenceFiles(dir);
    expect(files).toHaveLength(1);
    const text = await readFile(
      path.join(dir, 'docs/forge/reports/parity', files[0] ?? ''),
      'utf8',
    );
    const problems = documentProblems(
      PARITY_EVIDENCE_TYPE,
      `reports/parity/${files[0] ?? ''}`,
      text,
    ).problems;
    expect(problems).toEqual([]);
    expect(text).toContain(`id: ${String(result.evidenceId)}`);
    expect(text).toMatch(/verdict: match/);
  });

  it('--no-record writes no file and the envelope carries a null evidence id', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));

    expect(result.evidenceId).toBeNull();
    expect(await evidenceFiles(dir)).toEqual([]);
  });

  it("--story <id> names the record's own story", async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    await runParityCheck(checkOptions(dir, { story: 'STORY-014' }));

    const files = await evidenceFiles(dir);
    const text = await readFile(
      path.join(dir, 'docs/forge/reports/parity', files[0] ?? ''),
      'utf8',
    );
    expect(text).toMatch(/story: STORY-014/);
  });

  it('the check never modifies the working tree beyond its own evidence file', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    await commitAll(dir, 'capture');

    await runParityCheck(checkOptions(dir, { noRecord: true }));
    // `--untracked-files=all` (not git's own default, which collapses a wholly-new DIRECTORY to one
    // line) so a second new file under an already-new directory is still visible on its own line.
    const status = await execa('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: dir,
    });
    expect(status.stdout.trim()).toBe('');

    const result = await runParityCheck(checkOptions(dir));
    const statusAfterRecord = await execa(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      { cwd: dir },
    );
    const untrackedLines = statusAfterRecord.stdout
      .trim()
      .split('\n')
      .filter((l) => l !== '');
    expect(untrackedLines).toHaveLength(1);
    expect(untrackedLines[0]).toContain(String(result.evidenceId));
  });
});

describe('runParityCheck: telemetry CheckRun{kind:"parity"} (specs/22 M16 P15)', () => {
  async function readParityCheckRuns(
    dir: string,
    runId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    const events = [];
    for await (const event of readEvents(dir, runId)) events.push(event);
    return events
      .filter((event) => event.type === 'CheckRun')
      .map((event) => event.payload as Record<string, unknown>)
      .filter((payload) => payload['kind'] === 'parity');
  }

  it('with FORGE_RUN_ID (runId) set, a real check appends exactly one CheckRun{kind:"parity"} event with the expected counts and no observed content', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    await writeBehavior(dir, CHANGED_BODY);

    const result = await runParityCheck(checkOptions(dir, { runId: 'run-parity-telemetry' }));
    expect(result.verdict).toBe('mismatch');

    const parityRuns = await readParityCheckRuns(dir, 'run-parity-telemetry');
    expect(parityRuns).toHaveLength(1);
    expect(parityRuns[0]).toEqual({
      kind: 'parity',
      total: 1,
      verdictCounts: {
        invalid: 0,
        expired: 0,
        missing: 0,
        ambiguous: 0,
        error: 0,
        unclean: 0,
        unstable: 0,
        mismatch: 1,
        match: 0,
      },
      evidenceId: result.evidenceId,
      declarationNames: ['sample'],
    });
    // Never an observation: the candidate's own changed output text appears NOWHERE in the event.
    expect(JSON.stringify(parityRuns[0])).not.toContain('changed');
  });

  it('with no runId at all (the ordinary, standalone human invocation): no run directory is ever created', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    await runParityCheck(checkOptions(dir, { noRecord: true }));

    expect(await pathExists(new ProjectPaths(dir).resolveState('runs'))).toBe(false);
  });

  it('--no-record: the event ALSO carries evidenceId: null, matching the envelope', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    const result = await runParityCheck(
      checkOptions(dir, { runId: 'run-parity-no-record', noRecord: true }),
    );
    expect(result.evidenceId).toBeNull();

    const parityRuns = await readParityCheckRuns(dir, 'run-parity-no-record');
    expect(parityRuns).toHaveLength(1);
    expect(parityRuns[0]?.['evidenceId']).toBeNull();
  });

  it('a real evidenceId (no --no-record) appears in the event, matching the envelope and the written record', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    const result = await runParityCheck(checkOptions(dir, { runId: 'run-parity-evidence' }));
    expect(result.evidenceId).toMatch(/^PAR-\d{3}$/);

    const parityRuns = await readParityCheckRuns(dir, 'run-parity-evidence');
    expect(parityRuns[0]?.['evidenceId']).toBe(result.evidenceId);
  });

  it('multiple declarations in one invocation are tallied together, never a second event', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample-a');
    await writeDeclaration(dir, 'sample-b');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    const result = await runParityCheck(checkOptions(dir, { runId: 'run-parity-multi' }));
    expect(result.verdict).toBe('match');
    expect(result.declarations).toHaveLength(2);

    const parityRuns = await readParityCheckRuns(dir, 'run-parity-multi');
    expect(parityRuns).toHaveLength(1);
    expect(parityRuns[0]).toMatchObject({
      total: 2,
      verdictCounts: expect.objectContaining({ match: 2 }) as unknown,
      declarationNames: ['sample-a', 'sample-b'],
    });
  });

  it('zero declarations (a real "no-declarations" occurrence) still emits one real event, never a non-event', async () => {
    // `freshProject` itself already commits a clean tree with no `.forge/parity/` at all -- nothing
    // further to declare or commit for this one.
    const dir = await freshProject();

    const result = await runParityCheck(checkOptions(dir, { runId: 'run-parity-empty' }));
    expect(result.reason).toBe('no-declarations');

    const parityRuns = await readParityCheckRuns(dir, 'run-parity-empty');
    expect(parityRuns).toHaveLength(1);
    expect(parityRuns[0]).toMatchObject({ total: 0, declarationNames: [] });
  });

  // Round-2 gauntlet fix (specs/22 M16 P15): this test's own title previously claimed "the identical
  // property check-telemetry.ts already proves for the binding payload" -- false. Two independent
  // critics confirmed the ONLY redaction test at this call-site layer was this one, for the NEW parity
  // emitter's `declarationNames` field; `emitBindingCheckTelemetry`'s own payload had no direct-call
  // redaction test anywhere in this suite before this fix (grep confirmed: no test file imported it).
  // Both critics confirmed, via their own direct calls to the real emitter, that redaction mechanically
  // DOES work correctly for the binding case too (not a live security bug, just a missing proof) -- see
  // `packages/cli/test/commands/loop/test/check-telemetry.test.ts`'s own new test, added by this fix,
  // for that proof.
  it('a secret-shaped declaration name is redacted at write time (the mechanism this parity emitter itself uses; see check-telemetry.test.ts for the equivalent, previously-missing binding-emitter proof)', async () => {
    const dir = await freshProject();
    const secret = `ghp_${'a'.repeat(36)}`;

    await emitParityCheckTelemetry({
      projectRoot: dir,
      runId: 'run-parity-redaction',
      clock: SYSTEM_CLOCK,
      total: 1,
      verdictCounts: {
        invalid: 0,
        expired: 0,
        missing: 0,
        ambiguous: 0,
        error: 0,
        unclean: 0,
        unstable: 0,
        mismatch: 0,
        match: 1,
      },
      evidenceId: 'PAR-001',
      declarationNames: [secret],
    });

    const parityRuns = await readParityCheckRuns(dir, 'run-parity-redaction');
    expect(parityRuns).toHaveLength(1);
    const names = parityRuns[0]?.['declarationNames'] as readonly string[];
    expect(names[0]).not.toContain(secret);
    expect(names[0]).toContain('[REDACTED]');
  });
});

describe('runParityCheck: the envelope passes a real evaluateGate with failOn "failing > 0" (specs/22 M16 P7)', () => {
  it('a matching candidate passes the gate; a mismatching one fails it', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    const gate: GateDefinition = {
      id: 'G-Parity',
      checks: {
        deterministic: [
          {
            id: 'behavior:parity',
            run: 'parity-check',
            parser: 'forge-json',
            failOn: 'failing > 0',
          },
        ],
        advisory: [],
      },
      openQuestionsPolicy: 'block',
    };
    const runner: CheckRunner = async () => {
      const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
      return { stdout: JSON.stringify({ v: 1, ...result }), exitCode: parityCheckExitCode(result) };
    };
    const passing = await evaluateGate(gate, dir, runner);
    expect(passing.passed).toBe(true);

    await writeBehavior(dir, CHANGED_BODY);
    const failing = await evaluateGate(gate, dir, runner);
    expect(failing.passed).toBe(false);
  });
});

async function writeRawDeclaration(dir: string, name: string, yaml: string): Promise<void> {
  await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
  await writeFile(path.join(dir, '.forge/parity', `${name}.parity.yaml`), yaml, 'utf8');
}

describe('runParityCheck: declaration-level edge cases (specs/22 M16 P7)', () => {
  it('a reference.ref that names a real branch reads invalid, never resolved as if it were a tag', async () => {
    const dir = await freshProject();
    await execa('git', ['branch', 'feature-branch'], { cwd: dir });
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: feature-branch
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: 2
    cases:
      - {}
`,
    );
    await commitAll(dir, 'declare with a branch reference');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('invalid');
    expect(result.declarations[0]?.reason).toMatch(/names a branch/);
    expect(parityCheckExitCode(result)).toBe(1);
  });

  it('a reference.ref that is tag-shaped but names no real commit reads missing', async () => {
    const dir = await freshProject();
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: v1-does-not-exist
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: 2
    cases:
      - {}
`,
    );
    await commitAll(dir, 'declare with an unresolved tag reference');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('missing');
    expect(result.declarations[0]?.reason).toMatch(/does not resolve to a commit/);
  });

  it('an expired "unobservable" entry reads expired, even when the declaration\'s own "expires" has not been reached', async () => {
    const dir = await freshProject();
    const sha = await headSha(dir);
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${sha}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: 2
    cases:
      - {}
unobservable:
  - surface: process
    reason: not worth observing
    owner: tester
    expiry: 2020-01-01
`,
    );
    await commitAll(dir, 'declare with an expired unobservable entry');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('expired');
    expect(result.declarations[0]?.reason).toMatch(/unobservable.*expiry/);
  });

  it('a declaration whose only surface is excused reads invalid as nothing-compared', async () => {
    const dir = await freshProject();
    const sha = await headSha(dir);
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${sha}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: 2
    cases:
      - {}
unobservable:
  - surface: process
    reason: not worth observing
    owner: tester
    expiry: 2999-01-01
`,
    );
    await commitAll(dir, 'declare with its only surface excused');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('invalid');
    expect(result.declarations[0]?.reason).toMatch(/nothing-compared/);
  });

  it('an overlay input the declaration names but does not provide fails the digest with invalid', async () => {
    const dir = await freshProject();
    const sha = await headSha(dir);
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${sha}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: 2
    cases:
      - inputs:
          - from: missing-overlay.txt
            to: overlay.txt
`,
    );
    await commitAll(dir, 'declare with a missing overlay source');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('invalid');
    expect(result.declarations[0]?.reason).toMatch(/could not be read while computing its digest/);
  });

  it("a selected capture missing an entry for one of the declaration's own cases reads missing, never a partial comparison", async () => {
    // F-TEST-9's own example is "an unobservable entry removed since the capture was taken" -- found,
    // while building this test, NOT to be reachable through a real `forge parity capture` today:
    // `capture-command.ts`'s own `captureOneDeclaration` observes every DECLARED surface
    // unconditionally (it never reads a declaration's own `unobservable` list at all, unlike this
    // piece's own `processDeclaration`, which deliberately builds a non-exempt-only variant before
    // observing -- see this piece's own report, "defects found"). So capturing with a surface marked
    // `unobservable` either fails outright (if that surface cannot really be observed) or captures it
    // anyway (if it can) -- either way, removing the `unobservable` entry afterwards never leaves a
    // capture with a genuinely MISSING entry for a now-required case. This test instead reaches the
    // same `missing` outcome the direct, realistic way the capture format itself allows: a capture
    // file that is missing one of its own entries while still matching the current declaration's key
    // exactly (digest, reference sha, platform) -- a hand-edited or partially-merged capture, which
    // `13` F-TEST-9 names as a real possibility ("a merge that left two captures").
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    const captured = await runParityCapture(captureOptions(dir));
    const file = captured.captures[0]?.file ?? '';
    const capturePath = path.join(dir, '.forge/parity/captures', file);
    const raw = JSON.parse(await readFile(capturePath, 'utf8')) as { cases: unknown[] };
    raw.cases = []; // the capture now has a case list that does not cover the declaration's own case.
    const edited = JSON.stringify(raw);
    const crypto = await import('node:crypto');
    const editedName = `${crypto.createHash('sha256').update(edited).digest('hex')}.json`;
    await rm(capturePath, { force: true });
    await writeFile(path.join(dir, '.forge/parity/captures', editedName), edited, 'utf8');

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('missing');
  });

  it('two declarations are listed in name order, and the overall verdict is the worst of theirs', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'beta');
    await writeDeclaration(dir, 'alpha');
    await commitAll(dir, 'declare two');
    await runParityCapture(captureOptions(dir));
    await writeBehavior(dir, CHANGED_BODY);

    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.declarations.map((d) => d.name)).toEqual(['alpha', 'beta']);
    expect(result.verdict).toBe('mismatch');
  });

  it('throws a plain programming-error when asked to record with no reportsRoot (never silently skips)', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    await expect(
      runParityCheck({
        projectRoot: dir,
        parentEnv: { ...process.env, FORGE_RUN_ID: undefined },
      }),
    ).rejects.toThrow(/reportsRoot is required/);
  });
});

describe('runParityCheck: the file surface, including a declared output the candidate never writes (specs/22 M16 P7)', () => {
  async function writeFileDeclaration(dir: string, ref: string): Promise<void> {
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${ref}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  file:
    run: "node write-output.cjs"
    stability:
      runs: 2
    cases:
      - outputs:
          - path: out.txt
`,
    );
  }

  it('matches when the candidate writes the identical declared output, and mismatches (naming the file) when it writes nothing at all', async () => {
    const dir = await freshProject();
    await writeFile(
      path.join(dir, 'write-output.cjs'),
      "require('fs').writeFileSync('out.txt', 'ok');\n",
      'utf8',
    );
    const sha = await commitAll(dir, 'add write-output script');
    await writeFileDeclaration(dir, sha);
    await commitAll(dir, 'declare a file surface');
    await runParityCapture(captureOptions(dir));

    const matching = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(matching.verdict).toBe('match');

    // The candidate's own script is rewritten to write NOTHING at all -- `observe-types.ts`'s own
    // `RawFileEntryContent` "absent" mode, which capture.ts's stored shape cannot represent directly
    // (this piece's own file-absence sentinel, `check-command.ts`'s own `ABSENT_FILE_SENTINEL_SHA256`).
    await writeFile(path.join(dir, 'write-output.cjs'), '// writes nothing\n', 'utf8');
    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('mismatch');
    expect(result.declarations[0]?.reason).toMatch(/declared output "out\.txt"/);
    await rm(path.join(dir, 'out.txt'), { force: true });
  });
});

describe('runParityCheck: an exit-code-only mismatch (specs/22 M16 P7)', () => {
  it('reports the mismatch location as "its exit" when neither stream differs', async () => {
    const dir = await freshProject();
    await writeFile(
      path.join(dir, 'behavior.cjs'),
      "process.stdout.write('ok'); process.exitCode = 0;\n",
      'utf8',
    );
    const sha = await commitAll(dir, 'add exit-code script');
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${sha}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: 2
    cases:
      - {}
`,
    );
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));

    await writeFile(
      path.join(dir, 'behavior.cjs'),
      "process.stdout.write('ok'); process.exitCode = 3;\n",
      'utf8',
    );
    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('mismatch');
    expect(result.declarations[0]?.reason).toMatch(/its exit/);
  });
});

describe('runParityCheck: the oracle rewritten mid-run (after the first case, before the last comparison) (specs/22 M16 P7)', () => {
  it("a case that rewrites .forge/parity/ itself still reads oracle-changed overall, overriding every declaration's own verdict", async () => {
    const dir = await freshProject();
    const sha = await headSha(dir);
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${sha}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: 2
    cases:
      - {}
`,
    );
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    await commitAll(dir, 'capture');

    // The candidate's own command rewrites the oracle WHILE being observed ("code a case runs can
    // change a file", Q294 Decision 3's own boundary), caught here by the SECOND comparison even
    // though the FIRST one (before any case ran) was clean.
    await writeBehavior(
      dir,
      "require('fs').appendFileSync('.forge/parity/sample.parity.yaml', '\\n# rewritten\\n');\nprocess.stdout.write('ok');\n",
    );

    const result = await runParityCheck(
      checkOptions(dir, { trusted: 'refs/heads/main', noRecord: true }),
    );
    expect(result.verdict).toBe('invalid');
    expect(result.reason).toMatch(/^oracle-changed:/);
  });
});

describe('runParityCheck: a case that tampers with .forge/parity/ and restores it before exiting is invisible to both anchor checks (specs/22 M16 P7)', () => {
  it("reads match, not oracle-changed: a transient edit undone within one case's own run window is outside what the before/after comparison can see (Q294 Decision 7, disclosed, not a bug; MUST-FIX 3)", async () => {
    const dir = await freshProject();
    const sha = await headSha(dir);
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${sha}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    stability:
      runs: 2
    cases:
      - {}
`,
    );
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    await commitAll(dir, 'capture');

    // Unlike the sibling scenario just above (which PERSISTS its rewrite, caught by the SECOND
    // comparison), this candidate reads its own declaration file, writes different bytes, and then
    // writes the EXACT original bytes back -- all synchronously, before the process exits. Run
    // TWICE for `stability.runs: 2`, each run independently: reads whatever is currently on disk
    // (the untouched original, since the previous run already restored it), tampers, restores.  By
    // the time the AFTER comparison runs (once every declaration has finished), the file already
    // reads byte-identical to the trusted commit again: the edit happened and ended entirely inside a
    // window neither the BEFORE check (already run, before this process ever started) nor the AFTER
    // check (the file is already restored by the time it runs) ever looks during. This is the exact
    // boundary Q294 Decision 7 discloses rather than closes ("a case that runs can change a file and
    // restore it... which neither sees") -- pinned here as a concrete, reproducible case, not left as
    // prose.
    await writeBehavior(
      dir,
      "const fs=require('fs');" +
        "const p='.forge/parity/sample.parity.yaml';" +
        "const original=fs.readFileSync(p,'utf8');" +
        "fs.writeFileSync(p,original+'\\n# tampered\\n');" +
        'fs.writeFileSync(p,original);' +
        "process.stdout.write('ok');\n",
    );

    const result = await runParityCheck(
      checkOptions(dir, { trusted: 'refs/heads/main', noRecord: true }),
    );
    expect(result.verdict).toBe('match');
    expect(result.failing).toBe(0);

    // Not merely that this module failed to notice a real difference under `.forge/parity/`: the
    // working tree really is byte-identical to the trusted commit there afterward, so there
    // genuinely is none left to see. Scoped to that one path, not the whole working tree: every
    // sibling test in this file varies the CANDIDATE by rewriting `behavior.cjs` on disk and never
    // reverting it (that is the point of {@link writeBehavior}), so asserting a clean status
    // tree-wide would fail on that unrelated, deliberate, always-uncommitted change instead of
    // proving anything about this test's own claim.
    const { stdout } = await execa('git', ['status', '--porcelain', '--', '.forge/parity'], {
      cwd: dir,
    });
    expect(stdout).toBe('');
  });
});

describe('runParityCheck: the library surface (specs/22 M16 P7)', () => {
  it("matches a returned value and mismatches once the candidate's own value changes", async () => {
    const dir = await freshProject();
    await mkdir(path.join(dir, '.forge/parity/probes'), { recursive: true });
    // The probe's own bytes ARE part of the declaration digest (Q294 Decision 6: "the bytes of the
    // probes"), so it must stay byte-identical between capture and check -- it reads a SEPARATE,
    // non-digested file (`value.json`, the identical "the declaration stays fixed; an external file
    // varies" pattern this file's own `FIXED_RUN`/`behavior.cjs` already use for the process surface).
    await writeFile(
      path.join(dir, '.forge/parity/probes/probe.mjs'),
      "import {readFileSync} from 'node:fs';\n" +
        "const value = JSON.parse(readFileSync('value.json', 'utf8'));\n" +
        'console.log(JSON.stringify({ok: true, value}));\n',
      'utf8',
    );
    // Committed (not merely written) with value 42: the reference side observes a SCRATCH worktree
    // holding only the reference commit's own tracked files, so `value.json` must already be one of
    // them for the probe to find it there at all.
    await writeFile(path.join(dir, 'value.json'), '42', 'utf8');
    const sha = await commitAll(dir, 'add the probe and its value file');
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${sha}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  library:
    run: node .forge/parity/probes/probe.mjs
    stability:
      runs: 2
    cases:
      - {}
`,
    );
    await commitAll(dir, 'declare a library surface');
    await runParityCapture(captureOptions(dir));

    const matching = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(matching.verdict).toBe('match');

    await writeFile(path.join(dir, 'value.json'), '99', 'utf8');
    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('mismatch');
  });
});

describe('runParityCheck: a process surface that declares only one stream (specs/22 M16 P7)', () => {
  it('an unlisted stream stays unobserved on the candidate side too', async () => {
    const dir = await freshProject();
    await writeFile(
      path.join(dir, 'behavior.cjs'),
      "process.stdout.write('ok'); process.stderr.write('noisy');\n",
      'utf8',
    );
    const sha = await commitAll(dir, 'add a script that also writes stderr');
    await writeRawDeclaration(
      dir,
      'sample',
      `name: sample
reference:
  ref: ${sha}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: ${JSON.stringify(FIXED_RUN)}
    streams: [stdout]
    stability:
      runs: 2
    cases:
      - {}
`,
    );
    await commitAll(dir, 'declare stdout-only');
    await runParityCapture(captureOptions(dir));

    // Only stderr changes; since it is unobserved, the case still matches.
    await writeFile(
      path.join(dir, 'behavior.cjs'),
      "process.stdout.write('ok'); process.stderr.write('different noise entirely');\n",
      'utf8',
    );
    const result = await runParityCheck(checkOptions(dir, { noRecord: true }));
    expect(result.verdict).toBe('match');
  });
});

describe('runParityCheck: deleting every declaration since the trusted commit reads oracle-changed, never no-declarations (specs/22 M16 P7)', () => {
  it('zero declarations on disk, with a trust anchor that disagrees, still names the deleted paths rather than reading no-declarations', async () => {
    const dir = await freshProject();
    await writeDeclaration(dir, 'sample');
    await commitAll(dir, 'declare');
    await runParityCapture(captureOptions(dir));
    await commitAll(dir, 'capture');
    await execa('git', ['rm', '-r', '--cached', '.forge/parity'], { cwd: dir });
    await rm(path.join(dir, '.forge/parity'), { recursive: true, force: true });

    const result = await runParityCheck(
      checkOptions(dir, { trusted: 'refs/heads/main', noRecord: true }),
    );
    expect(result.declarations).toEqual([]);
    expect(result.verdict).toBe('invalid');
    expect(result.reason).toMatch(/^oracle-changed:/);
    expect(result.reason).not.toBe('no-declarations');
    expect(result.reason).toMatch(/sample\.parity\.yaml/);
    expect(parityCheckExitCode(result)).toBe(1);
  });
});
