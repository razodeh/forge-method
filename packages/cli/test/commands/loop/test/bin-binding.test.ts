/**
 * `forge test binding --story <id> [--json]` (`specs/22` M15 P4) — real subprocess tests, the
 * `bin.test.ts` style `PLAN-M15.md` P4's own "Tests first" line requires: a real, spawned `forge`
 * process against a real, throwaway git project, never a direct function call.
 *
 * @see specs/22 M15 P4
 * @see PLAN-M15.md P4
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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

function storyFixture(filesExpected: readonly string[]): string {
  return `---
id: STORY-001
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

/** A real git project: a base commit (the story, no implementation yet) and — unless `implAtBase` —
 * a second commit adding `impl.js`/`impl.test.js`, so `HEAD~1` genuinely lacks the implementation
 * `forge test binding`'s own default `baseRevision` reverts back to. */
async function freshProject(
  options: {
    readonly filesExpected?: readonly string[];
    readonly testBody?: string;
    readonly implAtBase?: boolean;
    readonly skipImpl?: boolean;
    readonly skipPackageJson?: boolean;
    readonly skipTestCommand?: boolean;
    readonly testCommandOverride?: string;
  } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-binding-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  if (!options.skipPackageJson) {
    await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
  }
  const config = {
    ...DEFAULT_CONFIG,
    execution: {
      ...DEFAULT_CONFIG.execution,
      testCommands: options.skipTestCommand
        ? {}
        : { unit: options.testCommandOverride ?? TEST_COMMAND },
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
    storyFixture(options.filesExpected ?? ['impl.js', 'impl.test.js']),
    'utf8',
  );

  const testBody =
    options.testBody ??
    "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n";
  if (options.implAtBase) {
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    if (!options.skipImpl) await writeFile(path.join(dir, 'impl.test.js'), testBody, 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'base: story and implementation together'], {
      cwd: dir,
    });
    return dir;
  }

  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: story exists, no implementation yet'], {
    cwd: dir,
  });
  if (!options.skipImpl) {
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(path.join(dir, 'impl.test.js'), testBody, 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: implement add()'], { cwd: dir });
  }
  return dir;
}

describe('forge test binding — a genuinely binding suite', () => {
  it('exits 0 with a real v1 JSON envelope, naming the evidence id', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly v: number;
      readonly ok: boolean;
      readonly bound: readonly string[];
      readonly nonBinding: readonly string[];
      readonly exempt: boolean;
      readonly evidenceId: string;
      readonly tests: readonly { readonly name: string; readonly binding: boolean }[];
    };
    expect(parsed.v).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.bound).toEqual(['adds']);
    expect(parsed.nonBinding).toEqual([]);
    expect(parsed.exempt).toBe(false);
    expect(parsed.evidenceId).toMatch(/^MUT-\d{3}$/);
    // A round-3 gauntlet critic (M15 P4) proved by mutation that `tests`' own per-test `binding`
    // field was asserted nowhere: flipping it to its exact logical opposite still passed every test.
    expect(parsed.tests).toEqual([{ name: 'adds', binding: true }]);
  }, 30_000);

  it('--json stdout is exactly one line', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
  }, 30_000);
});

describe('forge test binding — a non-binding test', () => {
  it('exits non-zero, naming each non-binding test, writing evidence anyway', async () => {
    // `skipImpl: true` -- built by hand below, as a test file that genuinely never imports `impl.js`
    // at all (never a shared-file over-credit, `specs/22` M15 P3's own disclosed whole-file-load-
    // failure phenomenon), so the non-binding verdict is real, not an artifact of the fixture.
    const dir = await freshProject({
      filesExpected: ['impl.js', 'tautology.test.js'],
      skipImpl: true,
    });
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: a genuinely unrelated test file'], {
      cwd: dir,
    });

    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).not.toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly ok: boolean;
      readonly nonBinding: readonly string[];
      readonly evidenceId: string;
      readonly tests: readonly { readonly name: string; readonly binding: boolean }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.nonBinding).toEqual(['tautology']);
    expect(parsed.evidenceId).toMatch(/^MUT-\d{3}$/);
    expect(parsed.tests).toEqual([{ name: 'tautology', binding: false }]);
  }, 30_000);
});

