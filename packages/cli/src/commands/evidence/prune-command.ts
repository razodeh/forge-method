/**
 * `runEvidencePrune` — `forge evidence prune [--apply] [--keep <n>]` (`03` §3.2.5), the retention
 * policy `specs/22` M15 P7 deferred.
 *
 * A dry run by default; `--apply` acts. Three steps, in this fixed order, per `18` §18.7:
 *
 * 1. Enumerate every store once, and compute the fixed-point protected set (`enumerate.ts`/
 *    `plan.ts`). A dry run stops here and reports what it WOULD do; nothing on disk has changed.
 * 2. `--apply` only: write a tombstone for every candidate (`tombstone.ts`) — idempotent, so a
 *    concurrent or repeated prune never errors on one it, or another process, already wrote.
 * 3. `--apply` only: enumerate ONE MORE TIME (after every tombstone exists, before any record is
 *    removed) and check whether anything now references a candidate that did not before; only a
 *    candidate still unreferenced is actually removed. One that IS now referenced keeps its
 *    tombstone (a pending removal) and is reported as `pending`, not `removed`.
 *
 * @see specs/03-cli-and-installer.md §3.2.5
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 9
 */
import { rm } from 'node:fs/promises';

import { ForgeError, type Clock } from '@forge/core';
import { pathExists, type AbsolutePath, type ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';

import { CONFIG_REL_PATH, readConfig } from '../config.ts';

import { enumerateEvidence } from './enumerate.ts';
import { computeProtection, computeStillReferenced } from './plan.ts';
import { writeTombstone } from './tombstone.ts';
import { describePruneReason, type EvidenceRecordInfo, type PruneReportEntry } from './types.ts';

/** `paths.reports` (`18` §18.7's own retention text roots every tombstone under it), the project's
 * real, configured reports root, defaulting to `DEFAULT_CONFIG.paths.reports`
 * (`"docs/forge/reports"`) the identical lenient-if-absent way `gate-commands.ts`'s own, private
 * `resolveReportsRoot` already reads `paths.reports` for a written `GateReport` — duplicated here
 * (rather than exported from that file and imported) because `gate-commands.ts` is not in this
 * piece's own Surface to change the exports of, and the duplication is three lines against a config
 * shape that has not changed since M1. */
async function resolveReportsRoot(paths: ProjectPaths): Promise<string> {
  if (!(await pathExists(paths.resolveWithin(CONFIG_REL_PATH)))) {
    return DEFAULT_CONFIG.paths.reports;
  }
  const config = await readConfig(paths);
  return config.paths.reports;
}

/** `.forge/checks` (`10` §10.3's own gate-document root) — the identical literal `bin.ts`'s own
 * `CHECKS_ROOT` constant already uses for every other gate-reading command, duplicated here for the
 * identical "not this piece's Surface to export it from" reason `resolveReportsRoot` above states. */
const CHECKS_ROOT = '.forge/checks';

export interface RunEvidencePruneInput {
  readonly paths: ProjectPaths;
  readonly clock: Clock;
  readonly keep: number;
  readonly apply: boolean;
  /** The real FORGE session marker, when `FORGE_RUN_ID` is set in the calling process's own
   * environment — presence alone is the whole test (`18` §18.7: "whichever run it names"), mirroring
   * `forge parity capture`'s own identical refusal. */
  readonly marker: { readonly runId: string } | undefined;
  /**
   * Test-only synchronization hook, called (when present) after every candidate's tombstone has been
   * written and before the second enumeration pass runs. Never set by `bin.ts`'s own real CLI
   * dispatch — its only real caller is `prune.test.ts`'s own "a record referenced for the first time
   * between the two enumeration passes" test, which has no other reliable way to land a real write
   * inside this exact, genuinely narrow window without a racy, flaky sleep (the REAL cross-process
   * version of this same claim is proven for real, with no hook of any kind, in
   * `prune-multiprocess.test.ts`). A production call never passes this, so it is always a no-op
   * (`?? (async () => {})`) outside a test.
   */
  readonly afterTombstonesForTest?: () => Promise<void>;
}

export interface RunEvidencePruneResult {
  readonly applied: boolean;
  readonly keep: number;
  readonly kept: readonly PruneReportEntry[];
  readonly removed: readonly PruneReportEntry[];
  readonly pending: readonly PruneReportEntry[];
}

function toEntry(record: EvidenceRecordInfo, reason: string): PruneReportEntry {
  return {
    id: record.id,
    type: record.type,
    subject: record.subject,
    relPath: record.relPath,
    reason,
  };
}

/** `--keep <n>`: an integer of at least 1 (`18` §18.7). Validated here, once, before anything else
 * this command does reads a single byte of real project state — the identical "arguments are checked
 * before the config is read" discipline `bin.ts`'s own sibling commands already state as their own
 * convention.
 *
 * @throws {ForgeError} `RUN-143` if `raw` does not parse as a positive integer.
 */
export function parseKeep(raw: string | undefined): number {
  if (raw === undefined) return 5;
  // `Number(raw)` alone would accept "1e1", "0x5", " 5 " and "5.0" as integers by JS coercion rules —
  // none of which a CLI flag's own value should read as a clean positive integer; a strict digit-only
  // pattern (optionally signed, so "-1" and "0" both reach the real refusal with their own real typed
  // value rather than NaN's) is checked first.
  const looksLikeInteger = /^-?\d+$/.test(raw);
  const value = looksLikeInteger ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1) {
    throw new ForgeError('RUN-143', { flag: '--keep', value: raw });
  }
  return value;
}

