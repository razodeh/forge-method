/**
 * `scanFixDiff` — what a `forge debug` FIX attempt may put in the diff FORGE will run and commit (`PLAN-M13.md`
 * P28, `SPEC-QUESTIONS.md` Q222; `20` §20.2 point 2 deny list and point 3 claim enforcement, `20` §20.4 pre-commit
 * secret scan, `20` §20.5 point 5 output scanning, `13` §13.2 step 7 "must not touch unrelated code").
 *
 * The FIX session writes files in a lane through the agent's write grant; nothing checked what it wrote before
 * PROVE ran the project's tests against it (which executes it) and `commitInLane` staged all of it. The claim
 * machinery of `06` §6.7 (`enforceClaim`, `resolveStepClaim`) holds a step to a *positive* list of globs, and a
 * defect gives no such list: `Defect.affected` names CAP/STORY ids, not paths, and the ISOLATE scope is model text.
 * So the FIX claim is stated the other way round and conservatively: **ordinary source and test files anywhere in the
 * project, except the protected set below**. The scan is a pure function of the diff, so the same scan runs on
 * every attempt (before PROVE) and again on the exact diff about to be committed.
 *
 * Protected: `.git/` internals, `.forge/` (config, overlays, state: `20` §20.5 point 5 forbids a lane changing
 * them), `.env*`, `node_modules/`, key and credential files, CI and hook configuration (`.github/`, `.husky/`,
 * `.gitlab-ci.yml`, `.circleci/`, `Jenkinsfile`, `.gitattributes`, `.gitmodules`: files that run with the project's
credentials on someone else's machine), files the project's own tooling executes when it runs the tests (`package.json`,
 * package-manager and test-runner configuration, `Makefile`, `.envrc`), and the project's document roots (`paths.kb|specs|sessions|reports`: the
 * process artifacts a fix is not what writes). Also refused: a symlink (its target is outside what this scan can
 * see), a submodule, an IGNORED file (`git add -A` never lists it, the tests would still run it), and an added line holding
 * a secret-shaped value (`SECRET_PATTERNS`, the shapes `20` §20.10 S3 names, and a few more).
 *
 * The input is git's own machine-readable listing (`FixChange`), never a rendered diff: a name git quotes (a `"`, a
 * non-ASCII byte) or an added line that starts `++ ` cannot hide from a parser that reads NUL-separated records.
 *
 * @see specs/13 §13.2
 * @see specs/20 §20.2
 */
import { SECRET_PATTERNS } from '@forge/extensions/skills';
import { escape as escapeGlob, minimatch } from 'minimatch';

import type { DocRoots } from '../dispatch/types.ts';

export type FixScanRule = 'protected-path' | 'symlink' | 'secret' | 'ignored-file' | 'submodule';

/** One file the lane changed against its base, as the caller read it from git's machine-readable listing (never from
 * parsing a rendered diff, whose headers quote unusual names). */
export interface FixChange {
  readonly path: string;
  /** The new file mode (`100644`, `100755`, `120000` a symlink, `160000` a submodule). */
  readonly mode: string;
  readonly deleted: boolean;
  readonly submodule: boolean;
  /** The lines the change adds (a binary read as text), joined by newlines, without the leading `+`. */
  readonly added: string;
}

export interface FixScanViolation {
  readonly rule: FixScanRule;
  /** The path (`protected-path`, `symlink`) or the file the secret-shaped value was added to (`secret`). The value
   * itself is never quoted. */
  readonly path: string;
  readonly detail: string;
}

/** The paths no agent step's claim may reach, whatever the claim says (`PLAN-M13.md` P36, `20` §20.2 point 2 deny list,
 * `20` §20.5 point 5): the repository's own internals, FORGE's config and state, and secrets files. A story's
 * `files_expected` or a workflow's `produces` names paths a model or a person wrote; none of them can make these
 * writable. Also the head of the protected set below, so the two never disagree. `.env.example`, `.env.sample` and
 * `.env.template` stay writable here (a scaffold step writes one); the protected set below refuses every `.env.*`. */
export const NEVER_WRITABLE_GLOBS: readonly string[] = [
  '.git',
  '**/.git',
  '.git/**',
  '**/.git/**',
  '.forge',
  '.forge/**',
  '**/.env',
  '**/.env.!(example|sample|template)',
];

