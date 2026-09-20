/**
 * `forge debug <symptom|--from-failure <runId>>` — real `Defect` artifact scaffolding (unchanged) plus
 * real dispatch to `@forge/engine/rca`'s own `runRcaLoop` (`PLAN-M8.md` P9's own Checks section).
 *
 * @see specs/03 §3.2.5
 * @see specs/13 §13
 * @see specs/13 §13.2 F-DEBUG-1
 */
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { readArtifact } from '@forge/core/artifacts';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import {
  debugFromFailure,
  debugSymptom,
  type DebugDeps,
} from '../../../src/commands/loop/debug.ts';
import { refactorTarget } from '../../../src/commands/loop/refactor.ts';
import {
  AGENTS_ROOT,
  CHECKS_ROOT,
  REPORTS_ROOT,
  agentYaml,
  cleanupAll,
  createTestProject,
  fixtureAdapter,
  testRunDeps,
} from './helpers.ts';

afterEach(cleanupAll);

/** `forge debug`'s RCA sessions (`commands/loop/debug.ts`) build their own `SessionRequest` with an empty
 * system prompt rather than going through the engine's prompt assembly: a disclosed, still-open gap
 * (`SPEC-QUESTIONS.md` Q203 D4; Q207 records it as the one production session type strict mode flags).
 * Strict-prompt mode is therefore off for every adapter in this file, on purpose, until `debug.ts` is
 * moved onto real assembly; the moment it is, delete this constant and the tests below must still pass. */
const RCA_SESSIONS = { strict: false } as const;

/** `node <path-to-script-file>` tolerates trailing argv the way `node -e` does not (`reporter.test.ts`'s
 * own established technique this session, re-verified directly for this exact use) — irrelevant here,
 * but the same *shim-as-a-real-file* idea is what makes a bare `forge` resolvable on `PATH` at all
 * inside a real `execa(..., {shell:true})` subprocess call: `loop.ts`'s own FIX-phase PROVE step shells
 * the literal string `"forge test run"`, which assumes a real, installed `forge` binary — true for a
 * real end user, not true inside this monorepo's own dev/test environment (confirmed directly: no
 * `forge` on `PATH`, no `node_modules/.bin/forge`). A tiny, real, executable shim script — not a mock
 * of `forge`'s own behaviour, a real subprocess that `exec`s the real CLI entry `bin.test.ts` itself
 * already uses (`LAUNCHER`) — makes the *real* `forge test run` genuinely resolvable, the identical gap
 * a real end user's own `npm install -g` closes for them. */
async function installForgeShim(): Promise<{
  readonly dir: string;
  readonly restorePath: () => void;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-shim-'));
  const launcher = fileURLToPath(new URL('../../../bin/forge.mjs', import.meta.url));
  const shimPath = path.join(dir, 'forge');
  await writeFile(shimPath, `#!/bin/sh\nexec "${process.execPath}" "${launcher}" "$@"\n`, 'utf8');
  await chmod(shimPath, 0o755);
  const originalPath = process.env['PATH'];
  process.env['PATH'] = `${dir}${path.delimiter}${originalPath ?? ''}`;
  return {
    dir,
    restorePath: () => {
      process.env['PATH'] = originalPath;
    },
  };
}

function resolveRealVitestEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('vitest/package.json');
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.['vitest'];
  if (binRelative === undefined)
    throw new Error('vitest/package.json has no real "vitest" bin entry.');
  return path.join(path.dirname(packageJsonPath), binRelative);
}
const REAL_VITEST_ENTRY = resolveRealVitestEntry();
const REAL_VITEST_CMD = `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`;

/** Commits a real, working `.forge/config.yaml` (`execution.testCommands.unit` pointed at this
 * monorepo's own real, installed vitest — resolved by absolute path, so it runs regardless of whether
 * the target directory has its own `node_modules`, the identical technique `reporter.test.ts`/
 * `run.test.ts` already establish) plus a real vitest fixture whose own single test's pass/fail state
 * tracks the exact same real, on-disk condition (`fixed.marker`'s own presence) the RCA loop's own
 * scripted REPRODUCE/FIX exchange uses below — so a real `forge test run` inside the lane genuinely
 * fails before the fix and genuinely passes after it, not a fixture that merely *claims* to. Committed
 * to `main` *before* `debugSymptom` ever runs: a lane is created from a resolved git revision, so
 * anything only written to the *working tree* (never committed) is invisible to it.
 */
