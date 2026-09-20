/**
 * `clean-build`, `reproducible-install` and `ci-skeleton` — the three `G-Foundation` checks about a clean clone
 * (`10` §10.3: "Clean clone doesn't build; no reproducible install; CI skeleton absent"), `PLAN-M13.md` P25.
 *
 * **What these prove, and what they do not.** They read the committed project (`committed-tree.ts`) and never
 * run a build or an install: a gate check must be deterministic and read project state only, and an install needs
 * the network. So they prove the STRUCTURAL preconditions `11` F-INIT-3 states as hard requirements ("one command
 * to install, one to build, one to test, one to run", "lockfiles committed; versions pinned; toolchain version
 * declared") and that `14` §14.3 gives the pipeline (a definition in the repo). They do not prove the build
 * succeeds: that is the pipeline's run, whose verdict `14` §14.3 rule 7 says lands in `docs/forge/reports/` for
 * gates to read, in a format no spec defines yet. The limit is stated in Q219 and in each message.
 *
 * @see specs/10 §10.3
 * @see specs/11 F-INIT-3
 * @see specs/14 §14.3
 * @see PLAN-M13.md P25
 */
import { listDirEntriesSorted, pathExists } from '@forge/core/fs';
import * as YAML from 'yaml';

import { readCommittedTree, type CommittedTree } from './committed-tree.ts';
import type { DoctorRuleContext, DoctorRuleViolation } from './rules.ts';

function violation(subject: string, message: string, remedy: string): DoctorRuleViolation {
  return { subject, message, remedy };
}

/** Runs `check` on the committed tree, or returns the one `git` violation that says why there is none. */
async function withCommittedTree(
  ctx: DoctorRuleContext,
  check: (tree: CommittedTree) => Promise<readonly DoctorRuleViolation[]>,
): Promise<readonly DoctorRuleViolation[]> {
  const result = await readCommittedTree(ctx.projectRoot);
  if (result.ok) return check(result.tree);
  if (result.reason === 'not-a-repository') {
    return [
      violation(
        'git',
        `The project is not inside a git repository (${result.detail}), so there is no clean clone to check.`,
        'Run `git init`, commit the project, and run the check again.',
      ),
    ];
  }
  if (result.reason === 'no-commit') {
    return [
      violation(
        'git',
        'The repository has no commit, so a clean clone would be empty.',
        'Commit the scaffold (`git add -A && git commit`) and run the check again.',
      ),
    ];
  }
  return [
    violation(
      'git',
      `The committed files could not be listed: ${result.detail}.`,
      'Repair the repository (`git fsck`) and run the check again.',
    ),
  ];
}

/** The candidates that exist in the working tree but are not committed: absent from a clean clone. */
async function presentButUncommitted(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  candidates: readonly string[],
): Promise<readonly string[]> {
  const found: string[] = [];
  for (const candidate of candidates) {
    if (tree.files.has(candidate)) continue;
    if (await pathExists(ctx.paths.resolveWithin(candidate))) found.push(candidate);
  }
  return found;
}

type ReadOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly violation: DoctorRuleViolation };

async function readCommitted(tree: CommittedTree, file: string): Promise<ReadOutcome> {
  const read = await tree.read(file);
  // A byte order mark starts many files a Windows tool wrote; a `^`-anchored pattern would miss the first line.
  if (read.ok) return { ok: true, text: read.text.replace(/^\uFEFF/, '') };
  return {
    ok: false,
    violation: violation(
      file,
      `${file} could not be read: ${read.detail}.`,
      `Repair ${file} so it can be read, commit it, and run the check again.`,
    ),
  };
}

function parseJsonObject(text: string): Record<string, unknown> | string {
  try {
    // A byte order mark is legal at the start of a JSON file a tool wrote; `JSON.parse` refuses it.
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'it is not a JSON object';
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    return `it is not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`;
  }
}

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// clean-build
// ---------------------------------------------------------------------------------------------------------------

type BuildEvaluation =
  | { readonly kind: 'declares'; readonly how: string }
  | { readonly kind: 'silent'; readonly note: string }
  | { readonly kind: 'unreadable'; readonly detail: string };

interface BuildCandidate {
  readonly file: string;
  /** `undefined` for a manifest whose mere presence means its tool builds it (`cargo build`, `go build`, ...). */
  readonly evaluate: ((text: string) => BuildEvaluation) | undefined;
  readonly implied: string;
}

function makeTargetEvaluation(file: string, pattern: RegExp): (text: string) => BuildEvaluation {
  return (text) =>
    pattern.test(text)
      ? { kind: 'declares', how: `${file} target "build"` }
      : { kind: 'silent', note: `${file} has no "build" target` };
}

