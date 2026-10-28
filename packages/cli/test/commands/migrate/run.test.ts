/**
 * `forge migrate run --phase <expand|migrate|contract> [--migration <id>] [--json]` (`03` §3.2.5;
 * `specs/22` M17 P18; #14), real for the first time.
 *
 * Exercises `migrateRun` (`commands/migrate/run.ts`) directly, against a real temp project, a real
 * `migrations.yaml`, and real Node scripts on disk — phase/migration filtering, `after`/`expands`
 * dependency ordering across two sequential invocations, the ledger's own idempotency (a repeat
 * invocation of an already-applied entry never re-runs its script), every failure mode (a missing
 * script, a script that fails, a script that times out, an unmet dependency, a malformed or missing
 * `migrations.yaml`, an order-inconsistent one, a corrupt ledger), and a path-escape attempt. A
 * second describe block drives the real, compiled CLI entry point as a subprocess (the identical
 * recipe `test/command-steps.test.ts` already establishes) for the exit-code contract (0/1/2) and the
 * exact `--json` envelope `03` §3.2.5 pins.
 *
 * @see specs/03 §3.2.5
 * @see specs/09 §9.7 point 4
 * @see specs/12 F-DATA-6
 * @see specs/22 M17 P18
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import { afterEach, describe, expect, it } from 'vitest';

import { TS_NODE_FLAG } from '../../../../../scripts/lib/node-ts-flag.mjs';
import type { SpecCommandContext } from '../../../src/commands/spec.ts';
import { isMigratePhase, migrateRun, MIGRATE_PHASES } from '../../../src/commands/migrate/run.ts';
import {
  KB_ROOT,
  SPECS_ROOT,
  cleanupAll,
  createTestProject,
  type TestProject,
} from '../helpers.ts';

afterEach(cleanupAll);

const MIGRATIONS_PATH = `${KB_ROOT}/data/migrations.yaml`;
const SCRIPTS_DIR = 'docs/forge/migrations';
const LEDGER_PATH = '.forge/migrate/applied.json';

function ctx(project: TestProject): SpecCommandContext {
  return { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT };
}

const FAKE_CLOCK: Clock = { now: () => '2026-01-01T00:00:00.000Z' };

async function put(project: TestProject, relative: string, text: string): Promise<void> {
  const target = path.join(project.dir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

async function writeMigrations(project: TestProject, yaml: string): Promise<void> {
  await put(project, MIGRATIONS_PATH, yaml);
}

/** A real Node script that appends its OWN id to the shared `applied.log` (project-root-relative,
 * since the script's own `cwd` is `projectRoot`) each time it genuinely runs, then exits 0 — the
 * marker this suite's own idempotency tests read back to prove a given id's script was (or was not)
 * re-invoked, distinguishable from any sibling script's own writes to the same file. */
async function writeCountingScript(project: TestProject, id: string): Promise<void> {
  await put(
    project,
    `${SCRIPTS_DIR}/${id}.mjs`,
    `import { appendFileSync } from 'node:fs';\nappendFileSync('applied.log', ${JSON.stringify(`${id}\n`)});\n`,
  );
}

async function writeFailingScript(
  project: TestProject,
  id: string,
  message = 'boom',
): Promise<void> {
  await put(
    project,
    `${SCRIPTS_DIR}/${id}.mjs`,
    `process.stderr.write(${JSON.stringify(message)});\nprocess.exitCode = 1;\n`,
  );
}

async function writeHangingScript(project: TestProject, id: string): Promise<void> {
  await put(project, `${SCRIPTS_DIR}/${id}.mjs`, 'setInterval(() => {}, 1000);\n');
}

/** The exact shape a real migration script's own dependency can produce (specs/22 M16 P10,
 * `SPEC-QUESTIONS.md` Q296): a `detached: true` Node grandchild (Node's own, direct equivalent of
 * `setsid(2)`) that writes its own real pid to `markerRelativePath` (project-root-relative, since the
 * script's own `cwd` is `projectRoot`), then blocks the event loop with a synchronous busy loop --
 * unreachable by anything that relies on `setTimeout`/signal handling inside it, so only an external
 * SIGKILL by pid can end it. The script itself (the migration's own top-level process) also busy-loops
 * after spawning and never exits on its own, so the real timeout below -- not an early exit -- is what
 * has to end it; by that point the grandchild, spawned in the script's very first statement, has
 * certainly already written its marker. Mirrors `shell.test.ts`'s own identical fixture verbatim in
 * shape, since this is `runMigrationScript`'s own direct analogue of exactly the same real-world risk. */
