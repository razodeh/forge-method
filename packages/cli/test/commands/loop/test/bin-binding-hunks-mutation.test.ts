/**
 * `forge test binding --story <id> --hunks --base <ref> [--max-hunks <n>]` — the real, spawned-
 * subprocess CLI wiring for M16 P12's own additions (`--max-hunks`, the `--story` requirement, and
 * the `--json` envelope's additive hunk-mode fields), the `bin-binding.test.ts` style `PLAN-M15.md` P4
 * already established for this command: a real `forge` process against a real, throwaway git
 * project, never a direct function call. Deep per-hunk verdict correctness (killed/uncovered/invalid/
 * timeout, degrade, contamination) is `hunk-mutation.test.ts`'s own job, at the engine level; this
 * file proves the CLI dispatch actually wires `--max-hunks`/`--story` to it, with the real flags, and
 * that the envelope and exit code behave exactly as `13` F-TEST-10 and `03` §3.2.5 row 117 require.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P12
 * @see process/SPEC-QUESTIONS.md Q294 Decision 8
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@forge/schemas/config';

const LAUNCHER = fileURLToPath(new URL('../../../../bin/forge.mjs', import.meta.url));

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

const TEST_COMMAND = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;

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

function storyFixture(filesExpected: readonly string[], id = 'STORY-001'): string {
  return `---
id: ${id}
type: Story
schemaVersion: 1
title: Fixture story
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
status: ready
owner_role: developer
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected:
${filesExpected.map((file) => `  - ${file}`).join('\n')}
context_refs: []
acceptance:
  - id: AC-001-1
    given: two numbers
    when: add is called
    then: the sum is returned
    kind: functional
tests: []
dod_profile: default
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
---

Fixture story body.
`;
}

/** A real git project with a real base commit (the story alone) and a real second commit (the real
 * implementation plus its own test) — `baseSha` is that base commit's own real sha, the value `--base`
 * is given below, equal to the default `HEAD~1` range (`13` F-TEST-10's own golden requirement: "with
 * --base equal to the default range"). The identical `bin-binding.test.ts`'s own `freshProject`
 * shape, duplicated rather than imported (this file owns its fixture independently, the same
 * convention `hunks.test.ts`'s own doc comment already states for the identical reason). */
async function freshProject(options: {
  readonly testCommandOverride?: string;
  readonly testBody?: string;
}): Promise<{ readonly dir: string; readonly baseSha: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-mutation-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
  const config = {
    ...DEFAULT_CONFIG,
    execution: {
      ...DEFAULT_CONFIG.execution,
      testCommands: { unit: options.testCommandOverride ?? TEST_COMMAND },
    },
  };
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/kb'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/plans'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/sessions'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    storyFixture(['impl.js', 'impl.test.js']),
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: story exists, no implementation yet'], {
    cwd: dir,
  });
  const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });

  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) { return a + b; }\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.test.js'),
    options.testBody ??
      "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'the story: implement add()'], { cwd: dir });

  return { dir, baseSha: baseSha.trim() };
}

interface Envelope {
  readonly v: number;
  readonly passed: boolean;
  readonly incomplete: number;
  readonly bound: readonly string[];
  readonly nonBinding: readonly string[];
  readonly exempt: boolean;
  readonly evidenceId: string;
  readonly restoreVerified: boolean;
  readonly tests: readonly { readonly name: string; readonly binding: boolean }[];
  readonly hunks?: readonly {
    readonly id: string;
    readonly path: string;
    readonly verdict: string;
    readonly killedBy?: readonly string[];
    readonly reason?: string;
  }[];
  readonly granularity?: string;
  readonly uncoveredHunks?: number;
  readonly invalidHunks?: number;
  readonly timeoutHunks?: number;
  readonly skippedHunks?: number;
}

