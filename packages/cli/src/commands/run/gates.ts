/**
 * `loadGateRegistry` — real `.forge/checks/*.gate.yaml` content (written by `forge init` from
 * `@forge/templates`' own shipped gate definitions) parsed into `@forge/engine/gates`' own
 * `GateDefinition` shape, for `createGateEvaluator` (`@forge/engine/dispatch`) to evaluate against.
 *
 * The document is read STRICTLY (`parseGateDocument`, `@forge/engine/gates`, `PLAN-M13.md` P41): an unknown
 * key, a wrong-typed value, a gate with no deterministic check, or two files claiming one gate id is
 * `GATE-506`, naming the file and the key, never a default. A misspelled `checks:` used to become an empty
 * gate that passed vacuously (the P35 finding). `forge workflow validate --all` (`gateValidateAll`) runs the
 * same validator and reports every problem instead of stopping at the first.
 *
 * `PLAN-M14.md` P20: every real `*.check.yaml` this project's three check roots hold (`discoverCheckFiles`
 * below — `checksRoot` itself, `.forge/overrides/checks/`, `.forge/modules/<id>/checks/` for every
 * currently installed module id) attaches to every gate it names in its own `appliesTo.gates` (`15` §15.7):
 * a `severity: error` check joins that gate's `checks.deterministic` (the same array `evaluateGate`'s own
 * unmodified pass rule already reads); a `severity: warn` one joins `checks.warnings` (evaluated the same
 * way but never able to fail the gate, `@forge/engine/gates`' own `evaluate.ts`). Exactly as strict as a
 * `*.gate.yaml` itself: an unparseable check file, one naming an unknown gate, or one whose id collides
 * with a check the gate already carries (its own, or an earlier attachment) is `GATE-506`, naming the file
 * — one broken check file blocks `gate list/check/approve` for every gate (Q229 D3's stance).
 *
 * @see specs/10 §10.3
 * @see specs/15 §15.7
 */
