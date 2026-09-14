/**
 * The `21` §21.5 performance-benchmark suite, with ratchets.
 *
 * `21` §21.5 names five numeric, non-functional targets — cold start, first frame, compile, KB pack,
 * index rebuild — and confirms (`PLAN-M12.md` P5's own Mandate) that zero benchmark infrastructure
 * existed anywhere in this repository before this file, beyond the structurally unrelated coverage
 * ratchet (`scripts/check-coverage-ratchet.mjs`), whose "record a mark, compare future runs against
 * it, allow improvement, fail on regression past budget" shape this file deliberately mirrors —
 * inverted for milliseconds, where lower (not higher) is better. See `scripts/lib/bench-ratchet.mjs`
 * for the ratchet decision logic itself and `scripts/lib/bench-fixtures.mjs` for the five fixtures,
 * both separated out and independently unit-tested for the identical reason
 * `check-coverage-ratchet.mjs`/`coverage-ratchet.mjs` are split: a check nobody has exercised is
 * indistinguishable from one that always passes.
 *
 * **Cold start and first frame run through the real, installed CLI** — a real child process, `packages/
 * cli/dist/forge.mjs` when built (the real, published, bundled entry `resolveCliCommand` below prefers)
 * or the dev-mode `packages/cli/bin/forge.mjs` spawn wrapper otherwise — never a bypassed direct
 * function call, per `PLAN-M12.md` P5's own stated dependency on P1's real dispatcher. `forge --version`
 * was not wired into that dispatcher until this piece (`bin.ts`'s own `printVersion`): `21` §21.5 names
 * it literally as the cold-start benchmark's own command, and a benchmark for a flag that does not exist
 * is not a real benchmark. Compile / KB pack / index rebuild measure the real library functions
 * directly (`@forge/extensions/compile`, `@forge/kb/pack`, `@forge/kb/index`) — the identical, already-
 * established shape `packages/kb/test/pack/build-context-pack.test.ts`'s own informational 500-entry
 * benchmark already uses for the identical operation, not routed through the CLI, since `21` §21.5's
 * own row for each names the library-level operation ("assembly", "resolution", "rebuild"), not a CLI
 * invocation.
 *
 * **On measurement noise**: see `bench-ratchet.mjs`'s own doc comment. Every fixture's *size* is fixed
 * and deterministic; the *wall-clock time* spent measuring it will vary run to run in this shared,
 * heavily concurrent sandbox, which is why each benchmark takes the median of several samples rather
 * than a single reading, and why the ratchet applies real (documented, non-zero) tolerance to the
 * mark comparison. A real CI runner is dedicated and single-tenant, where this noise mostly does not
 * apply — this file does not pretend otherwise.
 *
 * Usage:
 *   node --experimental-strip-types scripts/bench.mjs           # record mode: run, warn/fail over
 *                                                                # budget, update marks on improvement
 *   node --experimental-strip-types scripts/bench.mjs --check   # CI gate: fail on any regression past
 *                                                                # the stricter of budget or mark
 *
 * @see specs/21 §21.5
 * @see scripts/lib/bench-ratchet.mjs
 * @see scripts/lib/bench-fixtures.mjs
 * @see PLAN-M12.md P5
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rebuildIndex, JsonBackend } from '@forge/kb/index';
import { buildContextPack } from '@forge/kb/pack';
import { parseKbTree } from '@forge/kb/schema';
import { compile } from '@forge/extensions/compile';
import { ProjectPaths } from '@forge/core/fs';

import { BENCHMARK_NAMES, evaluateBenchRatchet } from './lib/bench-ratchet.mjs';
import {
  buildCompileSources,
  buildEventLogFixture,
  buildSyntheticKbTree,
} from './lib/bench-fixtures.mjs';

// The working directory, not this script's own location — the same reasoning
// `check-coverage-ratchet.mjs` already documents: pnpm always runs a script from the workspace root,
// and resolving from `import.meta.url` would make this untestable against a fixture tree.
const repoRoot = realpathSync(process.cwd());
// Overridable so `scripts/bench.test.ts` can run this file end to end against a throwaway marks file
// instead of overwriting the real, committed `bench-marks.json` with one dev machine's own timing —
// the identical "the real thing, pointed at a fixture, not a parallel implementation" shape this
// piece's own doc comment already commits to elsewhere.
const marksPath = process.env['FORGE_BENCH_MARKS_PATH'] ?? path.join(repoRoot, 'bench-marks.json');
const kbFixtureRoot = path.join(repoRoot, 'fixtures', 'greenfield-service');

/**
 * The real command line this run's cold-start/first-frame benchmarks spawn. `21` §21.5's own literal
 * text names `npx forge-method --version` — the *published*, bundled entry (`packages/cli/dist/
 * forge.mjs`, `tsup.config.ts`'s own single-file bundle target, `02` §2.7), not the dev-mode spawn
 * wrapper (`packages/cli/bin/forge.mjs`) this workspace's own `pnpm forge` alias uses day to day. That
 * wrapper spawns a *second* child process with `--experimental-strip-types` to load `src/bin.ts` as
 * raw TypeScript across this whole workspace's module graph — real, measured overhead of running
 * unbuilt source in dev, not part of the real published CLI's own cold start. When `dist/forge.mjs`
 * has been built (`pnpm --filter @forge/cli build` / `pnpm build`), this benchmarks that directly, one
 * plain `node` process, exactly matching `npx forge-method --version`'s own real shape. When it has
 * not (a fresh checkout with no build step run yet), this falls back to the dev-mode wrapper and says
 * so — a real, disclosed approximation, not a silent substitution. */
