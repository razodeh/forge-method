/**
 * `runSurvey` — `17` §17.2 phase 1 (SURVEY): "No LLM. Pure tooling, producing a factual profile."
 * Every signal in `17` §17.2's own table is produced here from real file contents found by
 * `walkRepository`, plus the git-profile fact this piece adds (see `git-profile.ts` doc comment in
 * `@forge/vcs` for why that one signal lives outside this package). Output is written verbatim by
 * `writeSurveyReport` to `reports/adoption/survey.json`, the spec's own literal path.
 *
 * **Deliberately does not throw for a malformed or unreadable individual file.** `17` §17.1's own
 * framing — a target repo is "possibly large, possibly undocumented, possibly wrong about itself" —
 * means a broken `package.json`, a binary file with a text-like extension, or a permission-denied
 * config file is an expected condition, not a bug in this tool; each such file is simply excluded
 * from the signal it would have contributed to, never a reason to abort the whole survey. The one
 * thing this module does throw for is `rootDir` itself not existing, via `ProjectPaths`'s own
 * existing `CFG-003` — reused rather than a new error code, since a project root that does not exist
 * is exactly the condition `ProjectPaths`'s constructor already guards structurally.
 *
 * @see specs/17 §17.2
 * @see SPEC-QUESTIONS.md Q152
 * @see PLAN-M10.md P15
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import * as YAML from 'yaml';

import { DEFAULT_IGNORED_DIR_NAMES, walkRepository, type WalkedFile } from './walk.ts';

/** The five toolchains `17` §17.2's own signal table names under "Build/toolchain", keyed by the
 * manifest basename that identifies each. */
const MANIFEST_TOOLCHAINS: Readonly<Record<string, Toolchain>> = {
  'package.json': 'node',
  'pom.xml': 'maven',
  'pyproject.toml': 'python',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
};

export type Toolchain = 'node' | 'maven' | 'python' | 'go' | 'rust';

export interface ManifestSignal {
  readonly toolchain: Toolchain;
  readonly path: string;
}

/** Extension → display language, for the size/language profile. Deliberately not exhaustive: an
 * unrecognised extension still counts toward `totalFiles`, just not toward `byLanguage`'s line
 * counts — see this file's own module doc comment on why an untyped file is excluded rather than
 * guessed at. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  rb: 'Ruby',
  php: 'PHP',
  cs: 'C#',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  swift: 'Swift',
  scala: 'Scala',
  sh: 'Shell',
};

export interface LanguageStat {
  readonly language: string;
  readonly files: number;
  readonly lines: number;
}

export interface SizeProfile {
  readonly totalFiles: number;
  /** Sum of `byLanguage[].lines` only — a file whose extension is not in `LANGUAGE_BY_EXTENSION` is
   * counted in `totalFiles` but contributes no line count, so this is not a full repo line count. */
  readonly totalLines: number;
  readonly byLanguage: readonly LanguageStat[];
}

export interface EntryPointSignal {
  readonly kind:
    'package-main' | 'package-bin' | 'package-script' | 'dockerfile-cmd' | 'serverless-function';
  readonly path: string;
  readonly value: string;
}

export interface DeployableUnitSignal {
  readonly kind: 'dockerfile' | 'compose-service' | 'k8s-manifest' | 'ci-deploy-job';
  readonly path: string;
  readonly name: string;
}

export interface DatastoreSignal {
  readonly kind: 'connection-string' | 'orm-config' | 'migrations-dir';
  readonly path: string;
  readonly evidence: string;
}

export interface TestSetupSignal {
  readonly testDirs: readonly string[];
  readonly frameworks: readonly string[];
  readonly ciTestCommands: readonly string[];
}

export interface CiSignal {
  readonly system:
    'github-actions' | 'gitlab-ci' | 'circleci' | 'jenkins' | 'travis' | 'azure-pipelines';
  readonly path: string;
  readonly jobs: readonly string[];
}