/** A build "command" that builds nothing: `true`, `:`, `exit 0`, `echo ...`, `noop`. */
const NO_OP_COMMAND =
  /^(?:true|:|exit\s+0|noop|echo(?:\s[^&|;<>`$]*)?|node\s+-e\s+["']?(?:0|1|;)?["']?|sleep\s+\d+)$/;

const BUILD_CANDIDATES: readonly BuildCandidate[] = [
  {
    file: 'package.json',
    implied: '',
    evaluate: (text) => {
      const parsed = parseJsonObject(text);
      if (typeof parsed === 'string') return { kind: 'unreadable', detail: parsed };
      const build = record(parsed['scripts'])?.['build'];
      if (!nonBlankString(build))
        return { kind: 'silent', note: 'package.json has no scripts.build' };
      return NO_OP_COMMAND.test(build.trim())
        ? {
            kind: 'silent',
            note: `package.json scripts.build is a no-op (${JSON.stringify(build)})`,
          }
        : { kind: 'declares', how: 'package.json scripts.build' };
    },
  },
  // A make target, not a `build := x` variable and not a bare `.PHONY: build`.
  ...['Makefile', 'GNUmakefile', 'makefile'].map((file): BuildCandidate => ({
    file,
    implied: '',
    evaluate: makeTargetEvaluation(file, /^build[ \t]*:(?!:?=)/m),
  })),
  ...['justfile', 'Justfile', '.justfile'].map((file): BuildCandidate => ({
    file,
    implied: '',
    evaluate: makeTargetEvaluation(file, /^@?build\b(?:[ \t]+[^\n:]*?)?[ \t]*:(?!=)/m),
  })),
  ...['Taskfile.yml', 'Taskfile.yaml', 'taskfile.yml', 'taskfile.yaml'].map(
    (file): BuildCandidate => ({
      file,
      implied: '',
      evaluate: (text) => {
        let parsed: unknown;
        try {
          parsed = YAML.parse(text);
        } catch (cause) {
          return { kind: 'unreadable', detail: `it is not valid YAML (${firstLine(cause)})` };
        }
        const tasks = record(record(parsed)?.['tasks']);
        return tasks !== undefined && Object.hasOwn(tasks, 'build')
          ? { kind: 'declares', how: `${file} task "build"` }
          : { kind: 'silent', note: `${file} has no "build" task` };
      },
    }),
  ),
  {
    file: 'pyproject.toml',
    implied: '',
    evaluate: (text) =>
      /^\[build-system\]/m.test(text)
        ? { kind: 'declares', how: 'pyproject.toml [build-system]' }
        : { kind: 'silent', note: 'pyproject.toml has no [build-system]' },
  },
  { file: 'setup.py', evaluate: undefined, implied: 'setup.py (python -m build)' },
  { file: 'Cargo.toml', evaluate: undefined, implied: 'Cargo.toml (cargo build)' },
  { file: 'go.mod', evaluate: undefined, implied: 'go.mod (go build)' },
  { file: 'pom.xml', evaluate: undefined, implied: 'pom.xml (mvn package)' },
  { file: 'build.gradle', evaluate: undefined, implied: 'build.gradle (gradle build)' },
  { file: 'build.gradle.kts', evaluate: undefined, implied: 'build.gradle.kts (gradle build)' },
  { file: 'MODULE.bazel', evaluate: undefined, implied: 'MODULE.bazel (bazel build)' },
  { file: 'flake.nix', evaluate: undefined, implied: 'flake.nix (nix build)' },
  {
    file: 'pubspec.yaml',
    evaluate: undefined,
    implied: 'pubspec.yaml (flutter build / dart compile)',
  },
];

function firstLine(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.split('\n')[0] ?? text;
}

/** `10` §10.3 "Clean clone doesn't build". `11` F-INIT-3 hard requirement: one command to build, recorded, used by
 * every gate. Structural proof: a committed manifest declares (or, for a language toolchain, implies) that command. */
export async function cleanBuildViolations(
  ctx: DoctorRuleContext,
): Promise<readonly DoctorRuleViolation[]> {
  return withCommittedTree(ctx, async (tree) => {
    const violations: DoctorRuleViolation[] = [];
    const declared: string[] = [];
    const silent: string[] = [];
    for (const candidate of BUILD_CANDIDATES) {
      if (!tree.files.has(candidate.file)) continue;
      if (candidate.evaluate === undefined) {
        // A zero-byte `setup.py` or `Cargo.toml` builds nothing.
        if (await hasContent(tree, candidate.file)) declared.push(candidate.implied);
        else silent.push(`${candidate.file} is empty`);
        continue;
      }
      const read = await readCommitted(tree, candidate.file);
      if (!read.ok) {
        violations.push(read.violation);
        continue;
      }
      const evaluation = candidate.evaluate(read.text);
      if (evaluation.kind === 'declares') declared.push(evaluation.how);
      else if (evaluation.kind === 'silent') silent.push(evaluation.note);
      else {
        violations.push(
          violation(
            candidate.file,
            `${candidate.file} could not be read: ${evaluation.detail}.`,
            `Repair ${candidate.file} so it parses, commit it, and run the check again.`,
          ),
        );
      }
    }
    // .NET names its project files, so they are matched by extension at the project root.
    for (const file of [...tree.files.keys()].sort()) {
      if (/^[^/]+\.(sln|csproj|fsproj|vbproj)$/.test(file) && (await hasContent(tree, file))) {
        declared.push(`${file} (dotnet build)`);
      }
    }
    if (declared.length > 0) return violations;

    const uncommitted = await presentButUncommitted(
      ctx,
      tree,
      BUILD_CANDIDATES.map((candidate) => candidate.file),
    );
    const details = [
      silent.length > 0 ? ` Found without a build command: ${silent.join('; ')}.` : '',
      uncommitted.length > 0
        ? ` Present in the working tree but not committed (so absent from a clean clone): ${uncommitted.join(', ')}.`
        : '',
    ].join('');
    violations.push(
      violation(
        'build',
        `No committed build command was found. Looked for a "build" script in package.json, a "build" target in a Makefile, justfile or Taskfile, a [build-system] in pyproject.toml, or a Cargo.toml, go.mod, pom.xml, build.gradle, MODULE.bazel, flake.nix, pubspec.yaml or a .NET project file.${details} This check does not run the build; the pipeline's run of it is the runtime evidence.`,
        'Add the one build command the scaffold names (for example a "build" script in package.json or a "build" target in a Makefile), commit it, and run the check again.',
      ),
    );
    return violations;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// reproducible-install
// ---------------------------------------------------------------------------------------------------------------

/** A file counts only when committed AND it has content: a zero-byte or whitespace-only file pins and declares
 * nothing. Only a small file is read to tell (anything over a few KiB is not blank). */
async function hasContent(tree: CommittedTree, file: string): Promise<boolean> {
  const committed = tree.files.get(file);
  if (committed === undefined || committed.size === 0) return false;
  if (committed.size > 4096) return true;
  const read = await tree.read(file);
  return read.ok && read.text.trim() !== '';
}

async function anyHasContent(tree: CommittedTree, names: readonly string[]): Promise<boolean> {
  for (const name of names) if (await hasContent(tree, name)) return true;
  return false;
}

/** A JSON lockfile (`package-lock.json`, `npm-shrinkwrap.json`) that is not one: `{}` pins nothing. Other lock
 * formats are only required to be non-empty. Returns why it is a stub, or `undefined`. */
async function lockStub(
  tree: CommittedTree,
  name: string,
  expectsEntries: boolean,
): Promise<string | undefined> {
  const size = tree.files.get(name)?.size ?? 0;
  // Any lockfile that locks something is longer than this; `lockfileVersion: '9.0'` alone is 23 bytes.
  if (expectsEntries && size < LOCK_MIN_BYTES_WITH_DEPENDENCIES) {
    return 'is too small to lock the dependencies package.json declares';
  }
  if (name !== 'package-lock.json' && name !== 'npm-shrinkwrap.json') return undefined;
  // A stub is tiny; a file this large is a real lockfile, and is not read (multi-MB npm lockfiles are ordinary).
  if ((tree.files.get(name)?.size ?? 0) > LOCK_STUB_MAX_BYTES) return undefined;
  const read = await readCommitted(tree, name);
  if (!read.ok) return 'could not be read';
  const parsed = parseJsonObject(read.text);
  if (typeof parsed === 'string') return `is not a usable lockfile (${parsed})`;
  if (typeof parsed['lockfileVersion'] !== 'number') {
    return 'has no lockfileVersion, so it is not a lockfile';
  }
  const packages = record(parsed['packages']);
  const dependencies = record(parsed['dependencies']);
  const locked =
    Object.keys(packages ?? {}).filter((key) => key !== '').length +
    Object.keys(dependencies ?? {}).length;
  return expectsEntries && locked === 0
    ? 'locks no package, but package.json declares dependencies'
    : undefined;
}

const LOCK_MIN_BYTES_WITH_DEPENDENCIES = 100;

/** Above this size a JSON lockfile is not inspected: `{"lockfileVersion":3}` is a few dozen bytes. */
const LOCK_STUB_MAX_BYTES = 64 * 1024;

/** Reports a lockfile question the way a reader needs it: which file names were looked for, and whether one exists
 * only in the working tree or is empty. Returns `undefined` when one is committed and non-empty. */
async function lockViolation(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  subject: string,
  names: readonly string[],
  what: string,
  expectsEntries = false,
): Promise<DoctorRuleViolation | undefined> {
  const stubs: string[] = [];
  for (const name of names) {
    if (!(await hasContent(tree, name))) continue;
    const stub = await lockStub(tree, name, expectsEntries);
    if (stub === undefined) return undefined;
    stubs.push(`${name} ${stub}`);
  }
  const empty: string[] = [];
  for (const name of names)
    if (tree.files.has(name) && !(await hasContent(tree, name))) empty.push(name);
  const uncommitted = await presentButUncommitted(ctx, tree, names);
  const extra = [
    empty.length > 0 ? ` ${empty.join(', ')} is committed but empty.` : '',
    stubs.length > 0 ? ` ${stubs.join('; ')}.` : '',
    uncommitted.length > 0
      ? ` ${uncommitted.join(', ')} exists in the working tree but is not committed, so a clean clone lacks it.`
      : '',
  ].join('');
  return violation(
    subject,
    `No committed ${what} was found (looked for ${names.join(', ')}); a clean clone would resolve dependencies afresh.${extra}`,
    `Commit the ${what} your package manager writes (${names[0] ?? what}) and run the check again.`,
  );
}

function toolchainViolation(subject: string, looked: string, remedy: string): DoctorRuleViolation {
  return violation(
    subject,
    `The toolchain version is not declared (looked for ${looked}); a clean machine would pick whatever it has installed.`,
    remedy,
  );
}

const JS_LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
];
const PYTHON_LOCKFILES = ['uv.lock', 'poetry.lock', 'Pipfile.lock', 'pdm.lock', 'pylock.toml'];
const REQUIREMENTS_FILE = /^requirements([-_.][A-Za-z0-9_.-]*)?\.txt$/;

