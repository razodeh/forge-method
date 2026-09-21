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
 * @see specs/10 §10.3
 */
import { ForgeError } from '@forge/core';
import { listDirEntriesSorted, readTextFile, type ProjectPaths } from '@forge/core/fs';
import { parseGateDocument, type GateDefinition } from '@forge/engine/gates';
import * as YAML from 'yaml';

export async function loadGateRegistry(
  paths: ProjectPaths,
  checksRoot: string,
): Promise<ReadonlyMap<string, GateDefinition>> {
  const registry = new Map<string, GateDefinition>();
  let entries;
  try {
    entries = await listDirEntriesSorted(paths.resolveWithin(checksRoot));
  } catch (error) {
    // Tolerant only of "the checks directory genuinely doesn't exist yet" (a real, ordinary state for
    // a project that has never run `forge init`'s own checks-scaffolding step) — a critic round
    // caught this catch-all silently reporting "zero gates registered" for any other failure too
    // (a permission error, a `resolveWithin` rejection for a bad/denied `checksRoot`), which would
    // hide a real misconfiguration behind a result indistinguishable from "no gates yet."
    // `listDirEntriesSorted` always wraps its own failure as `RUN-034`, so the real Node `ENOENT` (or
    // its absence) lives on `error.cause`, not on `error` itself.
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return registry;
    }
    throw error;
  }
  const fileById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith('.gate.yaml')) continue;
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
  return registry;
}