function resolveCliCommand() {
  // Test-only override so `scripts/bench.test.ts` can point this file at a deliberately broken
  // entry (simulating a stale/pre-`--version` `dist/forge.mjs`) without touching the real, working
  // build this repository actually ships — proving `assertCliCommandWorks` below without requiring a
  // real broken build to exist on disk.
  const forcedEntry = process.env['FORGE_BENCH_CLI_ENTRY'];
  if (forcedEntry !== undefined) {
    return { command: process.execPath, prefixArgs: [forcedEntry], usingDist: true };
  }
  const distEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'forge.mjs');
  if (existsSync(distEntry)) {
    return { command: process.execPath, prefixArgs: [distEntry], usingDist: true };
  }
  const devEntry = path.join(repoRoot, 'packages', 'cli', 'bin', 'forge.mjs');
  return { command: process.execPath, prefixArgs: [devEntry], usingDist: false };
}

const { command: cliCommand, prefixArgs: cliPrefixArgs, usingDist } = resolveCliCommand();

// Fixture sizes are `21` §21.5's own literal figures — "100-artifact project", "5-layer fixture",
// "500 entries", "1000 entries" — and are never configurable: they are what makes each measurement a
// real proof against that row. Sample counts (how many timed repeats the median is taken over) are a
// pure noise-reduction knob with no bearing on correctness, so `scripts/bench.test.ts` overrides them
// down to keep its own real, end-to-end run of this file fast — the deliberate reason this is an env
// var and not a hardcoded constant.
const SUBPROCESS_SAMPLES = Number(process.env['FORGE_BENCH_SUBPROCESS_SAMPLES'] ?? 3);
const IN_PROCESS_SAMPLES = Number(process.env['FORGE_BENCH_IN_PROCESS_SAMPLES'] ?? 5);

