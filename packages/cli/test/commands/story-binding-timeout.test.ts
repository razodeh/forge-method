/**
 * `checkBinding` (`story.ts`) — its own handling of `runBindingCheck`'s two timeout outcomes
 * (`specs/22` M16 P10: `'baseline-timeout'`/`'mutated-timeout'`). Mocked, not a real hang: `checkBinding`
 * threads no `timeoutMs` override of its own (`StoryVerifyContext` has no such field — `forge story
 * verify`'s own binding check always uses `reporter.ts`'s full `DEFAULT_TEST_RUN_TIMEOUT_MS`, 20
 * minutes), so a REAL baseline/mutated hang here would mean waiting out that full default per case —
 * impractical for a test, and this file's whole job is proving `checkBinding`'s own ternary maps each
 * outcome to the right `Resolution`, not re-proving that `runBindingCheck` itself can time out (already
 * proven for real, with a real hang and a real kill, in `binding.test.ts`). `runBindingCheck` is mocked
 * directly; every other real dependency `storyVerify` touches (the real story/profile files on disk,
 * the real DoD-profile evaluation) is untouched and real.
 *
 * @see specs/22 M16 P10
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoryVerifyContext } from '../../src/commands/story.ts';

const { runBindingCheckMock } = vi.hoisted(() => ({ runBindingCheckMock: vi.fn() }));

vi.mock('../../src/commands/loop/test/binding.ts', () => ({
  runBindingCheck: runBindingCheckMock,
  // `story.ts` imports only `runBindingCheck` from this module (confirmed by reading its own import
  // line) — `splitImplementationAndTestPaths`/`BindingCheckInput`/etc. are never referenced there, so
  // this mock need not (and, being a value-only module replacement, cannot cleanly) re-export them.
}));

const { storyVerify } = await import('../../src/commands/story.ts');

const dirs: string[] = [];
afterEach(() => {
  runBindingCheckMock.mockReset();
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function storyFixture(): string {
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
  - impl.js
  - impl.test.js
context_refs: []
acceptance:
  - id: AC-001-1
    given: two numbers
    when: add is called
    then: the sum is returned
    kind: functional
tests: []
dod_profile: backend-default
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
---

Fixture story body.
`;
}

const PROFILE_YAML = `profiles:
  backend-default:
    ready: []
    verify:
      - { check: test:binding }
    done: []
`;

async function freshProject(): Promise<{ readonly ctx: StoryVerifyContext }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-story-binding-timeout-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    storyFixture(),
    'utf8',
  );
  await mkdir(path.join(dir, 'docs/forge/kb/engineering'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/kb/engineering/dod-profiles.yaml'),
    PROFILE_YAML,
    'utf8',
  );
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
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'the story'], { cwd: dir });

  const ctx = {
    paths: new ProjectPaths(dir),
    projectRoot: dir,
    specsRoot: 'docs/forge/specs',
    kbRoot: 'docs/forge/kb',
    reportsRoot: 'docs/forge/reports',
    // Never actually run: `runBindingCheck` is mocked above, so this string is never shelled.
    testCommands: { unit: 'true' },
  };
  return { ctx };
}

describe('checkBinding — a baseline-timeout outcome from runBindingCheck (specs/22 M16 P10)', () => {
  it('reports unverifiable, naming the timeout, never a pass or a crash', async () => {
    const { ctx } = await freshProject();
    runBindingCheckMock.mockResolvedValueOnce({ outcome: 'baseline-timeout' });

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('unverifiable');
    expect(check?.message).toContain('timed out');
    expect(runBindingCheckMock).toHaveBeenCalledTimes(1);
  });
});

describe('checkBinding — a mutated-timeout outcome from runBindingCheck (specs/22 M16 P10)', () => {
  it('reports unverifiable, naming the timeout, never crediting any test as bound', async () => {
    const { ctx } = await freshProject();
    runBindingCheckMock.mockResolvedValueOnce({ outcome: 'mutated-timeout' });

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('unverifiable');
    expect(check?.message).toContain('timed out');
    expect(runBindingCheckMock).toHaveBeenCalledTimes(1);
  });
});
