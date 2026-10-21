/**
 * `forge test adopt [--write [--run <id>]] [--agent] [--check-proof <layer>] [--json]`
 * (`03` §3.2.5 row, `specs/22` M17 P6/P7) -- real, spawned `forge` subprocess tests, the same
 * `bin-exempt.test.ts`-style discipline: a real binary against a real, throwaway fixture directory,
 * never a direct function call.
 *
 * @see specs/03 §3.2.5
 * @see specs/22 M17 P6
 * @see specs/22 M17 P7
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@forge/schemas/config';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

const LAUNCHER = fileURLToPath(new URL('../../../../bin/forge.mjs', import.meta.url));

function run(
  args: readonly string[],
  cwd: string,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args, '-C', cwd], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const execError = error as {
      readonly status: number | null;
      readonly stdout: string;
      readonly stderr: string;
    };
    return { status: execError.status ?? 1, stdout: execError.stdout, stderr: execError.stderr };
  }
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-adopt-'));
  dirs.push(dir);
  return dir;
}

/** A real `.forge/checks/G-TestAdopt.gate.yaml` -- the identical real template `forge init` writes
 * (`templates/checks/G-TestAdopt.gate.yaml`), hand-written here rather than requiring a real `forge
 * init` (which needs a live `ANTHROPIC_API_KEY` for its platform-adapter preflight, out of reach for
 * this bare-fixture test style). */
async function writeGateFile(dir: string): Promise<void> {
  await mkdir(path.join(dir, '.forge', 'checks'), { recursive: true });
  await writeFile(
    path.join(dir, '.forge', 'checks', 'G-TestAdopt.gate.yaml'),
    'id: G-TestAdopt\nname: Test adoption gate\nautonomyOverride: null\nchecks:\n  deterministic:\n    - id: test-adoption:approved\n      run: "forge test adopt --check-proof unit --json"\n      parser: forge-json\n      failOn: "unapproved > 0"\n  advisory: []\nopenQuestionsPolicy: block\napproval:\n  required: true\n  roles: [human]\n  quorum: 1\n',
  );
}

/** A real, minimal `.forge/config.yaml` -- `runPromotion`'s own `mergeStagedCommandIntoConfig`
 * throws `CFG-020` ("never been initialized") without one. */
async function writeBaseConfig(dir: string): Promise<void> {
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(DEFAULT_CONFIG));
}