describe('forge test binding --hunks — --max-hunks and --story wiring (specs/22 M16 P12)', () => {
  it("a malformed --max-hunks is a real, typed RUN-139 usage refusal, before the hunk-mutation engine ever runs (though --base HEAD's own real git resolution, resolveHunkModeBase, still happens first)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-mutation-bad-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

    const result = run(
      [
        'test',
        'binding',
        '--story',
        'STORY-001',
        '--hunks',
        '--base',
        'HEAD',
        '--max-hunks',
        'not-a-number',
        '--json',
      ],
      dir,
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout.trim()) as {
      readonly error?: { readonly code?: string };
    };
    expect(parsed.error?.code).toBe('RUN-139');
  });

  it('--max-hunks 0 is refused (RUN-139): n must be at least 1', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-mutation-zero-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

    const result = run(
      [
        'test',
        'binding',
        '--story',
        'STORY-001',
        '--hunks',
        '--base',
        'HEAD',
        '--max-hunks',
        '0',
        '--json',
      ],
      dir,
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout.trim()) as {
      readonly error?: { readonly code?: string };
    };
    expect(parsed.error?.code).toBe('RUN-139');
  });

  it('--hunks without --story is refused (USR-005), before any config or story is read', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-mutation-nostory-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

    const result = run(['test', 'binding', '--hunks', '--base', 'HEAD', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout.trim()) as {
      readonly error?: { readonly code?: string };
    };
    expect(parsed.error?.code).toBe('USR-005');
    expect(result.stderr).toContain('--story');
  });

  it('--max-hunks without --hunks is refused (USR-005): the flag has no effect outside hunk mode', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-mutation-maxnohunks-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

    const result = run(
      ['test', 'binding', '--story', 'STORY-001', '--max-hunks', '5', '--json'],
      dir,
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout.trim()) as {
      readonly error?: { readonly code?: string };
    };
    expect(parsed.error?.code).toBe('USR-005');
    expect(result.stderr).toContain('--max-hunks');
  });
});