async function checkJavascript(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const manifestRead = await readCommitted(tree, 'package.json');
  const manifestValue = manifestRead.ok ? parseJsonObject(manifestRead.text) : undefined;
  const declaresDependencies =
    typeof manifestValue === 'object' &&
    ['dependencies', 'devDependencies', 'optionalDependencies'].some(
      (key) => Object.keys(record(manifestValue[key]) ?? {}).length > 0,
    );
  const lock = await lockViolation(
    ctx,
    tree,
    'javascript',
    JS_LOCKFILES,
    'lockfile',
    declaresDependencies,
  );
  if (lock !== undefined) into.push(lock);

  let declared = await anyHasContent(tree, ['.nvmrc', '.node-version']);
  if (!declared && tree.files.has('.tool-versions')) {
    const read = await readCommitted(tree, '.tool-versions');
    if (!read.ok) into.push(read.violation);
    else declared = /^[ \t]*(nodejs|node)[ \t]+\S+/m.test(read.text);
  }
  if (!manifestRead.ok) {
    into.push(manifestRead.violation);
    return;
  }
  const manifest = parseJsonObject(manifestRead.text);
  if (typeof manifest === 'string') {
    into.push(
      violation(
        'package.json',
        `package.json could not be read: ${manifest}.`,
        'Repair package.json so it parses, commit it, and run the check again.',
      ),
    );
    return;
  }
  if (!declared) {
    const versions = [record(manifest['engines'])?.['node'], record(manifest['volta'])?.['node']];
    // `*`, `x`, `latest` and `>=0` constrain nothing: they declare no toolchain version.
    declared = versions.some(
      (value) =>
        nonBlankString(value) && !/^(?:\*|x|latest|>=?\s*0(?:\.0)*(?:\.0)?)$/i.test(value.trim()),
    );
  }
  if (!declared) {
    into.push(
      toolchainViolation(
        'javascript',
        '.nvmrc, .node-version, a node entry in .tool-versions, engines.node or volta.node',
        'Declare the Node.js version in .nvmrc (or engines.node in package.json), commit it, and run the check again.',
      ),
    );
  }
}

