/**
 * `forge test run --rule smoke|contract` — the two layer checks `G-Deliver` (`test:smoke`) and `G-Integration`
 * (`contract:cross-service`) name (`PLAN-M13.md` P25, `13` §13.1 F-TEST-1 rule 4, `14` §14.9).
 *
 * Exit-code driven (`01` D6: "deterministic gates ... exit-code driven"): the project's own configured command for
 * the layer is the oracle, so any test runner works. What is proved here is the part FORGE owns: an unset or
 * unusable command is a typed failure (never a silent pass), the command runs exactly as configured (nothing is
 * appended to it, nothing is interpolated into it), a hung or chatty command is stopped, and the result is a
 * deterministic per-command verdict.
 *
 * @see specs/13 §13.1
 * @see specs/14 §14.9
 * @see PLAN-M13.md P25
 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isForgeError } from '@forge/core/errors';
import { afterEach, describe, expect, it } from 'vitest';

import { testRunLayer } from '../../../../src/commands/loop/test/layer.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-test-layer-'));
  dirs.push(dir);
  return dir;
}

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('testRunLayer: a layer with no usable command is a typed failure, never a pass', () => {
  for (const rule of ['smoke', 'contract'] as const) {
    it(`${rule}: no command configured -> ENV-006 naming execution.testCommands.${rule}, with a remedy`, async () => {
      const dir = await project();
      const error = await thrown(testRunLayer({ projectRoot: dir, testCommands: {} }, rule));
      expect(isForgeError(error)).toBe(true);
      if (!isForgeError(error)) return;
      expect(error.code).toBe('ENV-006');
      expect(error.message).toContain(`execution.testCommands.${rule}`);
      expect(error.message).toContain('not set');
      expect(error.remedy).toMatch(/^Set /);
    });

    it(`${rule}: a command for a different layer does not stand in for it`, async () => {
      const dir = await project();
      const error = await thrown(
        testRunLayer(
          { projectRoot: dir, testCommands: { unit: 'true', e2e: 'true', lint: 'true' } },
          rule,
        ),
      );
      expect(isForgeError(error) && error.code).toBe('ENV-006');
    });
  }

  it('a blank command, and one holding a line break or NUL, is unusable', async () => {
    const dir = await project();
    for (const command of ['', '   ', 'true\nrm -rf x', 'tr\u0000ue']) {
      const error = await thrown(
        testRunLayer({ projectRoot: dir, testCommands: { smoke: command } }, 'smoke'),
      );
      expect(isForgeError(error) && error.code, JSON.stringify(command)).toBe('ENV-006');
    }
  });
});

describe('testRunLayer: runs the configured command and reports one verdict per command', () => {
  it('a YAML block scalar (`smoke: |`), which ends in a newline, runs as the command it is', async () => {
    const dir = await project();
    const result = await testRunLayer(
      { projectRoot: dir, testCommands: { smoke: 'echo smoke-ok\n' } },
      'smoke',
    );
    expect(result.failed).toBe(0);
    expect(result.commands[0]?.command).toBe('echo smoke-ok');
    const crlf = await testRunLayer(
      { projectRoot: dir, testCommands: { smoke: 'echo ok\r\n' } },
      'smoke',
    );
    expect(crlf.failed).toBe(0);
  });

  it('exit 0 passes', async () => {
    const dir = await project();
    const result = await testRunLayer(
      { projectRoot: dir, testCommands: { smoke: 'echo smoke-ok' } },
      'smoke',
    );
    expect(result).toMatchObject({ rule: 'smoke', failed: 0, errors: 0 });
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      layer: 'smoke',
      command: 'echo smoke-ok',
      exitCode: 0,
      passed: true,
    });
    expect(result.problems).toBeUndefined();
  });

  it('a non-zero exit fails, keeps the exit code, and quotes the tail of the output for the reader', async () => {
    const dir = await project();
    const result = await testRunLayer(
      {
        projectRoot: dir,
        testCommands: { contract: 'echo consumer says no >&2; exit 3' },
      },
      'contract',
    );
    expect(result.failed).toBe(1);
    expect(result.commands[0]).toMatchObject({ layer: 'contract', exitCode: 3, passed: false });
    expect(result.commands[0]?.output).toContain('consumer says no');
    expect(result.problems?.[0]).toContain('exited 3');
  });

  it('a command that cannot even start fails (shell exit 127), it is not skipped', async () => {
    const dir = await project();
    const result = await testRunLayer(
      { projectRoot: dir, testCommands: { smoke: 'no-such-binary-anywhere-p25' } },
      'smoke',
    );
    expect(result.failed).toBe(1);
    expect(result.commands[0]?.passed).toBe(false);
  });

  it('runs in the project root', async () => {
    const dir = await project();
    await writeFile(path.join(dir, 'marker.txt'), 'here', 'utf8');
    const result = await testRunLayer(
      { projectRoot: dir, testCommands: { smoke: 'test -f marker.txt' } },
      'smoke',
    );
    expect(result.failed).toBe(0);
  });

  it("runs the string exactly as configured: nothing is appended and shell syntax is the author's own", async () => {
    const dir = await project();
    const result = await testRunLayer(
      {
        projectRoot: dir,
        testCommands: {
          smoke: `${JSON.stringify(process.execPath)} -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" | grep -q '^\\[\\]$'`,
        },
      },
      'smoke',
    );
    expect(result.failed, JSON.stringify(result)).toBe(0);
  });

  it('interpolates nothing into the command: the rule name and the project path are not part of it', async () => {
    const dir = await project();
    const result = await testRunLayer(
      {
        projectRoot: dir,
        testCommands: { smoke: 'test "$#" -eq 0 && test -z "$1"' },
      },
      'smoke',
    );
    expect(result.failed).toBe(0);
  });

  it('is deterministic: two runs of the same command give byte-identical results', async () => {
    const dir = await project();
    const context = { projectRoot: dir, testCommands: { smoke: 'echo a; echo b >&2; exit 2' } };
    const first = await testRunLayer(context, 'smoke');
    const second = await testRunLayer(context, 'smoke');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('writes nothing under the project: it must not replace the project-wide test report or the flake state', async () => {
    const dir = await project();
    await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/reports/test-results.json'),
      '{"v":1,"outcomes":[]}',
    );
    await testRunLayer({ projectRoot: dir, testCommands: { contract: 'true' } }, 'contract');
    expect(await readFile(path.join(dir, 'docs/forge/reports/test-results.json'), 'utf8')).toBe(
      '{"v":1,"outcomes":[]}',
    );
    await expect(access(path.join(dir, 'docs/forge/reports/flaky.json'))).rejects.toThrow();
  });
});

describe('testRunLayer: a command that hangs or floods is stopped and fails', () => {
  it('a command that outlives the timeout fails with timedOut, quickly, even with a grandchild holding the pipe', async () => {
    const dir = await project();
    const started = Date.now();
    const result = await testRunLayer(
      {
        projectRoot: dir,
        testCommands: { smoke: 'sleep 30 & sleep 30' },
        limits: { timeoutMs: 400, maxOutputBytes: 10_000 },
      },
      'smoke',
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.failed).toBe(1);
    expect(result.commands[0]).toMatchObject({ passed: false, timedOut: true });
    expect(result.problems?.[0]).toContain('did not finish within 400ms');
  });

  it('a command that exits 0 but wrote more than the output cap still fails', async () => {
    const dir = await project();
    const result = await testRunLayer(
      {
        projectRoot: dir,
        testCommands: { contract: 'yes | head -c 200000; true' },
        limits: { timeoutMs: 20_000, maxOutputBytes: 1_000 },
      },
      'contract',
    );
    expect(result.failed).toBe(1);
    expect(result.commands[0]).toMatchObject({ passed: false, outputLimitExceeded: true });
    expect(result.commands[0]?.output?.length ?? 0).toBeLessThanOrEqual(2_100);
  });

  it('the default caps are finite and stated', async () => {
    const { TEST_LAYER_LIMITS } = await import('../../../../src/commands/loop/test/layer.ts');
    expect(TEST_LAYER_LIMITS.timeoutMs).toBeGreaterThan(0);
    expect(TEST_LAYER_LIMITS.timeoutMs).toBeLessThanOrEqual(3_600_000);
    expect(TEST_LAYER_LIMITS.maxOutputBytes).toBeGreaterThan(0);
    expect(TEST_LAYER_LIMITS.maxOutputBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});