async function writeHangingScriptWithDetachedGrandchild(
  project: TestProject,
  id: string,
  markerRelativePath: string,
): Promise<void> {
  await put(
    project,
    `${SCRIPTS_DIR}/${id}.mjs`,
    "import { spawn } from 'node:child_process';\n" +
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(
        "require('node:fs').writeFileSync(process.argv[1], String(process.pid));\nfor (;;) { /* busy */ }\n",
      )}, ${JSON.stringify(markerRelativePath)}], { detached: true, stdio: 'ignore' });\n` +
      'child.unref();\n' +
      'for (;;) { /* the script hangs too, so the real timeout -- not an early exit -- ends it */ }\n',
  );
}

/** Every real line `applied.log` holds — one per genuine script invocation, named by id — or `[]`
 * when no counting script has ever run. */
async function appliedLogEntries(project: TestProject): Promise<readonly string[]> {
  try {
    const text = await readFile(path.join(project.dir, 'applied.log'), 'utf8');
    return text.split('\n').filter((line) => line.trim() !== '');
  } catch {
    return [];
  }
}

async function appliedLogLines(project: TestProject): Promise<number> {
  return (await appliedLogEntries(project)).length;
}

async function ledger(project: TestProject): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(project.dir, LEDGER_PATH), 'utf8'));
  } catch {
    return undefined;
  }
}

describe('isMigratePhase / MIGRATE_PHASES (specs/22 M17 P18)', () => {
  it('accepts exactly the three declared phases', () => {
    expect(MIGRATE_PHASES).toEqual(['expand', 'migrate', 'contract']);
    for (const phase of MIGRATE_PHASES) expect(isMigratePhase(phase)).toBe(true);
    expect(isMigratePhase('contraction')).toBe(false);
    expect(isMigratePhase('')).toBe(false);
  });
});

describe('migrateRun: phase filtering and a clean apply (specs/22 M17 P18)', () => {
  it('applies every not-yet-applied entry of the given phase, in file order, and reports them in applied', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
  - id: beta-expand
    phase: expand
    release: 1
  - id: alpha-contract
    phase: contract
    release: 2
    expands: alpha-expand
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    await writeCountingScript(project, 'beta-expand');

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toEqual({
      phase: 'expand',
      applied: ['alpha-expand', 'beta-expand'],
      failed: 0,
      errors: 0,
    });
    expect(await appliedLogLines(project)).toBe(2);
  });

  it('a phase with no matching entries is a clean, vacuous success (nothing attempted)', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'contract' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toEqual({ phase: 'contract', applied: [], failed: 0, errors: 0 });
  });
});

describe('migrateRun: idempotency, the no-op guarantee (12 F-DATA-6, QUALITY-BAR.md R9) (specs/22 M17 P18)', () => {
  it('a repeat invocation of an already-applied entry does not re-run its script, and reports it as not newly applied', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');

    const first = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);
    if (first.kind !== 'ok') throw new Error('expected a real result');
    expect(first.result).toEqual({
      phase: 'expand',
      applied: ['alpha-expand'],
      failed: 0,
      errors: 0,
    });
    expect(await appliedLogLines(project)).toBe(1);

    const second = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);
    if (second.kind !== 'ok') throw new Error('expected a real result');
    // The decisive assertion: NOT merely "did not error" -- the script's own observable side effect
    // did not happen a second time, and the envelope says so (applied: [], not ['alpha-expand']).
    expect(second.result).toEqual({ phase: 'expand', applied: [], failed: 0, errors: 0 });
    expect(await appliedLogLines(project)).toBe(1);
  });

  it('the ledger records appliedAt/phase for a real, injected clock, and survives a resumed (fresh) process (R9: a kill-and-resume converges)', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
  - id: beta-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    await writeFailingScript(project, 'beta-expand');

    // Attempt 1: alpha applies and is durably recorded; beta fails (simulating a run that stopped
    // partway through, the shape R9 calls "killed at a boundary").
    const first = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);
    if (first.kind !== 'ok') throw new Error('expected a real result');
    expect(first.result.applied).toEqual(['alpha-expand']);
    expect(first.result.failed).toBe(1);
    expect(await ledger(project)).toMatchObject({
      v: 1,
      applied: { 'alpha-expand': { appliedAt: '2026-01-01T00:00:00.000Z', phase: 'expand' } },
    });

    // Attempt 2, a fresh call (a resumed/retried invocation): alpha is correctly skipped (already
    // applied, ledger-backed) and beta is retried from scratch, converging once its own script is
    // fixed -- the retry does not re-run alpha's script a second time.
    await writeCountingScript(project, 'beta-expand');
    const second = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);
    if (second.kind !== 'ok') throw new Error('expected a real result');
    expect(second.result).toEqual({
      phase: 'expand',
      applied: ['beta-expand'],
      failed: 0,
      errors: 0,
    });
    // alpha's own script ran exactly once, ever -- never a second time on the retried attempt --
    // while beta's own script ran exactly once too, on its own (first successful) attempt.
    const entries = await appliedLogEntries(project);
    expect(entries.filter((line) => line === 'alpha-expand')).toHaveLength(1);
    expect(entries.filter((line) => line === 'beta-expand')).toHaveLength(1);
  });
});

describe('migrateRun: after/expands dependency ordering, across two real invocations (specs/22 M17 P18)', () => {
  it('an entry whose dependency has not been applied yet fails with a named, actionable problem, and is retried once the dependency is applied', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: seed-expand
    phase: expand
    release: 1
  - id: seed-migrate
    phase: migrate
    release: 1
    expands: seed-expand
`,
    );
    await writeCountingScript(project, 'seed-expand');
    await writeCountingScript(project, 'seed-migrate');

    // --phase migrate alone, before --phase expand ever ran: seed-migrate's own dependency is
    // declared (no order violation) but not yet applied.
    const premature = await migrateRun(ctx(project), project.dir, { phase: 'migrate' }, FAKE_CLOCK);
    if (premature.kind !== 'ok') throw new Error('expected a real result');
    expect(premature.result.applied).toEqual([]);
    expect(premature.result.failed).toBe(1);
    expect(premature.result.errors).toBe(0);
    expect(premature.result.problems?.[0]).toContain('seed-migrate');
    expect(premature.result.problems?.[0]).toContain('seed-expand');
    expect(premature.result.problems?.[0]).toContain('not yet applied');

    // Apply the dependency for real.
    const expand = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);
    if (expand.kind !== 'ok') throw new Error('expected a real result');
    expect(expand.result.applied).toEqual(['seed-expand']);

    // Retried: the dependency is now satisfied, and seed-migrate's own script genuinely runs.
    const retried = await migrateRun(ctx(project), project.dir, { phase: 'migrate' }, FAKE_CLOCK);
    if (retried.kind !== 'ok') throw new Error('expected a real result');
    expect(retried.result).toEqual({
      phase: 'migrate',
      applied: ['seed-migrate'],
      failed: 0,
      errors: 0,
    });
  });

  it("an entry's own expands dependency, not just after, is honoured the same way", async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: wide-expand
    phase: expand
    release: 1
  - id: wide-contract
    phase: contract
    release: 2
    expands: wide-expand
`,
    );
    await writeCountingScript(project, 'wide-expand');
    await writeCountingScript(project, 'wide-contract');

    const premature = await migrateRun(
      ctx(project),
      project.dir,
      { phase: 'contract' },
      FAKE_CLOCK,
    );
    if (premature.kind !== 'ok') throw new Error('expected a real result');
    expect(premature.result.failed).toBe(1);
    expect(premature.result.problems?.[0]).toContain('wide-expand');
  });
});

describe('migrateRun: --migration restricts the run to one named entry (specs/22 M17 P18)', () => {
  it('applies only the named entry, not every entry of the phase', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
  - id: beta-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    await writeCountingScript(project, 'beta-expand');

    const outcome = await migrateRun(
      ctx(project),
      project.dir,
      { phase: 'expand', migration: 'alpha-expand' },
      FAKE_CLOCK,
    );

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toEqual({
      phase: 'expand',
      applied: ['alpha-expand'],
      failed: 0,
      errors: 0,
    });
  });

  it('an id migrations.yaml does not declare at all resolves as unknown-migration', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');

    const outcome = await migrateRun(
      ctx(project),
      project.dir,
      { phase: 'expand', migration: 'no-such-id' },
      FAKE_CLOCK,
    );

    expect(outcome).toEqual({ kind: 'unknown-migration' });
  });

  it('an id that exists but under a DIFFERENT phase also resolves as unknown-migration', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
  - id: alpha-contract
    phase: contract
    release: 2
    expands: alpha-expand
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    await writeCountingScript(project, 'alpha-contract');

    // alpha-contract is a real, declared id -- but not of the "expand" phase named here.
    const outcome = await migrateRun(
      ctx(project),
      project.dir,
      { phase: 'expand', migration: 'alpha-contract' },
      FAKE_CLOCK,
    );

    expect(outcome).toEqual({ kind: 'unknown-migration' });
  });
});

describe('migrateRun: per-entry failure modes (QUALITY-BAR.md R6) (specs/22 M17 P18)', () => {
  it('a missing script is a named, actionable failure, not a crash', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    // No script written at all.

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toMatchObject({ applied: [], failed: 1, errors: 0 });
    expect(outcome.result.problems?.[0]).toContain('docs/forge/migrations/alpha-expand.mjs');
    expect(outcome.result.problems?.[0]).toContain('not found');
  });

  it('a script that exits non-zero is a named failure, with its own stderr excerpted', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeFailingScript(project, 'alpha-expand', 'the backfill found a corrupt row');

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toMatchObject({ applied: [], failed: 1, errors: 0 });
    expect(outcome.result.problems?.[0]).toContain('exited 1');
    expect(outcome.result.problems?.[0]).toContain('the backfill found a corrupt row');
  });

  it('a script that outlives its timeout is killed and reported, never left to hang the run', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeHangingScript(project, 'alpha-expand');

    const outcome = await migrateRun(
      ctx(project),
      project.dir,
      { phase: 'expand' },
      FAKE_CLOCK,
      300, // scriptTimeoutMs -- a real, short timeout, test-injected (never reachable from the CLI).
    );

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toMatchObject({ applied: [], failed: 1, errors: 0 });
    expect(outcome.result.problems?.[0]).toContain('timed out');
    expect(outcome.result.problems?.[0]).toContain('killed');
  }, 15_000);

  it('a timed-out script does not leave a detached grandchild running (specs/22 M16 P10, SPEC-QUESTIONS.md Q296): runMigrationScript must kill the whole real process tree, not only the script itself', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    const markerRelativePath = 'grandchild.pid';
    await writeHangingScriptWithDetachedGrandchild(project, 'alpha-expand', markerRelativePath);

    const outcome = await migrateRun(
      ctx(project),
      project.dir,
      { phase: 'expand' },
      FAKE_CLOCK,
      500, // scriptTimeoutMs -- a real, short timeout, test-injected (never reachable from the CLI).
    );

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toMatchObject({ applied: [], failed: 1, errors: 0 });
    expect(outcome.result.problems?.[0]).toContain('timed out');

    const markerPath = path.join(project.dir, markerRelativePath);
    const pid = Number((await readFile(markerPath, 'utf8')).trim());
    expect(Number.isInteger(pid)).toBe(true);
    // `kill -0`: the standard liveness probe, sends no real signal.
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive, `detached grandchild pid ${String(pid)} must not survive the timeout kill`).toBe(
      false,
    );
  }, 15_000);
});

describe('migrateRun: file-level problems refuse the whole run (errors, not failed) (specs/22 M17 P18)', () => {
  it('a missing migrations.yaml is a real, named error, never a silent zero-entry success', async () => {
    const project = await createTestProject();
    // No migrations.yaml written at all.

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toMatchObject({ applied: [], failed: 0, errors: 1 });
    expect(outcome.result.problems?.[0]).toContain('migrations.yaml');
  });

  it('a malformed migrations.yaml (a misspelled key) is a real, named schema error', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phaze: expand
    release: 1
`,
    );

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result.errors).toBe(1);
    expect(outcome.result.applied).toEqual([]);
  });

  it('an order-inconsistent migrations.yaml (a forward reference) refuses the whole run before anything is attempted', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-migrate
    phase: migrate
    release: 1
    expands: alpha-expand
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    await writeCountingScript(project, 'alpha-migrate');

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toMatchObject({ applied: [], failed: 0, errors: 1 });
    expect(outcome.result.problems?.[0]).toContain('alpha-migrate');
    // Nothing was attempted at all -- not even alpha-expand, which is itself well-formed.
    expect(await appliedLogLines(project)).toBe(0);
  });
});

