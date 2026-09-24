/**
 * `createRcaShell`, the `runShell` `forge debug` gives the RCA loop (`PLAN-M13.md` P28, `SPEC-QUESTIONS.md` Q222):
 * a proposed command is vetted against the agent's grant and run confined; an engine command is run confined without
 * the vet; a refusal is a typed result (`RUN-095`), not an exception and not an execution.
 */
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRcaShell } from '../../src/rca/shell.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function lane(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'forge-rca-shell-')));
  dirs.push(dir);
  return dir;
}

const GRANT = {
  exec: ['git *', 'ls*', 'cat*', 'sleep*', 'yes*', 'env', 'true', 'sh *'],
  network: 'none',
} as const;

describe('createRcaShell', () => {
  it('a refused proposed command comes back as a typed result: exit 126, no output, RUN-095, its reason; and the callback sees it', async () => {
    const root = await lane();
    const seen: { command: string; reason: string }[] = [];
    const runShell = createRcaShell({
      grant: GRANT,
      root,
      parentEnv: process.env,
      onRefused: (refusal) => {
        seen.push({ command: refusal.command, reason: refusal.reason });
      },
    });
    const canary = path.join(root, 'canary');
    const result = await runShell(`cat a; touch ${canary}`, root, 'proposed');
    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe('');
    expect(result.refusal).toMatchObject({ code: 'RUN-095', reason: 'shell-operator' });
    expect(result.refusal?.message).toContain('refused and not run');
    expect(seen).toEqual([{ command: `cat a; touch ${canary}`, reason: 'shell-operator' }]);
    await expect(stat(canary)).rejects.toThrow();
  });

  it('an allowed proposed command runs in the lane and reports its own exit code', async () => {
    const root = await lane();
    await writeFile(path.join(root, 'a.txt'), 'hello\n');
    const runShell = createRcaShell({ grant: GRANT, root, parentEnv: process.env });
    expect(await runShell('cat a.txt', root, 'proposed')).toEqual({
      stdout: 'hello',
      stderr: '',
      exitCode: 0,
    });
    expect((await runShell('cat missing.txt', root, 'proposed')).exitCode).toBe(1);
  });

  it('an engine command is not vetted (it may chain: it is FORGE’s own text) but is still scrubbed', async () => {
    const root = await lane();
    const runShell = createRcaShell({
      grant: { exec: false, network: 'none' },
      root,
      parentEnv: { PATH: process.env['PATH'], ANTHROPIC_API_KEY: 'canary-key', TZ: 'UTC' },
    });
    const result = await runShell('echo a && env', root, 'engine');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('a\n');
    expect(result.stdout).toContain('TZ=UTC');
    expect(result.stdout).not.toContain('canary-key');
    expect(result.refusal).toBeUndefined();
  });

  it('a proposed command is scrubbed too, and git inside it reads neither the user’s nor the system’s config', async () => {
    const root = await lane();
    const runShell = createRcaShell({
      grant: GRANT,
      root,
      parentEnv: { PATH: process.env['PATH'], GITHUB_TOKEN: 'canary-token' },
    });
    const result = await runShell('env', root, 'proposed');
    expect(result.stdout).not.toContain('canary-token');
    expect(result.stdout).toContain('GIT_CONFIG_GLOBAL=/dev/null');
  });

  it('the FORGE run/step/agent marker (@forge/core/session-marker, PLAN-M14.md P4) never reaches a proposed or engine RCA shell command, even when it is already present in parentEnv -- a nested "forge debug" run inside a command step would otherwise inherit it via ExecuteStepContext.commandEnv (commandEnvFor/commandStepEnvironment)', async () => {
    const root = await lane();
    const runShell = createRcaShell({
      grant: GRANT,
      root,
      parentEnv: {
        PATH: process.env['PATH'],
        FORGE_RUN_ID: 'outer-run-id-should-never-leak',
        FORGE_STEP_ID: 'outer-step-id-should-never-leak',
        FORGE_AGENT_ID: 'outer-agent-id-should-never-leak',
      },
    });
    const proposed = await runShell('env', root, 'proposed');
    expect(proposed.stdout).not.toContain('FORGE_RUN_ID');
    expect(proposed.stdout).not.toContain('FORGE_STEP_ID');
    expect(proposed.stdout).not.toContain('FORGE_AGENT_ID');
    expect(proposed.stdout).not.toContain('should-never-leak');

    const engine = await runShell('echo a && env', root, 'engine');
    expect(engine.stdout).not.toContain('FORGE_RUN_ID');
    expect(engine.stdout).not.toContain('FORGE_STEP_ID');
    expect(engine.stdout).not.toContain('FORGE_AGENT_ID');
    expect(engine.stdout).not.toContain('should-never-leak');
  });

  it('a proposed command that outlives its limit is killed and reported, not left running', async () => {
    const root = await lane();
    const runShell = createRcaShell({
      grant: GRANT,
      root,
      parentEnv: process.env,
      proposedLimits: { timeoutMs: 300, maxOutputBytes: 10_000 },
    });
    const started = Date.now();
    const result = await runShell('sleep 30', root, 'proposed');
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('a proposed command that writes more than the output cap is stopped and reported', async () => {
    const root = await lane();
    const runShell = createRcaShell({
      grant: GRANT,
      root,
      parentEnv: process.env,
      proposedLimits: { timeoutMs: 20_000, maxOutputBytes: 500 },
    });
    const result = await runShell('yes', root, 'proposed');
    expect(result.outputLimitExceeded).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(500);
  });

  it('a proposal accepted via the <trusted> <path> extension (PLAN-M14.md P5/P24) gets the engine’s own limits, not the tighter proposed-command budget', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'), { recursive: true });
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    await writeFile(path.join(root, 'sleep.mjs'), 'setTimeout(() => process.exit(0), 1000);\n');
    const runShell = createRcaShell({
      grant: { exec: [], network: 'none' },
      trustedCommands: ['node sleep.mjs'],
      root,
      parentEnv: process.env,
      // A model’s own ad-hoc reproduction would be killed by this before the script’s 1s delay elapses; the
      // engine’s own limits below are generous enough that it is not.
      proposedLimits: { timeoutMs: 200, maxOutputBytes: 10_000 },
      engineLimits: { timeoutMs: 5_000, maxOutputBytes: 10_000 },
    });
    const result = await runShell('node sleep.mjs tests/x.test.ts', root, 'proposed');
    expect(result.timedOut).not.toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.refusal).toBeUndefined();
  });

  it('the same accepted <trusted> <path> proposal is refused for a project that configures no execution.testCommands (trustedCommands empty): the extension never widens an untrusted grant', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'), { recursive: true });
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    const runShell = createRcaShell({
      grant: { exec: [], network: 'none' },
      root,
      parentEnv: process.env,
    });
    const result = await runShell('true tests/x.test.ts', root, 'proposed');
    expect(result.refusal).toMatchObject({ code: 'RUN-095', reason: 'not-in-grant' });
  });

  it('the default limits are finite (a proposed command can never run unbounded)', async () => {
    const { PROPOSED_COMMAND_LIMITS, ENGINE_COMMAND_LIMITS } =
      await import('../../src/dispatch/confined-command.ts');
    for (const limits of [PROPOSED_COMMAND_LIMITS, ENGINE_COMMAND_LIMITS]) {
      expect(Number.isFinite(limits.timeoutMs) && limits.timeoutMs > 0).toBe(true);
      expect(Number.isFinite(limits.maxOutputBytes) && limits.maxOutputBytes > 0).toBe(true);
    }
    expect(PROPOSED_COMMAND_LIMITS.timeoutMs).toBeLessThanOrEqual(ENGINE_COMMAND_LIMITS.timeoutMs);
  });
});
