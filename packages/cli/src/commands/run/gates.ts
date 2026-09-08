/**
 * `loadGateRegistry` — real `.forge/checks/*.gate.yaml` content (written by `forge init` from
 * `@forge/templates`' own shipped gate definitions) parsed into `@forge/engine/gates`' own
 * `GateDefinition` shape, for `createGateEvaluator` (`@forge/engine/dispatch`) to evaluate against.
 *
 * `GateDefinition` is a real subset of what a `.gate.yaml` file actually carries (`name`/`phase`/
 * `autonomyOverride`/`approval`/`evidence` are real, shipped fields `GateDefinition` itself has no use
 * for — `10` §10.3's own gate-authoring surface, not `@forge/engine/gates`' own evaluation contract) —
 * this reads exactly the fields that contract declares, structurally, rather than round-tripping
 * every field a gate file happens to carry.
 *
 * @see specs/10 §10.3
 */
import { listDirEntriesSorted, readTextFile, type ProjectPaths } from '@forge/core/fs';
import type { AdvisoryCheck, DeterministicCheck, GateDefinition } from '@forge/engine/gates';
import * as YAML from 'yaml';

interface RawGateFile {
  readonly id: string;
  readonly checks?: {
    readonly deterministic?: readonly DeterministicCheck[];
    readonly advisory?: readonly AdvisoryCheck[];
  };
  readonly openQuestionsPolicy?: 'block' | 'warn';
}

function toGateDefinition(raw: RawGateFile): GateDefinition {
  return {
    id: raw.id,
    checks: {
      deterministic: raw.checks?.deterministic ?? [],
      advisory: raw.checks?.advisory ?? [],
    },
    openQuestionsPolicy: raw.openQuestionsPolicy ?? 'warn',
  };
}

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
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith('.gate.yaml')) continue;
    const text = await readTextFile(paths.resolveWithin(`${checksRoot}/${entry.name}`));
    const raw = YAML.parse(text) as RawGateFile;
    const definition = toGateDefinition(raw);
    registry.set(definition.id, definition);
  }
  return registry;
}