describe('forge test binding — a dirty working tree', () => {
  it('is refused before any git work, never reaching the lane/revert/test machinery', async () => {
    const dir = await freshProject();
    await writeFile(path.join(dir, 'untracked.txt'), 'uncommitted\n', 'utf8');

    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(5);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('VCS-010');
    // Nothing was written: the refusal happened before any lane/test/evidence work.
    expect(result.stdout).not.toContain('MUT-');
    // A real, direct check -- not inferred from exit code/stdout alone -- that `createLaneWorktree`
    // (`@forge/vcs`'s own `.forge/state/worktrees/<laneId>/`, `packages/vcs/src/lanes.ts`) never ran:
    // a round-1 gauntlet critic (M15 P4) found this test's assertions alone would not catch a future
    // regression that reordered `assertCleanWorkingTree` to run after lane creation, since a
    // created-then-torn-down lane leaves no trace in exit code or stdout.
    await expect(readdir(path.join(dir, '.forge', 'state', 'worktrees'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 30_000);
});

describe('forge test binding — an unknown story', () => {
  it('is a usage error (exit 2), not a crash', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-999', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('RUN-110');
    expect(result.stderr).not.toContain('at ');
  }, 30_000);

  it('a missing --story flag entirely is also the identical usage error', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('RUN-110');
  }, 30_000);
});

describe('forge test binding — a story document that exists but fails its own schema', () => {
  it('is a distinct RUN-110 message from "no such story" — a round-1 critic (M15 P4) caught these conflated', async () => {
    const dir = await freshProject();
    // A real, correctly-named story (`id: STORY-002`) whose `files_expected` violates the schema
    // (a string, not an array) -- the exact shape a round-1 gauntlet critic reproduced live to show
    // the old, single generic RUN-110 message falsely claimed this story "does not name a real story."
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-002-malformed.md'),
      [
        '---',
        'id: STORY-002',
        'type: Story',
        'schemaVersion: 1',
        'title: Malformed fixture story',
        'files_expected: "this-should-be-an-array-not-a-string"',
        'created: 2026-01-01',
        'updated: 2026-01-01',
        'revision: 1',
        'author: architect',
        'changelog: []',
        '---',
        '',
        'Malformed fixture body.',
        '',
      ].join('\n'),
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'add a malformed story'], { cwd: dir });

    const result = run(['test', 'binding', '--story', 'STORY-002', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as {
      readonly error: { readonly code: string; readonly message: string };
    };
    expect(parsed.error.code).toBe('RUN-110');
    expect(parsed.error.message).toContain('does not validate as a Story');
    expect(parsed.error.message).not.toContain('does not name a real story');
  }, 30_000);
});

describe('forge test binding — no test paths declared', () => {
  it('is a usage error (RUN-111), never silently running the whole project suite', async () => {
    const dir = await freshProject({ filesExpected: ['impl.js'] });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('RUN-111');
  }, 30_000);
});

describe('forge test binding — an undetectable ecosystem', () => {
  it('is a RUN-111 usage error naming the real cause, not the "no test paths" message', async () => {
    // No `package.json` and no Python marker file anywhere -- `detectEcosystem` (`ecosystem.ts`)
    // has nothing to classify this project as, a genuinely distinct cause from "no test paths" (a
    // round-1 gauntlet critic, M15 P4, found only the latter had a regression test).
    const dir = await freshProject({ skipPackageJson: true });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as {
      readonly error: { readonly code: string; readonly message: string };
    };
    expect(parsed.error.code).toBe('RUN-111');
    expect(parsed.error.message).toContain('could not detect a js/python test ecosystem');
  }, 30_000);
});

describe('forge test binding — no configured unit test command', () => {
  it('is a RUN-111 usage error naming the real cause, not the "no test paths" message', async () => {
    const dir = await freshProject({ skipTestCommand: true });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as {
      readonly error: { readonly code: string; readonly message: string };
    };
    expect(parsed.error.code).toBe('RUN-111');
    expect(parsed.error.message).toContain('no execution.testCommands.unit is configured');
  }, 30_000);
});

describe('forge test binding — a story already failing before any mutation', () => {
  it('reports baseline-not-green through the real CLI: exit 1, naming the failing test, writing no evidence', async () => {
    // A round-2 gauntlet critic (M15 P4) found `runTestBindingCommand`'s own non-'completed' outcome
    // mapping (bin.ts's `result.outcome === 'baseline-not-green' ? ... : result.message` ternary) had
    // zero CLI-level test coverage -- only `runBindingCheck` itself (`binding.test.ts`, M15 P3) was
    // ever exercised at that outcome, never the real spawned `forge` binary's own exit code/JSON shape
    // for it.
    const dir = await freshProject({
      testBody:
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(999); });\n",
    });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly ok: boolean; readonly problem: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toContain('already failing before any mutation');
    expect(parsed.problem).toContain('adds');
    // No `MutationEvidence` is written for a check that never completed (`binding-evidence.ts`'s own
    // doc comment): a baseline that never ran under mutation has nothing real to record.
    expect(result.stdout).not.toContain('MUT-');
  }, 30_000);
});

