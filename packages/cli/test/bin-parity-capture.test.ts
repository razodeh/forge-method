/**
 * `forge parity capture [--name <name>] [--json]` (`PLAN-M16.md` P6, `13` F-TEST-9, Q294 Amendment
 * A8), invoked as a real subprocess: proves the CLI dispatch wiring itself (`bin.ts`'s new `parity`
 * noun), the `--json` envelope's exact one-line shape, and the plain-text exit path — concerns
 * `capture-command.test.ts`'s own direct, in-process calls of `runParityCapture` cannot exercise
 * (nothing there ever goes through `bin.ts`'s own argument parsing or console output).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P6
 * @see process/SPEC-QUESTIONS.md Q294 Amendment A8
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function forge(
  args: readonly string[],
  cwd: string,
  envOverlay: Readonly<Record<string, string>> = {},
): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      cwd,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverlay },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

/** A real, bare git repository with one commit, plus one real, stable `.forge/parity/sample.parity.yaml`
 * declaration whose reference is that exact commit — just enough for `forge parity capture` to
 * succeed for real against a real repository. */
async function freshProjectWithDeclaration(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p6-bin-capture-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitkeep'), '', 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  const { stdout: sha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });

  const yaml = `name: sample
reference:
  ref: ${sha.trim()}
review:
  by: tester
  basis: read the diff by hand
  at: 2026-01-01
expires: 2999-01-01
surfaces:
  process:
    run: "node -e \\"process.stdout.write('ok')\\""
    stability:
      runs: 2
    cases:
      - {}
`;
  await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
  await writeFile(path.join(dir, '.forge/parity/sample.parity.yaml'), yaml, 'utf8');
  return dir;
}

function lastJsonLine(stdout: string): unknown {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  expect(lines).toHaveLength(1); // `--json` prints exactly one line (`03` §3.5).
  return JSON.parse(lines[0] ?? '');
}

describe('forge parity capture (real subprocess dispatch) (specs/22 M16 P6)', () => {
  it('captures for real under --json, printing exactly one parseable {v:1,...} envelope line', async () => {
    const dir = await freshProjectWithDeclaration();

    const result = forge(['parity', 'capture', '--json', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly v: number;
      readonly captured: number;
      readonly unchanged: number;
      readonly captures: readonly { readonly name: string; readonly file: string }[];
    };
    expect(envelope).toEqual({
      v: 1,
      captured: 1,
      unchanged: 0,
      captures: [{ name: 'sample', file: envelope.captures[0]?.file }],
    });
    expect(envelope.captures[0]?.file).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it('captures for real without --json, printing a human-readable summary and exiting 0', async () => {
    const dir = await freshProjectWithDeclaration();

    const result = forge(['parity', 'capture', '-C', dir], dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('captured 1');
    expect(result.stdout).toContain('sample ->');
  });

  it('a second real invocation reports unchanged under --json', async () => {
    const dir = await freshProjectWithDeclaration();
    expect(forge(['parity', 'capture', '--json', '-C', dir], dir).status).toBe(0);

    const second = forge(['parity', 'capture', '--json', '-C', dir], dir);
    expect(second.status).toBe(0);
    const envelope = lastJsonLine(second.stdout) as {
      readonly captured: number;
      readonly unchanged: number;
    };
    expect(envelope).toMatchObject({ captured: 0, unchanged: 1 });
  });

  it('--name selects one real declaration by name', async () => {
    const dir = await freshProjectWithDeclaration();

    const result = forge(['parity', 'capture', '--name', 'sample', '--json', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly captures: readonly { readonly name: string }[];
    };
    expect(envelope.captures.map((c) => c.name)).toEqual(['sample']);
  });

  it('refuses a --name matching no real declaration with exit 2 and a typed --json error envelope', async () => {
    const dir = await freshProjectWithDeclaration();

    const result = forge(['parity', 'capture', '--name', 'nope', '--json', '-C', dir], dir);

    expect(result.status).toBe(2);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly error: { readonly code: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-132');
    expect(result.stderr).toContain('sample'); // the plain-text refusal still names what does exist.
  });

  it('refuses under a real FORGE_RUN_ID, with a typed --json error envelope, never a stack trace', async () => {
    const dir = await freshProjectWithDeclaration();

    const result = forge(['parity', 'capture', '--json', '-C', dir], dir, {
      FORGE_RUN_ID: 'run-from-a-real-session',
    });

    expect(result.status).not.toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly error: { readonly code: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-136');
    // No stack trace frame ("    at functionName (file:line:col)") leaked to a human either — not a
    // bare `.not.toContain('at ')`, which the remedy's own prose ("a person AT their own terminal")
    // would trip on by accident.
    expect(result.stderr).not.toMatch(/^\s*at\s+\S+.*:\d+:\d+\)?\s*$/m);
  });

  it('an unknown "parity" subcommand is a plain usage error, not a crash', async () => {
    const dir = await freshProjectWithDeclaration();

    const result = forge(['parity', 'bogus', '-C', dir], dir);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('needs a real subcommand');
  });
});
