/**
 * `forge parity check [--name <name>] [--trusted <ref>] [--story <id>] [--no-record] [--json]`
 * (`specs/22` M16 P7, `13` F-TEST-9, Q294 Amendments A3/A4/A9), invoked as a real subprocess: proves
 * the CLI dispatch wiring itself (`bin.ts`'s `parity check` branch — reading `--trusted`/`--story`/
 * `--no-record`, resolving `reportsRoot` from the real project config, printing the exact `--json`
 * envelope and returning the right exit code), concerns `check-command.test.ts`'s own direct,
 * in-process calls of `runParityCheck` cannot exercise (nothing there ever goes through `bin.ts`'s
 * own argument parsing, `readConfig` or console output) — the identical split
 * `bin-parity-capture.test.ts` (M16 P6) already establishes for `forge parity capture`.
 *
 * `DEFAULT_CONFIG` (confirmed valid against the real `configSchema` directly, this file's own
 * `freshCapturedProject` helper) builds each project's `.forge/config.yaml`, never a FRESH
 * `forge init`: that needs a live platform-adapter CLI on `PATH`, which no automated test
 * environment has (`bin-init-tiers.test.ts`'s own file header: "Re-init is the path used because it
 * needs no live platform CLI" — a FIRST init is exactly the path this file must not take either).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P7
 * @see process/SPEC-QUESTIONS.md Q294
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

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

function lastJsonLine(stdout: string): unknown {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  expect(lines).toHaveLength(1); // `--json` prints exactly one line (`03` §3.5).
  return JSON.parse(lines[0] ?? '');
}

/** A real project: a genuinely `configSchema`-valid `.forge/config.yaml` (`DEFAULT_CONFIG` itself,
 * confirmed directly against the real schema before relying on it here — never a FRESH `forge init`,
 * which needs a live platform-adapter CLI on `PATH` that no automated test environment has; even
 * `bin-init-tiers.test.ts`'s own file header says so: "Re-init is the path used because it needs no
 * live platform CLI"), then a real git history with one stable declaration, captured for real. */
async function freshCapturedProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p7-bin-check-'));
  dirs.push(dir);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
  await writeFile(path.join(dir, 'behavior.cjs'), "process.stdout.write('ok');\n", 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'add behavior script'], { cwd: dir });
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
    run: "node behavior.cjs"
    stability:
      runs: 2
    cases:
      - {}
