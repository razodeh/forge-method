/**
 * `forge test exempt <storyId> <testId> --reason --owner --expires` (`specs/22` M15 P6) — real
 * subprocess tests, the `bin-binding.test.ts`-style `PLAN-M15.md` P6's own "Tests first" line
 * requires: a real, spawned `forge` process against a real, throwaway git project, never a direct
 * function call.
 *
 * @see specs/22 M15 P6
 * @see PLAN-M15.md P6
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

function storyFixture(filesExpected: readonly string[], status = 'done', id = 'STORY-001'): string {
  return `---
id: ${id}
type: Story
schemaVersion: 1
title: Fixture story
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
status: ${status}
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

/** A real git project with ONE non-binding test (`tautology`, in its own file, never touching
 * `impl.js`) alongside the real, genuinely binding `adds` test -- `forge test exempt` needs a real,
 * currently non-binding test to exempt, and a real, currently binding one to confirm its own refusal
 * against (`GATE-515` `'exempts-a-binding-test'`). */
async function freshProject(
  options: {
    readonly tautologyTestName?: string;
  } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-exempt-'));
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
  // `.forge/state/` is where a real binding check's own scratch lane worktree lives
  // (`@forge/vcs`) -- a real `forge init`-created project always gitignores it; without this,
  // ordinary cleanup timing under heavy system load can transiently leave a worktree directory
  // visible to `git status`, failing an UNRELATED later command's own `assertCleanWorkingTree`
  // for a reason no real project would ever actually hit.
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/kb'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    storyFixture(['impl.js', 'impl.test.js', 'tautology.test.js']),
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: story exists, no implementation yet'], {
    cwd: dir,
  });

  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) { return a + b; }\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.test.js'),
    "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    'utf8',
  );
  const tautologyName = options.tautologyTestName ?? 'tautology';
  await writeFile(
    path.join(dir, 'tautology.test.js'),
    `import { test, expect } from 'vitest';\ntest('${tautologyName}', () => { expect(true).toBe(true); });\n`,
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa(
    'git',
    ['commit', '--quiet', '-m', 'the story: implement add(), plus an unrelated test'],
    {
      cwd: dir,
    },
  );
  return dir;
}

/** `forge test exempt` only writes `reports/exemptions.md` -- it does not commit it (no standalone
 * collection-file-writing command in this codebase auto-commits; `configSet --commit` is opt-in, and
 * even that commits only `.forge/config.yaml`). A real caller commits the declaration like any other
 * change before the next `forge test binding`/`forge story verify` run, which requires a clean tree
 * (`assertCleanWorkingTree`) -- this fixture helper stands in for that real commit step. */
async function commitAll(dir: string, message: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
}

/** Folds the just-declared `reports/exemptions.md` into the PRIOR commit (the implementation one)
 * rather than adding a new commit on top of it -- `forge test binding`'s own single-story
 * `baseRevision: 'HEAD~1'` (`specs/22` M15 P3/P4, a real, already-disclosed limitation, not something
 * P6 fixes) only reverts the implementation correctly when it is genuinely the MOST RECENT commit: a
 * separate exemption-declaration commit on top of it would shift `HEAD~1` forward, off the true
 * pre-implementation base, and silently break every test in this suite that needs a real, correct
 * binding verdict after declaring an exemption (not merely a `'problem'` outcome, which fires
 * independently of the raw binding result and so does not expose this). */
async function amendOntoImplementation(dir: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--amend', '--no-edit', '--quiet'], { cwd: dir });
}

/** `offsetDays` from the REAL current date, not a fixed anchor -- `DEFAULT_CONFIG.gates.waiverMaxDays`
 * (90) is measured from the moment `forge test exempt` actually runs (`SYSTEM_CLOCK`), so a fixture
 * date anchored to a fixed year could silently drift outside (or inside) the cap as real time passes. */
function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/** Launches `forge` as a real, independent OS process and resolves with its result -- unlike `run()`
 * above (`execFileSync`, synchronous, one process at a time), this is what actually lets the test
 * below start several REAL, overlapping `forge test exempt` processes and `Promise.all` them, the
 * shape `appendExemption`'s own real concurrency risk (two separate OS processes, not two calls in
 * one process) needs to be tested against. */