export interface DocSignal {
  readonly kind: 'readme' | 'docs-dir' | 'adr' | 'changelog';
  readonly path: string;
}

export interface HealthSignals {
  readonly todoFixmeCount: number;
  readonly lintConfigPresent: boolean;
  readonly typeCheckConfigPresent: boolean;
}

/** The git-profile facts SURVEY needs, supplied as plain data rather than imported: see this file's
 * own module doc comment and `SPEC-QUESTIONS.md` Q152. Structurally identical to `@forge/vcs`'s own
 * `GitProfile` — a caller that already has one (from `analyzeGitProfile`) can pass it directly with
 * no adapter, by TypeScript's structural typing alone. */
export interface GitProfileFacts {
  readonly hasCommits: boolean;
  readonly ageDays: number | undefined;
  readonly commitCount: number;
  readonly contributorCount: number;
  readonly churnHotspots: readonly { readonly path: string; readonly commitCount: number }[];
  readonly filesChangedTogether: readonly {
    readonly paths: readonly [string, string];
    readonly count: number;
  }[];
}

export interface Survey {
  readonly size: SizeProfile;
  readonly manifests: readonly ManifestSignal[];
  readonly entryPoints: readonly EntryPointSignal[];
  readonly deployableUnits: readonly DeployableUnitSignal[];
  readonly datastores: readonly DatastoreSignal[];
  readonly testSetup: TestSetupSignal;
  readonly ci: readonly CiSignal[];
  readonly gitProfile: GitProfileFacts;
  readonly existingDocs: readonly DocSignal[];
  readonly health: HealthSignals;
}

export interface SizeThresholds {
  readonly maxFiles: number;
  readonly maxLines: number;
}

/** `17` §17.2 phase 1's own gate: "if the repo exceeds size thresholds... propose a scoped adoption
 * rather than attempting the whole thing." No spec-given numbers exist for either threshold — recorded
 * as a proceeding-per-spec-silence default in `SPEC-QUESTIONS.md` Q152, alongside the layering
 * question this file's own doc comment already cites that entry for. */
export const DEFAULT_SIZE_THRESHOLDS: SizeThresholds = {
  maxFiles: 5000,
  maxLines: 500_000,
};

export interface ScopedAdoptionProposal {
  readonly reason: string;
  /** Directories to adopt first, most promising first: manifest-rooted subprojects when any exist
   * (a monorepo's own natural scope boundary), else the largest top-level directories by file count. */
  readonly suggestedScopes: readonly string[];
}

export interface SizeGateResult {
  readonly triggered: boolean;
  readonly proposal: ScopedAdoptionProposal | undefined;
}

export interface SurveyResult {
  readonly survey: Survey;
  readonly gate: SizeGateResult;
}

export interface RunSurveyInput {
  readonly rootDir: string;
  readonly gitProfile: GitProfileFacts;
  readonly sizeThresholds?: Partial<SizeThresholds>;
  readonly ignoredDirNames?: ReadonlySet<string>;
  /** A walk already computed for `rootDir` (by a caller that also runs `runInventory` against the
   * same root) — supplying it skips this function's own call to `walkRepository`, so a single
   * adoption run over a large target repo (`17` §17.1) walks the filesystem once, not once per
   * phase, matching `walk.ts`'s own "the single filesystem walk every… extractor runs against" claim
   * for real rather than only for extractors within one phase. Left undefined, `runSurvey` walks
   * `rootDir` itself, exactly as it always has — this is purely an opt-in reuse path. */
  readonly files?: readonly WalkedFile[];
}

/** Files small enough, and named plausibly enough, to be worth reading for a text signal (datastore
 * connection strings, unresolved-work marker density — see `computeHealthSignals`). Bounded on both
 * axes: an arbitrary target repo can contain
 * enormous generated or vendored text files this tool has no business reading in full, and a binary
 * file with a misleading extension should not be decoded as UTF-8 and scanned for garbage matches. */
