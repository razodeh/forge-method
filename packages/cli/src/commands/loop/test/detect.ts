/**
 * `detectTestRunners` -- `forge test adopt`'s deterministic half (`13` F-TEST-11's own "Detection"
 * paragraph): inspects a project's own manifests, across languages, for a test runner it recognises
 * with enough confidence to propose a structured `execution.testCommands.<layer>` entry outright,
 * preferring that runner's richest machine-readable output (one of `TEST_REPORT_FORMATS`) to a
 * hand- or agent-written translator. Anything it does not confidently recognise -- an unfamiliar
 * framework, an ecosystem with no built-in parser that fits, a Makefile whose own `test:` recipe does
 * not name a known runner, a polyglot monorepo it cannot resolve to one command, or a project with no
 * test setup at all -- is a real, typed `{confident: false}` candidate `adopt.ts` hands off to P7's
 * `adopt-tests` agent workflow (`specs/22` M17 Decision 2) rather than guessing.
 *
 * **Why these runners, and not others.** `TEST_REPORT_FORMATS` (`@forge/schemas/config`) has six
 * built-ins; a project's own real output only ever fits one of them WITHOUT adding a dependency or
 * losing information to a schema this piece did not relax. Vitest/Jest/Mocha/Node's built-in test
 * runner (JS), pytest (Python, the same marker-presence confidence `ecosystem.ts`'s own legacy path
 * already established), `go test` (Go) and PHPUnit (PHP, whose own `--log-junit` is a zero-dependency
 * CLI flag) each have one. Maven/Gradle's own default JUnit XML output is one file PER TEST CLASS,
 * which `execution.testCommands.<layer>.output.path`'s single-path shape (`18` §18.3) cannot express
 * without an aggregation step this piece does not build; `cargo test`'s stable CLI has no built-in
 * JUnit/TAP output at all; `dotnet test`'s own single-file format is TRX, which has no built-in
 * `TEST_REPORT_FORMATS` parser; Ruby's two mainstream runners (minitest, RSpec) need an added gem for
 * either JUnit or TAP. Each of those five is still recognised BY ECOSYSTEM (so the project is told
 * what was found, not left guessing why nothing happened) but hands off rather than proposing a
 * command this piece cannot back with a real, already-shipped parser.
 *
 * **Monorepos.** Recursing into every subdirectory looking for a second manifest is explicitly out of
 * scope here (`process/plans/PLAN-M17.md` P6's own report records this as a disclosed gap): the
 * common case -- an npm/pnpm/Yarn workspaces root whose OWN `package.json` already aggregates every
 * workspace's tests into one `scripts.test` -- is covered for free by the plain root-level read below,
 * with no extra code. A root that declares `workspaces`/`pnpm-workspace.yaml` but has no usable root
 * test command of its own is a real, named hand-off (`'workspace-no-root-command'`), not silently
 * treated as "no test setup at all".
 *
 * @see specs/13 F-TEST-11
 * @see specs/18 §18.3
 * @see specs/22 M17 P6
 */
import { listDirSorted, pathExists, readTextFile } from '@forge/core/fs';
import type { ProjectPaths } from '@forge/core/fs';
import type { StructuredTestCommand } from '@forge/schemas/config';

/** The one layer `detectTestRunners` ever proposes for (`process/plans/PLAN-M17.md` P6's own report:
 * a DECISION, not an oversight -- inferring whether a given manifest's tests are `unit`/
 * `integration`/`e2e`/etc. from CI config or script names alone is a per-project judgement call this
 * piece does not generalise; `'unit'` is the one layer every recognised manifest can name without
 * that judgement). */
export const DETECTED_LAYER = 'unit' as const;

/** The ecosystem a directory's own manifests name -- real even when `confident` below is `false`: a
 * project told "this is a Rust project, hands off" has learned something `'none'` does not say at
 * all. */
export type DetectedEcosystem =
  | 'javascript'
  | 'python'
  | 'go'
  | 'php'
  | 'rust'
  | 'java'
  | 'dotnet'
  | 'ruby'
  | 'makefile-only'
  | 'workspace-no-root-command'
  | 'none';

/** The runner `detectTestRunners` proposed a command for -- present only when `confident` is `true`. */
export type DetectedRunner =
  'vitest' | 'jest' | 'mocha' | 'node-test' | 'pytest' | 'go-test' | 'phpunit';