function runAsync(
  args: readonly string[],
  cwd: string,
): Promise<{ readonly status: number; readonly stdout: string; readonly stderr: string }> {
  return execa(process.execPath, [LAUNCHER, ...args, '-C', cwd], {
    reject: false,
  }).then((result) => ({
    status: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  }));
}

/** A real git project with `storyCount` independent `done` stories, each with its own genuinely
 * non-binding `tautology-N` test and its own dummy, never-exercised implementation file -- every
 * story's own implementation lands in the SAME final commit (not one commit per story), so every
 * story's own `HEAD~1` still resolves to the shared pre-implementation base (the identical
 * single-most-recent-commit assumption `amendOntoImplementation`'s own doc comment explains). Separate
 * stories, not separate tests on the SAME story: concurrent `forge test exempt` calls against the same
 * story would additionally race `runOneStoryBinding`'s own `runId` (`bin.ts`, a real, pre-existing,
 * UNRELATED collision risk a round-1 critic found incidentally, not part of this diff) -- this fixture
 * sidesteps that entirely so the test below isolates exactly one thing, `appendExemption`'s own
 * cross-process lock. */
async function freshMultiStoryProject(storyCount: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-exempt-multi-'));
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
  // `.forge/state/` is where a real binding check's own scratch lane worktree lives
  // (`@forge/vcs`) -- a real `forge init`-created project always gitignores it; without this,
  // ordinary cleanup timing under heavy system load can transiently leave a worktree directory
  // visible to `git status`, failing an UNRELATED later command's own `assertCleanWorkingTree`
  // for a reason no real project would ever actually hit.
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/kb'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });

  for (let index = 1; index <= storyCount; index += 1) {
    const storyId = `STORY-${String(index).padStart(3, '0')}`;
    await writeFile(
      path.join(dir, `docs/forge/specs/stories/${storyId}-fixture.md`),
      storyFixture(
        [`impl${String(index)}.js`, `tautology${String(index)}.test.js`],
        'done',
        storyId,
      ),
      'utf8',
    );
  }
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: stories exist, no implementations yet'], {
    cwd: dir,
  });

  for (let index = 1; index <= storyCount; index += 1) {
    await writeFile(
      path.join(dir, `impl${String(index)}.js`),
      'export const unused = 1;\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, `tautology${String(index)}.test.js`),
      `import { test, expect } from 'vitest';\ntest('tautology${String(index)}', () => { expect(true).toBe(true); });\n`,
      'utf8',
    );
  }
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'implement every story at once'], { cwd: dir });
  return dir;
}

describe('forge test exempt — a valid exemption', () => {
  it('suppresses exactly one non-binding test and no other, and forge test binding then passes', async () => {
    const dir = await freshProject();

    const exempt = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        'A pure tautology, never touches impl.js.',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
        '--json',
      ],
      dir,
    );
    expect(exempt.status).toBe(0);
    const exemptParsed = JSON.parse(exempt.stdout) as {
      readonly recorded: boolean;
      readonly id: string;
      readonly testId: string;
    };
    expect(exemptParsed.recorded).toBe(true);
    expect(exemptParsed.id).toMatch(/^EXEMPT-\d{3}$/);
    expect(exemptParsed.testId).toBe('STORY-001: tautology');
    await amendOntoImplementation(dir);

    const binding = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);
    expect(binding.status).toBe(0);
    const bindingParsed = JSON.parse(binding.stdout) as {
      readonly passed: boolean;
      readonly nonBinding: readonly string[];
      readonly exempt: boolean;
      readonly bound: readonly string[];
    };
    expect(bindingParsed.passed).toBe(true);
    expect(bindingParsed.nonBinding).toEqual([]);
    expect(bindingParsed.exempt).toBe(true);
    expect(bindingParsed.bound).toEqual(['adds']);
  }, 60_000);

  it('is written to reports/exemptions.md as a real, schema-shaped collection entry', async () => {
    const dir = await freshProject();
    run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        'A pure tautology.',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
      ],
      dir,
    );
    const text = await readFile(path.join(dir, 'docs/forge/reports/exemptions.md'), 'utf8');
    expect(text).toContain('testId: "STORY-001: tautology"');
    expect(text).toContain('owner: alice');
  }, 60_000);
});