describe('forge test binding — a genuinely broken test command', () => {
  it('reports the real tool-error message through the CLI, the ternary\'s "else" branch', async () => {
    // The companion case to 'baseline-not-green' above: this covers the ternary's other real branch
    // (`result.message`, used by `baseline-tool-error`/`mutated-tool-error`/`restore-verification-
    // tool-error` alike) -- a round-2 critic found this branch untested too. Shell chaining
    // (`shell-safety.ts`'s own `containsShellChaining`) is a real, deterministic way to make
    // `runAndNormalize` itself refuse outright (`'tool-error'`) rather than ever invoking a test
    // runner at all, never flaky the way an actually-broken command's exit code could be.
    const dir = await freshProject({ testCommandOverride: `${TEST_COMMAND} && echo done` });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly ok: boolean; readonly problem: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toContain('shell chaining');
    expect(result.stdout).not.toContain('MUT-');
  }, 30_000);
});

describe('forge test binding — plain-text output (no --json)', () => {
  // A round-3 gauntlet critic (M15 P4) found every one of this file's other tests passes `--json`,
  // leaving the entire human-readable branch of `runTestBindingCommand` (the success summary line,
  // the per-test `non-binding: <name>` stderr lines, and the plain-text early-failure line) with zero
  // real-CLI coverage -- confirmed live against the sibling `forge story verify`'s own non-`--json`
  // test (`packages/cli/test/bin-story-verify.test.ts`), which already covers its own plain-text path.
  it('prints a human-readable summary line and exits 0 for a genuinely binding suite', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-001'], dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('forge test binding --story STORY-001:');
    expect(result.stdout).toContain('bound=1');
    expect(result.stdout).toContain('nonBinding=0');
    expect(result.stdout).toContain('restoreVerified=true');
    expect(result.stdout).toMatch(/evidence=MUT-\d{3}\./);
  }, 30_000);

  it('prints the summary line plus one "non-binding: <name>" line per non-binding test, on stderr', async () => {
    const dir = await freshProject({
      filesExpected: ['impl.js', 'tautology.test.js'],
      skipImpl: true,
    });
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: a genuinely unrelated test file'], {
      cwd: dir,
    });

    const result = run(['test', 'binding', '--story', 'STORY-001'], dir);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('forge test binding --story STORY-001:');
    expect(result.stderr).toContain('non-binding: tautology');
  }, 30_000);
});