async function seedReproducibleProject(project: { readonly dir: string }): Promise<void> {
  // Built from the real `DEFAULT_CONFIG` and serialised by the real `yaml` package, not hand-typed —
  // `configSchema` is `.strict()` at every level, and a hand-written YAML fixture missing even one
  // real, required field (`execution.autonomyByGate`/`conflictPolicy`/`sharedMutablePaths`, confirmed
  // directly) fails with a real, correct `CFG-001` this technique cannot silently drift out of sync
  // with the schema's own real shape.
  const config = {
    ...DEFAULT_CONFIG,
    execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: REAL_VITEST_CMD } },
  };
  await mkdir(path.join(project.dir, '.forge'), { recursive: true });
  await writeFile(path.join(project.dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
  await writeFile(path.join(project.dir, 'package.json'), '{}', 'utf8');
  await writeFile(
    path.join(project.dir, 'bug.test.js'),
    `import { test, expect } from 'vitest';
import { existsSync } from 'node:fs';
test('the real fix has landed', () => { expect(existsSync('fixed.marker')).toBe(true); });
`,
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa('git', ['commit', '--quiet', '-m', 'seed a real, reproducible defect'], {
    cwd: project.dir,
  });
}

function debugDeps(
  project: Awaited<ReturnType<typeof createTestProject>>,
  adapter: FakePlatformAdapter,
  configOverride?: DebugDeps['config'],
): DebugDeps {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: configOverride ?? project.config,
    adapter,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
  };
}

async function withDiagnostician(
  project: Awaited<ReturnType<typeof createTestProject>>,
): Promise<void> {
  await writeFile(
    path.join(project.dir, AGENTS_ROOT, 'diagnostician.yaml'),
    agentYaml('diagnostician', 'Diagnostician'),
  );
}

/** Every real, scripted response the RCA loop's own happy path needs, keyed by each phase's own real,
 * literal prompt prefix (`loop.ts`'s own exact prompt text — REPRODUCE and real ISOLATE both share
 * `phase: 'isolate'`, distinguished only by prompt text, matching `loop.ts`'s own doc comment). Three
 * distinct hypothesis claims, two refuted and one confirmed (`loop.ts` requires *some but not all*
 * confirmed to proceed past a round), one five-whys turn that already satisfies the stop rule (this
 * fixture's own default `Sev3` severity never triggers the Sev1/Sev2 typo-forcing rule), and a FIX that
 * really writes `fixed.marker` — the same real file the reproduction command and `bug.test.js` both
 * check for. */
function scriptHappyPath(adapter: FakePlatformAdapter): void {
  adapter.script((r) => r.prompt.startsWith('REPRODUCE attempt'), {
    text: ['proposing a reproduction'],
    structured: { command: 'test -f fixed.marker' },
  });
  adapter.script((r) => r.prompt.startsWith('ISOLATE for'), {
    text: ['isolating'],
    structured: { scope: 'bug.test.js' },
  });
  adapter.script((r) => r.prompt.startsWith('HYPOTHESISE for'), {
    text: ['hypothesising'],
    structured: { claims: ['hypothesis-alpha', 'hypothesis-beta', 'hypothesis-gamma'] },
  });
  // `.startsWith('FALSIFY for')` *and* the claim text — DIAGNOSE's own prompt also quotes the
  // confirmed claim (`why does "${causalChain.at(-1)}" happen?`), so the claim substring alone would
  // wrongly match a DIAGNOSE request too (reproduced directly: it did, silently skipping DIAGNOSE's
  // own `why` response and leaving `rootCause` as the raw claim text).
  adapter.script(
    (r) => r.prompt.startsWith('FALSIFY for') && r.prompt.includes('"hypothesis-alpha"'),
    {
      text: ['falsifying alpha'],
      structured: { refuted: true, refutedBy: 'ruled out by direct inspection' },
    },
  );
  adapter.script(
    (r) => r.prompt.startsWith('FALSIFY for') && r.prompt.includes('"hypothesis-beta"'),
    {
      text: ['falsifying beta'],
      structured: { refuted: true, refutedBy: 'ruled out by direct inspection' },
    },
  );
  adapter.script(
    (r) => r.prompt.startsWith('FALSIFY for') && r.prompt.includes('"hypothesis-gamma"'),
    {
      text: ['falsifying gamma'],
      structured: { refuted: false },
    },
  );
  adapter.script((r) => r.prompt.startsWith('DIAGNOSE for'), {
    text: ['diagnosing'],
    structured: { why: 'a missing marker file check', satisfiesStopRule: true },
  });
  adapter.script((r) => r.prompt.startsWith('FIX for'), {
    text: ['fixing'],
    writeFiles: [{ relativePath: 'fixed.marker', content: 'fixed\n' }],
    // The session both writes real files *and* reports real structured JSON in the same turn
    // (`FIX_OUTPUT_SCHEMA`) — `diff` is deliberately omitted here: `runFixSession` always overwrites
    // it with a real, computed `git diff`, never trusts a session's own self-report of it.
    structured: { description: 'wrote the missing marker file', blastRadius: ['bug.test.js'] },
  });
  adapter.script((r) => r.prompt.startsWith('PREVENT for'), {
    text: ['preventing'],
    structured: {
      actions: ['add a regression test guarding this exact marker check'],
      kbWrites: ['KB-marker-file-checks'],
    },
  });
}

describe('debugSymptom — recorded (real RCA-### artifact, real fix committed to a real lane)', () => {
  it('runs the real ten-phase loop end to end against a fake adapter and records a real, schema-valid RCA', async () => {
    const project = await createTestProject();
    await withDiagnostician(project);
    await seedReproducibleProject(project);
    const shim = await installForgeShim();

    try {
      const adapter = new FakePlatformAdapter({}, RCA_SESSIONS);
      scriptHappyPath(adapter);

      const result = await debugSymptom(
        debugDeps(project, adapter),
        'the marker file is missing after checkout',
      );

      expect(result.outcome).toBe('recorded');
      if (result.outcome !== 'recorded') throw new Error('unreachable');
      expect(result.defectId).toMatch(/^DEF-\d+$/);
      expect(result.rcaId).toMatch(/^RCA-\d+$/);

      // A real, schema-valid RCA artifact — readArtifact schema-validates internally, the identical
      // "reading it back at all proves it's valid" precedent the old debug.test.ts already relied on
      // for Defect.
      const sessionsFiles = await readdir(path.join(project.dir, 'docs/forge/sessions/rca'));
      const rcaFile = sessionsFiles.find((name) => name.startsWith(result.rcaId));
      if (rcaFile === undefined) throw new Error('unreachable');
      const rcaDoc = await readArtifact(project.paths, `docs/forge/sessions/rca/${rcaFile}`);
      expect(rcaDoc.get(['defect'])).toBe(result.defectId);
      expect(rcaDoc.get(['root_cause'])).toBe('a missing marker file check');
      expect((rcaDoc.get(['prevention']) as readonly string[]).length).toBeGreaterThan(0);
      expect((rcaDoc.get(['hypotheses']) as readonly unknown[]).length).toBe(3);
      // A fresh critic round reproduced directly that the FIX session's own real `description`/
      // `blastRadius` and the PREVENT session's own real `kbWrites` were silently discarded (no
      // `outputSchema` requested them at all) — every real RCA's own `fix`/`blast_radius`/`kb_writes`
      // fields fell back to the root cause text and `[]` on every real run, not just hypothetically.
      expect(rcaDoc.get(['fix'])).toBe('wrote the missing marker file');
      expect(rcaDoc.get(['blast_radius'])).toEqual(['bug.test.js']);
      expect(rcaDoc.get(['kb_writes'])).toEqual(['KB-marker-file-checks']);

      // The source Defect is now really closed.
      const defectDoc = await readArtifact(
        project.paths,
        `${REPORTS_ROOT}/defects/${result.defectId}.md`,
      );
      expect(defectDoc.get(['status'])).toBe('closed');

      // A real fix, genuinely committed to a real lane branch (`06` §6.4) — not merely claimed.
      const { stdout: branches } = await execa('git', ['branch', '--list', `forge/debug-*`], {
        cwd: project.dir,
      });
      expect(branches.trim()).not.toBe('');
      // `git branch --list` marks the branch checked out in *this* (the main) worktree with `* `, and
      // one checked out in any *other* worktree — exactly what a real lane's own branch always is —
      // with `+ ` instead (confirmed directly): both need stripping, not just `*`.
      const branchName = branches.trim().replace(/^[*+]?\s*/, '');
      const { stdout: showFile } = await execa('git', ['show', `${branchName}:fixed.marker`], {
        cwd: project.dir,
      });
      expect(showFile.trim()).toBe('fixed');

      // A fresh critic round reproduced directly that PROVE's own real `forge test run` re-check (run
      // inside the same lane, to verify the accepted fix) leaves real, ordinary side effects behind —
      // `docs/forge/reports/test-results.json`/`flaky.json`, a real vitest cache — that an unconditional
      // `git add -A` at commit time then staged and committed alongside the real fix. The committed
      // tree must contain exactly, and only, the one real file the FIX session actually wrote.
      const { stdout: parentSha } = await execa('git', ['rev-parse', `${branchName}^`], {
        cwd: project.dir,
      });
      const { stdout: changedFiles } = await execa(
        'git',
        ['diff', '--name-only', parentSha.trim(), branchName],
        { cwd: project.dir },
      );
      expect(changedFiles.trim().split('\n')).toEqual(['fixed.marker']);
    } finally {
      shim.restorePath();
    }
  }, 30_000);
});

describe('debugSymptom — needs-more-evidence (REPRODUCE never reproduces)', () => {
  it('reports needs-more-evidence and writes no RCA artifact when no proposed command ever fails', async () => {
    const project = await createTestProject();
    await withDiagnostician(project);
    await seedReproducibleProject(project);
    const shim = await installForgeShim();

    try {
      const adapter = new FakePlatformAdapter({}, RCA_SESSIONS);
      // Every REPRODUCE attempt proposes a command that always succeeds (exit 0) — never reproduces.
      adapter.script((r) => r.prompt.startsWith('REPRODUCE attempt'), {
        structured: { command: 'true' },
      });

      const result = await debugSymptom(debugDeps(project, adapter), 'an unreproducible symptom');

      expect(result.outcome).toBe('needs-more-evidence');
      if (result.outcome !== 'needs-more-evidence') throw new Error('unreachable');
      expect(result.instrumentationPlan.length).toBeGreaterThan(0);

      const sessionsDir = path.join(project.dir, 'docs/forge/sessions/rca');
      await expect(readdir(sessionsDir)).rejects.toThrow();
    } finally {
      shim.restorePath();
    }
  }, 30_000);
});

describe('debugSymptom — escalated (hypotheses never converge)', () => {
  it('reports escalated with real evidence and writes no RCA artifact when every hypothesis round is non-convergent', async () => {
    const project = await createTestProject();
    await withDiagnostician(project);
    await seedReproducibleProject(project);
    const shim = await installForgeShim();

    try {
      const adapter = new FakePlatformAdapter({}, RCA_SESSIONS);
      adapter.script((r) => r.prompt.startsWith('REPRODUCE attempt'), {
        structured: { command: 'test -f fixed.marker' },
      });
      adapter.script((r) => r.prompt.startsWith('ISOLATE for'), {
        structured: { scope: 'bug.test.js' },
      });
      adapter.script((r) => r.prompt.startsWith('HYPOTHESISE for'), {
        structured: { claims: ['claim-one', 'claim-two', 'claim-three'] },
      });
      // Every real hypothesis is confirmed (none refuted) on every real round — F-DEBUG-1 step 5's own
      // "if all three survive... return to ISOLATE" — exhausting MAX_HYPOTHESIS_ROUNDS never diagnoses.
      adapter.script(() => true, { structured: { refuted: false } });

      const result = await debugSymptom(
        debugDeps(project, adapter),
        'a symptom with no real cause',
      );

      expect(result.outcome).toBe('escalated');
      if (result.outcome !== 'escalated') throw new Error('unreachable');
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.evidence.defectId).toBe(result.defectId);

      const sessionsDir = path.join(project.dir, 'docs/forge/sessions/rca');
      await expect(readdir(sessionsDir)).rejects.toThrow();
    } finally {
      shim.restorePath();
    }
  }, 30_000);
});

