/**
 * The fence around strict-prompt mode's opt-outs (`PLAN-M13.md` P6, `SPEC-QUESTIONS.md` Q207).
 *
 * `@forge/testkit`'s `FakePlatformAdapter` refuses a session whose prompt is empty, a bare path, or not
 * the nine compiled blocks. Three spellings switch that off or hollow it out: `strict: false`,
 * `HAND_BUILT_REQUESTS`. One of them in the wrong test silently re-creates the gap strict mode exists to
 * close (a test that dispatches an agent step and never reads the prompt), so every use is listed here
 * with its reason. (`strictFixtureSystemPrompt` keeps strict mode on -- the request still has to be nine
 * well-formed blocks -- so it is not an opt-out and is not fenced.) Adding one anywhere else fails this test:
 * add the file below, with a reason a reviewer can disagree with. A listed file that no longer uses any
 * of them fails too, so the list cannot go stale.
 */
import { execa } from 'execa';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OPT_OUT = /HAND_BUILT_REQUESTS|strict:\s*false/;
/** `strict: false` is an ordinary option elsewhere (a CLI flag, a lint setting); it only opts out of strict
 * mode in a file that talks to the fake adapter. */
const FAKE_ADAPTER = /FakePlatformAdapter|withCapabilities|@forge\/testkit/;

/** Path (a file, or a directory ending in `/`) -> why it may opt out. */
const ALLOWED: Readonly<Record<string, string>> = {
  'packages/testkit/src/': 'defines the options and their documentation',
  'packages/testkit/test/':
    "the adapter's own mechanics, conformance and scripting suites drive it with hand-built requests " +
    '(`strict.test.ts` covers strict mode itself)',
  'packages/extensions/test/install/conformance.test.ts':
    'module conformance fixtures: a module test that opts out, and one that must be refused for not doing so',
  'test/strict-opt-outs.test.ts': 'this file',
};

function reasonFor(file: string): string | undefined {
  for (const [entry, reason] of Object.entries(ALLOWED)) {
    if (entry.endsWith('/') ? file.startsWith(entry) : file === entry) return reason;
  }
  return undefined;
}

async function trackedAndUntrackedTypeScript(): Promise<readonly string[]> {
  const { stdout } = await execa(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repoRoot },
  );
  return stdout
    .split('\0')
    .filter((file) => /\.(?:ts|tsx|mts|mjs|js)$/.test(file) && !file.startsWith('specs/'));
}

describe('strict-prompt opt-outs are fenced', () => {
  it('only the listed files use strict: false or HAND_BUILT_REQUESTS', async () => {
    const unlisted: string[] = [];
    const used = new Set<string>();
    for (const file of await trackedAndUntrackedTypeScript()) {
      const text = await readFile(path.join(repoRoot, file), 'utf8').catch(() => '');
      if (!OPT_OUT.test(text) || !FAKE_ADAPTER.test(text)) continue;
      used.add(file);
      if (reasonFor(file) === undefined) unlisted.push(file);
    }
    expect(
      unlisted,
      'these files opt out of strict-prompt mode; if that is right, list them in ALLOWED with a reason',
    ).toEqual([]);
    expect(used.size).toBeGreaterThan(0);

    for (const entry of Object.keys(ALLOWED)) {
      const stillUsed = [...used].some((file) =>
        entry.endsWith('/') ? file.startsWith(entry) : file === entry,
      );
      expect(stillUsed, `${entry} is listed as an opt-out but no longer uses one; remove it`).toBe(
        true,
      );
    }
  });

  it('forge debug is not one of them: its RCA sessions go through real prompt assembly (PLAN-M13.md P27)', async () => {
    // Until P27 `commands/loop/debug.ts` sent an empty system prompt and its test file was listed above,
    // with a canary that failed the day debug moved onto assembly. That day has come: the entry is gone,
    // and debug's tests run against the strict adapter (`debug.test.ts` asserts no session is refused).
    expect(reasonFor('packages/cli/test/commands/loop/debug.test.ts')).toBeUndefined();
    const text = await readFile(
      path.join(repoRoot, 'packages/cli/test/commands/loop/debug.test.ts'),
      'utf8',
    );
    expect(OPT_OUT.test(text)).toBe(false);
  });
});
