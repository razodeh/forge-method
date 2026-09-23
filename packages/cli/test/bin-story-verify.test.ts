/**
 * `forge story verify <storyId> [--phase verify|done] [--json]` (`10` §10.6 steps 6 and 9, `09` §9.8 as
 * amended by `PLAN-M14.md` P1, `PLAN-M13.md` P22, `PLAN-M14.md` P25), invoked as a real subprocess so the
 * literal command lines `implement-story.workflow.yaml`'s `self-verify` (default phase) and `done-check`
 * (`--phase done`) steps run are proven to be accepted, to read the project it is pointed at (`-C`), and
 * to exit as documented.
 *
 * @see specs/09 §9.8
 * @see specs/10 §10.6
 * @see PLAN-M13.md P22
 * @see PLAN-M14.md P1, P25
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@forge/schemas/config';
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

function forge(args: readonly string[], cwd: string): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      cwd,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

const BASE = {
  schemaVersion: 1,
  created: '2026-01-01',
  updated: '2026-01-01',
  revision: 1,
  author: 'po',
  changelog: [],
};

const STORY = {
  ...BASE,
  id: 'STORY-001',
  type: 'Story',
  title: 'Fixture story',
  status: 'in-progress',
  epic: 'EPIC-001',
  capability: 'CAP-001',
  storyType: 'feature',
  size: 'M',
  owner_role: 'backend',
  depends_on: [],
  blocked_by: [],
  interfaces: [],
  data: [],
  files_expected: ['src/a.ts'],
  context_refs: [],
  acceptance: [{ id: 'AC-001-1', given: 'g', when: 'w', then: 't', kind: 'functional' }],
  tests: [],
  dod_profile: 'backend-default',
};

/** A bare project: the config (`readConfig` needs only that), one Story and one DoD profiles file. `checks`
 * populates the `verify` list by default (the phase `forge story verify` runs with no `--phase`); pass
 * `phase: 'done'` to populate the `done` list instead, for a `--phase done` case. */
async function project(
  checks: readonly string[],
  testCommands: Readonly<Record<string, string>> = {},
  phase: 'verify' | 'done' = 'verify',
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-story-verify-'));
  dirs.push(dir);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  const config = {
    ...DEFAULT_CONFIG,
    execution: { ...DEFAULT_CONFIG.execution, testCommands },
  };
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(config), 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001.md'),
    `---\n${YAML.stringify(STORY)}---\n\nBody.\n`,
    'utf8',
  );
  await mkdir(path.join(dir, 'docs/forge/kb/engineering'), { recursive: true });
  const list = checks.map((entry) => `      - ${entry}`).join('\n');
  const verifyLine = phase === 'verify' ? `    verify:\n${list}\n` : '';
  const doneLine = phase === 'done' ? `    done:\n${list}\n` : '    done: []\n';
  await writeFile(
    path.join(dir, 'docs/forge/kb/engineering/dod-profiles.yaml'),
    `profiles:\n  backend-default:\n    ready: []\n${verifyLine}${doneLine}`,
    'utf8',
  );
  return dir;
}