describe('debugSymptom — escalated (every FIX attempt fails to produce a real, proposed diff)', () => {
  it('exhausts MAX_FIX_ATTEMPTS and escalates when a FIX session fails outright and when it succeeds but writes nothing', async () => {
    const project = await createTestProject();
    await withDiagnostician(project);
    await seedReproducibleProject(project);
    const shim = await installForgeShim();

    try {
      const adapter = new FakePlatformAdapter({}, RCA_SESSIONS);
      adapter.script((r) => r.prompt.startsWith('REPRODUCE attempt'), {
        structured: { command: 'test -f fixed.marker' },
      });
      adapter.script((r) => r.prompt.startsWith('ISOLATE for'), {
        structured: { scope: 'bug.test.js' },
      });
      adapter.script((r) => r.prompt.startsWith('HYPOTHESISE for'), {
        structured: { claims: ['hypothesis-alpha', 'hypothesis-beta', 'hypothesis-gamma'] },
      });
      adapter.script(
        (r) => r.prompt.startsWith('FALSIFY for') && r.prompt.includes('"hypothesis-alpha"'),
        { structured: { refuted: true, refutedBy: 'ruled out' } },
      );
      adapter.script(
        (r) => r.prompt.startsWith('FALSIFY for') && r.prompt.includes('"hypothesis-beta"'),
        { structured: { refuted: true, refutedBy: 'ruled out' } },
      );
      adapter.script(
        (r) => r.prompt.startsWith('FALSIFY for') && r.prompt.includes('"hypothesis-gamma"'),
        { structured: { refuted: false } },
      );
      adapter.script((r) => r.prompt.startsWith('DIAGNOSE for'), {
        structured: { why: 'a missing marker file check', satisfiesStopRule: true },
      });
      // The *first* real FIX session fails outright (a real, injected adapter failure) — consumed
      // once, so every later FIX attempt falls through to the real script below instead, which
      // succeeds but writes nothing at all: neither ever proposes a real diff.
      adapter.injectFailure((r) => r.prompt.startsWith('FIX for'), 'error');
      adapter.script((r) => r.prompt.startsWith('FIX for'), { text: ['no real change proposed'] });

      const result = await debugSymptom(debugDeps(project, adapter), 'a defect nothing ever fixes');

      expect(result.outcome).toBe('escalated');
      if (result.outcome !== 'escalated') throw new Error('unreachable');
      expect(result.reason).toContain('exhausted fix attempts');
      expect(result.evidence.fixAttempts).toContain('(no diff proposed)');

      const sessionsDir = path.join(project.dir, 'docs/forge/sessions/rca');
      await expect(readdir(sessionsDir)).rejects.toThrow();
    } finally {
      shim.restorePath();
    }
  }, 30_000);
});

