/**
 * Asserts the structural invariants that keep the deterministic floor un-bypassable.
 *
 * These are not tests of a module's behaviour; they are tests of the repository's shape. Each one
 * exists because a plausible, well-intentioned change would otherwise silently disable a guarantee
 * the rest of the suite assumes.
 *
 * @see specs/21 §21.1
 * @see specs/02 §2.2
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Workspace roots declared in `pnpm-workspace.yaml`, per `specs/02` §2.2. */
const WORKSPACE_ROOTS = ['packages', 'tools', 'modules'] as const;

/** Build output, skipped at any depth. Never contains a source of record. */
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git', '.turbo']);

/**
 * The single path excluded by name, mirroring `vitest.config.ts`. `test/lint-rules.test.ts` writes a
 * fixture here for the duration of a lint call, and this file's walks run in parallel with it.
 *
 * Excluding *all* dot-directories was tried and is a defect: it put a failing test in `test/.hidden/`
 * beyond both the collection globs and this walk simultaneously, which is precisely the shared blind
 * spot the set-equality assertion exists to rule out.
 */
// `packages/kb/test/lint/factories.ts` (PLAN-M3.md P10): shared, schema-validated `KbEntry`/`ADR`/
// `Component`/... builder functions, imported by four real `*.test.ts` files in the same directory —
// genuinely test-only code (it constructs adversarial/minimal fixtures, nothing else ever imports it),
// just structured as a plain importable module rather than a runnable suite, so `TEST_FILE`'s own
// `.test.`/`.spec.` naming heuristic — a proxy for "this is test code," not the actual invariant this
// walk enforces — never recognises it. Listed individually, the same as this set's one other entry,
// rather than exempting `test/` directories wholesale, which would blind this check to a real stray
// production file hiding there instead.
// `packages/telemetry/test/fixtures/append-and-hang.ts` (PLAN-M5.md P6): a standalone fixture *process*
// `events.test.ts` spawns via `child_process` (with `--experimental-strip-types`, this repository's own
// no-build-step convention) to prove the event log's `fsync`-before-return guarantee against a real
// `SIGKILL`, not merely "no error was thrown." It cannot be named `*.test.ts`/`*.spec.ts` without
// vitest's own collection glob trying to run it directly as a suite — it has no `describe`/`it` blocks,
// awaits at the top level, and ends in a deliberately never-resolving `setInterval`, so that attempt
// would hang the whole run. Genuinely test-only for the same reason as the `kb` entry above; listed
// individually for the same reason too.
// `packages/engine/test/dispatch/helpers.ts` (PLAN-M5.md P15): a real `ExecuteStepContext` builder and
// `StepNode` fixture builder, imported by five real `*.test.ts` files in the same directory — the same
// "shared, importable module rather than a runnable suite" shape as the `kb` entry above, for the same
// reason unrecognised by `TEST_FILE`'s naming heuristic. Listed individually for the same reason too.
// `packages/engine/test/e2e/fixture-workflow.ts` (PLAN-M5.md P20): the shared fixture workflow, gate
// registry, and `RunEngineContext` builder every `test/e2e/*.test.ts` and `test/run/*.test.ts` file
// imports — the identical "shared, importable module, not a runnable suite" shape as the two entries
// above. `packages/engine/test/e2e/fixtures/run-engine-child.ts` (PLAN-M5.md P20): the real-child-
// process fixture `crash-resume.test.ts` spawns via `node --experimental-strip-types` (never imported,
// never run as a vitest suite) — the identical "genuinely test-only, unrecognised by `TEST_FILE`'s
// naming heuristic" shape `append-and-hang.ts` above is already listed for, and for the same reason.
// `packages/methods/test/fixtures/repo-strategy.ts` (PLAN-M6.md M2): the shared verbatim `11` §11.0
// `repo-strategy` YAML fixture string, imported by `test/schema/load.test.ts` and `test/score/*.test.ts`
// — the identical "shared, importable module, not a runnable suite" shape as the `kb`/`engine` entries
// above, for the same reason unrecognised by `TEST_FILE`'s naming heuristic.
// `packages/catalog/test/fixtures/postgresql.ts` (PLAN-M6.md C1): the shared verbatim `12` §12.2
// `postgresql` YAML fixture string, imported by `test/schema/load.test.ts`,
// `test/registry/registry.test.ts`, and `test/registry/validate.test.ts` — the identical shape as the
// `methods` entry above, for the same reason.
const IGNORED_PATHS = new Set([
  'tools/lint-fixture/.fixtures',
  'packages/kb/test/lint/factories.ts',
  'packages/telemetry/test/fixtures/append-and-hang.ts',
  'packages/engine/test/dispatch/helpers.ts',
  'packages/engine/test/e2e/fixture-workflow.ts',
  'packages/engine/test/e2e/fixtures/run-engine-child.ts',
  'packages/methods/test/fixtures/repo-strategy.ts',
  'packages/catalog/test/fixtures/postgresql.ts',
]);

/**
 * Directories skipped only at the repository root, mirroring `vitest.config.ts`'s root-anchored
 * exclusions. Anchoring matters: skipping `specs`/`fixtures` at *any* depth is what let a failing
 * test in `packages/<pkg>/specs/` hide from the globs and from this walk simultaneously.
 */
const IGNORED_ROOT_DIRECTORIES = new Set(['specs', 'fixtures']);

/** Source and test file extensions, matching the collection globs in `vitest.config.ts`. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** Test files, which `vitest.config.ts` collects and coverage excludes. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

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
  /**
   * Every `*.{test,spec}.*` file in the repository, at any extension and any depth.
   *
   * Walks from the repository root rather than from a list of workspace roots. The previous version
   * scanned exactly the four roots the collection globs used, so it shared their blind spot and
   * could never observe a file outside them — a failing test at the repo root or in `scripts/` was
   * invisible to both.
   */
  function findTestFiles(relativeDir: string): readonly string[] {
    const found: string[] = [];
    for (const entry of readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (relativeDir === '' && IGNORED_ROOT_DIRECTORIES.has(entry.name)) continue;
      const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (IGNORED_PATHS.has(relative)) continue;
      if (entry.isDirectory()) {
        found.push(...findTestFiles(relative));
      } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        found.push(relative);
      }
    }
    return found.sort();
  }

  function collectedTestFiles(): readonly string[] {
    const listed = JSON.parse(
      execFileSync('node', ['scripts/run-tests.mjs', 'list', '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }),
    ) as readonly { file: string }[];
    // `vitest list --json` emits one entry per *test*, not per file, so the paths must be deduped
    // before they can be compared with a file walk.
    return [
      ...new Set(
        listed.map((entry) => path.relative(repoRoot, entry.file).split(path.sep).join('/')),
      ),
    ].sort();
  }

  it('collects exactly the test files that exist, so a green run cannot mean "found nothing"', () => {
    // Set equality, not a subset check: a subset check passes when the globs and the walk share the
    // same blind spot, which is precisely how the previous version failed.
    expect(collectedTestFiles()).toEqual(findTestFiles(''));
  });

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
    // assertion above fail with a message naming neither symlinks nor the file.
    expect(symlinks.sort()).toEqual([]);
  });

  it('finds test files at all, so the equality above is not vacuous', () => {
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

  it('collects a test planted anywhere a future piece might put one', () => {
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

describe('every source file in the repository is typechecked', () => {
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

  it('has no file outside the tsconfig project, since an unchecked file is outside the discipline', () => {
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