/** @param {readonly number[]} values @returns {number} */
function median(values) {
  if (values.length === 0) {
    throw new Error('bench: median() called with no samples.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper === undefined) {
    throw new Error('bench: median() internal indexing error.');
  }
  if (sorted.length % 2 !== 0) return upper;
  const lower = sorted[mid - 1];
  if (lower === undefined) {
    throw new Error('bench: median() internal indexing error.');
  }
  return (lower + upper) / 2;
}

/** Runs `fn` `samples` times, discarding a real warm-up run first (so a one-off module-load/JIT cost
 * does not get counted as the steady-state figure `21` §21.5 actually budgets for), and returns the
 * median wall-clock duration in milliseconds.
 * @param {() => void} fn
 * @param {number} samples
 * @returns {number} */
function timeMedian(fn, samples) {
  fn();
  const durations = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    fn();
    durations.push(performance.now() - start);
  }
  return median(durations);
}

function benchColdStart() {
  const run = () => {
    execFileSync(cliCommand, [...cliPrefixArgs, '--version'], { cwd: repoRoot, encoding: 'utf8' });
  };
  return { ms: timeMedian(run, SUBPROCESS_SAMPLES), fixtureSize: 1 };
}

function benchFirstFrame() {
  const artifactCount = 100;
  const scratchRoot = mkdtempSync(path.join(tmpdir(), 'forge-bench-status-'));
  const { projectRoot } = buildEventLogFixture(scratchRoot, artifactCount);
  try {
    const run = () => {
      execFileSync(cliCommand, [...cliPrefixArgs, '--project', projectRoot, '--json', 'status'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
    };
    return { ms: timeMedian(run, SUBPROCESS_SAMPLES), fixtureSize: artifactCount };
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

function benchCompile() {
  const entityCount = 100;
  const sources = buildCompileSources(entityCount);
  const run = () => {
    compile(sources);
  };
  return { ms: timeMedian(run, IN_PROCESS_SAMPLES), fixtureSize: entityCount * 6 };
}

async function benchKbPack() {
  const entryCount = 500;
  const paths = new ProjectPaths(kbFixtureRoot);
  const baseTree = await parseKbTree(paths);
  const bigTree = buildSyntheticKbTree(baseTree, entryCount, 'kbpack');

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'forge-bench-kb-pack-'));
  const backend = new JsonBackend(path.join(scratchDir, 'index.json'));
  try {
    rebuildIndex(bigTree, backend);
    const run = () => {
      buildContextPack(
        {
          declaredInputIds: ['RUN-001'],
          briefText: 'runtime service database',
          budgetTokens: 10_000,
        },
        backend,
        bigTree,
      );
    };
    return { ms: timeMedian(run, IN_PROCESS_SAMPLES), fixtureSize: bigTree.entries.length };
  } finally {
    backend.close();
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

async function benchIndexRebuild() {
  const entryCount = 1_000;
  const paths = new ProjectPaths(kbFixtureRoot);
  const baseTree = await parseKbTree(paths);
  const bigTree = buildSyntheticKbTree(baseTree, entryCount, 'idxrb');

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'forge-bench-index-rebuild-'));
  const indexPath = path.join(scratchDir, 'index.json');
  try {
    const run = () => {
      const backend = new JsonBackend(indexPath);
      rebuildIndex(bigTree, backend);
      backend.close();
    };
    return { ms: timeMedian(run, IN_PROCESS_SAMPLES), fixtureSize: bigTree.entries.length };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

function readMarks() {
  if (!existsSync(marksPath)) return {};
  return JSON.parse(readFileSync(marksPath, 'utf8'));
}

/** A round-1 critic finding: `resolveCliCommand` only checks that `dist/forge.mjs` *exists*, never
 * that it actually runs — a stale build (predating this piece's own `--version` wiring in `bin.ts`,
 * or broken for any other reason) makes `execFileSync(cliCommand, [...cliPrefixArgs, '--version'])`
 * throw from deep inside `benchColdStart`'s `timeMedian` warm-up call, propagating as an opaque,
 * unhandled Node stack trace instead of a real, actionable message. Run once, eagerly, before any
 * timed measurement, so the failure is diagnosed clearly in one place rather than wherever the first
 * timed call happens to throw. */
function assertCliCommandWorks() {
  try {
    execFileSync(cliCommand, [...cliPrefixArgs, '--version'], { cwd: repoRoot, encoding: 'utf8' });
  } catch (cause) {
    const which = usingDist ? 'packages/cli/dist/forge.mjs' : 'packages/cli/bin/forge.mjs';
    throw new Error(
      `bench: "${which} --version" failed — this is likely a stale build (rebuild with \`pnpm build\`) ` +
        'or a broken dispatcher, not a benchmark failure. Real cause below.',
      { cause },
    );
  }
}

async function main() {
  const check = process.argv.includes('--check');
  assertCliCommandWorks();

  const achieved = {
    'cold-start': benchColdStart(),
    'first-frame': benchFirstFrame(),
    compile: benchCompile(),
    'kb-pack': await benchKbPack(),
    'index-rebuild': await benchIndexRebuild(),
  };

  // Defence in depth against `bench-ratchet.mjs`'s own budget table drifting out of sync with the
  // benchmarks actually run here — see the identical reasoning `reconstruct.ts`'s own
  // `EVENT_TYPE_MEMBERSHIP` gives for checking both directions.
  for (const name of Object.keys(achieved)) {
    if (!BENCHMARK_NAMES.includes(name)) {
      throw new Error(`bench: "${name}" has no 21 §21.5 budget recorded in bench-ratchet.mjs.`);
    }
  }

  const marks = readMarks();
  const { regressions, overBudget, improved, next } = evaluateBenchRatchet(achieved, marks);

  console.log("21 §21.5 performance benchmarks (median of several samples; see this file's own");
  console.log(
    'doc comment for why a shared, concurrent sandbox makes single-sample timing unsafe):',
  );
  console.log(
    usingDist
      ? '  (cold-start/first-frame: benchmarking the real built packages/cli/dist/forge.mjs)'
      : '  (cold-start/first-frame: packages/cli/dist/forge.mjs not built — falling back to the ' +
          'dev-mode bin/forge.mjs spawn wrapper, a real but slower approximation; run `pnpm build` ' +
          'first for a measurement matching the real npx forge-method --version cold start)',
  );
  for (const [name, result] of Object.entries(achieved)) {
    const mark = marks[name];
    const markText = mark === undefined ? 'no prior mark' : `mark ${mark.ms.toFixed(1)}ms`;
    console.log(
      `  - ${name}: ${result.ms.toFixed(1)}ms (fixture size ${String(result.fixtureSize)}, ${markText})`,
    );
  }

  if (check) {
    if (regressions.length > 0) {
      console.error('\nbench --check: regression(s) past the stricter of mark or budget:\n');
      for (const regression of regressions) console.error(`  - ${regression}`);
      return 1;
    }
    console.log('\nbench --check: no regressions.');
    return 0;
  }

  if (improved.length > 0) {
    console.log('\nImproved marks (will be written):');
    for (const line of improved) console.log(`  - ${line}`);
  }
  writeFileSync(marksPath, `${JSON.stringify(next, null, 2)}\n`);

  if (overBudget.length > 0) {
    // A real, disclosed, currently-true fact about this codebase (SPEC-QUESTIONS.md Q188 point 3),
    // not a suite bug: `first-frame` measured against the real, built `dist/forge.mjs` in this shared
    // sandbox lands around 500-650ms against its own 400ms budget — a control measurement (timing an
    // unknown-subcommand invocation, which does essentially no work) lands in the identical range with
    // low variance, showing this is the bundle's own real module-load cost, not scheduling noise.
    // `pnpm bench` therefore exits non-zero on this repository today, on purpose: silently exiting 0
    // over a real, unfixed budget miss would be worse than a loud failure a future performance piece
    // has to actually resolve.
    console.error("\nbench: over 21 §21.5's own absolute budget:\n");
    for (const line of overBudget) console.error(`  - ${line}`);
    return 1;
  }

  return 0;
}

process.exitCode = await main();