describe('debugSymptom — a hard, thrown INTAKE/HYPOTHESISE/PREVENT refusal (RUN-060)', () => {
  it('resets and removes the lane, following retainLaneWorktrees, even though runRcaLoop throws rather than returns', async () => {
    // `createTestProject()`'s own default config sets `retainLaneWorktrees: 'always'` — every other
    // test in this file relies on that to inspect a lane afterward, but it also means none of them can
    // actually prove real cleanup happens. Overridden to `'never'` here specifically to exercise it.
    const project = await createTestProject();
    await withDiagnostician(project);
    await seedReproducibleProject(project);
    const shim = await installForgeShim();

    try {
      const adapter = new FakePlatformAdapter({}, RCA_SESSIONS);
      adapter.script((r) => r.prompt.startsWith('REPRODUCE attempt'), {
        structured: { command: 'test -f fixed.marker' },
      });
      adapter.script((r) => r.prompt.startsWith('ISOLATE for'), {
        structured: { scope: 'bug.test.js' },
      });
      // Only two distinct claims — F-DEBUG-1 step 4's own "at least three" is a hard refusal
      // (`loop.ts`'s own `refuse('HYPOTHESISE', ...)`, thrown as a real `RUN-060`, never returned).
      adapter.script((r) => r.prompt.startsWith('HYPOTHESISE for'), {
        structured: { claims: ['claim-one', 'claim-two'] },
      });

      const neverRetain = {
        ...project.config,
        execution: { ...project.config.execution, retainLaneWorktrees: 'never' as const },
      };

      await expect(
        debugSymptom(
          debugDeps(project, adapter, neverRetain),
          'too few real hypotheses ever proposed',
        ),
      ).rejects.toMatchObject({ code: 'RUN-060' });

      const { stdout: branches } = await execa('git', ['branch', '--list', 'forge/debug-*'], {
        cwd: project.dir,
      });
      expect(branches.trim()).toBe('');
      const { stdout: worktrees } = await execa('git', ['worktree', 'list', '--porcelain'], {
        cwd: project.dir,
      });
      expect(worktrees).not.toContain('debug-fix');
    } finally {
      shim.restorePath();
    }
  }, 30_000);
});