const MAX_SCANNED_FILE_BYTES = 200_000;
const TEXT_SCAN_EXTENSIONS = new Set([
  'json',
  'yml',
  'yaml',
  'js',
  'ts',
  'py',
  'ini',
  'toml',
  'cfg',
  'properties',
  'env',
  'md',
  'txt',
  'rb',
  'go',
  'rs',
  'java',
]);

async function readIfSmallText(absPath: string): Promise<string | undefined> {
  try {
    const stats = await stat(absPath);
    if (!stats.isFile() || stats.size > MAX_SCANNED_FILE_BYTES) return undefined;
    return await readFile(absPath, 'utf8');
  } catch {
    return undefined;
  }
}

/** Reads capture group `index` from `match`, safe wherever the group is mandatory (no `?`) in the
 * pattern that produced the match, which is true of every call site below. `as string`, not `!`: `!`
 * is banned (`no-non-null-assertion`) elsewhere in this codebase's own `src/**`, with an explicit,
 * commented `as` cast used instead at the identical "the type checker cannot see this is safe" shape
 * — `packages/adapter-kit/src/control-tokens/strip.ts`'s own precedent. Never a bare `throw new
 * Error` either (`QUALITY-BAR.md` R2): "this tool's own regex disagrees with itself" is a bug in this
 * file, not a fact about the target repository, and has no `ForgeError` code of its own to claim. See
 * the identical helper's fuller doc comment in `inventory.ts`, which this mirrors rather than shares:
 * the two files have no legal way to import from each other's non-exported internals, and a two-line
 * pure function is not worth promoting to a shared module for that alone. */
function requiredGroup(match: RegExpMatchArray | RegExpExecArray, index: number): string {
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- `!` is banned; see doc comment above.
  return match[index] as string;
}

/** Plain code-unit-order comparison, never `localeCompare` (`QUALITY-BAR.md` R10): collation order
 * varies by the host's locale, which would make a fact report non-reproducible across machines. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function extensionOf(relPath: string): string {
  const base = path.posix.basename(relPath);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** Whether `relPath` names a dotenv file (`.env`, `.env.local`, `.env.production`, …) — real config
 * files this tool must scan for connection strings, but which `extensionOf` alone cannot recognise:
 * `.env` itself has its dot at position 0, so `extensionOf('.env')` is `''` (no extension), not
 * `'env'` — confirmed directly rather than assumed, since it is the single most common real-world
 * secrets/config filename this tool is meant to cover (`17` §17.2's own "connection strings in
 * config templates" row) and a silent miss here would be exactly the kind of confident-looking but
 * incomplete scan `17` §17.1 warns against. */
function isDotEnvFile(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  return base === '.env' || base.startsWith('.env.');
}

function buildSizeProfile(
  files: readonly WalkedFile[],
  lineCountByPath: ReadonlyMap<string, number>,
): SizeProfile {
  const byLanguage = new Map<string, { files: number; lines: number }>();
  for (const file of files) {
    const ext = extensionOf(file.relPath);
    const language = LANGUAGE_BY_EXTENSION[ext];
    if (language === undefined) continue;
    const existing = byLanguage.get(language) ?? { files: 0, lines: 0 };
    existing.files += 1;
    existing.lines += lineCountByPath.get(file.relPath) ?? 0;
    byLanguage.set(language, existing);
  }
  const languageStats = [...byLanguage.entries()]
    .map(([language, stats]) => ({ language, files: stats.files, lines: stats.lines }))
    .sort((a, b) => b.lines - a.lines || compareStrings(a.language, b.language));
  return {
    totalFiles: files.length,
    totalLines: languageStats.reduce((sum, entry) => sum + entry.lines, 0),
    byLanguage: languageStats,
  };
}

function findManifests(files: readonly WalkedFile[]): readonly ManifestSignal[] {
  const manifests: ManifestSignal[] = [];
  for (const file of files) {
    const base = path.posix.basename(file.relPath);
    const toolchain = MANIFEST_TOOLCHAINS[base];
    if (toolchain !== undefined) manifests.push({ toolchain, path: file.relPath });
  }
  return manifests.sort((a, b) => compareStrings(a.path, b.path));
}