describe('forge test adopt (specs/22 M17 P6)', () => {
  it('stages a real proposal for a real vitest fixture project and prints it with --json', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2.0.0' } }),
      'utf8',
    );
    const result = run(['test', 'adopt', '--json'], dir);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly v: number;
      readonly outcome: string;
      readonly layer: string;
      readonly candidate: { readonly runner: string; readonly confident: boolean };
    };
    expect(parsed).toMatchObject({
      v: 1,
      outcome: 'staged',
      layer: 'unit',
      candidate: { runner: 'vitest', confident: true },
    });
    const staged = await readFile(path.join(dir, '.forge/test-adopt/unit.proposal.yaml'), 'utf8');
    expect(staged).toContain('source: detected');
  });

  it('hands off (exit 1) for an unrecognised project, naming the agent workflow', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('specs/22 M17 P7');
  });

  // `specs/22` M17 P7 closed this real surface: `--agent` now really dispatches
  // `runAdoptTestsAgent` (`adopt-agent.ts`) rather than refusing with `USR-003`. Proving the real
  // agent session end to end needs a materialised `test-architect` role and a real adapter -- both
  // out of reach for this bare, un-`forge init`-ed fixture directory (the identical real,
  // config-reading refusal `--write`'s own tests below hit first too) -- so this smoke test proves
  // only that the CLI really reaches `buildLoopDepsForProject`'s own real `readConfig` call instead
  // of a stub refusal: a real `CFG-020` ("never been initialized"), never `USR-003` ("not
  // implemented"). The bounded-retry/staging/gate behaviour itself is proven directly, against a
  // real `FakePlatformAdapter` session, in `adopt-agent.test.ts`.
  it('--agent reaches the real dispatch path (CFG-020 for an uninitialized project), never the old USR-003 stub', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', '--agent'], dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('USR-003');
    expect(result.stderr).toContain('never been initialized');
  });

  it('--write refuses (exit 1) when nothing has been staged for this project yet', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', '--write', '--json'], dir);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly outcome: string };
    expect(parsed.outcome).toBe('no-staged-proposal');
  });

  it('--write still refuses a bare detection with no proof, but NOT as "proof-not-passing" (specs/22 M17 P21: the translator proof does not gate a confident, built-in-format detection -- it now reaches "gate-not-available" instead, the next real, distinct reason, since this bare fixture has no G-TestAdopt.gate.yaml at all)', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2.0.0' } }),
      'utf8',
    );
    run(['test', 'adopt'], dir);
    const result = run(['test', 'adopt', '--write', '--json'], dir);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly outcome: string };
    expect(parsed.outcome).toBe('gate-not-available');
  });

  it('--write reaches "not-approved" for a bare detection with no proof, once a real G-TestAdopt.gate.yaml exists but no human has approved it (specs/22 M17 P21)', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2.0.0' } }),
      'utf8',
    );
    await writeGateFile(dir);
    run(['test', 'adopt'], dir);
    const result = run(['test', 'adopt', '--write', '--run', 'p21-no-approval', '--json'], dir);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly outcome: string };
    expect(parsed.outcome).toBe('not-approved');
  });

  it('--write genuinely reaches "promoted" for a bare detection with no proof, end to end through the real "forge gate approve" binary too (specs/22 M17 P21: the defect this closes -- before this fix, --write could NEVER promote the single most common case, a confident Vitest/pytest/node --test/Jest/Mocha detection)', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { vitest: '2.0.0' } }),
      'utf8',
    );
    await writeGateFile(dir);
    await writeBaseConfig(dir);
    const staged = run(['test', 'adopt', '--json'], dir);
    expect(staged.status).toBe(0);

    const runId = 'p21-promoted';
    // The real `G-TestAdopt.gate.yaml` deterministic check (`forge test adopt --check-proof unit
    // --json`) runs as a real, second `forge` subprocess here -- `forge gate approve` shells out to
    // it exactly the way `G-TestAdopt.gate.yaml`'s own `run:` field says, never an in-process stub.
    const approve = run(['gate', 'approve', 'G-TestAdopt', '--run', runId, '--json'], dir);
    expect(approve.status).toBe(0);
    const approveParsed = JSON.parse(approve.stdout) as {
      readonly recorded: boolean;
      readonly evaluation: { readonly checksPassed: number; readonly checksFailed: number };
    };
    expect(approveParsed.recorded).toBe(true);
    expect(approveParsed.evaluation).toMatchObject({ checksPassed: 1, checksFailed: 0 });

    const result = run(['test', 'adopt', '--write', '--run', runId, '--json'], dir);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly v: number;
      readonly outcome: string;
      readonly layer: string;
    };
    expect(parsed).toEqual({ v: 1, outcome: 'promoted', layer: 'unit' });

    const config = YAML.parse(await readFile(path.join(dir, '.forge', 'config.yaml'), 'utf8')) as {
      readonly execution: { readonly testCommands: Readonly<Record<string, unknown>> };
    };
    expect(config.execution.testCommands['unit']).toMatchObject({
      run: 'npx vitest run --reporter=json',
      format: 'vitest-json',
    });
  });

  it("--check-proof <layer> --json (specs/22 M17 P7): G-TestAdopt.gate.yaml's own real check command, against a project with nothing staged", async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', '--check-proof', 'unit', '--json'], dir);
    // EXIT_CODES.failure (1), never `gateFailed` (3): this is one deterministic check command's own
    // exit code, not `forge gate check`'s own aggregate verdict (critic round 2, found by the real
    // `gate-fail-closed.test.ts`/`gate-family-coverage.test.ts` sweep: every shipped check must exit
    // 0 or 1, and the gate's own `failOn: 'unapproved > 0'` -- not this process's exit code -- is what
    // decides the GATE's pass/fail).
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      readonly v: number;
      readonly layer: string;
      readonly unapproved: number;
      readonly detail: string;
    };
    expect(parsed).toMatchObject({ v: 1, layer: 'unit', unapproved: 1 });
    expect(parsed.detail).toContain('no staged proposal');
  });

  it('an unknown flag is a real usage error (exit 2), not silently ignored', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', '--bogus-flag'], dir);
    expect(result.status).toBe(2);
  });

  it('a stray positional argument is a real usage error (exit 2) -- there is no layer argument', async () => {
    const dir = await tempDir();
    const result = run(['test', 'adopt', 'unit'], dir);
    expect(result.status).toBe(2);
  });
});
