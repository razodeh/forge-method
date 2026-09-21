/**
 * The RCA loop's REPRODUCE and PROVE run the project's own configured test command in the confined runner (`PLAN-M13.md`
 * P23, `SPEC-QUESTIONS.md` Q230, `Q222` D2; `13` §13.2 F-DEBUG-1 steps 2 and 8, `20` §20.1).
 *
 * Real `runRcaLoop`, real `createRcaShell` (the vet, the scrubbed environment, the lane as cwd, a real child process), a fake
 * TEST COMMAND (`node test-unit.mjs`, a script that exits non-zero until a marker exists and counts its own runs) and a
 * scripted model. The grant is built by the derivation (`deriveTestExec`/`grantWithTestExec`) from a diagnostician that
 * declares no test runner, so the command runs only because the project configured it.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SessionResult, ToolGrant } from '@forge/adapter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deriveTestExec,
  grantWithTestExec,
  testLayersForBrief,
} from '../../src/dispatch/test-command-grant.ts';
import { runRcaLoop } from '../../src/rca/loop.ts';
import { createRcaShell } from '../../src/rca/shell.ts';
import type {
  DefectContext,
  RcaLoopDeps,
  RcaSessionRequest,
  RcaShellResult,
} from '../../src/rca/types.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CLOCK = { now: () => '2026-01-01T00:00:00.000Z' };
const TEST_COMMAND = 'node test-unit.mjs';

/** The diagnostician the shipped roster has: read-only tools plus `git *`, no test runner. */
const DIAGNOSTICIAN: ToolGrant = {
  read: true,
  write: true,
  exec: ['git *', 'ls*', 'rg*', 'cat*', 'tree*'],
  network: 'none',
};

async function lane(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p23-rca-'));
  dirs.push(dir);
  // The fake test command: counts its runs, fails until the fix (a marker file) exists.
  await writeFile(
    path.join(dir, 'test-unit.mjs'),
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "appendFileSync('runs.log', 'run\\n');",
      "process.exit(existsSync('fixed.marker') ? 0 : 1);",
      '',
    ].join('\n'),
  );
  return dir;
}

function defect(): DefectContext {
  return {
    defectId: 'DEF-023',
    observed: 'the unit suite fails',
    expected: 'the unit suite passes',
    severity: 'Sev3',
    evidence: [],
  };
}

function result(structured: unknown): SessionResult {
  return {
    sessionId: 'fake',
    ok: true,
    finalText: '',
    structured,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 1 },
    durationMs: 0,
    changedFiles: [],
    controlTokens: [],
  };
}

const OK: RcaShellResult = { exitCode: 0, stdout: '', stderr: '' };

/** The loop's dependencies: the REAL confined shell for a proposed command, a scripted pass for FORGE's own `forge test run`. */
function deps(
  root: string,
  testCommands: Record<string, string>,
  proposals: readonly string[],
  extras: Partial<RcaLoopDeps> = {},
): { readonly deps: RcaLoopDeps; readonly requests: RcaSessionRequest[] } {
  const derived = deriveTestExec(testCommands, testLayersForBrief('debug-isolate'));
  const shell = createRcaShell({
    grant: grantWithTestExec(DIAGNOSTICIAN, derived),
    trustedCommands: derived.patterns,
    root,
    parentEnv: process.env,
  });
  const requests: RcaSessionRequest[] = [];
  let proposal = 0;
  const queue: readonly unknown[] = [
    { scope: 'test-unit.mjs' },
    { claims: ['a', 'b', 'c'] },
    { refuted: false },
    { refuted: true, refutedBy: 'ruled out' },
    { refuted: true, refutedBy: 'ruled out' },
    { why: 'a decision was made without checking the input', satisfiesStopRule: true },
    { diff: 'diff --git a/fixed.marker b/fixed.marker\n+fixed', description: 'the fix' },
    { actions: ['add a regression test'] },
  ];
  let next = 0;
  return {
    requests,
    deps: {
      runSession: async (request) => {
        requests.push(request);
        if (request.prompt.startsWith('REPRODUCE attempt')) {
          const command = proposals[proposal];
          proposal += 1;
          return result({ command });
        }
        // The FIX session's effect: the marker the fake test command looks for.
        if (request.phase === 'fix') await writeFile(path.join(root, 'fixed.marker'), 'fixed\n');
        const structured = queue[next];
        next += 1;
        return result(structured);
      },
      runShell: async (command, cwd, origin) =>
        origin === 'engine' ? OK : shell(command, cwd, origin),
      clock: CLOCK,
      now: () => 0,
      cwd: root,
      ...extras,
    },
  };
}