describe('forge test exempt — refusals', () => {
  it('refuses to exempt a test that genuinely binds (GATE-515)', async () => {
    const dir = await freshProject();
    const result = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'adds',
        '--reason',
        'Trying to exempt the real one.',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
        '--json',
      ],
      dir,
    );
    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('GATE-515');
  }, 60_000);

  it('refuses a malformed --owner (GATE-513)', async () => {
    const dir = await freshProject();
    const result = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        'A pure tautology.',
        '--owner',
        'not a real identifier',
        '--expires',
        isoDate(30),
        '--json',
      ],
      dir,
    );
    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('GATE-513');
  }, 60_000);

  it('refuses an --expires beyond the configured cap (GATE-515)', async () => {
    const dir = await freshProject();
    const result = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        'A pure tautology.',
        '--owner',
        'alice',
        '--expires',
        isoDate(9999),
        '--json',
      ],
      dir,
    );
    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('GATE-515');
  }, 60_000);

  it('is a usage error for a blank --reason (an exemption without a reason is a schema error)', async () => {
    const dir = await freshProject();
    const result = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        '   ',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
      ],
      dir,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--reason');
  }, 60_000);

  it('is a usage error when --reason/--owner/--expires are missing entirely', async () => {
    const dir = await freshProject();
    const result = run(['test', 'exempt', 'STORY-001', 'tautology'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--reason');
  }, 60_000);

  it('is refused before any git work for a dirty tree', async () => {
    const dir = await freshProject();
    await writeFile(path.join(dir, 'untracked.txt'), 'uncommitted\n', 'utf8');
    const result = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        'A pure tautology.',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
        '--json',
      ],
      dir,
    );
    expect(result.status).toBe(5);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('VCS-010');
  }, 60_000);
});

describe('forge test exempt — stale and expired exemptions (checked later, by forge test binding)', () => {
  it('a stale exemption (its own test was renamed) fails test:binding, naming itself', async () => {
    const dir = await freshProject();
    const exempt = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        'A pure tautology.',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
      ],
      dir,
    );
    expect(exempt.status).toBe(0);
    await amendOntoImplementation(dir);

    await writeFile(
      path.join(dir, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('renamed', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await commitAll(dir, 'rename the tautology test');

    const binding = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);
    expect(binding.status).toBe(1);
    const parsed = JSON.parse(binding.stdout) as { readonly ok: boolean; readonly problem: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toContain('STORY-001: tautology');
    expect(parsed.problem).toContain('stale');
  }, 60_000);

  it('an expired exemption fails test:binding, naming its expiry and owner', async () => {
    const dir = await freshProject();
    const exempt = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        'A pure tautology.',
        '--owner',
        'alice',
        '--expires',
        isoDate(-1),
      ],
      dir,
    );
    expect(exempt.status).toBe(0);
    await amendOntoImplementation(dir);

    const binding = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);
    expect(binding.status).toBe(1);
    const parsed = JSON.parse(binding.stdout) as { readonly ok: boolean; readonly problem: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toContain('STORY-001: tautology');
    expect(parsed.problem).toContain('alice');
    expect(parsed.problem).toContain('expired');
  }, 60_000);
});

describe('forge test exempt — real cross-process concurrency', () => {
  it('5 real, separate forge test exempt processes, declared concurrently against 5 different stories, all survive with 5 distinct ids', async () => {
    // A round-1 gauntlet critic (both independent reviewers) reproduced live that an EARLIER version
    // of appendExemption's own in-process lock gave two separate `forge test exempt` processes
    // nothing: concurrent real CLI invocations silently raced the same read-modify-write, and only
    // one of several "successful" declarations actually survived. This test exercises exactly that
    // shape -- real, separate OS processes, not Promise.all in one process -- against the fix
    // (withExemptionsLock, a real .forge/state/exemptions.lock file).
    const storyCount = 5;
    const dir = await freshMultiStoryProject(storyCount);

    const calls = Array.from({ length: storyCount }, (_unused, index) => {
      const n = index + 1;
      const storyId = `STORY-${String(n).padStart(3, '0')}`;
      return runAsync(
        [
          'test',
          'exempt',
          storyId,
          `tautology${String(n)}`,
          '--reason',
          `A pure tautology for story ${String(n)}.`,
          '--owner',
          'alice',
          '--expires',
          isoDate(30),
          '--json',
        ],
        dir,
      );
    });
    const results = await Promise.all(calls);

    for (const [index, result] of results.entries()) {
      expect(result.status, `story ${String(index + 1)}: ${result.stderr}`).toBe(0);
    }
    const parsedResults = results.map(
      (result) => JSON.parse(result.stdout) as { readonly recorded: boolean; readonly id: string },
    );
    expect(parsedResults.every((parsed) => parsed.recorded)).toBe(true);
    // The real, load-bearing assertion: every one of the 5 concurrent declarations actually survived
    // in the shared reports/exemptions.md, each with its own distinct id -- not silently clobbered by
    // another call's own read-modify-write, and not collided on the same allocated id.
    const ids = parsedResults.map((parsed) => parsed.id);
    expect(new Set(ids).size).toBe(storyCount);

    const text = await readFile(path.join(dir, 'docs/forge/reports/exemptions.md'), 'utf8');
    const frontMatterText = text.split('---\n')[1] ?? '';
    const parsed = YAML.parse(frontMatterText) as { readonly exemptions: readonly unknown[] };
    expect(parsed.exemptions).toHaveLength(storyCount);
  }, 120_000);
});