/** The requirement lines that are not pinned to one exact version, after joining `\` continuations. */
function unpinnedRequirements(text: string): readonly string[] {
  const joined = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  const unpinned: string[] = [];
  for (const raw of joined) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line === '') continue;
    if (
      /^(-r|-c|--requirement|--constraint|--index-url|--extra-index-url|--find-links|-i|-f|--)/.test(
        line,
      )
    ) {
      continue;
    }
    const exact =
      /(?:^|[^=!<>~])===?\s*[A-Za-z0-9_.+!-]+(?=\s|;|,|$)/.test(line) && !line.includes('*');
    // A direct URL is pinned only to a commit (40 hex) or a hash; a branch or no ref is not a pin.
    const url = /^[^\s@]+[ \t]*@[ \t]*\S+/.test(line) && /(@[0-9a-f]{40}\b|#sha256=)/.test(line);
    // `-e .` installs the project itself from its own checkout: not an external dependency to pin.
    const localEditable = /^-e[ \t]+(?:\.|\.{1,2}\/)[^:]*$/.test(line);
    if (!exact && !url && !localEditable) unpinned.push(line);
  }
  return unpinned;
}

/** A `pyproject.toml` only configures tools (`[tool.ruff]`) in many JavaScript and Rust repositories; it makes the
 * project a Python one only if it declares a project, a build system or a Python packaging tool. */
