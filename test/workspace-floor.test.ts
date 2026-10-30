/**
 * Asserts the structural invariants that keep the deterministic floor un-bypassable.
 *
 * These are not tests of a module's behaviour; they are tests of the repository's shape. Each one
 * exists because a plausible, well-intentioned change would otherwise silently disable a guarantee
 * the rest of the suite assumes.
 *
 * This file's own 3 real-subprocess-heavy tests (`vitest list` twice, `tsc --listFiles` once per
 * tsconfig) now live in `test/workspace-floor-heavy-subprocess.test.ts`, split out for the identical
 * "CI capacity, not lock correctness" reason `SPEC-QUESTIONS.md` Q365 already isolated 5 real
 * multi-process lock-stress files for: run together with the other ~750 files in `vitest.config.ts`'s
 * single shared fork pool, these 3 tests' own real elapsed time repeatedly outpaced even a generously
 * widened timeout under genuine CI contention (`Q370` Decision 4's own disclosed note that a 3rd
 * timeout bump "mirrors a broader, repeating pattern... that should eventually be replaced by the
 * already-disclosed real fix," not papered over indefinitely). Every OTHER test in this file —
 * including `findTestFiles`'s own real filesystem walk, which neither shells out nor is itself
 * heavyweight — stays here, in the main, coverage-measured run: this file imports no `src/**` module
 * of any workspace package at all (it only walks the real filesystem and shells out to `node`/`git`/
 * `tsc`), so there is no coverage-floor risk on either side of the split — confirmed by inspection and
 * by the fact that no package's coverage report has ever carried an entry for this file.
 *
 * @see specs/21 §21.1
 * @see specs/02 §2.2
 * @see SPEC-QUESTIONS.md Q365
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  IGNORED_DIRECTORIES,
  IGNORED_PATHS,
  IGNORED_ROOT_DIRECTORIES,
  SOURCE_FILE,
  TEST_FILE,
  WORKSPACE_ROOTS,
  findTestFiles,
  repoRoot,
} from './workspace-floor-helpers.ts';

/**
 * Lists workspace-relative paths of files directly inside a workspace package whose name matches.
 *
 * Written as an explicit walk rather than `fs.glob`, which arrived in Node 22 and would break the
 * Node 20.10 floor `specs/02` §2.1 sets. Results are sorted so the assertion cannot depend on
 * filesystem ordering (`QUALITY-BAR.md` R10).
 */