async function findEntryPoints(files: readonly WalkedFile[]): Promise<readonly EntryPointSignal[]> {
  const signals: EntryPointSignal[] = [];
  for (const file of files) {
    const base = path.posix.basename(file.relPath);
    if (base === 'package.json') {
      const text = await readIfSmallText(file.absPath);
      if (text === undefined) continue;
      try {
        const pkg = JSON.parse(text) as Record<string, unknown>;
        if (typeof pkg['main'] === 'string') {
          signals.push({ kind: 'package-main', path: file.relPath, value: pkg['main'] });
        }
        if (typeof pkg['bin'] === 'string') {
          signals.push({ kind: 'package-bin', path: file.relPath, value: pkg['bin'] });
        } else if (pkg['bin'] !== null && typeof pkg['bin'] === 'object') {
          for (const [name, value] of Object.entries(pkg['bin'] as Record<string, unknown>)) {
            if (typeof value === 'string') {
              signals.push({ kind: 'package-bin', path: file.relPath, value: `${name}: ${value}` });
            }
          }
        }
        const scripts = pkg['scripts'];
        if (scripts !== null && typeof scripts === 'object') {
          const start = (scripts as Record<string, unknown>)['start'];
          if (typeof start === 'string') {
            signals.push({ kind: 'package-script', path: file.relPath, value: start });
          }
        }
      } catch {
        // Malformed package.json: no entry-point fact contributed. See module doc comment.
      }
    } else if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) {
      const text = await readIfSmallText(file.absPath);
      if (text === undefined) continue;
      for (const line of text.split('\n')) {
        const match = /^\s*(CMD|ENTRYPOINT)\s+(.+)$/.exec(line);
        if (match) {
          signals.push({
            kind: 'dockerfile-cmd',
            path: file.relPath,
            value: requiredGroup(match, 2).trim(),
          });
        }
      }
    } else if (base === 'serverless.yml' || base === 'serverless.yaml') {
      const text = await readIfSmallText(file.absPath);
      if (text === undefined) continue;
      try {
        const doc = YAML.parse(text) as Record<string, unknown> | null;
        const functions = doc?.['functions'];
        if (functions !== null && typeof functions === 'object') {
          for (const name of Object.keys(functions)) {
            signals.push({ kind: 'serverless-function', path: file.relPath, value: name });
          }
        }
      } catch {
        // Malformed serverless.yml: no entry-point fact contributed.
      }
    }
  }
  return signals;
}

const K8S_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Service']);

async function findDeployableUnits(
  files: readonly WalkedFile[],
): Promise<readonly DeployableUnitSignal[]> {
  const signals: DeployableUnitSignal[] = [];
  for (const file of files) {
    const base = path.posix.basename(file.relPath);
    if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) {
      signals.push({ kind: 'dockerfile', path: file.relPath, name: base });
      continue;
    }
    if (
      base === 'docker-compose.yml' ||
      base === 'docker-compose.yaml' ||
      base === 'compose.yaml'
    ) {
      const text = await readIfSmallText(file.absPath);
      if (text === undefined) continue;
      try {
        const doc = YAML.parse(text) as Record<string, unknown> | null;
        const services = doc?.['services'];
        if (services !== null && typeof services === 'object') {
          for (const name of Object.keys(services)) {
            signals.push({ kind: 'compose-service', path: file.relPath, name });
          }
        }
      } catch {
        // Malformed compose file: no deployable-unit fact contributed.
      }
      continue;
    }
    if (extensionOf(file.relPath) === 'yml' || extensionOf(file.relPath) === 'yaml') {
      const text = await readIfSmallText(file.absPath);
      if (text === undefined) continue;
      try {
        for (const doc of YAML.parseAllDocuments(text)) {
          const value = doc.toJS() as Record<string, unknown> | null;
          const kind = value?.['kind'];
          if (typeof kind === 'string' && K8S_KINDS.has(kind)) {
            const name = (value?.['metadata'] as Record<string, unknown> | undefined)?.['name'];
            signals.push({
              kind: 'k8s-manifest',
              path: file.relPath,
              name: typeof name === 'string' ? name : kind,
            });
          }
        }
      } catch {
        // Not a k8s manifest, or malformed YAML: no fact contributed.
      }
    }
  }
  return signals;
}