async function isPythonProject(tree: CommittedTree): Promise<boolean> {
  if (!tree.files.has('pyproject.toml')) return false;
  const read = await readCommitted(tree, 'pyproject.toml');
  // Unreadable: treated as Python, so the rule reports it rather than skipping a file it cannot read.
  return (
    !read.ok ||
    /^\[(project|build-system|tool\.(poetry|pdm|hatch|setuptools|flit|uv))\b/m.test(read.text)
  );
}

async function checkPython(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const hasLock = await anyHasContent(tree, PYTHON_LOCKFILES);
  const requirementFiles = [...tree.files.keys()]
    .filter((file) => REQUIREMENTS_FILE.test(file))
    .sort();
  if (!hasLock) {
    if (requirementFiles.length === 0) {
      const lock = await lockViolation(ctx, tree, 'python', PYTHON_LOCKFILES, 'lock file');
      if (lock !== undefined) into.push(lock);
    } else {
      const loose: string[] = [];
      for (const file of requirementFiles) {
        const read = await readCommitted(tree, file);
        if (!read.ok) {
          into.push(read.violation);
          continue;
        }
        for (const line of unpinnedRequirements(read.text)) loose.push(`${file}: ${line}`);
      }
      if (loose.length > 0) {
        into.push(
          violation(
            'python',
            `No lock file is committed and these requirements are not pinned to an exact version: ${loose.slice(0, 5).join('; ')}${loose.length > 5 ? `; and ${String(loose.length - 5)} more` : ''}.`,
            'Pin every requirement with == (or commit a uv.lock or poetry.lock), commit it, and run the check again.',
          ),
        );
      }
    }
  }

  let declared = await anyHasContent(tree, ['.python-version', 'runtime.txt']);
  for (const file of ['.tool-versions', 'pyproject.toml', 'Pipfile']) {
    if (declared || !tree.files.has(file)) continue;
    const read = await readCommitted(tree, file);
    if (!read.ok) {
      into.push(read.violation);
      continue;
    }
    if (file === '.tool-versions') declared = /^[ \t]*python[ \t]+\S+/m.test(read.text);
    else if (file === 'pyproject.toml') {
      declared =
        /^[ \t]*requires-python[ \t]*=/m.test(read.text) ||
        /^[ \t]*python[ \t]*=[ \t]*["']/m.test(read.text);
    } else declared = /^[ \t]*python_(full_)?version[ \t]*=/m.test(read.text);
  }
  if (!declared) {
    into.push(
      toolchainViolation(
        'python',
        '.python-version, a python entry in .tool-versions, requires-python in pyproject.toml, or python_version in a Pipfile',
        'Declare the Python version in .python-version (or requires-python in pyproject.toml), commit it, and run the check again.',
      ),
    );
  }
}

async function checkRust(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const lock = await lockViolation(ctx, tree, 'rust', ['Cargo.lock'], 'lockfile');
  if (lock !== undefined) into.push(lock);
  let declared = await anyHasContent(tree, ['rust-toolchain', 'rust-toolchain.toml']);
  if (!declared) {
    const read = await readCommitted(tree, 'Cargo.toml');
    if (!read.ok) into.push(read.violation);
    else declared = /^[ \t]*rust-version[ \t]*=/m.test(read.text);
  }
  if (!declared) {
    into.push(
      toolchainViolation(
        'rust',
        'rust-toolchain, rust-toolchain.toml or rust-version in Cargo.toml',
        'Add a rust-toolchain.toml (or rust-version in Cargo.toml), commit it, and run the check again.',
      ),
    );
  }
}

async function checkGo(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const read = await readCommitted(tree, 'go.mod');
  if (!read.ok) {
    into.push(read.violation);
    return;
  }
  if (!/^go[ \t]+\d/m.test(read.text)) {
    into.push(
      toolchainViolation(
        'go',
        'a go directive in go.mod',
        'Add a go directive to go.mod, commit it, and run the check again.',
      ),
    );
  }
  if (/^require\b/m.test(read.text)) {
    const lock = await lockViolation(ctx, tree, 'go', ['go.sum'], 'checksum file');
    if (lock !== undefined) into.push(lock);
  }
}

async function checkGradle(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const lock = await lockViolation(
    ctx,
    tree,
    'gradle',
    ['gradle.lockfile', 'gradle/verification-metadata.xml'],
    'dependency lock',
  );
  if (lock !== undefined) into.push(lock);
  if (!tree.files.has('gradle/wrapper/gradle-wrapper.properties')) {
    into.push(
      toolchainViolation(
        'gradle',
        'gradle/wrapper/gradle-wrapper.properties',
        'Generate and commit the Gradle wrapper (`gradle wrapper`), then run the check again.',
      ),
    );
  }
}

/** `sdk:` as a key under the top-level `environment:` block of a pubspec (`flutter:` alone is not an SDK constraint).
 * Read line by line: a lazy `[\s\S]*?` from every `environment:` was quadratic on a hostile file. */
function declaresSdkConstraint(text: string): boolean {
  let inEnvironment = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^environment:[ \t]*(?:#.*)?$/.test(line)) {
      inEnvironment = true;
      continue;
    }
    if (!inEnvironment) continue;
    if (/^\S/.test(line)) {
      inEnvironment = false;
      continue;
    }
    if (/^[ \t]+sdk:[ \t]*\S/.test(line)) return true;
  }
  return false;
}

async function checkDart(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const lock = await lockViolation(ctx, tree, 'dart', ['pubspec.lock'], 'lockfile');
  if (lock !== undefined) into.push(lock);
  let declared = await anyHasContent(tree, ['.fvmrc', '.fvm/fvm_config.json']);
  const read = await readCommitted(tree, 'pubspec.yaml');
  if (!read.ok) into.push(read.violation);
  else if (!declared) declared = declaresSdkConstraint(read.text);
  if (!declared) {
    into.push(
      toolchainViolation(
        'dart',
        '.fvmrc or an environment sdk constraint in pubspec.yaml',
        'Declare the SDK constraint under environment: in pubspec.yaml (or pin Flutter with .fvmrc), commit it, and run the check again.',
      ),
    );
  }
}

async function checkDotnet(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const lock = await lockViolation(ctx, tree, 'dotnet', ['packages.lock.json'], 'lockfile');
  if (lock !== undefined) into.push(lock);
  if (!(await hasContent(tree, 'global.json'))) {
    into.push(
      toolchainViolation(
        'dotnet',
        'global.json',
        'Pin the SDK in global.json, commit it, and run the check again.',
      ),
    );
  }
}

async function checkRuby(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const lock = await lockViolation(ctx, tree, 'ruby', ['Gemfile.lock'], 'lockfile');
  if (lock !== undefined) into.push(lock);
  let declared = await hasContent(tree, '.ruby-version');
  for (const file of ['.tool-versions', 'Gemfile']) {
    if (declared || !tree.files.has(file)) continue;
    const read = await readCommitted(tree, file);
    if (!read.ok) into.push(read.violation);
    else
      declared =
        file === 'Gemfile'
          ? /^[ \t]*ruby[ \t]+["']/m.test(read.text)
          : /^[ \t]*ruby[ \t]+\S+/m.test(read.text);
  }
  if (!declared) {
    into.push(
      toolchainViolation(
        'ruby',
        '.ruby-version, a ruby entry in .tool-versions, or a ruby directive in the Gemfile',
        'Declare the Ruby version in .ruby-version, commit it, and run the check again.',
      ),
    );
  }
}

async function checkPhp(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
): Promise<void> {
  const lock = await lockViolation(ctx, tree, 'php', ['composer.lock'], 'lockfile');
  if (lock !== undefined) into.push(lock);
  const read = await readCommitted(tree, 'composer.json');
  if (!read.ok) {
    into.push(read.violation);
    return;
  }
  const manifest = parseJsonObject(read.text);
  const declared =
    typeof manifest === 'object' &&
    (nonBlankString(record(manifest['require'])?.['php']) ||
      nonBlankString(record(record(manifest['config'])?.['platform'])?.['php']));
  if (typeof manifest === 'string') {
    into.push(
      violation(
        'composer.json',
        `composer.json could not be read: ${manifest}.`,
        'Repair composer.json so it parses, commit it, and run the check again.',
      ),
    );
  } else if (!declared) {
    into.push(
      toolchainViolation(
        'php',
        'require.php or config.platform.php in composer.json',
        'Declare the PHP version under require in composer.json, commit it, and run the check again.',
      ),
    );
  }
}

async function checkSingleLock(
  ctx: DoctorRuleContext,
  tree: CommittedTree,
  into: DoctorRuleViolation[],
  subject: string,
  lockNames: readonly string[],
): Promise<void> {
  const lock = await lockViolation(ctx, tree, subject, lockNames, 'lockfile');
  if (lock !== undefined) into.push(lock);
}

/** `10` §10.3 "no reproducible install". `11` F-INIT-3: "Reproducible from a clean clone on a clean machine
 * (lockfiles committed; versions pinned; toolchain version declared via `.tool-versions`/`.nvmrc`/
 * `rust-toolchain.toml`/`.python-version`)". Every ecosystem present must satisfy its own conventions. */
export async function reproducibleInstallViolations(
  ctx: DoctorRuleContext,
): Promise<readonly DoctorRuleViolation[]> {
  return withCommittedTree(ctx, async (tree) => {
    const into: DoctorRuleViolation[] = [];
    const has = (file: string): boolean => tree.files.has(file);
    let recognised = 0;

    if (has('package.json')) {
      recognised += 1;
      await checkJavascript(ctx, tree, into);
    }
    const requirementFiles = [...tree.files.keys()].filter((file) => REQUIREMENTS_FILE.test(file));
    if (
      ['Pipfile', 'setup.py', 'setup.cfg'].some(has) ||
      requirementFiles.length > 0 ||
      (await isPythonProject(tree))
    ) {
      recognised += 1;
      await checkPython(ctx, tree, into);
    }
    if (has('Cargo.toml')) {
      recognised += 1;
      await checkRust(ctx, tree, into);
    }
    if (has('go.mod')) {
      recognised += 1;
      await checkGo(ctx, tree, into);
    }
    if (has('build.gradle') || has('build.gradle.kts')) {
      recognised += 1;
      await checkGradle(ctx, tree, into);
    }
    if (has('pom.xml')) {
      recognised += 1;
      into.push(
        violation(
          'maven',
          'pom.xml is present, but Maven has no lockfile FORGE can verify, so a reproducible install cannot be shown.',
          'Move to a build with a committed lockfile, or pin every dependency and plugin version, commit the Maven wrapper, and record a Waiver for this check.',
        ),
      );
    }
    if (has('pubspec.yaml')) {
      recognised += 1;
      await checkDart(ctx, tree, into);
    }
    if ([...tree.files.keys()].some((file) => /^[^/]+\.(sln|csproj|fsproj|vbproj)$/.test(file))) {
      recognised += 1;
      await checkDotnet(ctx, tree, into);
    }
    if (has('Gemfile')) {
      recognised += 1;
      await checkRuby(ctx, tree, into);
    }
    if (has('composer.json')) {
      recognised += 1;
      await checkPhp(ctx, tree, into);
    }
    if (has('flake.nix')) {
      recognised += 1;
      await checkSingleLock(ctx, tree, into, 'nix', ['flake.lock']);
    }
    if (has('MODULE.bazel')) {
      recognised += 1;
      await checkSingleLock(ctx, tree, into, 'bazel', ['MODULE.bazel.lock']);
    }

    if (recognised === 0) {
      into.push(
        violation(
          'install',
          'No committed dependency manifest was recognised (package.json, pyproject.toml, requirements*.txt, Pipfile, Cargo.toml, go.mod, build.gradle, pom.xml, pubspec.yaml, a .NET project, Gemfile, composer.json, flake.nix, MODULE.bazel), so there is nothing to reproduce an install from.',
          'Commit the manifest and lockfile of the scaffold (see delivery/build.md) and run the check again.',
        ),
      );
    }
    return into;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// ci-skeleton
// ---------------------------------------------------------------------------------------------------------------

interface PipelineKind {
  readonly platform: string;
  readonly matches: (file: string) => boolean;
  /** `undefined` when the definition is acceptable, else what is wrong with it. */
  readonly validate: (text: string) => string | undefined;
}

function yamlDocument(text: string): { readonly value: unknown } | { readonly error: string } {
  try {
    return { value: YAML.parse(text) as unknown };
  } catch (cause) {
    return { error: `it is not valid YAML (${firstLine(cause)})` };
  }
}

function nonEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function nonEmptyMap(value: unknown): boolean {
  const map = record(value);
  return map !== undefined && Object.keys(map).length > 0;
}

/** Wraps a check on a YAML mapping, so each platform states only what it needs. */
function mappingCheck(check: (map: Record<string, unknown>) => string | undefined) {
  return (text: string): string | undefined => {
    const document = yamlDocument(text);
    if ('error' in document) return document.error;
    if (document.value === null || document.value === undefined) return 'it is empty';
    const map = record(document.value);
    return map === undefined ? 'it is not a YAML mapping' : check(map);
  };
}

const PIPELINES: readonly PipelineKind[] = [
  {
    platform: 'GitHub Actions',
    matches: (file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file),
    validate: mappingCheck((map) => {
      // YAML 1.1 readers turn an unquoted `on` key into `true`; accept either spelling.
      const trigger = Object.hasOwn(map, 'on') ? map['on'] : map['true'];
      const hasTrigger = nonBlankString(trigger) || nonEmptyList(trigger) || nonEmptyMap(trigger);
      if (!hasTrigger) return 'it has no "on" trigger';
      const jobs = record(map['jobs']);
      if (jobs === undefined || Object.keys(jobs).length === 0) return 'it defines no jobs';
      for (const [name, job] of Object.entries(jobs)) {
        const body = record(job);
        if (body === undefined) return `job "${name}" is not a mapping`;
        const steps = Array.isArray(body['steps']) ? (body['steps'] as unknown[]) : [];
        const doesSomething = steps.some((step) => {
          const parts = record(step);
          if (parts === undefined) return false;
          if (nonBlankString(parts['uses'])) return true;
          return nonBlankString(parts['run']) && !NO_OP_COMMAND.test(parts['run'].trim());
        });
        // A job needs somewhere to run unless it calls a reusable workflow.
        const hasRunner =
          nonBlankString(body['runs-on']) ||
          nonEmptyList(body['runs-on']) ||
          nonEmptyMap(body['runs-on']);
        if (!hasRunner && !nonBlankString(body['uses'])) return `job "${name}" has no runs-on`;
        if (!doesSomething && !nonBlankString(body['uses'])) {
          return `job "${name}" has no step that runs a command or uses an action, and calls no reusable workflow`;
        }
      }
      return undefined;
    }),
  },
  {
    platform: 'GitLab CI',
    matches: (file) => file === '.gitlab-ci.yml',
    validate: mappingCheck((map) => {
      const include = map['include'];
      if (nonBlankString(include) || nonEmptyList(include) || nonEmptyMap(include))
        return undefined;
      // A key starting with a dot is a hidden template, not a job that runs.
      const hasJob = Object.entries(map).some(([name, value]) => {
        if (name.startsWith('.')) return false;
        const job = record(value);
        return (
          job !== undefined &&
          (nonBlankString(job['script']) ||
            nonEmptyList(job['script']) ||
            Object.hasOwn(job, 'trigger') ||
            nonBlankString(job['extends']) ||
            nonEmptyList(job['extends']) ||
            Object.hasOwn(job, 'run'))
        );
      });
      return hasJob ? undefined : 'it defines no job with a script';
    }),
  },
  {
    platform: 'CircleCI',
    matches: (file) => file === '.circleci/config.yml',
    validate: mappingCheck((map) => {
      if (!Object.hasOwn(map, 'version')) return 'it has no version';
      return nonEmptyMap(map['jobs']) || nonEmptyMap(map['workflows'])
        ? undefined
        : 'it defines no jobs or workflows';
    }),
  },
  {
    platform: 'Azure Pipelines',
    matches: (file) => file === 'azure-pipelines.yml' || file === 'azure-pipelines.yaml',
    validate: mappingCheck((map) =>
      nonEmptyList(map['steps']) || nonEmptyList(map['stages']) || nonEmptyList(map['jobs'])
        ? undefined
        : 'it defines no steps, stages or jobs',
    ),
  },
  {
    platform: 'Bitbucket Pipelines',
    matches: (file) => file === 'bitbucket-pipelines.yml',
    validate: mappingCheck((map) =>
      nonEmptyMap(map['pipelines']) ? undefined : 'it defines no pipelines',
    ),
  },
  {
    platform: 'Buildkite',
    matches: (file) => file === '.buildkite/pipeline.yml' || file === '.buildkite/pipeline.yaml',
    validate: mappingCheck((map) =>
      nonEmptyList(map['steps']) ? undefined : 'it defines no steps',
    ),
  },
  {
    platform: 'Jenkins',
    matches: (file) => file === 'Jenkinsfile',
    validate: (text) => {
      // Comments removed first: `// node (` is not a block.
      const code = stripBlockComments(text).replace(/^[ \t]*\/\/.*$/gm, ' ');
      // The first block only, then one scan of what follows it: a scan from every `pipeline {` was quadratic on a
      // hostile file made of them.
      const after = (block: RegExp): string | undefined => {
        const match = block.exec(code);
        return match === null ? undefined : code.slice(match.index);
      };
      const declarativeBody = after(/\bpipeline\s*\{/);
      const scriptedBody = after(/\bnode\s*[({]/);
      const declarative =
        declarativeBody !== undefined && /\b(stage|steps)\b/.test(declarativeBody);
      const scripted =
        scriptedBody !== undefined && /\b(sh|bat|powershell|stage)\b/.test(scriptedBody);
      const sharedLibrary = /^[ \t]*@Library\b/m.test(code);
      return declarative || scripted || sharedLibrary
        ? undefined
        : 'it declares no pipeline { } with a stage or steps, and no node { } block that runs anything';
    },
  },
];

// Block comments removed with `indexOf`: a lazy `[\s\S]*?` from every opener was quadratic on a file of
// unterminated openers. An unterminated comment runs to the end, as in Groovy.
function stripBlockComments(text: string): string {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf('/*', at);
    if (open === -1) {
      parts.push(text.slice(at));
      break;
    }
    parts.push(text.slice(at, open), ' ');
    const close = text.indexOf('*/', open + 2);
    if (close === -1) break;
    at = close + 2;
  }
  return parts.join('');
}

const PIPELINE_LOOKED_FOR =
  '.github/workflows/*.yml, .gitlab-ci.yml, .circleci/config.yml, azure-pipelines.yml, bitbucket-pipelines.yml, .buildkite/pipeline.yml and Jenkinsfile';

/** `10` §10.3 "CI skeleton absent". `14` §14.3: "Pipeline definitions are in the repo, reviewed like code". A
 * pipeline definition is committed for a known platform and defines at least one job that has steps (or calls a
 * reusable workflow); every committed definition must be valid, so one good file does not excuse a broken one. */
export async function ciSkeletonViolations(
  ctx: DoctorRuleContext,
): Promise<readonly DoctorRuleViolation[]> {
  return withCommittedTree(ctx, async (tree) => {
    const violations: DoctorRuleViolation[] = [];
    let valid = 0;
    const files = [...tree.files.keys()].sort();
    for (const file of files) {
      const kind = PIPELINES.find((candidate) => candidate.matches(file));
      if (kind === undefined) continue;
      const read = await readCommitted(tree, file);
      if (!read.ok) {
        violations.push(read.violation);
        continue;
      }
      const problem = kind.validate(read.text);
      if (problem === undefined) {
        valid += 1;
        continue;
      }
      violations.push(
        violation(
          file,
          `${file} is not a valid ${kind.platform} pipeline: ${problem}.`,
          `Fix ${file} so it defines at least one job with steps, commit it, and run the check again.`,
        ),
      );
    }
    if (valid > 0 || violations.length > 0) return violations;

    const uncommitted = await presentButUncommitted(ctx, tree, [
      '.gitlab-ci.yml',
      '.circleci/config.yml',
      'azure-pipelines.yml',
      'bitbucket-pipelines.yml',
      '.buildkite/pipeline.yml',
      'Jenkinsfile',
      ...(await workingWorkflowFiles(ctx)),
    ]);
    const extra =
      uncommitted.length > 0
        ? ` Present in the working tree but not committed (so absent from a clean clone): ${uncommitted.join(', ')}.`
        : '';
    return [
      violation(
        'ci',
        `No CI pipeline definition is committed. Looked for ${PIPELINE_LOOKED_FOR}; scripts under ci/ are not a pipeline.${extra}`,
        'Add the pull-request pipeline the scaffold-ci step describes (for GitHub: .github/workflows/ci.yml with a job that runs the task runner), commit it, and run the check again.',
      ),
    ];
  });
}

async function workingWorkflowFiles(ctx: DoctorRuleContext): Promise<readonly string[]> {
  const directory = '.github/workflows';
  if (!(await pathExists(ctx.paths.resolveWithin(directory)))) return [];
  const entries = await listDirEntriesSorted(ctx.paths.resolveWithin(directory));
  return entries
    .filter((entry) => !entry.isDirectory && /\.ya?ml$/.test(entry.name))
    .map((entry) => `${directory}/${entry.name}`);
}