/**
 * One directory's own detection result. `command`, when present, is exactly the structured
 * `execution.testCommands.<layer>` entry `adopt.ts` stages -- this module proposes, it never writes
 * to any file itself (Decision 4, `process/plans/PLAN-M17.md`: "detection only ever proposes").
 */
export interface DetectedCandidate {
  /** Project-relative; `'.'` for the project root -- `detectTestRunners` v1 only ever returns this
   * (see this file's own doc comment on monorepo scope). */
  readonly dir: string;
  readonly layer: typeof DETECTED_LAYER;
  readonly ecosystem: DetectedEcosystem;
  readonly runner?: DetectedRunner;
  readonly confident: boolean;
  readonly command?: StructuredTestCommand;
  /** A human-readable account of what was found and why -- always present, confident or not, so
   * `forge test adopt`'s own non-`--json` output and hand-off message never have to be invented
   * separately from what detection actually saw. */
  readonly reason: string;
}

const OUTPUT_DIR = '.forge/test-output';

function fileOutput(layer: string, extension: string): { path: string } {
  return { path: `${OUTPUT_DIR}/${layer}.${extension}` };
}

/** Case-insensitive, whole-package-name membership test over a `package.json`'s merged
 * `dependencies`/`devDependencies` -- a scoped or version-ranged entry is still a real declaration of
 * intent to use that package, so only the KEY matters, never the version string. */