describe('forge debug is the one known session type that bypasses prompt assembly (canary)', () => {
  it('its RCA sessions still send an empty system prompt, which a strict adapter refuses -- delete this test and RCA_SESSIONS when `debug.ts` is moved onto real assembly', async () => {
    const project = await createTestProject();
    await withDiagnostician(project);
    await seedReproducibleProject(project);
    const shim = await installForgeShim();

    try {
      const adapter = new FakePlatformAdapter(); // strict, the default
      scriptHappyPath(adapter);

      // The loop tolerates each refused session (it is an adapter failure to it), so the outcome is not
      // the assertion here: the recorded refusals are.
      await debugSymptom(
        debugDeps(project, adapter),
        'the marker file is missing after checkout',
      ).catch(() => undefined);

      const refused = adapter.strictViolations.filter((record) =>
        record.stepId.startsWith('debug:'),
      );
      expect(refused.length).toBeGreaterThan(0);
      for (const record of refused) {
        expect(record.violations.join(' ')).toContain('the system prompt is empty');
      }
      // Only debug's own sessions: nothing else in this flow may be refused.
      expect(adapter.strictViolations).toHaveLength(refused.length);
      adapter.acknowledgeStrictViolations(refused.length);
    } finally {
      shim.restorePath();
    }
  }, 30_000);
});