describe('migrateRun: a corrupt ledger is disclosed and tolerated, never a silent reset nor a crash (specs/22 M17 P18)', () => {
  it('a hand-corrupted ledger file is reported as a problem, and the run still proceeds from an empty ledger', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    await put(project, LEDGER_PATH, '{ not valid json');

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result.applied).toEqual(['alpha-expand']);
    expect(outcome.result.problems?.[0]).toContain(LEDGER_PATH);
  });

  it('a ledger with the wrong shape (not a crash) is also tolerated the same way', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    await put(project, LEDGER_PATH, JSON.stringify({ v: 1, applied: { x: 'not an object' } }));

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result.applied).toEqual(['alpha-expand']);
    expect(outcome.result.problems?.[0]).toContain(LEDGER_PATH);
  });
});

describe('migrateRun: path handling (QUALITY-BAR.md R11) (specs/22 M17 P18)', () => {
  it("a migration id cannot be used to escape the project root -- migrations.yaml's own schema already forbids the shape that would try", async () => {
    // `migrationSchema.id` (`integration-rules.ts`) is `^[A-Za-z][A-Za-z0-9._-]{0,63}$`: no `/`, no
    // leading `.`, so an id naming `../../etc/passwd` or an absolute path can never parse as a valid
    // entry in the first place -- the defence is structural (schema-level), proven directly here by
    // confirming the shape the regex forbids is refused as a schema violation, never silently
    // resolved as a path by this file's own `${SCRIPTS_DIR}/${entry.id}.mjs` construction.
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: ../../escape
    phase: expand
    release: 1
`,
    );

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);

    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result.errors).toBe(1);
    expect(outcome.result.applied).toEqual([]);
  });
});

describe('migrateRun: the cross-process lock (critic-reproduced: 12 F-DATA-6, the multi-instance race) (specs/22 M17 P18)', () => {
  it('a live, non-stale holder of .forge/migrate/lock.json makes a bounded wait give up with RUN-157, never silently proceeding unlocked', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    // A real, currently-alive holder (this very test process) -- never a faked isProcessAlive.
    // The REAL wall clock, deliberately, not this suite's own frozen FAKE_CLOCK: the wait this test
    // proves is exhausted is measured against real elapsed time passing while the lock loop polls
    // (a real setTimeout between checks), which a clock frozen at one instant can never appear to
    // exceed -- the one place in this whole file a frozen clock is the wrong tool, not the right one.
    await put(
      project,
      '.forge/migrate/lock.json',
      JSON.stringify({ pid: process.pid, startedAt: SYSTEM_CLOCK.now() }),
    );

    await expect(
      migrateRun(ctx(project), project.dir, { phase: 'expand' }, SYSTEM_CLOCK, undefined, 150),
    ).rejects.toMatchObject({ code: 'RUN-157', details: { pid: process.pid } });

    // Never proceeded unlocked: the script was never run while the lock was genuinely held.
    expect(await appliedLogLines(project)).toBe(0);
  });

  it('a lock naming a real, genuinely dead pid is reclaimed immediately, never waited out', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');

    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = child.pid;
    if (deadPid === undefined) throw new Error('expected a real pid');
    await new Promise((resolve) => child.on('exit', resolve));

    await put(
      project,
      '.forge/migrate/lock.json',
      JSON.stringify({ pid: deadPid, startedAt: FAKE_CLOCK.now() }),
    );

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);
    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toEqual({
      phase: 'expand',
      applied: ['alpha-expand'],
      failed: 0,
      errors: 0,
    });
  });

  // Regression for a CONFIRMED reasoning gap, identical to the already-fixed `withEventLogLock`
  // (`379eb26`, `@forge/telemetry`) and `withCollectionLock` (`e2a42d5`, this package's own
  // `collection-lock.ts`): `acquireMigrateLock` (`commands/migrate/lock.ts`) used to fold an
  // UNREADABLE lock (`readMigrateLock` returning `undefined` -- missing, unreadable, or malformed)
  // into "stale, reclaim immediately" right alongside a genuinely dead pid. A real multi-process
  // stress repro (28 processes x 6 sequential acquire/release cycles, the identical volume
  // `e2a42d5`'s own regression test uses) did not surface observable ledger loss for THIS file
  // specifically -- `acquireMigrateLock` WAITS for a live holder rather than refusing outright the
  // way `acquireRunLock`/`withManifestLock` do, which narrows (but does not close) the same window --
  // so this is a targeted, direct test of the fixed condition instead of a full concurrency repro.
  //
  // A hand-written, permanently malformed lock file (never valid JSON, so `readMigrateLock` always
  // returns `undefined` for it, exactly the "ambiguous" case) proves two things the pre-fix code got
  // wrong: it must NOT be reclaimed immediately (the pre-fix behavior) just because it is unreadable,
  // and the overall wait must NOT give up with a fabricated `RUN-157` pid either, since no real holder
  // was ever identified. The fix instead gates reclaiming an unreadable lock on its own measured file
  // age (`AMBIGUOUS_LOCK_GRACE_MS` = 2s, the identical mechanism `withCollectionLock` already proved
  // safe) -- so this call must take measurably LONGER than its own much shorter `lockWaitMs` (150ms)
  // before it self-heals and succeeds, never failing fast with a bogus RUN-157.
  it('an unreadable (never-parseable) lock.json is never reclaimed immediately, and the wait is never abandoned with a fabricated holder pid -- it self-heals once the file is genuinely old enough', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    await put(project, '.forge/migrate/lock.json', 'not valid json {{{');

    const start = Date.now();
    // The REAL wall clock, deliberately (the same reason the live-holder test above gives): the
    // fixed behavior is gated on the lock file's own real `stat` age, which a frozen `FAKE_CLOCK`
    // cannot advance. `lockWaitMs` (150) is deliberately far shorter than the real ~2s self-heal
    // window -- proving the wait is not bounded by `lockWaitMs` while still ambiguous.
    const outcome = await migrateRun(
      ctx(project),
      project.dir,
      { phase: 'expand' },
      SYSTEM_CLOCK,
      undefined,
      150,
    );
    const elapsedMs = Date.now() - start;

    if (outcome.kind !== 'ok') throw new Error('expected a real result, not a thrown RUN-157');
    expect(outcome.result).toEqual({
      phase: 'expand',
      applied: ['alpha-expand'],
      failed: 0,
      errors: 0,
    });
    // The real, load-bearing assertion: this took far longer than the 150ms `lockWaitMs` -- proof the
    // ambiguous lock was retried (not reclaimed on sight) rather than failing fast, exactly the gap
    // between the pre-fix "reclaim immediately" behavior and this fix's own age-gated self-heal.
    expect(elapsedMs).toBeGreaterThan(1000);
  }, 10_000);

  it('a live pid whose lock is far older than the age ceiling is reclaimed anyway (the last-resort self-healing fallback)', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');
    // Alive (this test process's own real pid), but declared as started in 2020 -- far past the real
    // ceiling, which this test's own injected clock reads as "now" (2026).
    await put(
      project,
      '.forge/migrate/lock.json',
      JSON.stringify({ pid: process.pid, startedAt: '2020-01-01T00:00:00.000Z' }),
    );

    const outcome = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);
    if (outcome.kind !== 'ok') throw new Error('expected a real result');
    expect(outcome.result).toEqual({
      phase: 'expand',
      applied: ['alpha-expand'],
      failed: 0,
      errors: 0,
    });
  });
});

// --- the real, compiled CLI entry point, as a subprocess (the exit-code contract and --json) -------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const BIN = path.join(repoRoot, 'packages', 'cli', 'src', 'bin.ts');

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function cli(cwd: string, args: readonly string[]): Promise<CliResult> {
  const child = await execa(
    process.execPath,
    [TS_NODE_FLAG, '--disable-warning=ExperimentalWarning', BIN, ...args],
    { cwd, reject: false, timeout: 30_000, env: { NO_COLOR: '1' } },
  );
  return { exitCode: child.exitCode ?? -1, stdout: child.stdout, stderr: child.stderr };
}

async function writeDefaultConfig(dir: string): Promise<void> {
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge', 'config.yaml'), 'project:\n  level: L2\n', 'utf8');
}

describe('the real CLI entry point: exit codes and the --json envelope (03 §3.2.5) (specs/22 M17 P18)', () => {
  it('--phase missing is a usage error, exit 2', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);

    const result = await cli(project.dir, ['migrate', 'run', '--json']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--phase is required');
  });

  it('--phase bogus is a usage error, exit 2', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);

    const result = await cli(project.dir, ['migrate', 'run', '--phase', 'bogus', '--json']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('is not one of expand, migrate or contract');
  });

  it('--migration naming an id migrations.yaml does not have is a usage error, exit 2', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');

    const result = await cli(project.dir, [
      'migrate',
      'run',
      '--phase',
      'expand',
      '--migration',
      'no-such-id',
      '--json',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('does not name an entry');
  });

  it('exit 0 and the exact --json envelope when every attempted entry applies cleanly', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');

    const result = await cli(project.dir, ['migrate', 'run', '--phase', 'expand', '--json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      v: 1,
      phase: 'expand',
      applied: ['alpha-expand'],
      failed: 0,
      errors: 0,
    });
  });

  it('exit 1, with a problems entry, when an entry fails to apply', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeFailingScript(project, 'alpha-expand');

    const result = await cli(project.dir, ['migrate', 'run', '--phase', 'expand', '--json']);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      readonly v: 1;
      readonly phase: string;
      readonly applied: readonly string[];
      readonly failed: number;
      readonly errors: number;
      readonly problems: readonly string[];
    };
    expect(parsed).toMatchObject({ v: 1, phase: 'expand', applied: [], failed: 1, errors: 0 });
    expect(parsed.problems).toHaveLength(1);
  });

  it('exit 1, with errors, when migrations.yaml itself is missing', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);

    const result = await cli(project.dir, ['migrate', 'run', '--phase', 'expand', '--json']);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      v: 1,
      phase: 'expand',
      applied: [],
      failed: 0,
      errors: 1,
    });
  });

  it('a repeat CLI invocation of an already-clean phase is a genuine no-op, exit 0, applied: []', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);
    await writeMigrations(
      project,
      `migrations:
  - id: alpha-expand
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'alpha-expand');

    const first = await cli(project.dir, ['migrate', 'run', '--phase', 'expand', '--json']);
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ applied: ['alpha-expand'] });

    const second = await cli(project.dir, ['migrate', 'run', '--phase', 'expand', '--json']);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout)).toEqual({
      v: 1,
      phase: 'expand',
      applied: [],
      failed: 0,
      errors: 0,
    });
    expect(await appliedLogLines(project)).toBe(1);
  });

  it('an unrecognised extra positional after "run" is a usage error (USR-002), exit 2', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);

    const result = await cli(project.dir, ['migrate', 'run', '--phase', 'expand', 'extra']);

    expect(result.exitCode).toBe(2);
  });
});