async function runs(root: string): Promise<number> {
  try {
    return (await readFile(path.join(root, 'runs.log'), 'utf8')).split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

describe('REPRODUCE and PROVE run the configured test command', () => {
  it('the model proposes the project’s unit command: it runs in the confined runner, fails (a reproduction), the fix makes it pass, and the run is recorded', async () => {
    const root = await lane();
    const { deps: loopDeps } = deps(root, { unit: TEST_COMMAND }, [TEST_COMMAND]);

    const outcome = await runRcaLoop(defect(), loopDeps);

    expect(outcome.outcome).toBe('recorded');
    if (outcome.outcome !== 'recorded') throw new Error('unreachable');
    expect(outcome.record.reproduction).toBe(TEST_COMMAND);
    expect(outcome.refusedCommands).toBeUndefined();
    // It really ran, twice: once to reproduce (exit 1), once to prove the fix (exit 0).
    expect(await runs(root)).toBe(2);
  });

  it('REPRODUCE’s instructions name the project’s test commands, so the model can propose one it could not look up (its session is read-only)', async () => {
    const root = await lane();
    const { deps: loopDeps, requests } = deps(root, { unit: TEST_COMMAND }, [TEST_COMMAND], {
      runnableCommands: [TEST_COMMAND],
    });
    await runRcaLoop(defect(), loopDeps);
    const reproduce = requests.find((request) => request.prompt.startsWith('REPRODUCE attempt 1'));
    expect(reproduce?.prompt).toContain(`\`${TEST_COMMAND}\``);
    expect(reproduce?.prompt).toMatch(/run exactly as written/);
  });

  it('control: with no runnableCommands the REPRODUCE instructions are the ones they always were', async () => {
    const root = await lane();
    const { deps: loopDeps, requests } = deps(root, { unit: TEST_COMMAND }, [TEST_COMMAND]);
    await runRcaLoop(defect(), loopDeps);
    const reproduce = requests.find((request) => request.prompt.startsWith('REPRODUCE attempt 1'));
    expect(reproduce?.prompt).not.toContain('test commands run exactly');
  });
});

describe('a configured test command is a whole layer: it gets the engine’s limits, and a command that never started is not a reproduction', () => {
  it('output over a model reproduction’s 1 MB cap does not kill the configured command (it is the layer’s own output)', async () => {
    const root = await lane();
    await writeFile(
      path.join(root, 'big.mjs'),
      "import { existsSync } from 'node:fs';\nprocess.stdout.write('x'.repeat(1_500_000), () => process.exit(existsSync('fixed.marker') ? 0 : 1));\n",
    );
    const { deps: loopDeps } = deps(root, { unit: 'node big.mjs' }, ['node big.mjs']);
    const outcome = await runRcaLoop(defect(), loopDeps);
    // Reproduced (exit 1) and carried on to a recorded RCA: not `needs-more-evidence` for a limit.
    expect(outcome.outcome).toBe('recorded');
  });

  it('a command the shell could not start (exit 127) is not a reproduction: needs-more-evidence saying it could not start', async () => {
    const root = await lane();
    const missing = 'definitely-not-installed-xyz test';
    const { deps: loopDeps } = deps(
      root,
      { unit: missing },
      Array.from({ length: 5 }, () => missing),
    );
    const outcome = await runRcaLoop(defect(), loopDeps);
    expect(outcome.outcome).toBe('needs-more-evidence');
    if (outcome.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(outcome.instrumentationPlan.join('\n')).toContain('starts in the lane');
    expect(outcome.instrumentationPlan.join('\n')).toContain('could not start');
  });
});

describe('the note shows a command exactly as it is granted', () => {
  it.each([
    "node -e 'process.exitCode=1'",
    'node -e "process.exitCode=1"',
    'node test-unit.mjs --a=b:c',
  ])(
    '%s appears verbatim (a proposal copied from the note equals the granted string)',
    async (command) => {
      const root = await lane();
      const { deps: loopDeps, requests } = deps(root, { unit: command }, [command], {
        runnableCommands: [command],
      });
      await runRcaLoop(defect(), loopDeps);
      const reproduce = requests.find((request) =>
        request.prompt.startsWith('REPRODUCE attempt 1'),
      );
      expect(reproduce?.prompt).toContain(`\`${command}\``);
      expect(reproduce?.prompt).not.toContain(JSON.stringify(command));
    },
  );
});

describe('the same loop without the derivation, or with a near miss, runs nothing', () => {
  it('control: with execution.testCommands unset the same proposal is refused (not in the diagnostician’s grant) and the script never runs', async () => {
    const root = await lane();
    const { deps: loopDeps } = deps(
      root,
      {},
      Array.from({ length: 5 }, () => TEST_COMMAND),
    );

    const outcome = await runRcaLoop(defect(), loopDeps);

    expect(outcome.outcome).toBe('needs-more-evidence');
    if (outcome.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(outcome.refusedCommands?.map((entry) => [entry.command, entry.reason])).toEqual(
      Array.from({ length: 5 }, () => [TEST_COMMAND, 'not-in-grant']),
    );
    expect(await runs(root)).toBe(0);
  });

  it.each([
    ['an added argument', `${TEST_COMMAND} --watch`],
    ['a doubled space (the shell would run the same script)', 'node  test-unit.mjs'],
    ['a different script', 'node other.mjs'],
    ['a chained command', `${TEST_COMMAND} && touch pwned`],
    ['a chained command after a semicolon', `${TEST_COMMAND}; touch pwned`],
    ['a substitution', `${TEST_COMMAND} $(touch pwned)`],
    ['an inline program', "node -e \"require('fs').writeFileSync('pwned', 'x')\""],
  ])(
    '%s is refused with RUN-095 and does not run (the configured command is the only one granted)',
    async (_name, proposal) => {
      const root = await lane();
      const { deps: loopDeps } = deps(
        root,
        { unit: TEST_COMMAND },
        Array.from({ length: 5 }, () => proposal),
      );

      const outcome = await runRcaLoop(defect(), loopDeps);

      expect(outcome.outcome).toBe('needs-more-evidence');
      if (outcome.outcome !== 'needs-more-evidence') throw new Error('unreachable');
      expect(outcome.refusedCommands).toHaveLength(5);
      expect(outcome.refusedCommands?.map((entry) => entry.code)).toEqual(
        Array.from({ length: 5 }, () => 'RUN-095'),
      );
      expect(await runs(root)).toBe(0);
      await expect(stat(path.join(root, 'pwned'))).rejects.toThrow();
    },
  );

  it('a configured value that could widen the grant (a chain) grants nothing: not even its first half runs', async () => {
    const root = await lane();
    const hostile = `${TEST_COMMAND} && touch pwned`;
    const { deps: loopDeps } = deps(root, { unit: hostile }, [
      hostile,
      TEST_COMMAND,
      TEST_COMMAND,
      hostile,
      TEST_COMMAND,
    ]);

    const outcome = await runRcaLoop(defect(), loopDeps);

    expect(outcome.outcome).toBe('needs-more-evidence');
    expect(await runs(root)).toBe(0);
    await expect(stat(path.join(root, 'pwned'))).rejects.toThrow();
  });
});