describe('debugFromFailure', () => {
  it('derives observed/affected from a real failed run’s own event log', async () => {
    const project = await createTestProject();
    // `refactorTarget` is an ordinary engine agent step, not an RCA session: it stays strict.
    const failingAdapter = new FakePlatformAdapter();
    failingAdapter.injectFailure(() => true, 'error');
    const failingDeps = testRunDeps(project, failingAdapter);
    const failingRun = await refactorTarget(failingDeps, 't', 'g', { host: 'test-host' });
    if (failingRun.kind !== 'run') throw new Error('unreachable');

    await withDiagnostician(project);
    await seedReproducibleProject(project);
    const shim = await installForgeShim();

    try {
      const debugAdapter = new FakePlatformAdapter({}, RCA_SESSIONS);
      // Never reproduces — this test only checks Defect scaffolding, not the full loop.
      debugAdapter.script((r) => r.prompt.startsWith('REPRODUCE attempt'), {
        structured: { command: 'true' },
      });

      const result = await debugFromFailure(debugDeps(project, debugAdapter), failingRun.runId);

      expect(result.outcome).toBe('needs-more-evidence');
      const defectDoc = await readArtifact(
        project.paths,
        `${REPORTS_ROOT}/defects/${result.defectId}.md`,
      );
      expect(defectDoc.get(['affected'])).toEqual(['refactor:only']);
    } finally {
      shim.restorePath();
    }
  }, 30_000);

  it('throws RUN-057 when the named run has no failed step at all', async () => {
    const project = await createTestProject();
    const deps = testRunDeps(project, fixtureAdapter('t-g.txt'));
    const cleanRun = await refactorTarget(deps, 't', 'g', { host: 'test-host' });
    if (cleanRun.kind !== 'run') throw new Error('unreachable');

    await withDiagnostician(project);
    const adapter = new FakePlatformAdapter({}, RCA_SESSIONS);
    await expect(
      debugFromFailure(debugDeps(project, adapter), cleanRun.runId),
    ).rejects.toMatchObject({ code: 'RUN-057' });
  });
});