// --- real, concurrent multi-process access -- the critic-reproduced defect, closed by ./lock.ts ----

/** A real `node -e`-shaped delay, written into a counting script's own source so the SPAWNED
 * process itself sleeps before recording -- widens the real overlap window between two independently
 * spawned, genuinely concurrent processes racing the same ledger (this suite's own existing
 * `writeCountingScript` records immediately, which the unit-level tests above rely on for speed; the
 * two tests below need a real, wide window instead). */
/** `markerRelativePath`, when given, is written SYNCHRONOUSLY, before the delay even starts -- a
 * concrete, on-disk signal a test can wait on to know the script's own process has genuinely begun
 * running, rather than inferring it indirectly (and racily) from an earlier entry's own ledger
 * write, which only proves "the PARENT has moved on to starting this one," not "the OS has actually
 * finished forking/execing it yet." */
async function writeSlowCountingScript(
  project: TestProject,
  id: string,
  delayMs: number,
  markerRelativePath?: string,
): Promise<void> {
  const markerLine =
    markerRelativePath === undefined
      ? ''
      : `writeFileSync(${JSON.stringify(markerRelativePath)}, 'x');\n`;
  await put(
    project,
    `${SCRIPTS_DIR}/${id}.mjs`,
    `import { appendFileSync, writeFileSync } from 'node:fs';\n` +
      markerLine +
      `await new Promise((resolve) => setTimeout(resolve, ${String(delayMs)}));\n` +
      `appendFileSync('applied.log', ${JSON.stringify(`${id}\n`)});\n`,
  );
}