describe('forge story verify (real subprocess)', () => {
  it('exits 0 with a {v:1} envelope when every verify check passes (the default phase)', async () => {
    const dir = await project(["'story.acceptance.length > 0'"]);
    const result = forge(['story', 'verify', 'STORY-001', '--json'], dir);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      v: 1,
      storyId: 'STORY-001',
      profile: 'backend-default',
      phase: 'verify',
      passed: true,
      errors: 0,
    });
  });

  it('exits 1 when a check fails, with the failing check in the envelope', async () => {
    const dir = await project(["'story.acceptance.length > 3'"]);
    const result = forge(['story', 'verify', 'STORY-001', '--json'], dir);
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout) as {
      passed: boolean;
      errors: number;
      checks: unknown[];
    };
    expect(body.passed).toBe(false);
    expect(body.errors).toBe(1);
    expect(body.checks).toEqual([
      expect.objectContaining({ check: 'story.acceptance.length > 3', status: 'fail' }),
    ]);
  });

  it('a pre-M14 profile with no verify list AT ALL prints the "kb lint" warning on stderr and in the --json envelope', async () => {
    const dir = await project(['{ check: security:secrets-scan }']); // fails -> exit 1, real stderr captured
    const withoutVerify = path.join(dir, 'docs/forge/kb/engineering/dod-profiles.yaml');
    await writeFile(
      withoutVerify,
      // No `verify:` key at all: a real pre-M14 profile file (`load.ts`'s own "kb lint" advisory names it).
      'profiles:\n  backend-default:\n    ready: []\n    done:\n      - { check: security:secrets-scan }\n',
      'utf8',
    );
    const result = forge(['story', 'verify', 'STORY-001', '--phase', 'done', '--json'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('forge: warning:');
    expect(result.stderr).toContain('verify');
    expect(result.stderr).toContain('09 §9.8');
    const body = JSON.parse(result.stdout) as { warnings: string[] };
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain('verify');
  });

  it('exits 1 for a check it cannot verify, never 0', async () => {
    const dir = await project(['{ check: security:secrets-scan }']);
    const result = forge(['story', 'verify', 'STORY-001', '--json'], dir);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      passed: false,
      checks: [expect.objectContaining({ status: 'unverifiable' })],
    });
  });

  it('reads the project named by -C, not the working directory, and prints text without --json', async () => {
    const dir = await project(["'story.acceptance.length > 0'"]);
    const elsewhere = await mkdtemp(path.join(tmpdir(), 'forge-cli-story-verify-cwd-'));
    dirs.push(elsewhere);
    const result = forge(['story', 'verify', 'STORY-001', '-C', dir], elsewhere);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('every verify check passed');
  });

  it('exits 2 for a story that does not exist, naming the remedy', async () => {
    const dir = await project([]);
    const result = forge(['story', 'verify', 'STORY-404', '--json'], dir);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('STORY-404');
    expect(result.stderr).toContain('forge spec list');
  });

  it('exits 2 for the usage mistakes: no id, two ids, a stray flag, a bad subcommand, an invalid --phase, none', async () => {
    const dir = await project([]);
    for (const args of [
      ['story', 'verify'],
      ['story', 'verify', 'STORY-001', 'STORY-002'],
      ['story', 'verify', 'STORY-001', '--bogus'],
      ['story', 'verify', 'STORY-001', '--phase', 'bogus'],
      ['story', 'verify', 'STORY-001', '--phase'],
      ['story', 'nonsense', 'STORY-001'],
      ['story'],
    ]) {
      expect(forge(args, dir).status, args.join(' ')).toBe(2);
    }
  });

  it('checks the arguments before it reads the project: a bare directory still exits 2, not a config error', async () => {
    const bare = await mkdtemp(path.join(tmpdir(), 'forge-cli-story-verify-bare-'));
    dirs.push(bare);
    expect(forge(['story', 'verify'], bare).status).toBe(2);
    // With a valid argument list the same directory is refused as an uninitialised project (exit 5).
    expect(forge(['story', 'verify', 'STORY-001'], bare).status).toBe(5);
  });

  it('reads execution.testCommands from the project config: a real vitest unit layer binds a passing test to the AC', async () => {
    const require = createRequire(import.meta.url);
    const vitestPackage = require.resolve('vitest/package.json');
    const bin = (require(vitestPackage) as { bin: Record<string, string> }).bin['vitest'];
    if (bin === undefined) throw new Error('vitest has no bin entry');
    const command = `${process.execPath} ${path.join(path.dirname(vitestPackage), bin)} run --root .`;
    const dir = await project(['{ check: test:unit }', '{ check: spec:ac-coverage }'], {
      unit: command,
    });
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const test = (expected: number): string =>
      `import { test, expect } from 'vitest'; test('AC-001-1 adds', () => { expect(1 + 1).toBe(${String(expected)}); });`;
    await writeFile(path.join(dir, 'sample.test.js'), test(2), 'utf8');
    const green = forge(['story', 'verify', 'STORY-001', '--json'], dir);
    expect(green.status).toBe(0);
    expect(JSON.parse(green.stdout)).toMatchObject({ passed: true, errors: 0 });

    await writeFile(path.join(dir, 'sample.test.js'), test(3), 'utf8');
    const red = forge(['story', 'verify', 'STORY-001', '--json'], dir);
    expect(red.status).toBe(1);
    const body = JSON.parse(red.stdout) as { checks: { check: string; status: string }[] };
    expect(body.checks.map((entry) => entry.status)).toEqual(['fail', 'fail']);
  }, 120_000);

  it('a configured typecheck command runs and its answer decides the check (config wiring, not a stub)', async () => {
    // `false` exits non-zero with no diagnostics to count: the run cannot be verified, so exit 1, not 0.
    const dir = await project(['{ check: build:typecheck }'], { typecheck: 'false' });
    const result = forge(['story', 'verify', 'STORY-001', '--json'], dir);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      checks: [expect.objectContaining({ check: 'build:typecheck', status: 'unverifiable' })],
    });
    // With no typecheck command configured at all it says so, and never runs anything.
    const bare = await project(['{ check: build:typecheck }']);
    const none = JSON.parse(forge(['story', 'verify', 'STORY-001', '--json'], bare).stdout) as {
      checks: { message: string }[];
    };
    expect(none.checks[0]?.message).toContain('execution.testCommands.typecheck');
  });

  it('refuses --dry-run (it would run the project test commands anyway) and runs nothing', async () => {
    const marker = path.join(tmpdir(), `forge-story-verify-marker-${String(process.pid)}`);
    const dir = await project(['{ check: build:typecheck }'], { typecheck: `touch ${marker}` });
    const result = forge(['story', 'verify', 'STORY-001', '--dry-run'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--dry-run');
    await expect(stat(marker)).rejects.toThrow();
  });

  it('--phase verify given explicitly behaves exactly like the default (omitted)', async () => {
    const dir = await project(["'story.acceptance.length > 0'"]);
    const result = forge(['story', 'verify', 'STORY-001', '--phase', 'verify', '--json'], dir);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ phase: 'verify', passed: true, errors: 0 });
  });
});