describe('forge test exempt — a refusal leaves the tree exactly as clean as it found it', () => {
  it('a GATE-515 exempts-a-binding-test refusal writes no MutationEvidence, so an immediate retry does not hit VCS-010', async () => {
    // A round-1 gauntlet critic (independent reviewer B) reproduced live that an EARLIER version of
    // this command's own pre-check (runOneStoryBinding, which always writes MutationEvidence on a
    // 'completed' outcome) left the project tree dirty after refusing to exempt a genuinely binding
    // test -- the user's own very next command (even a retry of the identical forge test exempt call)
    // then failed with an unrelated VCS-010, never reaching this command's own logic at all.
    const dir = await freshProject();

    const refused = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'adds',
        '--reason',
        'Trying to exempt the real one.',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
        '--json',
      ],
      dir,
    );
    expect(refused.status).toBe(2);

    const status = await execa('git', ['status', '--short'], { cwd: dir });
    expect(status.stdout.trim(), 'the refusal must leave the working tree untouched').toBe('');

    // The real proof: an immediate retry reaches this command's own real logic again (another clean
    // GATE-515 refusal), rather than tripping over VCS-010 debris from the first attempt.
    const retried = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'adds',
        '--reason',
        'Trying again.',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
        '--json',
      ],
      dir,
    );
    expect(retried.status).toBe(2);
    const parsed = JSON.parse(retried.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('GATE-515');
  }, 60_000);
});

describe('forge test exempt — hostile input the CLI-level checks must themselves catch', () => {
  it('refuses a calendar-invalid --expires (e.g. 2026-02-30) cleanly, never as an uncaught crash', async () => {
    // A round-1 gauntlet critic (both independent reviewers) reproduced live that Date.parse silently
    // rolls a calendar-invalid day-of-month over into the next month (Date.parse('2026-02-30') parses
    // as March 2, 2026) rather than rejecting it -- the EARLIER regex+Date.parse guard let this reach
    // appendExemption's own internal exemptionSchema check as an uncaught, non-ForgeError RangeError,
    // after a real, expensive binding check had already run.
    const dir = await freshProject();
    const result = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        'A pure tautology.',
        '--owner',
        'alice',
        '--expires',
        '2026-02-30',
        '--json',
      ],
      dir,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain('at ');
    expect(result.stderr).toContain('--expires');

    const status = await execa('git', ['status', '--short'], { cwd: dir });
    expect(status.stdout.trim(), 'a usage refusal must do no git work at all').toBe('');
  }, 60_000);

  it('refuses a --reason made entirely of invisible Unicode (zero-width spaces), not merely ASCII whitespace', async () => {
    // A round-1 gauntlet critic (both independent reviewers) reproduced live that a plain
    // reason.trim().length === 0 check accepts a --reason made entirely of U+200B (zero-width space)
    // as "non-blank," durably recording an invisible, meaningless governance entry.
    const dir = await freshProject();
    const result = run(
      [
        'test',
        'exempt',
        'STORY-001',
        'tautology',
        '--reason',
        '​​​',
        '--owner',
        'alice',
        '--expires',
        isoDate(30),
      ],
      dir,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--reason');
  }, 60_000);
});