function hasDependency(deps: Readonly<Record<string, unknown>>, name: string): boolean {
  return Object.hasOwn(deps, name);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function vitestCommand(): StructuredTestCommand {
  return {
    run: 'npx vitest run --reporter=json',
    output: { source: 'stdout' },
    format: 'vitest-json',
    scope: 'npx vitest run --reporter=json {files}',
    filter: 'npx vitest run --reporter=json -t {name:regex}',
  };
}

function jestCommand(): StructuredTestCommand {
  return {
    run: 'npx jest --json',
    output: { source: 'stdout' },
    format: 'jest-json',
    scope: 'npx jest --json {files}',
    filter: 'npx jest --json -t {name:regex}',
  };
}

function mochaCommand(): StructuredTestCommand {
  return {
    run: 'npx mocha --reporter tap',
    output: { source: 'stdout' },
    format: 'tap',
    scope: 'npx mocha --reporter tap {files}',
    filter: 'npx mocha --reporter tap --grep {name:regex}',
  };
}

function nodeTestCommand(): StructuredTestCommand {
  return {
    run: 'node --test',
    output: { source: 'stdout' },
    format: 'tap',
    scope: 'node --test {files}',
    filter: 'node --test --test-name-pattern={name:regex}',
  };
}

function pytestCommand(): StructuredTestCommand {
  const output = fileOutput(DETECTED_LAYER, 'xml');
  return {
    run: `python -m pytest --junit-xml=${output.path}`,
    output: { source: 'file', path: output.path },
    format: 'junit-xml',
    scope: `python -m pytest --junit-xml=${output.path} {files}`,
    filter: `python -m pytest --junit-xml=${output.path} -k {name}`,
  };
}

function goTestCommand(): StructuredTestCommand {
  return {
    run: 'go test -json ./...',
    output: { source: 'stdout' },
    format: 'go-test-json',
    filter: 'go test -json -run {name:regex} ./...',
  };
}

function phpunitCommand(): StructuredTestCommand {
  const output = fileOutput(DETECTED_LAYER, 'xml');
  return {
    run: `vendor/bin/phpunit --log-junit ${output.path}`,
    output: { source: 'file', path: output.path },
    format: 'junit-xml',
    scope: `vendor/bin/phpunit --log-junit ${output.path} {files}`,
    filter: `vendor/bin/phpunit --log-junit ${output.path} --filter {name:regex}`,
  };
}

/** Builds a confident JS candidate for `runner`, with `reason` describing which signal (an installed
 * dependency, or the existing `scripts.test` string for Node's own built-in runner, which needs no
 * dependency at all) decided it. */
function confidentJs(
  dir: string,
  runner: DetectedRunner,
  command: StructuredTestCommand,
  reason: string,
): DetectedCandidate {
  return {
    dir,
    layer: DETECTED_LAYER,
    ecosystem: 'javascript',
    runner,
    confident: true,
    command,
    reason,
  };
}

/** The four JS runner shapes `detectJavaScript` can read directly off a real `scripts.test` string
 * -- checked in this fixed order only because `vitest`/`jest`/`mocha` are mutually exclusive in
 * practice (a project runs one), so order between them never matters for a real script; `node --test`
 * is checked last only by convention. */
const SCRIPT_RUNNER_PATTERNS: readonly (readonly [RegExp, DetectedRunner])[] = [
  [/\bvitest\b/, 'vitest'],
  [/\bjest\b/, 'jest'],
  [/\bmocha\b/, 'mocha'],
  [/\bnode\b.*--test\b/, 'node-test'],
];

/** The one runner, if any, `testScript`'s own real text already names -- `undefined` when it names
 * none of the four (e.g. a generic wrapper script, `"run-tests.sh"`), which the caller reads as "fall
 * back to dependency presence" rather than "no test script exists at all". */
function matchScriptRunner(testScript: string): DetectedRunner | undefined {
  for (const [pattern, runner] of SCRIPT_RUNNER_PATTERNS) {
    if (pattern.test(testScript)) return runner;
  }
  return undefined;
}

/** Reads `dir/package.json` and decides the JS candidate for it, or `undefined` when `dir` has no
 * `package.json` at all (so the caller can fall through to the next ecosystem's own markers). */
async function detectJavaScript(
  paths: ProjectPaths,
  dir: string,
): Promise<DetectedCandidate | undefined> {
  const manifestPath = dir === '.' ? 'package.json' : `${dir}/package.json`;
  const abs = paths.resolveWithin(manifestPath);
  if (!(await pathExists(abs))) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(abs));
  } catch {
    return {
      dir,
      layer: DETECTED_LAYER,
      ecosystem: 'javascript',
      confident: false,
      reason: `${manifestPath} exists but is not valid JSON -- cannot read its scripts or dependencies.`,
    };
  }
  const pkg: Readonly<Record<string, unknown>> = isRecord(parsed) ? parsed : {};
  const deps: Record<string, unknown> = {
    ...(isRecord(pkg['dependencies']) ? pkg['dependencies'] : {}),
    ...(isRecord(pkg['devDependencies']) ? pkg['devDependencies'] : {}),
  };
  const scripts = isRecord(pkg['scripts']) ? pkg['scripts'] : {};
  const testScript = typeof scripts['test'] === 'string' ? scripts['test'] : undefined;

  // A fresh critic round reproduced this directly: a project mid-migration between two runners (both
  // still listed as devDependencies) has its OWN "scripts.test" already say which one it really runs
  // -- checked FIRST, before the dependency-priority fallback below, so a real "scripts.test": "jest
  // --coverage" is never silently overridden by a vitest devDependency the project simply has not
  // removed yet. Only `node --test` needs no dependency at all, so it was already script-driven; the
  // other three are now cross-checked against their own real dependency before being trusted, so a
  // script mentioning a tool that was never actually installed still falls through honestly rather
  // than proposing a command that cannot run.
  if (testScript !== undefined) {
    const scriptRunner = matchScriptRunner(testScript);
    if (scriptRunner === 'node-test') {
      return confidentJs(
        dir,
        'node-test',
        nodeTestCommand(),
        `${manifestPath}'s own "scripts.test" ("${testScript}") already runs Node's built-in test runner.`,
      );
    }
    if (scriptRunner === 'vitest' && hasDependency(deps, 'vitest')) {
      return confidentJs(
        dir,
        'vitest',
        vitestCommand(),
        `${manifestPath}'s own "scripts.test" ("${testScript}") already runs vitest.`,
      );
    }
    if (scriptRunner === 'jest' && hasDependency(deps, 'jest')) {
      return confidentJs(
        dir,
        'jest',
        jestCommand(),
        `${manifestPath}'s own "scripts.test" ("${testScript}") already runs jest.`,
      );
    }
    if (scriptRunner === 'mocha' && hasDependency(deps, 'mocha')) {
      return confidentJs(
        dir,
        'mocha',
        mochaCommand(),
        `${manifestPath}'s own "scripts.test" ("${testScript}") already runs mocha.`,
      );
    }
  }

  // Reached when "scripts.test" does not clearly name one of the three (absent, generic, or naming a
  // tool with no matching dependency) -- the original dependency-priority fallback, unchanged.
  if (hasDependency(deps, 'vitest')) {
    return confidentJs(
      dir,
      'vitest',
      vitestCommand(),
      `${manifestPath} declares "vitest" as a dependency.`,
    );
  }
  if (hasDependency(deps, 'jest')) {
    return confidentJs(
      dir,
      'jest',
      jestCommand(),
      `${manifestPath} declares "jest" as a dependency.`,
    );
  }
  if (hasDependency(deps, 'mocha')) {
    return confidentJs(
      dir,
      'mocha',
      mochaCommand(),
      `${manifestPath} declares "mocha" as a dependency.`,
    );
  }

  const workspaces = pkg['workspaces'] !== undefined;
  if (workspaces) {
    return {
      dir,
      layer: DETECTED_LAYER,
      ecosystem: 'workspace-no-root-command',
      confident: false,
      reason:
        `${manifestPath} declares "workspaces" (a monorepo) but its own "scripts.test" either does ` +
        'not exist or does not name a recognised runner -- per-package test adoption is not built ' +
        'by this piece (process/plans/PLAN-M17.md P6); a root script that itself aggregates every ' +
        'workspace\'s tests (e.g. "pnpm -r test") would be detected like any other JS project.',
    };
  }

  return {
    dir,
    layer: DETECTED_LAYER,
    ecosystem: 'javascript',
    confident: false,
    reason:
      `${manifestPath} exists but names no recognised test runner (checked: vitest, jest, mocha, ` +
      `Node's built-in --test) in its dependencies or "scripts.test"${testScript === undefined ? '' : ` ("${testScript}")`}.`,
  };
}