/** Every real descendant of `rootPid`, found by walking `ps`'s own real pid/ppid columns -- the
 * identical technique `@forge/engine/dispatch`'s own exported `listDescendantPids`
 * (`confined-command.ts`) uses, reproduced here rather than imported so this test keeps verifying the
 * REAL process tree from the outside, not merely trusting that `runMigrationScript`'s own call to that
 * same exported function did its job. Needed for real: `runMigrationScript` spawns `node` directly as
 * its own `detached: true` process (M17 #18 rewrote it away from a shell string through
 * `runShellCommand`/`runLimitedShellCommand` entirely -- a real argv array now, no shell involved at
 * all), which makes it the leader of a NEW process group of its own, separate from bin.ts's. A plain
 * `process.kill(-pid, 'SIGKILL')` aimed at bin.ts's own group therefore can never reach it (confirmed
 * live: a first attempt using only that technique still left the script's own process alive,
 * orphaned, after the "kill" -- it finished on its own later and appended a second, genuinely
 * unwanted time, exactly the flake a coordinator review caught by running the test several times).
 * Returns `[]` on any failure (no real `ps`, a transient read error) rather than throwing. */
function listDescendantPids(rootPid: number): readonly number[] {
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
    const childrenByParent = new Map<number, number[]>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const [pidText, ppidText] = trimmed.split(/\s+/);
      const pid = Number(pidText);
      const ppid = Number(ppidText);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      const siblings = childrenByParent.get(ppid);
      if (siblings === undefined) childrenByParent.set(ppid, [pid]);
      else siblings.push(pid);
    }
    const descendants: number[] = [];
    const queue: number[] = [rootPid];
    for (const current of queue) {
      for (const child of childrenByParent.get(current) ?? []) {
        descendants.push(child);
        queue.push(child);
      }
    }
    return descendants;
  } catch {
    return [];
  }
}