function findPackageFiles(matches: (fileName: string) => boolean): readonly string[] {
  const found: string[] = [];
  for (const root of WORKSPACE_ROOTS) {
    const rootPath = path.join(repoRoot, root);
    if (!existsSync(rootPath)) continue;
    for (const pkg of readdirSync(rootPath, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      for (const entry of readdirSync(path.join(rootPath, pkg.name), { withFileTypes: true })) {
        if (entry.isFile() && matches(entry.name)) {
          found.push(`${root}/${pkg.name}/${entry.name}`);
        }
      }
    }
  }
  return found.sort();
}

describe('the deterministic floor cannot be opted out of', () => {
  it('has no per-package vitest config, so every package inherits the root setup and thresholds', () => {
    expect(findPackageFiles((name) => name.startsWith('vitest.config.'))).toEqual([]);
  });

  it('has no per-package prettier or eslint config that could relax the root rules', () => {
    expect(
      findPackageFiles(
        (name) => name.startsWith('.prettierrc') || name.startsWith('eslint.config.'),
      ),
    ).toEqual([]);
  });
});

describe('no test file can escape collection', () => {
  it('has no symlinks, which specs/02 §2.7 forbids and which this walk cannot follow', () => {
    const symlinks: string[] = [];
    const walk = (relative: string): void => {
      for (const entry of readdirSync(path.join(repoRoot, relative), { withFileTypes: true })) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (IGNORED_PATHS.has(next)) continue;
        if (relative === '' && IGNORED_ROOT_DIRECTORIES.has(entry.name)) continue;
        if (entry.isSymbolicLink()) symlinks.push(next);
        else if (entry.isDirectory()) walk(next);
      }
    };
    walk('');
    // A symlink is reported as neither file nor directory, so it would make the set-equality
    // assertion in `workspace-floor-heavy-subprocess.test.ts` fail with a message naming neither
    // symlinks nor the file.
    expect(symlinks.sort()).toEqual([]);
  });

  it('finds test files at all, so the equality assertion in workspace-floor-heavy-subprocess.test.ts is not vacuous', () => {
    expect(findTestFiles('').length).toBeGreaterThan(0);
  });

  it('fails the run for a planted failing test, not merely collects it', () => {
    // PLAN-M1 P1b says a planted failing test "fails the run". Asserting collection is weaker: a
    // collected file whose body cannot fail proves nothing. One nested invocation, on the extension
    // and location combination the globs previously missed.
    const file = path.join(repoRoot, 'test', '.planted-probe', 'fails.test.mjs');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      "import { it, expect } from 'vitest';\nit('planted', () => { expect(1).toBe(2); });\n",
    );
    try {
      let status = 0;
      try {
        execFileSync(
          'node',
          ['scripts/run-tests.mjs', 'run', 'test/.planted-probe/fails.test.mjs'],
          {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: 'pipe',
          },
        );
      } catch (error) {
        status = (error as { status?: number }).status ?? 0;
      }
      expect(status, 'a failing planted test must fail the run').not.toBe(0);
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

describe('production source lives where the coverage globs look', () => {
  /** Every source file in a package outside `src/`, at any depth. */
  function straySources(
    packageDir: string,
    relative: string,
    packageRelative: string,
  ): readonly string[] {
    const strays: string[] = [];
    for (const entry of readdirSync(path.join(packageDir, relative), { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
      // `src/` is where the coverage globs look; everything beside it is the hazard. Dot-directories
      // are walked, not skipped: `packages/<pkg>/.internal/engine.ts` sits outside the `src/**`
      // coverage globs, so skipping it left real code with no floor and no error. The one exception
      // is named, exactly as in the other three walks in this file.
      if (entry.isDirectory()) {
        if (next !== 'src' && !IGNORED_PATHS.has(`${packageRelative}/${next}`)) {
          strays.push(...straySources(packageDir, next, packageRelative));
        }
      } else if (
        SOURCE_FILE.test(entry.name) &&
        !TEST_FILE.test(entry.name) &&
        !entry.name.includes('.config.') &&
        !IGNORED_PATHS.has(`${packageRelative}/${next}`)
      ) {
        // Test files are not production source and carry no coverage floor of their own, so a
        // package's `test/` directory is a legitimate sibling of `src/`. `IGNORED_PATHS` is checked
        // here too (previously only the directory branch above did), for the same reason it exists at
        // all: a real exception, named individually, not a wildcard.
        strays.push(next);
      }
    }
    return strays;
  }

  it('keeps every workspace package source file under src/, at any depth', () => {
    // Recursive by necessity: the previous version listed only the package root, so a real module in
    // `lib/` or `internal/` carried no coverage floor and nothing noticed.
    const strays: string[] = [];
    for (const root of WORKSPACE_ROOTS) {
      const rootPath = path.join(repoRoot, root);
      if (!existsSync(rootPath)) continue;
      for (const pkg of readdirSync(rootPath, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        strays.push(
          ...straySources(path.join(rootPath, pkg.name), '', `${root}/${pkg.name}`).map(
            (file) => `${root}/${pkg.name}/${file}`,
          ),
        );
      }
    }
    expect(strays.sort()).toEqual([]);
  });
});

describe('workspace packages ship TypeScript only', () => {
  it('has no .js or .jsx source in a package, which eslint exempts from type-aware rules', () => {
    // `specs/02` §2.1 is TypeScript, strict, ESM only. The exemption that keeps `eslint.config.js`
    // lintable would otherwise silently cover production code, which is exactly how the `**/*.mjs`
    // exemption became a real hole.
    const offenders: string[] = [];
    for (const root of WORKSPACE_ROOTS) {
      const rootPath = path.join(repoRoot, root);
      if (!existsSync(rootPath)) continue;
      for (const pkg of readdirSync(rootPath, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        const collect = (relative: string): void => {
          for (const entry of readdirSync(path.join(rootPath, pkg.name, relative), {
            withFileTypes: true,
          })) {
            if (IGNORED_DIRECTORIES.has(entry.name)) continue;
            const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
            // The fourth walk in this file, and the only one that was not consulting IGNORED_PATHS —
            // so a lint fixture written by a parallel test file surfaced here as a stray source.
            if (IGNORED_PATHS.has(`${root}/${pkg.name}/${next}`)) continue;
            if (entry.isDirectory()) collect(next);
            // .js/.jsx only, not .mjs/.cjs: a deliberate .mjs entry point (test/network-guard.mjs,
            // scripts/run-tests.mjs, tools/eslint-plugin-forge-boundaries/src/graph.mjs) signals its
            // own intent through the extension and is already governed elsewhere — by the R10
            // per-path assertion in errors.test.ts, and by checkJs where its tsconfig enables it. An
            // unmarked .js file has no such governance and is exactly what this check exists to catch.
            else if (/\.jsx?$/.test(entry.name) && !entry.name.includes('.config.')) {
              offenders.push(`${root}/${pkg.name}/${next}`);
            }
          }
        };
        collect('');
      }
    }
    expect(offenders.sort()).toEqual([]);
  });
});

describe('every workspace package is reached by the floor commands', () => {
  it('declares a typecheck script, so `pnpm typecheck` actually checks its source', () => {
    // `turbo run typecheck` only runs what packages declare. Without this, `packages/core` was
    // typechecked incidentally — by a test shelling out to tsc — rather than by the floor command
    // QUALITY-BAR §3 names.
    const missing: string[] = [];
    for (const root of WORKSPACE_ROOTS) {
      const rootPath = path.join(repoRoot, root);
      if (!existsSync(rootPath)) continue;
      for (const pkg of readdirSync(rootPath, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        const manifestPath = path.join(rootPath, pkg.name, 'package.json');
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          scripts?: Record<string, string>;
        };
        // A data-only package has no source to check; one with a tsconfig does.
        if (!existsSync(path.join(rootPath, pkg.name, 'tsconfig.json'))) continue;
        if (manifest.scripts?.['typecheck'] === undefined) missing.push(`${root}/${pkg.name}`);
      }
    }
    expect(missing.sort()).toEqual([]);
  });
});

describe('the floor commands are the ones QUALITY-BAR.md names', () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it.each(['build', 'typecheck', 'lint', 'test', 'boundaries'])('defines a %s script', (script) => {
    expect(manifest.scripts[script]).toBeTypeOf('string');
  });

  it('fails lint on any warning, so a rule downgraded to warn cannot pass silently', () => {
    expect(manifest.scripts['lint']).toContain('--max-warnings');
  });
});

describe('specs/02 §2.7 — line endings are normalised for the Windows target', () => {
  it('stores every tracked text file with LF in the index, whatever the checkout converted it to', () => {
    // `--eol` reports the index (`i/`) and working-tree (`w/`) endings per file. The index is what
    // matters: a Windows checkout may legitimately hold CRLF in the working tree, but a CRLF blob
    // in the index breaks prettier and changes hashes across platforms.
    // Tracked files, from the index. `git ls-files --eol` reports nothing for untracked files, so
    // on a branch where every file under review is new this check would otherwise be vacuous — the
    // working-tree walk below covers those.
    const report = execFileSync('git', ['ls-files', '--eol'], { cwd: repoRoot, encoding: 'utf8' });
    const crlfInIndex = report
      .split('\n')
      .filter((line) => line.startsWith('i/crlf'))
      .map((line) => line.split('\t').at(-1) ?? line);
    expect(crlfInIndex).toEqual([]);

    const crlfOnDisk: string[] = [];
    const walk = (relative: string): void => {
      for (const entry of readdirSync(path.join(repoRoot, relative), { withFileTypes: true })) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (IGNORED_PATHS.has(next)) continue;
        if (relative === '' && IGNORED_ROOT_DIRECTORIES.has(entry.name)) continue;
        if (entry.isDirectory()) walk(next);
        else if (SOURCE_FILE.test(entry.name) || entry.name.endsWith('.json')) {
          if (readFileSync(path.join(repoRoot, next), 'utf8').includes('\r\n')) {
            crlfOnDisk.push(next);
          }
        }
      }
    };
    walk('');
    expect(crlfOnDisk.sort()).toEqual([]);
  });
});