const PYTHON_MARKERS = ['pyproject.toml', 'setup.cfg', 'tox.ini'];

/** `js`-equivalent confidence rule for Python: presence of any of the three markers means pytest, the
 * identical "a real, unambiguous declaration of which test tooling the project itself actually runs"
 * confidence `ecosystem.ts`'s own pre-existing legacy-path probe already applies to the same three
 * files (that file additionally accepts `pytest.ini`, which `13` F-TEST-11's own named manifest list
 * does not -- not reproduced here, since this detector's own job is the list that spec actually
 * names, not `ecosystem.ts`'s). */
async function detectPython(
  paths: ProjectPaths,
  dir: string,
): Promise<DetectedCandidate | undefined> {
  for (const marker of PYTHON_MARKERS) {
    const relative = dir === '.' ? marker : `${dir}/${marker}`;
    if (await pathExists(paths.resolveWithin(relative))) {
      return {
        dir,
        layer: DETECTED_LAYER,
        ecosystem: 'python',
        runner: 'pytest',
        confident: true,
        command: pytestCommand(),
        reason: `${relative} exists -- pytest, by the same marker convention this codebase's legacy ecosystem probe already uses.`,
      };
    }
  }
  return undefined;
}

async function detectGo(paths: ProjectPaths, dir: string): Promise<DetectedCandidate | undefined> {
  const relative = dir === '.' ? 'go.mod' : `${dir}/go.mod`;
  if (!(await pathExists(paths.resolveWithin(relative)))) return undefined;
  return {
    dir,
    layer: DETECTED_LAYER,
    ecosystem: 'go',
    runner: 'go-test',
    confident: true,
    command: goTestCommand(),
    reason: `${relative} exists -- "go test -json" is the standard library's own machine-readable output.`,
  };
}

async function detectPhp(paths: ProjectPaths, dir: string): Promise<DetectedCandidate | undefined> {
  const relative = dir === '.' ? 'composer.json' : `${dir}/composer.json`;
  const abs = paths.resolveWithin(relative);
  if (!(await pathExists(abs))) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(abs));
  } catch {
    return {
      dir,
      layer: DETECTED_LAYER,
      ecosystem: 'php',
      confident: false,
      reason: `${relative} exists but is not valid JSON.`,
    };
  }
  const pkg = isRecord(parsed) ? parsed : {};
  const require = isRecord(pkg['require']) ? pkg['require'] : {};
  const requireDev = isRecord(pkg['require-dev']) ? pkg['require-dev'] : {};
  if (hasDependency(require, 'phpunit/phpunit') || hasDependency(requireDev, 'phpunit/phpunit')) {
    return {
      dir,
      layer: DETECTED_LAYER,
      ecosystem: 'php',
      runner: 'phpunit',
      confident: true,
      command: phpunitCommand(),
      reason: `${relative} requires "phpunit/phpunit" -- PHPUnit's own "--log-junit" needs no added dependency.`,
    };
  }
  return {
    dir,
    layer: DETECTED_LAYER,
    ecosystem: 'php',
    confident: false,
    reason: `${relative} exists but does not require "phpunit/phpunit" -- no other built-in PHP test format is known.`,
  };
}