/** Kills `rootPid` and every real descendant found by `listDescendantPids`, individually -- reliably
 * ending the whole real process TREE a real SIGKILL to just the top process cannot reach on its own
 * (this file's own `listDescendantPids` doc comment has the full, confirmed reasoning). Read ONCE,
 * before any signal is sent: a process already killed has its own children reparented immediately,
 * severing the `ppid` chain this walk depends on. */
function killProcessTree(rootPid: number): void {
  const descendants = listDescendantPids(rootPid);
  for (const pid of [...descendants, rootPid]) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

describe('two real, concurrent forge migrate run processes (critic-reproduced defect: the ledger silently lost one application; now serialized) (specs/22 M17 P18)', () => {
  it('both invocations, naming different migration ids, genuinely succeed, each script runs exactly once, and the final ledger holds BOTH entries', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);
    await writeMigrations(
      project,
      `migrations:
  - id: race-a
    phase: expand
    release: 1
  - id: race-b
    phase: expand
    release: 1
`,
    );
    // Each script sleeps 300ms before recording -- real process startup overhead already makes the
    // two processes' own critical sections likely to overlap; this makes it certain, so the lock (not
    // luck) is what this test actually proves.
    await writeSlowCountingScript(project, 'race-a', 300);
    await writeSlowCountingScript(project, 'race-b', 300);

    const [a, b] = await Promise.all([
      cli(project.dir, ['migrate', 'run', '--phase', 'expand', '--migration', 'race-a', '--json']),
      cli(project.dir, ['migrate', 'run', '--phase', 'expand', '--migration', 'race-b', '--json']),
    ]);

    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(JSON.parse(a.stdout)).toMatchObject({ applied: ['race-a'] });
    expect(JSON.parse(b.stdout)).toMatchObject({ applied: ['race-b'] });

    // The decisive assertion: each script's own real side effect happened EXACTLY once (never
    // dropped, never doubled), and the final ledger genuinely holds both entries -- before this
    // piece's lock, a plain read-modify-write of the ledger silently lost whichever process wrote
    // last, and a later invocation would then re-run the lost entry's script a second time.
    const entries = await appliedLogEntries(project);
    expect(entries.filter((line) => line === 'race-a')).toHaveLength(1);
    expect(entries.filter((line) => line === 'race-b')).toHaveLength(1);
    const finalLedger = (await ledger(project)) as { applied: Record<string, unknown> };
    expect(Object.keys(finalLedger.applied).sort()).toEqual(['race-a', 'race-b']);
  }, 20_000);
});