/** `forge evidence prune` itself. Trusts `input.keep` is already validated (`parseKeep`, above) — the
 * CLI entry point validates arguments before resolving ANY of the real I/O this function performs,
 * so by the time this runs a bad `--keep` has already been refused. */
export async function runEvidencePrune(
  input: RunEvidencePruneInput,
): Promise<RunEvidencePruneResult> {
  if (input.apply && input.marker !== undefined) {
    throw new ForgeError('RUN-144', { runId: input.marker.runId });
  }

  const reportsRoot = await resolveReportsRoot(input.paths);
  const enumeration1 = await enumerateEvidence(input.paths, CHECKS_ROOT);
  const protection = computeProtection(enumeration1, input.keep);

  const kept: PruneReportEntry[] = [];
  const candidates: EvidenceRecordInfo[] = [];
  for (const record of enumeration1.records) {
    const reason = protection.reasons.get(record.id);
    if (reason === undefined) {
      candidates.push(record);
    } else {
      kept.push(toEntry(record, describePruneReason(reason)));
    }
  }

  if (!input.apply) {
    return {
      applied: false,
      keep: input.keep,
      kept,
      removed: candidates.map((record) =>
        toEntry(record, describePruneReason({ kind: 'removed' })),
      ),
      pending: [],
    };
  }

  for (const record of candidates) {
    await writeTombstone(input.paths, reportsRoot, record, input.clock);
  }
  await input.afterTombstonesForTest?.();

  const enumeration2 = await enumerateEvidence(input.paths, CHECKS_ROOT);
  const candidateIds = new Set(candidates.map((record) => record.id));
  const deadBundleIds = new Set(
    candidates.filter((record) => record.type === 'EvidenceBundle').map((record) => record.id),
  );
  const stillReferenced = computeStillReferenced(enumeration2, candidateIds, deadBundleIds);

  const removed: PruneReportEntry[] = [];
  const pending: PruneReportEntry[] = [];
  for (const record of candidates) {
    const by = stillReferenced.has(record.id)
      ? referencingDescription(enumeration2, record.id)
      : undefined;
    if (by === undefined) {
      await removeRecord(input.paths, record);
      removed.push(toEntry(record, describePruneReason({ kind: 'removed' })));
    } else {
      pending.push(toEntry(record, describePruneReason({ kind: 'pending', by })));
    }
  }

  return { applied: true, keep: input.keep, kept, removed, pending };
}

