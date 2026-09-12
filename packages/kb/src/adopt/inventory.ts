/**
 * `runInventory` — `17` §17.2 phase 2 (INVENTORY): "Structural extraction, still without an LLM."
 *
 * **Scope note, recorded rather than silently implied by the code:** the module/dependency-graph
 * extractor is real and load-bearing for JavaScript/TypeScript source (`import`/`require`), the one
 * ecosystem this piece implements fully — `17` §17.2's own text names a different tool per language
 * (`madge`/`dependency-cruiser`, `import-linter`, `go list`, `jdeps`, `cargo tree`) precisely because
 * "language-appropriate" analysis is not one algorithm; building all five is out of this piece's
 * ~400-line budget (`PLAN-M10.md` P15). A target repo in another language still gets every other
 * INVENTORY signal (public API surface heuristics, external dependencies from its own manifest, config
 * surface), just an empty `dependencyGraph`. Recorded in `SPEC-QUESTIONS.md` Q152 alongside this
 * piece's other scope decisions, not left to be discovered by a future reader comparing this file
 * against the spec's five-tool list.
 *
 * @see specs/17 §17.2
 * @see SPEC-QUESTIONS.md Q152
 * @see PLAN-M10.md P15
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Survey } from './survey.ts';
import type { WalkedFile } from './walk.ts';
import { walkRepository } from './walk.ts';

export interface DependencyGraphNode {
  /** POSIX-relative module path, extension stripped, matching every other node's own key shape —
   * so an edge target always names a node that exists in `nodes` when resolution succeeds. */
  readonly module: string;
  readonly imports: readonly string[];
}

export interface DependencyGraph {
  readonly nodes: readonly DependencyGraphNode[];
  /** Each cycle is a sequence of module names where the last imports the first, found via DFS. A
   * module can appear in more than one reported cycle if it participates in more than one. */
  readonly cycles: readonly (readonly string[])[];
}

export type PublicApiSurfaceKind =
  'http-route' | 'cli-command' | 'exported-symbol' | 'queue-consumer' | 'scheduled-job' | 'webhook';

export interface PublicApiSurfaceSignal {
  readonly kind: PublicApiSurfaceKind;
  readonly name: string;
  readonly path: string;
  readonly evidence: string;
}

export type DataSurfaceKind = 'migration' | 'orm-entity';

export interface DataSurfaceSignal {
  readonly kind: DataSurfaceKind;
  readonly path: string;
  readonly name: string | undefined;
}

export type ConfigSurfaceKind = 'env-var' | 'secret-reference';

export interface ConfigSurfaceSignal {
  readonly kind: ConfigSurfaceKind;
  readonly name: string;
  readonly path: string;
  readonly line: number;
}

export interface ExternalDependency {
  readonly name: string;
  readonly version: string | undefined;
  readonly ecosystem: 'npm';
}

export interface Inventory {
  readonly dependencyGraph: DependencyGraph;
  readonly publicApiSurface: readonly PublicApiSurfaceSignal[];
  readonly dataSurface: readonly DataSurfaceSignal[];
  readonly configSurface: readonly ConfigSurfaceSignal[];
  readonly externalDependencies: readonly ExternalDependency[];
}

export interface RunInventoryInput {
  readonly rootDir: string;
  readonly survey: Survey;
  readonly ignoredDirNames?: ReadonlySet<string>;
  /** A walk already computed for `rootDir` by `runSurvey` against the same root — supplying it (e.g.
   * `runSurvey`'s own `SurveyResult` does not carry it, so a caller reuses `walkRepository`'s own
   * return value directly) skips this function's own call to `walkRepository`, so one adoption run
   * over a large target repo (`17` §17.1) walks the filesystem once, not once per phase. Left
   * undefined, `runInventory` walks `rootDir` itself, exactly as it always has. */
  readonly files?: readonly WalkedFile[];
}

const MAX_SCANNED_FILE_BYTES = 500_000;
const JS_TS_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);