describe('a real SIGKILL between two successfully-applied entries (R9: proven, not asserted) (specs/22 M17 P18)', () => {
  it('loses only the entry genuinely in flight, never the whole batch, and a resumed invocation converges', async () => {
    const project = await createTestProject();
    await writeDefaultConfig(project.dir);
    await writeMigrations(
      project,
      `migrations:
  - id: entry-1
    phase: expand
    release: 1
  - id: entry-2
    phase: expand
    release: 1
  - id: entry-3
    phase: expand
    release: 1
`,
    );
    await writeCountingScript(project, 'entry-1');
    await writeCountingScript(project, 'entry-2');
    // entry-3's own script is deliberately slow (a wide window to land the kill inside) AND writes
    // `entry-3.started` synchronously, before that delay even begins -- a concrete, on-disk signal
    // that its own real process has genuinely started, which the test below waits for directly
    // rather than inferring readiness from entry-2's own ledger write (which only proves the PARENT
    // has moved on to starting entry-3, not that the OS has actually finished forking/execing it
    // yet -- a real, confirmed gap a coordinator review caught by running this exact test repeatedly:
    // without this marker, the kill occasionally landed before entry-3's own process existed to be
    // found and killed at all, then a `ps`-walk a moment too early still legitimately found nothing).
    await writeSlowCountingScript(project, 'entry-3', 5000, 'entry-3.started');

    const child = spawn(
      process.execPath,
      [
        TS_NODE_FLAG,
        '--disable-warning=ExperimentalWarning',
        BIN,
        'migrate',
        'run',
        '--phase',
        'expand',
        '--json',
      ],
      { cwd: project.dir, env: { ...process.env, NO_COLOR: '1' } },
    );
    const binPid = child.pid;
    if (binPid === undefined) throw new Error('expected a real pid for the spawned bin.ts process');

    // Wait for entry-3's own real process to have genuinely started (this implies entry-1/entry-2
    // already applied, since the loop that runs them is strictly sequential), then kill at once.
    const markerPath = path.join(project.dir, 'entry-3.started');
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        await readFile(markerPath, 'utf8');
        break;
      } catch {
        if (Date.now() > deadline) {
          throw new Error('timed out waiting for entry-3 to genuinely start before the kill');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    // A plain `child.kill('SIGKILL')` (or even a process-GROUP kill of bin.ts's own group) is not
    // enough here, confirmed live: `runMigrationScript` spawns `node` directly as its own
    // `detached: true` process for entry-3's script (M17 #18 rewrote it away from a shell string
    // through `runShellCommand`/`runLimitedShellCommand` entirely -- a real argv array now, timed out
    // and killed via `@forge/engine/dispatch`'s own exported `killGroup`, not a hand-rolled timer),
    // which makes IT the leader of a NEW process group of its OWN, separate from bin.ts's. SIGKILL is
    // also never catchable, so bin.ts's own `onExit` signal-cleanup logic (the same file, for a signal
    // it CAN catch) never runs either. `killProcessTree` walks and kills the whole real descendant
    // tree instead, the identical technique `@forge/engine/dispatch`'s own `killGroup` uses for the
    // identical, doc-commented reason: "a descendant that started its own session... becomes the
    // leader of a new group a plain group kill can never reach."
    killProcessTree(binPid);
    const exit = await new Promise<{ readonly signal: NodeJS.Signals | null }>((resolve) => {
      child.on('close', (_code, signal) => {
        resolve({ signal });
      });
    });
    expect(exit.signal).toBe('SIGKILL');

    // Only entry-3 -- genuinely in flight when the kill landed -- was lost. entry-1 and entry-2,
    // already durably recorded before the kill, survive it untouched: NOT a batched-at-the-end write
    // (which would have lost all three), a real, per-entry one.
    const afterKill = (await ledger(project)) as { applied: Record<string, unknown> };
    expect(Object.keys(afterKill.applied).sort()).toEqual(['entry-1', 'entry-2']);
    expect(await appliedLogEntries(project)).toEqual(['entry-1', 'entry-2']);

    // Resumed: a fresh, independent invocation correctly skips the two already-applied entries
    // (never re-running their scripts) and genuinely applies the one that was lost, converging to
    // all three -- the real, process-level kill-and-resume proof `QUALITY-BAR.md` R9 asks for, and
    // also a real exercise of the lock's own stale-lock reclaim (the killed process's own orphaned
    // `.forge/migrate/lock.json` names a now-dead pid).
    const resumed = await migrateRun(ctx(project), project.dir, { phase: 'expand' }, FAKE_CLOCK);
    if (resumed.kind !== 'ok') throw new Error('expected a real result');
    expect(resumed.result).toEqual({ phase: 'expand', applied: ['entry-3'], failed: 0, errors: 0 });
    expect(await appliedLogEntries(project)).toEqual(['entry-1', 'entry-2', 'entry-3']);
  }, 30_000);
});