/** A short, human-readable name for whatever newly references `id` in `enumeration` — an `Evidence
 * Bundle`'s own id, or a gate's id, whichever this prune's own second enumeration actually found
 * first. Only ever called for an id `computeStillReferenced` already confirmed IS referenced, so the
 * `undefined` fallback (an internal consistency bug, not a caller-facing state) is never reachable in
 * production. */
function referencingDescription(
  enumeration: Parameters<typeof computeStillReferenced>[0],
  id: string,
): string {
  for (const record of enumeration.records) {
    if (record.type === 'EvidenceBundle' && record.references.includes(id)) return record.id;
  }
  for (const citation of enumeration.gateCitations) {
    if (citation.id === id) return `gate ${citation.gateId}`;
  }
  return 'an unknown store';
}

/**
 * Whether `error` is a raw Node `ENOENT` — the identical minimal type guard `atomic.ts`'s own
 * `errorCode` is, duplicated rather than imported (that one is unexported, and the two call sites are
 * each three lines, the identical "not worth a shared dependency" call this codebase already makes
 * for `errorCode`/`pathExists`).
 *
 * Exported so `removeRecord`'s own real cross-process TOCTOU guard (this piece's report names the
 * real 30-way concurrency finding this function exists for) has at least a direct, in-process unit
 * test of the predicate itself — the guarded branch it feeds (`resolveWithin`'s own `realpathSync`
 * racing a concurrent deletion) has no reliable single-process repro; its real evidence is
 * `prune-multiprocess.test.ts`, which coverage tooling cannot see into (a separate OS process, a
 * separate V8 instance). Disclosed precisely as such in this piece's own report.
 */
export function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Removes `record`'s own file — the second of the two fixed-order steps `18` §18.7 describes, always
 * after its tombstone already exists.
 *
 * `paths.resolveWithin` (not a raw path) is what keeps this containment-checked the identical way
 * every other write/delete into a host project already is (`QUALITY-BAR.md` R12). `@forge/core/fs`
 * exposes no higher-level "delete an artifact" helper (only `writeFileAtomic`/`writeNewFileAtomic`,
 * neither of which deletes), so this calls `node:fs/promises` directly on the resolved,
 * containment-checked path, the identical pattern `collection-lock.ts`'s own lock-file cleanup
 * (`rm(resolved, { force: true })`) already uses.
 *
 * `resolveWithin` itself is resolved in its OWN try/catch, separate from `rm`'s own `{ force: true }`
 * — a REAL finding from this piece's own multi-process testing (30-way concurrency; see this piece's
 * report): `resolveWithin`'s containment check calls `fs.realpathSync` on the deepest existing
 * ancestor of the path (`@forge/core/fs/paths.ts`'s own `realpathOfDeepestExistingAncestor`), which
 * can itself throw a RAW (never-`ForgeError`-wrapped) `ENOENT` if a concurrent process removes this
 * exact file in the real, narrow window between that function's own `existsSync` check and its
 * `realpathSync` call — a genuine TOCTOU race one layer BELOW where `rm`'s own `force: true` can ever
 * help, since there is no resolved path yet to pass it. This is `removeRecord`'s own defensive fix
 * for that race (fully this piece's own Surface — `@forge/core/fs/paths.ts` itself is not, and is
 * disclosed, not changed, in this piece's own report); identical outcome either way: the file is
 * gone, which is exactly what this call wanted.
 */
async function removeRecord(paths: ProjectPaths, record: EvidenceRecordInfo): Promise<void> {
  let resolved: AbsolutePath;
  try {
    resolved = paths.resolveWithin(record.relPath);
  } catch (error) {
    if (isEnoent(error)) return;
    throw error;
  }
  await rm(resolved, { force: true });
}