const CONNECTION_STRING_PATTERN =
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"]+/gi;

async function findDatastores(files: readonly WalkedFile[]): Promise<readonly DatastoreSignal[]> {
  const signals: DatastoreSignal[] = [];
  const migrationDirsSeen = new Set<string>();
  for (const file of files) {
    const segments = file.relPath.split('/');
    segments.slice(0, -1).forEach((rawSegment, i) => {
      const segment = rawSegment.toLowerCase();
      if (segment === 'migrations' || segment === 'migrate') {
        const dirPath = segments.slice(0, i + 1).join('/');
        if (!migrationDirsSeen.has(dirPath)) {
          migrationDirsSeen.add(dirPath);
          signals.push({ kind: 'migrations-dir', path: dirPath, evidence: dirPath });
        }
      }
    });
    const base = path.posix.basename(file.relPath);
    if (
      base === 'schema.prisma' ||
      base === 'knexfile.js' ||
      base === 'knexfile.ts' ||
      base === 'alembic.ini'
    ) {
      signals.push({ kind: 'orm-config', path: file.relPath, evidence: base });
    }
    if (TEXT_SCAN_EXTENSIONS.has(extensionOf(file.relPath)) || isDotEnvFile(file.relPath)) {
      const text = await readIfSmallText(file.absPath);
      if (text === undefined) continue;
      const matches = text.match(CONNECTION_STRING_PATTERN);
      if (matches) {
        for (const match of new Set(matches)) {
          signals.push({ kind: 'connection-string', path: file.relPath, evidence: match });
        }
      }
    }
  }
  return signals;
}

const TEST_DIR_NAMES = new Set(['test', 'tests', '__tests__', 'spec']);

function findTestDirs(files: readonly WalkedFile[]): readonly string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const segments = file.relPath.split('/');
    segments.slice(0, -1).forEach((segment, i) => {
      if (TEST_DIR_NAMES.has(segment.toLowerCase())) {
        dirs.add(segments.slice(0, i + 1).join('/'));
      }
    });
  }
  return [...dirs].sort();
}

function findTestFrameworks(files: readonly WalkedFile[]): readonly string[] {
  const frameworks = new Set<string>();
  for (const file of files) {
    const base = path.posix.basename(file.relPath);
    if (/^vitest\.config\.(ts|js|mjs|cjs)$/.exec(base)) frameworks.add('vitest');
    if (/^jest\.config\.(ts|js|mjs|cjs|json)$/.exec(base)) frameworks.add('jest');
    if (base === 'pytest.ini' || base === 'setup.cfg') frameworks.add('pytest');
    if (base.endsWith('_test.go')) frameworks.add('go-test');
    if (base === '.rspec') frameworks.add('rspec');
  }
  return [...frameworks].sort();
}

interface CiFileSpec {
  readonly system: CiSignal['system'];
  readonly matches: (relPath: string) => boolean;
}

const CI_FILE_SPECS: readonly CiFileSpec[] = [
  { system: 'github-actions', matches: (p) => p.startsWith('.github/workflows/') },
  { system: 'gitlab-ci', matches: (p) => p === '.gitlab-ci.yml' },
  { system: 'circleci', matches: (p) => p === '.circleci/config.yml' },
  { system: 'jenkins', matches: (p) => path.posix.basename(p) === 'Jenkinsfile' },
  { system: 'travis', matches: (p) => p === '.travis.yml' },
  { system: 'azure-pipelines', matches: (p) => p === 'azure-pipelines.yml' },
];