describe('forge test binding --hunks — the golden, through the real CLI (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it('with --base equal to the default range, every M15 field is byte-identical to a run without --hunks', async () => {
    const plain = await freshProject({});
    const hunked = await freshProject({});

    const plainResult = run(['test', 'binding', '--story', 'STORY-001', '--json'], plain.dir);
    const hunkedResult = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', hunked.baseSha, '--json'],
      hunked.dir,
    );

    expect(plainResult.status).toBe(0);
    expect(hunkedResult.status).toBe(0);
    const plainEnvelope = JSON.parse(plainResult.stdout.trim()) as Envelope;
    const hunkedEnvelope = JSON.parse(hunkedResult.stdout.trim()) as Envelope;

    // Strip the additive-only fields before comparing -- every M15 field underneath must still match,
    // including `evidenceId` (each project is a FRESH fixture of its own, so both independently
    // allocate the identical first-ever id, "MUT-001").
    const {
      hunks,
      granularity,
      uncoveredHunks,
      invalidHunks,
      timeoutHunks,
      skippedHunks,
      ...m15Fields
    } = hunkedEnvelope;
    expect(m15Fields).toEqual(plainEnvelope);
    expect(hunks).toBeDefined();
    expect(granularity).toBe('hunk');
    expect(uncoveredHunks).toBe(0);
    expect(invalidHunks).toBe(0);
    expect(timeoutHunks).toBe(0);
    expect(skippedHunks).toBe(0);
  }, 30_000);

  it('exit code is identical with and without --hunks: a passing story', async () => {
    const plain = await freshProject({});
    const hunked = await freshProject({});

    const plainResult = run(['test', 'binding', '--story', 'STORY-001'], plain.dir);
    const hunkedResult = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', hunked.baseSha],
      hunked.dir,
    );

    expect(plainResult.status).toBe(hunkedResult.status);
    expect(plainResult.status).toBe(0);
  }, 30_000);

  /** Builds a project whose SINGLE named test binds the whole change (so the change-level check
   * passes with `nonBinding: []`, `restoreVerified: true`, exit 0) while ONE of its two real hunks is
   * genuinely `uncovered` at hunk granularity (`sub` is never called by anything) -- the one real
   * scenario that can tell "hunk verdicts never change the exit code" apart from "this fixture
   * happens to have no uncovered hunks to leak in the first place" (mutation evidence item 2 needs a
   * real passing (incomplete === 0) run with a non-empty uncovered-hunk count, or a mutation that
   * folds `uncoveredHunks` into `incomplete` has nothing to flip). */
  async function projectWithOneUncoveredHunk(): Promise<{
    readonly dir: string;
    readonly baseSha: string;
  }> {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-mutation-exitparity-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
    const config = {
      ...DEFAULT_CONFIG,
      execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: TEST_COMMAND } },
    };
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
    await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
      storyFixture(['impl.js', 'impl.test.js']),
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) {\n  return 0;\n}\n\nexport function sub(a, b) {\n  return 0;\n}\n',
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'base: two buggy stubs'], { cwd: dir });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl.test.js'),
      "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: fix both, only add() is tested'], {
      cwd: dir,
    });
    return { dir, baseSha: baseSha.trim() };
  }

  it('exit code is identical with and without --hunks: a passing story that also has one genuinely uncovered hunk', async () => {
    const plain = await projectWithOneUncoveredHunk();
    const hunked = await projectWithOneUncoveredHunk();

    const plainResult = run(['test', 'binding', '--story', 'STORY-001'], plain.dir);
    const hunkedResult = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', hunked.baseSha, '--json'],
      hunked.dir,
    );

    expect(plainResult.status).toBe(0);
    expect(hunkedResult.status).toBe(0);
    expect(plainResult.status).toBe(hunkedResult.status);
    const parsed = JSON.parse(hunkedResult.stdout.trim()) as Envelope;
    // Confirms the fixture genuinely has an uncovered hunk to leak -- otherwise this test would pass
    // vacuously regardless of whether `incomplete` ever reads it.
    expect(parsed.uncoveredHunks).toBe(1);
  }, 30_000);

  it('exit code is identical with and without --hunks: an incomplete story (a non-binding test)', async () => {
    const tautologyBody =
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n";
    const plain = await freshProject({ testBody: tautologyBody });
    const hunked = await freshProject({ testBody: tautologyBody });

    const plainResult = run(['test', 'binding', '--story', 'STORY-001'], plain.dir);
    const hunkedResult = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', hunked.baseSha],
      hunked.dir,
    );

    expect(plainResult.status).toBe(hunkedResult.status);
    expect(plainResult.status).toBe(1);
  }, 30_000);

  it('exit code is identical with and without --hunks: a refusal (baseline-not-green)', async () => {
    const alreadyBrokenBody =
      "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('already broken', () => { expect(add(1, 2)).toBe(999); });\n";
    const plain = await freshProject({ testBody: alreadyBrokenBody });
    const hunked = await freshProject({ testBody: alreadyBrokenBody });

    const plainResult = run(['test', 'binding', '--story', 'STORY-001'], plain.dir);
    const hunkedResult = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', hunked.baseSha],
      hunked.dir,
    );

    expect(plainResult.status).toBe(hunkedResult.status);
    expect(plainResult.status).toBe(1);
    // Confirms the hunk-mode run really did go through the "never reaches 'completed'" path, not
    // merely that both happen to share a 1 -- the DECISION that `hunkMutation` is omitted entirely.
    const hunkedJson = run(
      ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', hunked.baseSha, '--json'],
      hunked.dir,
    );
    const parsed = JSON.parse(hunkedJson.stdout.trim()) as Envelope;
    expect(parsed.hunks).toBeUndefined();
    expect(parsed.granularity).toBeUndefined();
  }, 30_000);
});

describe('forge test binding --hunks — --max-hunks reaches the real engine (specs/22 M16 P12)', () => {
  it('a real --max-hunks 1 over two real hunks degrades granularity to "file", through the full CLI wiring', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-mutation-degrade-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
    const config = {
      ...DEFAULT_CONFIG,
      execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: TEST_COMMAND } },
    };
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
    await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
      storyFixture(['impl.js', 'impl.test.js']),
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) {\n  return 0;\n}\n\nexport function sub(a, b) {\n  return 0;\n}\n',
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'base: two buggy stubs'], { cwd: dir });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl.test.js'),
      "import { test, expect } from 'vitest';\n" +
        "import { add, sub } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n" +
        "test('subtracts', () => { expect(sub(3, 1)).toBe(2); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: fix both, two hunks'], { cwd: dir });

    const result = run(
      [
        'test',
        'binding',
        '--story',
        'STORY-001',
        '--hunks',
        '--base',
        baseSha.trim(),
        '--max-hunks',
        '1',
        '--json',
      ],
      dir,
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as Envelope;
    expect(parsed.granularity).toBe('file');
    expect(parsed.hunks).toHaveLength(2);
  }, 30_000);
});
