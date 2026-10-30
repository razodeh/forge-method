/**
 * The 3 real-subprocess-heavy structural-floor tests, split out of `test/workspace-floor.test.ts`
 * (this session's own "CI capacity, not lock correctness" piece — the identical reasoning
 * `SPEC-QUESTIONS.md` Q365 already established for the dedicated `lock-stress` job, applied here to
 * the main `floor`/`seed` jobs' own general resource-contention problem rather than cross-process
 * lock correctness specifically).
 *
 * Each of these 3 tests shells out to a real, heavyweight subprocess (`vitest list --json` twice,
 * `tsc --listFiles --noEmit` once per tsconfig) — real evidence from 3 independently-contended CI job
 * logs for the same run showed this file's own predecessor (`workspace-floor.test.ts`, before this
 * split) among the heaviest handful of files in the whole ~761-file suite (up to 890.6s on one leg,
 * 18 tests), and `SPEC-QUESTIONS.md` Q370 Decision 4 explicitly disclosed that a 3rd timeout bump on
 * these same 3 tests "mirrors a broader, repeating pattern... that should eventually be replaced by
 * the already-disclosed real fix (sharding `pnpm test` across jobs), not papered over indefinitely
 * with ever-larger margins." This file is that fix for these 3 tests specifically: moved into the
 * dedicated `heavy-subprocess` CI job (`.github/workflows/ci.yml`), excluded from `floor`/`seed`'s own
 * `pnpm test`, run with `pnpm test:heavy-subprocess` instead — while every OTHER, ordinary test in the
 * original file (the symlink walk, the planted-failure check, the source-location/TypeScript-only/
 * line-ending floors) stays in `workspace-floor.test.ts`, in the main, coverage-measured run.
 *
 * No coverage-floor risk on either side of this split: neither this file nor its sibling imports any
 * workspace package's `src/**` module at all — both only walk the real filesystem and shell out to
 * `node`/`git`/`tsc`, so this split changes nothing about what `pnpm test --coverage` measures for any
 * package (confirmed by inspection, and by the fact that this file's predecessor never appeared in any
 * package's `coverage/coverage-summary.json`).
 *
 * @see specs/21 §21.1
 * @see specs/02 §2.2
 * @see SPEC-QUESTIONS.md Q365
 * @see SPEC-QUESTIONS.md Q370
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  IGNORED_DIRECTORIES,
  IGNORED_PATHS,
  IGNORED_ROOT_DIRECTORIES,
  SOURCE_FILE,
  SUBPROCESS_HEAVY_TEST_TIMEOUT_MS,
  WORKSPACE_ROOTS,
  collectedTestFiles,
  findTestFiles,
  repoRoot,
} from './workspace-floor-helpers.ts';

describe('no test file can escape collection (heavy, real-subprocess)', () => {
  // `collectedTestFiles` shells out to `vitest list`; measured isolated duration ~24s (its higher
  // sample; see `M14-AGENT-NOTES.md`, `M14 P45`). The explicit timeout below
  // (`SUBPROCESS_HEAVY_TEST_TIMEOUT_MS`, shared with the other 2 subprocess-heavy tests in this file)
  // — see that constant's own comment, in `workspace-floor-helpers.ts`, for why 100_000 (its original
  // value) was not enough.
  it(
    'collects exactly the test files that exist, so a green run cannot mean "found nothing"',
    () => {
      // Set equality, not a subset check: a subset check passes when the globs and the walk share
      // the same blind spot, which is precisely how the previous version failed.
      expect(collectedTestFiles()).toEqual(findTestFiles(''));
    },
    SUBPROCESS_HEAVY_TEST_TIMEOUT_MS,
  );

  // Also shells out to `collectedTestFiles` (`vitest list`); measured isolated duration ~28s (its
  // higher sample; `M14-AGENT-NOTES.md`, `M14 P45`).
  it(
    'collects a test planted anywhere a future piece might put one',
    () => {
      // PLAN-M1.md P2 and P3 add scripts under `scripts/`; a test beside one of them landed squarely
      // in the previous globs' blind spot.
      const planted = [
        'probe-root.test.ts',
        'scripts/probe.test.ts',
        'test/probe.test.mts',
        // A package-level `specs/` directory: previously excluded at any depth, so a failing test here
        // was invisible to the globs and to this walk at the same time.
        'tools/lint-fixture/specs/probe.test.ts',
        // A dot-directory: excluded wholesale by both mechanisms until this case was added.
        'test/.hidden-probe/probe.test.ts',
        // `.mjs`, which PLAN-M1 P1b names explicitly and no case previously covered.
        'test/probe-planted.test.mjs',
      ];
      try {
        for (const file of planted) {
          mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
          writeFileSync(
            path.join(repoRoot, file),
            "import { it } from 'vitest';\nit('planted', () => undefined);\n",
          );
        }
        const collected = new Set(collectedTestFiles());
        expect(planted.filter((file) => !collected.has(file))).toEqual([]);
      } finally {
        // Remove the directories too: an empty directory is invisible to `git status`, so residue
        // would survive review and change what a later walk sees.
        for (const file of planted) rmSync(path.join(repoRoot, file), { force: true });
        for (const directory of ['tools/lint-fixture/specs', 'test/.hidden-probe']) {
          rmSync(path.join(repoRoot, directory), { recursive: true, force: true });
        }
      }
    },
    SUBPROCESS_HEAVY_TEST_TIMEOUT_MS,
  );
});

describe('every source file in the repository is typechecked (heavy, real-subprocess)', () => {
  /** Every workspace-package tsconfig, so the assertion below scales past the first package. */
  function findTsconfigs(relative: string): readonly string[] {
    const found: string[] = [];
    for (const entry of readdirSync(path.join(repoRoot, relative), { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (IGNORED_PATHS.has(next)) continue;
      if (entry.isDirectory()) {
        if (
          relative === '' &&
          !WORKSPACE_ROOTS.includes(entry.name as (typeof WORKSPACE_ROOTS)[number])
        )
          continue;
        found.push(...findTsconfigs(next));
      } else if (entry.name === 'tsconfig.json') {
        found.push(next);
      }
    }
    return found.sort();
  }

  // Runs a real `tsc --listFiles --noEmit` per tsconfig — real, heavyweight compiler subprocesses,
  // the same class of cost `pnpm typecheck` itself pays. Measured isolated duration ~30s (its
  // higher sample; `M14-AGENT-NOTES.md`, `M14 P45`). Shares `SUBPROCESS_HEAVY_TEST_TIMEOUT_MS` with
  // the other 2 subprocess-heavy tests in this file.
  it(
    'has no file outside the tsconfig project, since an unchecked file is outside the discipline',
    () => {
      // Every tsconfig in the repository, not only the root one. Requiring each file to appear in the
      // *root* project would mean the first real package (`PLAN-M1.md` P2) could not be added without
      // editing this test — an invariant that blocks the plan is a broken invariant.
      //
      // `--noEmit` still exits non-zero on a type error, which would surface here as an unhelpful set
      // difference. Capture the output either way and let the diagnostics be the failure message.
      const projects = ['tsconfig.json', ...findTsconfigs('')];
      const listed = new Set<string>();
      for (const project of projects) {
        let output: string;
        try {
          output = execFileSync(
            'node',
            ['node_modules/typescript/bin/tsc', '-p', project, '--listFiles', '--noEmit'],
            { cwd: repoRoot, encoding: 'utf8' },
          );
        } catch (error) {
          const diagnostics = (error as { stdout?: string }).stdout ?? String(error);
          throw new Error(
            `tsc reported errors in ${project}, so its file list cannot be trusted:\n${diagnostics
              .split('\n')
              .filter((line) => line.includes('error TS'))
              .join('\n')}`,
          );
        }
        for (const line of output.split('\n')) {
          if (!line.startsWith(repoRoot) || line.includes('node_modules')) continue;
          listed.add(path.relative(repoRoot, line.trim()).split(path.sep).join('/'));
        }
      }

      const onDisk: string[] = [];
      const walk = (relative: string): void => {
        for (const entry of readdirSync(path.join(repoRoot, relative), { withFileTypes: true })) {
          if (IGNORED_DIRECTORIES.has(entry.name)) continue;
          if (relative === '' && IGNORED_ROOT_DIRECTORIES.has(entry.name)) continue;
          const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
          if (IGNORED_PATHS.has(next)) continue;
          if (entry.isDirectory()) walk(next);
          else if (SOURCE_FILE.test(entry.name)) onDisk.push(next);
        }
      };
      walk('');

      // A file typechecked by nothing is outside the discipline this floor exists to install — which
      // is how `scripts/` and then `eslint.config.js` each slipped through in turn.
      expect(onDisk.filter((file) => !listed.has(file)).sort()).toEqual([]);
    },
    SUBPROCESS_HEAVY_TEST_TIMEOUT_MS,
  );
});