/** Ecosystems this detector recognises by manifest alone but never proposes a command for (this
 * file's own doc comment explains why each one) -- `[manifestRelative, ecosystem, humanName]`. */
const HANDOFF_ONLY_MANIFESTS: readonly (readonly [string, DetectedEcosystem, string])[] = [
  ['Cargo.toml', 'rust', 'Rust (Cargo)'],
  ['pom.xml', 'java', 'Java (Maven)'],
  ['build.gradle', 'java', 'Java (Gradle)'],
  ['build.gradle.kts', 'java', 'Java (Gradle)'],
  ['Gemfile', 'ruby', 'Ruby (Bundler)'],
];

async function detectHandoffOnlyEcosystem(
  paths: ProjectPaths,
  dir: string,
): Promise<DetectedCandidate | undefined> {
  for (const [manifest, ecosystem, humanName] of HANDOFF_ONLY_MANIFESTS) {
    const relative = dir === '.' ? manifest : `${dir}/${manifest}`;
    if (await pathExists(paths.resolveWithin(relative))) {
      return {
        dir,
        layer: DETECTED_LAYER,
        ecosystem,
        confident: false,
        reason:
          `${relative} exists -- ${humanName} -- but no built-in forge-test-report format fits its ` +
          "standard test output without an added dependency or a multi-file report this piece's " +
          'single-path "output.path" cannot express (this file\'s own doc comment has the detail).',
      };
    }
  }
  // `.csproj` is matched by extension, not a fixed name -- a directory listing, not a single
  // `pathExists` check, which is why it is handled separately rather than folded into the table above.
  const csprojDir = dir === '.' ? paths.resolveWithin('.') : paths.resolveWithin(dir);
  let entries: readonly string[];
  try {
    entries = await listDirSorted(csprojDir);
  } catch {
    entries = [];
  }
  if (entries.some((entry) => entry.toLowerCase().endsWith('.csproj'))) {
    return {
      dir,
      layer: DETECTED_LAYER,
      ecosystem: 'dotnet',
      confident: false,
      reason:
        'a ".csproj" file exists -- .NET -- but "dotnet test"\'s own single-file format (TRX) has no ' +
        'built-in forge-test-report parser in this codebase.',
    };
  }
  return undefined;
}

const MAKEFILE_RUNNER_BUILDERS: readonly (readonly [
  RegExp,
  DetectedRunner,
  DetectedEcosystem,
  () => StructuredTestCommand,
])[] = [
  [/\bpytest\b/, 'pytest', 'python', pytestCommand],
  [/\bgo\s+test\b/, 'go-test', 'go', goTestCommand],
  [/\bvitest\b/, 'vitest', 'javascript', vitestCommand],
  [/\bjest\b/, 'jest', 'javascript', jestCommand],
  [/\bmocha\b/, 'mocha', 'javascript', mochaCommand],
  [/\bnode\b.*--test\b/, 'node-test', 'javascript', nodeTestCommand],
  [/\bphpunit\b/, 'phpunit', 'php', phpunitCommand],
];

/** Extracts a `test:` target's own recipe lines (standard Make syntax: every immediately-following
 * line starting with a literal TAB, until the first line that does not) and matches them against
 * `MAKEFILE_RUNNER_BUILDERS`. Real, bounded Makefile support -- not a general Makefile parser: a
 * `test:` target whose recipe calls a shell script or another `make` target this function cannot see
 * into is a genuine, honest hand-off, not a false negative this piece claims to resolve. */