async function findCiSignals(
  files: readonly WalkedFile[],
): Promise<{ ci: readonly CiSignal[]; testCommands: readonly string[] }> {
  const ci: CiSignal[] = [];
  const testCommands = new Set<string>();
  for (const file of files) {
    const spec = CI_FILE_SPECS.find((candidate) => candidate.matches(file.relPath));
    if (spec === undefined) continue;
    const jobs: string[] = [];
    if (
      spec.system === 'github-actions' ||
      spec.system === 'gitlab-ci' ||
      spec.system === 'azure-pipelines' ||
      spec.system === 'circleci' ||
      spec.system === 'travis'
    ) {
      const text = await readIfSmallText(file.absPath);
      if (text !== undefined) {
        try {
          const doc = YAML.parse(text) as Record<string, unknown> | null;
          const jobsObj = doc?.['jobs'];
          if (jobsObj !== null && typeof jobsObj === 'object') {
            jobs.push(...Object.keys(jobsObj));
          }
          for (const runLine of text.matchAll(/run:\s*(.+)/g)) {
            const command = requiredGroup(runLine, 1).trim();
            if (/\btest\b/i.test(command)) testCommands.add(command);
          }
        } catch {
          // Malformed CI YAML: no job list, but the file's own presence is still a real CI signal.
        }
      }
    }
    ci.push({ system: spec.system, path: file.relPath, jobs: jobs.sort() });
  }
  return { ci, testCommands: [...testCommands].sort() };
}

function findDocs(files: readonly WalkedFile[]): readonly DocSignal[] {
  const docs: DocSignal[] = [];
  const docsDirsSeen = new Set<string>();
  for (const file of files) {
    const base = path.posix.basename(file.relPath);
    if (/^readme(\.\w+)?$/i.test(base)) docs.push({ kind: 'readme', path: file.relPath });
    if (/^changelog(\.\w+)?$/i.test(base)) docs.push({ kind: 'changelog', path: file.relPath });
    const segments = file.relPath.split('/');
    segments.slice(0, -1).forEach((rawSegment, i) => {
      const segment = rawSegment.toLowerCase();
      if (segment === 'docs') {
        const dirPath = segments.slice(0, i + 1).join('/');
        if (!docsDirsSeen.has(dirPath)) {
          docsDirsSeen.add(dirPath);
          docs.push({ kind: 'docs-dir', path: dirPath });
        }
      }
      if (segment === 'adr' || segment === 'decisions') {
        const dirPath = segments.slice(0, i + 1).join('/');
        if (!docsDirsSeen.has(dirPath)) {
          docsDirsSeen.add(dirPath);
          docs.push({ kind: 'adr', path: dirPath });
        }
      }
    });
  }
  return docs;
}

const LINT_CONFIG_BASENAMES = new Set([
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.flake8',
  'ruff.toml',
  '.rubocop.yml',
]);

async function computeHealthSignals(
  files: readonly WalkedFile[],
  lineCountByPath: ReadonlyMap<string, number>,
): Promise<HealthSignals> {
  let todoFixmeCount = 0;
  let lintConfigPresent = false;
  let typeCheckConfigPresent = false;

  for (const file of files) {
    const base = path.posix.basename(file.relPath);
    if (LINT_CONFIG_BASENAMES.has(base)) lintConfigPresent = true;
    if (base === 'tsconfig.json' || base === 'mypy.ini') typeCheckConfigPresent = true;

    if (lineCountByPath.has(file.relPath)) {
      const text = await readIfSmallText(file.absPath);
      if (text !== undefined) {
        const matches = text.match(/\b(TODO|FIXME)\b/g);
        if (matches) todoFixmeCount += matches.length;
      }
    }
  }

  return { todoFixmeCount, lintConfigPresent, typeCheckConfigPresent };
}