import { ForgeError } from '@forge/core';
import { listDirEntriesSorted, pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import {
  parseCheckDocument,
  parseGateDocument,
  type DeterministicCheck,
  type GateDefinition,
} from '@forge/engine/gates';
import * as YAML from 'yaml';

const GATE_FILE_SUFFIX = '.gate.yaml';
const CHECK_FILE_SUFFIX = '.check.yaml';
const OVERRIDES_CHECKS_ROOT = '.forge/overrides/checks';
const MANIFEST_REL_PATH = '.forge/manifest.yaml';
/** `buildManifest`'s own synthetic row (`init/manifest.ts`) — never a real `.forge/modules/<id>/`
 * directory of its own, so it is never treated as a module-check root below. */
const SYNTHETIC_TEMPLATES_MODULE_ID = '@forge/templates';

/** One real `*.check.yaml` file a project's check roots hold: `relPath` (resolveWithin-able, to read its
 * content) and `source` (its `.forge/`-stripped display path — `overrides/checks/acme.check.yaml`,
 * `modules/fm-web/checks/a11y.check.yaml` — what `gate list/check/approve/waive --json` shows for every
 * check attached from it). A `checksRoot` outside `.forge/` (every fixture in this package that does not
 * use the real `.forge/checks` convention) keeps its own full relative path instead: there is no shared
 * `.forge/` prefix to imply. */
export interface DiscoveredCheckFile {
  readonly relPath: string;
  readonly source: string;
}

function displaySource(relPath: string): string {
  return relPath.startsWith('.forge/') ? relPath.slice('.forge/'.length) : relPath;
}

/** Every `*.check.yaml` directly under `root`, tolerant of a root that does not exist at all (every real
 * call site below: a project with no overrides, or a module with no `checks/` of its own) — the identical
 * ENOENT-only tolerance `loadGateRegistry`'s own gate-file read uses, factored out so both share it. */
async function listCheckFilesIn(
  paths: ProjectPaths,
  root: string,
): Promise<readonly DiscoveredCheckFile[]> {
  let entries;
  try {
    entries = await listDirEntriesSorted(paths.resolveWithin(root));
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith(CHECK_FILE_SUFFIX))
    .map((entry) => {
      const relPath = `${root}/${entry.name}`;
      return { relPath, source: displaySource(relPath) };
    });
}

/** Every module id `.forge/manifest.yaml` currently lists (`buildManifest`/`moduleAdd`'s own real
 * `modules[].id` rows, `init/manifest.ts`, `commands/module.ts`) — the module roots `*.check.yaml`
 * attachment scans (`.forge/modules/<id>/checks/`; `installBundleTree` already copies a module's own
 * `checks/` there whole, `module.ts:453-470`). Tolerant of a project with no manifest at all (a bare
 * `ProjectPaths` this package's own test fixtures often build directly, never through real `forge init`)
 * or one this call cannot read/parse: gate loading must not become newly fragile to an unrelated manifest
 * problem this piece has no mandate to report — it simply attaches fewer module checks, the same as a
 * module with no real `checks/` directory of its own already does. */
async function installedModuleIds(paths: ProjectPaths): Promise<readonly string[]> {
  try {
    const manifestPath = paths.resolveWithin(MANIFEST_REL_PATH);
    if (!(await pathExists(manifestPath))) return [];
    const raw = YAML.parse(await readTextFile(manifestPath)) as {
      readonly modules?: readonly { readonly id?: unknown }[];
    };
    return (raw.modules ?? [])
      .map((entry) => entry.id)
      .filter(
        (id): id is string =>
          typeof id === 'string' && id !== '' && id !== SYNTHETIC_TEMPLATES_MODULE_ID,
      );
  } catch {
    return [];
  }
}

/** Every real `*.check.yaml` under `checksRoot` (the same directory a project's own `*.gate.yaml` files
 * live in), `.forge/overrides/checks/` and `.forge/modules/<id>/checks/` for every currently installed
 * module id — `15` §15.7's three real check homes, `19` §19.1's own module `checks/*.check.yaml` layout
 * row. Shared by `loadGateRegistry` (below, real attachment) and `gateValidateAll`
 * (`commands/workflow.ts`, static validation of the identical set) so the two can never silently disagree
 * on which files exist to attach or validate. */
export async function discoverCheckFiles(
  paths: ProjectPaths,
  checksRoot: string,
): Promise<readonly DiscoveredCheckFile[]> {
  const moduleIds = await installedModuleIds(paths);
  const roots = [
    checksRoot,
    OVERRIDES_CHECKS_ROOT,
    ...moduleIds.map((id) => `.forge/modules/${id}/checks`),
  ];
  const files: DiscoveredCheckFile[] = [];
  for (const root of roots) {
    files.push(...(await listCheckFilesIn(paths, root)));
  }
  return files;
}

export async function loadGateRegistry(
  paths: ProjectPaths,
  checksRoot: string,
): Promise<ReadonlyMap<string, GateDefinition>> {
  const registry = new Map<string, GateDefinition>();
  // `PLAN-M14.md` P20: a genuinely absent `checksRoot` (ENOENT) no longer returns early — the check
  // roots `discoverCheckFiles` also scans below (`.forge/overrides/checks/`, `.forge/modules/<id>/
  // checks/`) are independent real directories a project can have without `checksRoot` existing at all;
  // a critic round found the previous early return skipped them too, silently, whenever `checksRoot`
  // itself was missing. Tolerant only of "the checks directory genuinely doesn't exist yet" (a real,
  // ordinary state for a project that has never run `forge init`'s own checks-scaffolding step) — any
  // OTHER failure (a permission error, a `resolveWithin` rejection for a bad/denied `checksRoot`) still
  // propagates rather than hiding a real misconfiguration behind a result indistinguishable from "no
  // gates yet." `listDirEntriesSorted` always wraps its own failure as `RUN-034`, so the real Node
  // `ENOENT` (or its absence) lives on `error.cause`, not on `error` itself.
  let entries: Awaited<ReturnType<typeof listDirEntriesSorted>> = [];
  try {
    entries = await listDirEntriesSorted(paths.resolveWithin(checksRoot));
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const missing =
      cause instanceof Error &&
      'code' in cause &&
      (cause as NodeJS.ErrnoException).code === 'ENOENT';
    if (!missing) throw error;
  }
  const fileById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith(GATE_FILE_SUFFIX)) continue;
    const text = await readTextFile(paths.resolveWithin(`${checksRoot}/${entry.name}`));
    let raw: unknown;
    try {
      raw = YAML.parse(text);
    } catch (cause) {
      throw new ForgeError(
        'GATE-506',
        {
          file: entry.name,
          key: '(document)',
          detail: `not parseable YAML (${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : 'unknown error'})`,
        },
        { cause },
      );
    }
    const definition = parseGateDocument(raw, entry.name);
    const firstFile = fileById.get(definition.id);
    if (firstFile !== undefined) {
      throw new ForgeError('GATE-506', {
        file: entry.name,
        key: 'id',
        detail: `gate id "${definition.id}" is also defined by ${firstFile}; only one definition can take effect`,
      });
    }
    fileById.set(definition.id, entry.name);
    registry.set(definition.id, definition);
  }

  // `PLAN-M14.md` P20 — attach every real `*.check.yaml` (see this function's own doc comment above).
  // Every check id already used by a gate (its own native `deterministic`/`advisory` checks, plus every
  // check already attached this same call) is tracked so a genuine collision is caught, `GATE-506`.
  const usedCheckIds = new Map<string, Set<string>>(
    [...registry.entries()].map(([gateId, definition]) => [
      gateId,
      new Set<string>([
        ...definition.checks.deterministic.map((check) => check.id),
        ...definition.checks.advisory.map((check) => check.id),
      ]),
    ]),
  );
  for (const found of await discoverCheckFiles(paths, checksRoot)) {
    const text = await readTextFile(paths.resolveWithin(found.relPath));
    let raw: unknown;
    try {
      raw = YAML.parse(text);
    } catch (cause) {
      throw new ForgeError(
        'GATE-506',
        {
          file: found.source,
          key: '(document)',
          detail: `not parseable YAML (${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : 'unknown error'})`,
        },
        { cause },
      );
    }
    const check = parseCheckDocument(raw, found.source);
    for (const gateId of check.appliesTo.gates) {
      const definition = registry.get(gateId);
      if (definition === undefined) {
        throw new ForgeError('GATE-506', {
          file: found.source,
          key: 'appliesTo.gates',
          detail: `names unknown gate "${gateId}"`,
        });
      }
      const ids = usedCheckIds.get(gateId) ?? new Set<string>();
      usedCheckIds.set(gateId, ids);
      if (ids.has(check.id)) {
        throw new ForgeError('GATE-506', {
          file: found.source,
          key: 'id',
          detail: `check id "${check.id}" is already used by gate "${gateId}"`,
        });
      }
      ids.add(check.id);
      const attached: DeterministicCheck = {
        id: check.id,
        run: check.run,
        ...(check.parser === undefined ? {} : { parser: check.parser }),
        failOn: check.failOn,
        source: found.source,
      };
      registry.set(gateId, {
        ...definition,
        checks:
          check.severity === 'error'
            ? {
                ...definition.checks,
                deterministic: [...definition.checks.deterministic, attached],
              }
            : { ...definition.checks, warnings: [...(definition.checks.warnings ?? []), attached] },
      });
    }
  }

  return registry;
}