function matchMakefileTestTarget(makefileText: string): { recipe: string } | undefined {
  const lines = makefileText.split('\n');
  const targetIndex = lines.findIndex((line) => /^test\s*:/.test(line));
  if (targetIndex === -1) return undefined;
  const recipeLines: string[] = [];
  for (let i = targetIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line.startsWith('\t')) break;
    recipeLines.push(line.slice(1));
  }
  return { recipe: recipeLines.join('\n') };
}

/** Commands that print or evaluate text rather than invoking a real tool -- a recipe line whose own
 * first real command is one of these is never scanned for a runner keyword at all, however that
 * keyword might appear inside the TEXT it prints (`echo`) or a bare shell comment. A fresh critic
 * round reproduced this directly: a naive whole-recipe substring scan read
 * `@echo "Note: this project no longer uses pytest; see custom_runner.sh"` as a real pytest
 * invocation -- exactly backwards. */
const NON_INVOKING_COMMANDS = new Set(['echo', 'printf', 'cat', 'true', 'false', ':']);

/** Strips Make's own per-recipe-line prefix characters (`@` silences echoing the command when it
 * runs, `-` ignores its exit code, `+` always runs it even under `-n`) -- never part of the real
 * command's own identity, so always removed before anything else inspects the line. */
function stripMakeRecipeModifiers(segment: string): string {
  return segment.replace(/^[@+-]+\s*/, '');
}

/** One real, non-comment, non-text-printing shell command segment found inside a Makefile recipe. */
interface RecipeCommand {
  /** The segment's own real text (modifiers stripped) -- what a runner keyword is matched against. */
  readonly text: string;
  /** `false` when a real invocation was found but scoped or guarded (`cd dir &&`, an `if`/`;`-joined
   * sibling) in a way this detector's own canned command does not account for -- surfaced as a hedge
   * in `detectMakefile`'s own `reason`, never silently assumed to still work. */
  readonly isWholeLine: boolean;
}

/** Splits every real line of `recipe` into its own shell command segments (on `&&`, `||`, `;`, a bare
 * `|`), skipping pure `#`-comment lines entirely and any segment whose own first word is one of
 * `NON_INVOKING_COMMANDS`. A deliberately shallow, non-adversarial parse (no quote-awareness, no
 * subshell handling): enough to tell "a real invocation of this tool" from "this tool's name merely
 * appears somewhere in this recipe's own text" (`echo`'s own string argument, a comment) -- the
 * concrete gap the critic round above found, not a general Makefile/shell parser this piece does not
 * attempt to be. A quoted string that happens to contain one of the split characters (the critic's
 * own repro: a `;` inside `echo`'s quoted argument) can still split mid-string, but the resulting
 * leading segment's own first word is still `echo`, which the denylist still excludes regardless of
 * where the unaware split landed. */
function recipeCommandsOf(recipe: string): readonly RecipeCommand[] {
  const commands: RecipeCommand[] = [];
  for (const rawLine of recipe.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const segments = line
      .split(/&&|\|\||[;|]/)
      .map((segment) => stripMakeRecipeModifiers(segment.trim()))
      .filter((segment) => segment !== '');
    const isWholeLine = segments.length === 1 && segments[0] === stripMakeRecipeModifiers(line);
    for (const segment of segments) {
      const firstToken = segment.split(/\s+/)[0] ?? '';
      if (NON_INVOKING_COMMANDS.has(firstToken)) continue;
      commands.push({ text: segment, isWholeLine });
    }
  }
  return commands;
}

async function detectMakefile(
  paths: ProjectPaths,
  dir: string,
): Promise<DetectedCandidate | undefined> {
  const relative = dir === '.' ? 'Makefile' : `${dir}/Makefile`;
  const abs = paths.resolveWithin(relative);
  if (!(await pathExists(abs))) return undefined;
  const text = await readTextFile(abs);
  const target = matchMakefileTestTarget(text);
  if (target === undefined) {
    return {
      dir,
      layer: DETECTED_LAYER,
      ecosystem: 'makefile-only',
      confident: false,
      reason: `${relative} exists but declares no "test:" target.`,
    };
  }
  const commands = recipeCommandsOf(target.recipe);
  for (const [pattern, runner, ecosystem, build] of MAKEFILE_RUNNER_BUILDERS) {
    const matched = commands.find((command) => pattern.test(command.text));
    if (matched !== undefined) {
      const hedge = matched.isWholeLine
        ? ''
        : ` This recipe line is itself scoped or guarded (a directory change, a conditional, another ` +
          `joined command) in a way this detector's canned command does not account for -- verify it ` +
          'actually runs before trusting it, or use --agent.';
      return {
        dir,
        layer: DETECTED_LAYER,
        ecosystem,
        runner,
        confident: true,
        command: build(),
        reason:
          `${relative}'s own "test:" target recipe invokes ${runner} -- proposing the identical ` +
          `command this detector would for that runner directly.${hedge}`,
      };
    }
  }
  return {
    dir,
    layer: DETECTED_LAYER,
    ecosystem: 'makefile-only',
    confident: false,
    reason: `${relative} declares a "test:" target, but its recipe names no runner this detector recognises: ${JSON.stringify(target.recipe.slice(0, 200))}.`,
  };
}