function extensionOf(relPath: string): string {
  const base = path.posix.basename(relPath);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** Whether `relPath` names a dotenv file (`.env`, `.env.local`, `.env.production`, …) — real config
 * files this extractor must scan for `env-var`/`secret-reference` facts, but which `extensionOf`
 * alone cannot recognise: `.env` itself has its dot at position 0, so `extensionOf('.env')` is `''`
 * (no extension), not `'env'` — confirmed directly, not assumed. Mirrors `survey.ts`'s identical
 * helper; not shared, for the same reason `requiredGroup` above is not. */
function isDotEnvFile(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  return base === '.env' || base.startsWith('.env.');
}

/** Plain code-unit-order comparison, never `localeCompare` (`QUALITY-BAR.md` R10): collation order
 * varies by the host's locale, which would make a fact report non-reproducible across machines. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Reads capture group `index` from `match`. Every call site below only ever passes a group that is
 * mandatory (no `?`) in the pattern that produced the match — safe by construction — but
 * `RegExpMatchArray`'s own type marks every group `string | undefined` regardless, since TypeScript
 * cannot see into a regex literal to know which groups can and cannot fail to participate (confirmed
 * empirically: destructuring the match instead of indexing it does not change this — both are
 * `string | undefined` under `noUncheckedIndexedAccess`). `as string`, not `!`: `!` is banned
 * (`no-non-null-assertion`) elsewhere in this codebase's own `src/**`, with an explicit, commented
 * `as` cast used instead at the identical "loop/regex guarantees this, the type checker cannot see
 * it" shape — `packages/adapter-kit/src/control-tokens/strip.ts`'s own precedent, followed here
 * rather than reinvented. Never a bare `throw new Error` either (`QUALITY-BAR.md` R2): "this tool's
 * own regex disagrees with itself" is a bug in this file, not a fact about the target repository,
 * and has no `ForgeError` code of its own to claim. */
function requiredGroup(match: RegExpMatchArray, index: number): string {
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- `!` is banned; see doc comment above.
  return match[index] as string;
}

/** Like `requiredGroup`, for a pattern (`ENV_VAR_PATTERN`) whose two forms (`process.env.X` vs.
 * `process.env['X']`) populate exactly one of two alternative groups — safe by the same
 * by-construction reasoning `requiredGroup`'s own doc comment gives. */
function firstDefinedGroup(match: RegExpMatchArray, indices: readonly number[]): string {
  const found = indices.map((index) => match[index]).find((value) => value !== undefined);
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- `!` is banned; see `requiredGroup`'s doc comment.
  return found as string;
}

function stripExtension(relPath: string): string {
  const ext = extensionOf(relPath);
  return ext === '' ? relPath : relPath.slice(0, -(ext.length + 1));
}

async function readIfSmallText(absPath: string): Promise<string | undefined> {
  try {
    const stats = await stat(absPath);
    if (!stats.isFile() || stats.size > MAX_SCANNED_FILE_BYTES) return undefined;
    return await readFile(absPath, 'utf8');
  } catch {
    return undefined;
  }
}

/** Every bare specifier from `import ... from '...'`, `import '...'`, `export ... from '...'`, and
 * `require('...')` in `source` — a regex extractor, not a real parser: this is a fact-gathering tool
 * reading arbitrary, possibly-invalid target-repo source (`17` §17.1), not a compiler that must
 * reject malformed input. A file whose imports this misses simply contributes fewer edges, never a
 * thrown error (matching `survey.ts`'s own "facts only, never abort" stance). */
function extractImportSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bimport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

/** Resolves a relative import specifier to a module key in the same shape as `DependencyGraphNode`'s
 * own `module` field (extension stripped), or `undefined` for a bare (non-relative) specifier — a
 * package import, correctly out of scope for an internal dependency graph. Does not check the target
 * exists on disk: `17` §17.2's own graph is built from source, and a broken import is itself a fact
 * (a dangling edge) rather than something to silently drop. */
function resolveRelativeImport(fromModule: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const fromDir = path.posix.dirname(fromModule);
  const resolved = path.posix.normalize(path.posix.join(fromDir, specifier));
  return resolved;
}

function findCyclesDfs(nodes: readonly DependencyGraphNode[]): readonly (readonly string[])[] {
  const byModule = new Map(nodes.map((node) => [node.module, node]));
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(moduleName: string): void {
    if (visited.has(moduleName)) return;
    if (visiting.has(moduleName)) {
      const cycleStart = stack.indexOf(moduleName);
      cycles.push([...stack.slice(cycleStart), moduleName]);
      return;
    }
    visiting.add(moduleName);
    stack.push(moduleName);
    const node = byModule.get(moduleName);
    if (node) {
      for (const imported of node.imports) {
        visit(imported);
      }
    }
    stack.pop();
    visiting.delete(moduleName);
    visited.add(moduleName);
  }

  for (const node of nodes) {
    visit(node.module);
  }
  return cycles;
}

async function buildDependencyGraph(files: readonly WalkedFile[]): Promise<DependencyGraph> {
  const jsFiles = files.filter((file) => JS_TS_EXTENSIONS.has(extensionOf(file.relPath)));
  const moduleByPath = new Map(jsFiles.map((file) => [stripExtension(file.relPath), file]));

  const nodes: DependencyGraphNode[] = [];
  for (const file of jsFiles) {
    const moduleName = stripExtension(file.relPath);
    const text = await readIfSmallText(file.absPath);
    if (text === undefined) {
      nodes.push({ module: moduleName, imports: [] });
      continue;
    }
    const specifiers = extractImportSpecifiers(text);
    const imports = new Set<string>();
    for (const specifier of specifiers) {
      const resolved = resolveRelativeImport(moduleName, specifier);
      if (resolved === undefined) continue;
      // A relative import may spell its own extension explicitly (`./routes.ts`, common in a
      // repository whose runtime supports it, e.g. this one), omit it entirely, or resolve to a
      // directory's `index` — every node in `moduleByPath` is keyed extension-stripped, so the
      // specifier's own extension (if any) must be stripped the same way before comparing.
      const resolvedExt = extensionOf(resolved);
      const resolvedBase = JS_TS_EXTENSIONS.has(resolvedExt) ? stripExtension(resolved) : resolved;
      const candidates = [resolvedBase, `${resolvedBase}/index`];
      const match = candidates.find((candidate) => moduleByPath.has(candidate));
      imports.add(match ?? resolvedBase);
    }
    nodes.push({ module: moduleName, imports: [...imports].sort() });
  }

  nodes.sort((a, b) => compareStrings(a.module, b.module));
  const cycles = findCyclesDfs(nodes);
  return { nodes, cycles };
}

const ROUTE_METHOD_PATTERN =
  /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*['"]([^'"]+)['"]/gi;
const CLI_COMMAND_PATTERN = /\.\s*command\s*\(\s*['"]([^'"]+)['"]/g;
const EXPORT_SYMBOL_PATTERN =
  /^export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+([A-Za-z_$][\w$]*)/gm;
const QUEUE_CONSUMER_PATTERN = /\.\s*(?:consume|subscribe)\s*\(\s*['"]?([^'",)]+)['"]?/g;
const CRON_SCHEDULE_PATTERN = /\bcron\.schedule\s*\(\s*['"]([^'"]+)['"]/g;

async function findPublicApiSurface(
  files: readonly WalkedFile[],
): Promise<readonly PublicApiSurfaceSignal[]> {
  const signals: PublicApiSurfaceSignal[] = [];
  for (const file of files) {
    if (!JS_TS_EXTENSIONS.has(extensionOf(file.relPath))) continue;
    const text = await readIfSmallText(file.absPath);
    if (text === undefined) continue;

    for (const match of text.matchAll(ROUTE_METHOD_PATTERN)) {
      const method = requiredGroup(match, 1);
      const routePath = requiredGroup(match, 2);
      const isWebhook = /webhook/i.test(routePath);
      signals.push({
        kind: isWebhook ? 'webhook' : 'http-route',
        name: `${method.toUpperCase()} ${routePath}`,
        path: file.relPath,
        evidence: match[0],
      });
    }
    for (const match of text.matchAll(CLI_COMMAND_PATTERN)) {
      signals.push({
        kind: 'cli-command',
        name: requiredGroup(match, 1),
        path: file.relPath,
        evidence: match[0],
      });
    }
    for (const match of text.matchAll(EXPORT_SYMBOL_PATTERN)) {
      signals.push({
        kind: 'exported-symbol',
        name: requiredGroup(match, 1),
        path: file.relPath,
        evidence: match[0],
      });
    }
    for (const match of text.matchAll(QUEUE_CONSUMER_PATTERN)) {
      signals.push({
        kind: 'queue-consumer',
        name: requiredGroup(match, 1),
        path: file.relPath,
        evidence: match[0],
      });
    }
    for (const match of text.matchAll(CRON_SCHEDULE_PATTERN)) {
      signals.push({
        kind: 'scheduled-job',
        name: requiredGroup(match, 1),
        path: file.relPath,
        evidence: match[0],
      });
    }
  }
  return signals;
}

const MIGRATION_FILE_PATTERN = /^\d{4,}[-_].+\.(sql|js|ts|py|rb)$/;

async function findDataSurface(
  files: readonly WalkedFile[],
): Promise<readonly DataSurfaceSignal[]> {
  const signals: DataSurfaceSignal[] = [];
  for (const file of files) {
    const segments = file.relPath.split('/');
    const base = path.posix.basename(file.relPath);
    const inMigrationsDir = segments.some((segment) =>
      ['migrations', 'migrate'].includes(segment.toLowerCase()),
    );
    if (inMigrationsDir && MIGRATION_FILE_PATTERN.exec(base)) {
      signals.push({ kind: 'migration', path: file.relPath, name: base });
    }
    if (base === 'schema.prisma') {
      const text = await readIfSmallText(file.absPath);
      if (text !== undefined) {
        for (const match of text.matchAll(/\bmodel\s+([A-Za-z_$][\w$]*)\s*\{/g)) {
          signals.push({ kind: 'orm-entity', path: file.relPath, name: requiredGroup(match, 1) });
        }
      }
    }
  }
  return signals;
}

const ENV_VAR_PATTERN =
  /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;
const SECRET_HINT_PATTERN =
  /\b([A-Za-z0-9_]*(?:SECRET|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY)[A-Za-z0-9_]*)\s*[:=]/g;

async function findConfigSurface(
  files: readonly WalkedFile[],
): Promise<readonly ConfigSurfaceSignal[]> {
  const signals: ConfigSurfaceSignal[] = [];
  for (const file of files) {
    const ext = extensionOf(file.relPath);
    if (!JS_TS_EXTENSIONS.has(ext) && ext !== 'env' && !isDotEnvFile(file.relPath)) {
      continue;
    }
    const text = await readIfSmallText(file.absPath);
    if (text === undefined) continue;
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(ENV_VAR_PATTERN)) {
        const name = firstDefinedGroup(match, [1, 2]);
        signals.push({ kind: 'env-var', name, path: file.relPath, line: index + 1 });
      }
      for (const match of line.matchAll(SECRET_HINT_PATTERN)) {
        signals.push({
          kind: 'secret-reference',
          name: requiredGroup(match, 1),
          path: file.relPath,
          line: index + 1,
        });
      }
    });
  }
  return signals;
}

async function findExternalDependencies(
  files: readonly WalkedFile[],
): Promise<readonly ExternalDependency[]> {
  const dependencies: ExternalDependency[] = [];
  for (const file of files) {
    if (path.posix.basename(file.relPath) !== 'package.json') continue;
    const text = await readIfSmallText(file.absPath);
    if (text === undefined) continue;
    try {
      const pkg = JSON.parse(text) as Record<string, unknown>;
      for (const field of ['dependencies', 'devDependencies']) {
        const section = pkg[field];
        if (section !== null && typeof section === 'object') {
          for (const [name, version] of Object.entries(section as Record<string, unknown>)) {
            dependencies.push({
              name,
              version: typeof version === 'string' ? version : undefined,
              ecosystem: 'npm',
            });
          }
        }
      }
    } catch {
      // Malformed package.json: no external-dependency facts from this file.
    }
  }
  const deduped = new Map(dependencies.map((dep) => [`${dep.name}@${dep.version ?? ''}`, dep]));
  return [...deduped.values()].sort((a, b) => compareStrings(a.name, b.name));
}

/** Runs `17` §17.2 phase 2 against `input.rootDir`. Unlike `runSurvey`, this does not need
 * `input.survey`'s own values to compute anything yet — it is accepted so a future round (blast-radius
 * analysis in `17` §17.4 point 2, for instance) can cross-reference SURVEY facts without changing this
 * function's signature again. */
export async function runInventory(input: RunInventoryInput): Promise<Inventory> {
  const files = input.files ?? (await walkRepository(input.rootDir, input.ignoredDirNames));

  const [dependencyGraph, publicApiSurface, dataSurface, configSurface, externalDependencies] =
    await Promise.all([
      buildDependencyGraph(files),
      findPublicApiSurface(files),
      findDataSurface(files),
      findConfigSurface(files),
      findExternalDependencies(files),
    ]);

  return { dependencyGraph, publicApiSurface, dataSurface, configSurface, externalDependencies };
}