describe('forge story verify --phase done (real subprocess)', () => {
  it("exits 0 with phase: done when every done check passes, ignoring the same profile's verify list", async () => {
    const dir = await project(["'story.acceptance.length > 0'"], {}, 'done');
    const result = forge(['story', 'verify', 'STORY-001', '--phase', 'done', '--json'], dir);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      v: 1,
      storyId: 'STORY-001',
      profile: 'backend-default',
      phase: 'done',
      passed: true,
      errors: 0,
    });
  });

  it('the real 09 §9.8 done-phase ids (no deterministic implementation) are each unverifiable, never a pass', async () => {
    const dir = await project(
      [
        '{ check: review:blocking-findings == 0 }',
        '{ check: docs:public-api-documented }',
        '{ check: kb:no-new-contradictions }',
      ],
      {},
      'done',
    );
    const result = forge(['story', 'verify', 'STORY-001', '--phase', 'done', '--json'], dir);
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout) as { checks: { status: string }[] };
    expect(body.checks.map((entry) => entry.status)).toEqual(Array(3).fill('unverifiable'));
  });

  it('prints "every done check passed" in the text form, distinct from the verify form', async () => {
    const dir = await project(["'story.acceptance.length > 0'"], {}, 'done');
    const result = forge(['story', 'verify', 'STORY-001', '--phase', 'done'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('every done check passed');
  });
});