const CI_CONFIG_PATHS = [
  '.gitlab-ci.yml',
  '.circleci/config.yml',
  'azure-pipelines.yml',
  'Jenkinsfile',
  '.travis.yml',
];

/** Whether a known CI configuration file exists -- a confidence-enriching signal only (`13`
 * F-TEST-11 names CI configuration among detection's inputs), never required for, nor sufficient on
 * its own to produce, a confident proposal: this detector never attempts to parse an arbitrary CI
 * YAML's own job steps for the real test invocation, since there is no reliable, general way to
 * recover "the one real test command" from an arbitrary pipeline's step graph without running it. */
async function describeKnownCiConfig(
  paths: ProjectPaths,
  dir: string,
): Promise<string | undefined> {
  const githubDir = dir === '.' ? '.github/workflows' : `${dir}/.github/workflows`;
  const githubAbs = paths.resolveWithin(githubDir);
  if (await pathExists(githubAbs)) {
    try {
      const entries = await listDirSorted(githubAbs);
      if (entries.some((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))) {
        return `${githubDir}/`;
      }
    } catch {
      // Not a real finding if the directory could not be listed -- fall through to the other paths.
    }
  }
  for (const relative of CI_CONFIG_PATHS) {
    const path = dir === '.' ? relative : `${dir}/${relative}`;
    if (await pathExists(paths.resolveWithin(path))) return path;
  }
  return undefined;
}

/**
 * Inspects the project root for a recognised test runner (`13` F-TEST-11's own "Detection"
 * paragraph), in this precedence: JavaScript (`package.json`) > Python > Go > PHP > a hand-off-only
 * ecosystem (Rust/Java/.NET/Ruby) > a `Makefile`'s own `test:` target > "nothing recognised at all".
 * Always returns exactly one candidate (this file's own doc comment: monorepo recursion is out of
 * scope for v1) -- never throws for an ordinary "nothing here" outcome; a candidate with
 * `confident: false` IS the typed, honest answer `adopt.ts` hands to P7's workflow instead of
 * guessing.
 *
 * `reason` is enriched with a known CI configuration file's own path when one exists, regardless of
 * which branch decided the candidate -- `describeKnownCiConfig`'s own doc comment explains why this
 * is additive context only, never a parsed command source.
 */
export async function detectTestRunners(
  paths: ProjectPaths,
): Promise<readonly DetectedCandidate[]> {
  const dir = '.';
  const ciConfig = await describeKnownCiConfig(paths, dir);
  const enrich = (candidate: DetectedCandidate): DetectedCandidate =>
    ciConfig === undefined
      ? candidate
      : {
          ...candidate,
          reason: `${candidate.reason} Also has a known CI configuration at ${ciConfig}.`,
        };

  const probes: ((p: ProjectPaths, d: string) => Promise<DetectedCandidate | undefined>)[] = [
    detectJavaScript,
    detectPython,
    detectGo,
    detectPhp,
    detectHandoffOnlyEcosystem,
    detectMakefile,
  ];
  for (const probe of probes) {
    const candidate = await probe(paths, dir);
    if (candidate !== undefined) return [enrich(candidate)];
  }

  return [
    enrich({
      dir,
      layer: DETECTED_LAYER,
      ecosystem: 'none',
      confident: false,
      reason:
        'no package manifest, language marker, or Makefile "test:" target was found at all -- hands ' +
        'off to the agent-driven workflow (specs/22 M17 P7), which proposes a conventional runner for ' +
        "this project's stack as a reviewable change, never a silently added dependency.",
    }),
  ];
}