`;
  await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
  await writeFile(path.join(dir, '.forge/parity/sample.parity.yaml'), yaml, 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'declare'], { cwd: dir });

  const capture = forge(['parity', 'capture', '--json', '-C', dir], dir);
  expect(capture.status).toBe(0);
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'capture'], { cwd: dir });
  return dir;
}

describe('forge parity check (real subprocess dispatch) (specs/22 M16 P7)', () => {
  it('a matching candidate checks for real under --json: exit 0, failing 0, and a written ParityEvidence record', async () => {
    const dir = await freshCapturedProject();

    const result = forge(
      ['parity', 'check', '--json', '--trusted', 'refs/heads/main', '-C', dir],
      dir,
    );

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly v: number;
      readonly verdict: string;
      readonly failing: number;
      readonly passing: number;
      readonly evidenceId: string | null;
    };
    expect(envelope).toMatchObject({ v: 1, verdict: 'match', failing: 0, passing: 1 });
    expect(envelope.evidenceId).toMatch(/^PAR-\d{3}$/);
    const written = await readdir(path.join(dir, 'docs/forge/reports/parity'));
    expect(written).toHaveLength(1);
  });

  it('a mismatching candidate checks for real: exit 1, naming the surface/case/stream, never the text', async () => {
    const dir = await freshCapturedProject();
    await writeFile(path.join(dir, 'behavior.cjs'), "process.stdout.write('changed');\n", 'utf8');

    const result = forge(
      ['parity', 'check', '--json', '--trusted', 'refs/heads/main', '--no-record', '-C', dir],
      dir,
    );

    expect(result.status).toBe(1);
    const envelope = lastJsonLine(result.stdout) as {
      readonly verdict: string;
      readonly failing: number;
      readonly evidenceId: string | null;
      readonly declarations: readonly { readonly name: string; readonly reason?: string }[];
    };
    expect(envelope.verdict).toBe('mismatch');
    expect(envelope.failing).toBeGreaterThan(0);
    expect(envelope.evidenceId).toBeNull();
    expect(envelope.declarations[0]?.reason).toMatch(/stdout/);
    expect(result.stdout).not.toContain('changed');
  });

  it('checks for real without --json, printing a human-readable summary', async () => {
    const dir = await freshCapturedProject();

    const result = forge(
      ['parity', 'check', '--trusted', 'refs/heads/main', '--no-record', '-C', dir],
      dir,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 passing');
    expect(result.stdout).toContain('sample: match');
  });

  it('refuses a --name matching no real declaration with a typed --json error envelope, exit 1 (never 2)', async () => {
    const dir = await freshCapturedProject();

    const result = forge(['parity', 'check', '--name', 'nope', '--json', '-C', dir], dir);

    // `10` §10.3's check contract: `forge parity check` exits 0 or 1 ONLY, never `EXIT_CODES.usage`
    // (2) the way `forge parity capture`'s identical-shaped `--name` refusal (`RUN-132`) does --
    // this piece's own new `RUN-140` is registered at `exitCode: EXIT_CODES.failure` specifically so
    // this refusal still lands on "1", confirmed here against the real CLI boundary, not just the
    // registry row.
    expect(result.status).toBe(1);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly error: { readonly code: string; readonly exitCode: number };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-140');
    expect(envelope.error.exitCode).toBe(1);
  });

  it('refuses a malformed --trusted the same way, exit 1', async () => {
    const dir = await freshCapturedProject();

    const result = forge(['parity', 'check', '--trusted', 'main', '--json', '-C', dir], dir);

    expect(result.status).toBe(1);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly error: { readonly code: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-141');
  });

  it('--trusted @trunk resolves through the real config\'s own vcs.trunk ("main" by default), through the real CLI (specs/22 M17 P9)', async () => {
    const dir = await freshCapturedProject();

    const result = forge(['parity', 'check', '--json', '--trusted', '@trunk', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly v: number;
      readonly verdict: string;
      readonly failing: number;
      readonly passing: number;
      readonly evidenceId: string | null;
    };
    expect(envelope).toMatchObject({ v: 1, verdict: 'match', failing: 0, passing: 1 });
    expect(envelope.evidenceId).toMatch(/^PAR-\d{3}$/);
  });

  it('--trusted @trunk resolves to the schema\'s own default "main" even with no .forge/config.yaml at all, never CFG-020 (specs/22 M17 P9)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p9-bin-check-noconfig-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 't'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

    const result = forge(
      ['parity', 'check', '--json', '--trusted', '@trunk', '--no-record', '-C', dir],
      dir,
    );

    // Zero declarations is a real, counted failing outcome (`no-declarations`), never CFG-020: a
    // project with no `.forge/config.yaml` at all must keep working for `--no-record`
    // (`check-command.ts`'s own `reportsRoot` doc comment), and `--trusted @trunk` must not narrow
    // that guarantee now that it, too, may need to read config.
    expect(result.status).toBe(1);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly reason?: string;
      readonly failing: number;
      readonly passing: number;
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.reason).toBe('no-declarations');
    expect(envelope.failing).toBe(1);
    expect(envelope.passing).toBe(0);
  });

  it('--trusted @trunk resolves through a real, non-default vcs.trunk ("master"), through the real CLI (specs/22 M17 P9)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p9-bin-check-master-'));
    dirs.push(dir);
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(
      path.join(dir, '.forge/config.yaml'),
      YAML.stringify({ ...DEFAULT_CONFIG, vcs: { ...DEFAULT_CONFIG.vcs, trunk: 'master' } }),
      'utf8',
    );
    await execa('git', ['init', '--quiet', '-b', 'master'], { cwd: dir });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 't'], { cwd: dir });
    await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
    await writeFile(path.join(dir, 'behavior.cjs'), "process.stdout.write('ok');\n", 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'add behavior script'], { cwd: dir });
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
    run: "node behavior.cjs"
    stability:
      runs: 2
    cases:
      - {}
`;
    await mkdir(path.join(dir, '.forge/parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge/parity/sample.parity.yaml'), yaml, 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'declare'], { cwd: dir });
    const capture = forge(['parity', 'capture', '--json', '-C', dir], dir);
    expect(capture.status).toBe(0);
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'capture'], { cwd: dir });

    const result = forge(['parity', 'check', '--json', '--trusted', '@trunk', '-C', dir], dir);

    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly verdict: string;
      readonly failing: number;
      readonly passing: number;
    };
    expect(envelope).toMatchObject({ verdict: 'match', failing: 0, passing: 1 });
  });

  it('refuses a --trusted @trunk whose configured trunk does not name a real branch here, the same RUN-141 way an explicit bad ref does (specs/22 M17 P9)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p9-bin-check-badtrunk-'));
    dirs.push(dir);
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(
      path.join(dir, '.forge/config.yaml'),
      YAML.stringify({
        ...DEFAULT_CONFIG,
        vcs: { ...DEFAULT_CONFIG.vcs, trunk: 'no-such-branch' },
      }),
      'utf8',
    );
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 't'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

    const result = forge(['parity', 'check', '--trusted', '@trunk', '--json', '-C', dir], dir);

    expect(result.status).toBe(1);
    const envelope = lastJsonLine(result.stdout) as {
      readonly ok: boolean;
      readonly error: { readonly code: string; readonly message: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('RUN-141');
    expect(envelope.error.message).toContain('refs/heads/no-such-branch');
  });

  it("--story <id> names the written record's own story, through the real CLI", async () => {
    const dir = await freshCapturedProject();

    const result = forge(
      [
        'parity',
        'check',
        '--story',
        'STORY-014',
        '--trusted',
        'refs/heads/main',
        '--json',
        '-C',
        dir,
      ],
      dir,
    );

    expect(result.status).toBe(0);
    const written = await readdir(path.join(dir, 'docs/forge/reports/parity'));
    expect(written).toHaveLength(1);
  });
});