const PROTECTED_GLOBS: readonly string[] = [
  ...NEVER_WRITABLE_GLOBS,
  '**/node_modules/**',
  '**/.env.*',
  '**/.aws/**',
  '**/.ssh/**',
  '**/.gnupg/**',
  '**/.npmrc',
  '**/.netrc',
  '**/.pypirc',
  '**/secrets.local.yaml',
  '**/id_rsa*',
  '**/id_dsa*',
  '**/id_ecdsa*',
  '**/id_ed25519*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.keystore',
  '**/.github/**',
  '**/.husky/**',
  '**/.circleci/**',
  '**/.gitlab-ci.yml',
  '**/Jenkinsfile',
  '**/.gitattributes',
  '**/.gitmodules',
  // Files the project's own tooling EXECUTES when it runs the tests (PROVE): a manifest's scripts, a package
  // manager's config and hooks, task runners, test-runner configuration.
  '**/package.json',
  '**/.yarnrc*',
  '**/.yarn/**',
  '**/.pnpmfile.cjs',
  '**/.envrc',
  '**/Makefile',
  '**/.cargo/**',
  '**/lefthook.yml',
  '**/.pre-commit-config.yaml',
  '**/vitest.config.*',
  '**/vitest.workspace.*',
  '**/jest.config.*',
  '**/.mocharc*',
  '**/vite.config.*',
  '**/conftest.py',
  '**/pyproject.toml',
  '**/tox.ini',
  '**/babel.config.*',
  '**/playwright.config.*',
  '**/build.rs',
  // Configuration that runs automatically when a person or an agent opens the branch in an editor or an agent tool.
  '**/.claude/**',
  '**/.mcp.json',
  '**/.vscode/**',
  '**/.devcontainer/**',
  '**/.cursor/**',
  '**/.travis.yml',
  '**/azure-pipelines.yml',
  '**/.buildkite/**',
];

/** Secret shapes beyond `SECRET_PATTERNS` (`@forge/extensions`, the five `20` §20.10 S3 names). */
const EXTRA_SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN (PGP|DSA|ENCRYPTED|OPENSSH)? ?(PRIVATE KEY|PRIVATE KEY BLOCK)/,
  /(?:sk|rk)_live_[0-9a-zA-Z]{20,}/,
  /npm_[A-Za-z0-9]{36}/,
];

/** The globs that make up the protected set for a project (the fixed ones plus its four document roots). */
export function protectedFixGlobs(roots: DocRoots): readonly string[] {
  const rootGlobs = [roots.kb, roots.specs, roots.sessions, roots.reports]
    .map((root) => root.replace(/^\.\//, '').replace(/\/+$/, ''))
    // A configured root that opens with `!` or `#` is a literal path, never a negation or a comment (`outputClaimGlobs` escapes it too).
    // A root with glob characters (`docs/[kb]`, `a{b}`) is a literal path: escaped as `outputClaimGlobs` escapes it.
    .map((root) => escapeGlob(root, { magicalBraces: true }).replace(/^[!#]/, '\\$&'))
    .filter((root) => root !== '' && !root.startsWith('..'))
    .flatMap((root) => [root, `${root}/**`]);
  return [...PROTECTED_GLOBS, ...rootGlobs];
}

/**
 * Every rule `input` breaks; empty when the change is inside the FIX claim. `changes` is git's own listing of what
 * the lane changed; `ignored` lists ignored files present in the lane (a file `git add -A` never lists, which the
 * project's tests would still execute: any is refused). Pure.
 */
export function scanFixDiff(input: {
  readonly changes: readonly FixChange[];
  readonly ignored?: readonly string[];
  readonly docRoots: DocRoots;
}): readonly FixScanViolation[] {
  const violations: FixScanViolation[] = [];
  const globs = protectedFixGlobs(input.docRoots);
  const patterns = [...SECRET_PATTERNS, ...EXTRA_SECRET_PATTERNS];
  for (const change of input.changes) {
    const normalised = change.path.replace(/^\.\//, '');
    if (normalised.split('/').includes('..') || normalised.startsWith('/')) {
      violations.push({
        rule: 'protected-path',
        path: change.path,
        detail: 'a path outside the project',
      });
      continue;
    }
    const hit = globs.find((glob) => minimatch(normalised, glob, { dot: true, nocase: true }));
    if (hit !== undefined) {
      violations.push({
        rule: 'protected-path',
        path: change.path,
        detail: `it matches the protected pattern ${hit}`,
      });
    }
    if (change.mode === '120000') {
      violations.push({
        rule: 'symlink',
        path: change.path,
        detail: 'the change adds or changes a symlink',
      });
    }
    if (change.submodule) {
      violations.push({
        rule: 'submodule',
        path: change.path,
        detail: 'the change adds or moves a submodule',
      });
    }
    if (patterns.some((pattern) => new RegExp(pattern.source, pattern.flags).test(change.added))) {
      violations.push({
        rule: 'secret',
        path: change.path,
        detail:
          'an added line holds a secret-shaped value (an access key, a token or a private key block)',
      });
    }
  }
  for (const file of input.ignored ?? []) {
    violations.push({
      rule: 'ignored-file',
      path: file,
      detail:
        'an ignored file (not part of the diff, so never scanned) that the tests would still execute',
    });
  }
  return violations;
}