async function countLines(files: readonly WalkedFile[]): Promise<Map<string, number>> {
  const lineCounts = new Map<string, number>();
  for (const file of files) {
    if (!(extensionOf(file.relPath) in LANGUAGE_BY_EXTENSION)) continue;
    const text = await readIfSmallText(file.absPath);
    if (text === undefined) continue;
    const lineCount = text === '' ? 0 : text.split('\n').length;
    lineCounts.set(file.relPath, lineCount);
  }
  return lineCounts;
}

function buildSizeGate(
  size: SizeProfile,
  manifests: readonly ManifestSignal[],
  files: readonly WalkedFile[],
  thresholds: SizeThresholds,
): SizeGateResult {
  const triggered = size.totalFiles > thresholds.maxFiles || size.totalLines > thresholds.maxLines;
  if (!triggered) return { triggered: false, proposal: undefined };

  const manifestDirs = [
    ...new Set(manifests.map((m) => path.posix.dirname(m.path)).filter((d) => d !== '.')),
  ].sort();

  let suggestedScopes: readonly string[];
  if (manifestDirs.length > 0) {
    suggestedScopes = manifestDirs;
  } else {
    const topLevelCounts = new Map<string, number>();
    for (const file of files) {
      // `split('/')` on a non-empty string always yields at least one element, so the fallback
      // (`file.relPath` itself, for a file with no `/` at all) is never actually reached — it exists
      // only to satisfy `noUncheckedIndexedAccess`, not because index 0 can really be absent here.
      const top = file.relPath.split('/')[0] ?? file.relPath;
      topLevelCounts.set(top, (topLevelCounts.get(top) ?? 0) + 1);
    }
    suggestedScopes = [...topLevelCounts.entries()]
      .sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]))
      .slice(0, 5)
      .map(([dir]) => dir);
  }

  return {
    triggered: true,
    proposal: {
      reason:
        `The repository has ${String(size.totalFiles)} files and ${String(size.totalLines)} lines of ` +
        `recognised source, exceeding the configured threshold of ${String(thresholds.maxFiles)} files / ` +
        `${String(thresholds.maxLines)} lines. Per 17 §17.2, adopting the whole repository at once is not ` +
        'attempted; a scoped adoption of one module or service is proposed instead.',
      suggestedScopes,
    },
  };
}

/** Runs `17` §17.2 phase 1 against `input.rootDir`, producing facts only — see this file's own
 * module doc comment for what "facts only" rules out. */
export async function runSurvey(input: RunSurveyInput): Promise<SurveyResult> {
  const thresholds: SizeThresholds = { ...DEFAULT_SIZE_THRESHOLDS, ...input.sizeThresholds };
  const files = input.files ?? (await walkRepository(input.rootDir, input.ignoredDirNames));

  const lineCountByPath = await countLines(files);
  const size = buildSizeProfile(files, lineCountByPath);
  const manifests = findManifests(files);
  const entryPoints = await findEntryPoints(files);
  const deployableUnitsFromFiles = await findDeployableUnits(files);
  const datastores = await findDatastores(files);
  const testDirs = findTestDirs(files);
  const frameworks = findTestFrameworks(files);
  const { ci, testCommands } = await findCiSignals(files);
  const existingDocs = findDocs(files);
  const health = await computeHealthSignals(files, lineCountByPath);

  const ciDeployUnits: DeployableUnitSignal[] = ci
    .filter((signal) => signal.jobs.some((job) => /deploy/i.test(job)))
    .flatMap((signal) =>
      signal.jobs
        .filter((job) => /deploy/i.test(job))
        .map((job) => ({ kind: 'ci-deploy-job' as const, path: signal.path, name: job })),
    );

  const survey: Survey = {
    size,
    manifests,
    entryPoints,
    deployableUnits: [...deployableUnitsFromFiles, ...ciDeployUnits],
    datastores,
    testSetup: { testDirs, frameworks, ciTestCommands: testCommands },
    ci,
    gitProfile: input.gitProfile,
    existingDocs,
    health,
  };

  const gate = buildSizeGate(size, manifests, files, thresholds);

  return { survey, gate };
}

export { DEFAULT_IGNORED_DIR_NAMES };
